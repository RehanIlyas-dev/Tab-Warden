import { describe, expect, it, vi } from "vitest"

import { createFakeChrome } from "./fake-chrome.js"
import { DEFAULT_SETTINGS } from "../src/lib/messages.js"

// The worker calls chrome.* while the module is being evaluated, not when a
// message arrives. So a fake has to be installed on globalThis *before* the
// import runs, and the module has to be evaluated again for each test.
//
// bootWorker does both: it makes a fresh fake, puts it on globalThis, clears
// the module cache, then re-imports the worker so it registers its listener on
// this test's fake.
async function bootWorker(options = {}) {
  const fake = createFakeChrome(options)
  globalThis.chrome = fake.chrome

  vi.resetModules()
  await import("../src/background/service-worker.js")

  return fake
}

function tab(id, url, extra = {}) {
  return {
    id,
    url,
    title: extra.title ?? `tab ${id}`,
    pinned: extra.pinned ?? false,
    audible: extra.audible ?? false,
    discarded: extra.discarded ?? false,
    lastAccessed: extra.lastAccessed ?? id * 1000,
    ...extra,
  }
}

describe("audit:get", () => {
  it("returns tabs and groups", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com"), tab(3, "https://b.com")],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.type).toBe("audit")
    expect(result.tabs).toHaveLength(3)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].tabs).toHaveLength(2)
  })

  it("returns an empty audit with no tabs open", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({ type: "audit:get" })

    expect(result.tabs).toEqual([])
    expect(result.groups).toEqual([])
  })

  it("skips tabs with no id or no url", async () => {
    const fake = await bootWorker({
      tabs: [
        { url: "https://a.com", title: "no id" },
        { id: 2, title: "no url" },
        tab(3, "https://c.com"),
      ],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.tabs).toHaveLength(1)
    expect(result.tabs[0].id).toBe(3)
  })

  it("keeps a null lastAccessed when Chrome does not report one", async () => {
    const fake = await bootWorker({
      tabs: [{ id: 1, url: "https://a.com", title: "old" }],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.tabs[0].lastAccessed).toBe(null)
  })

  it("groups urls that differ only by tracking params", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com/p?utm_source=news"), tab(2, "https://a.com/p")],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.groups).toHaveLength(1)
  })

  it("carries a weight and an idle age for every tab", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: 1700000000000 })],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.tabs[0].weight).toBe(60)
    expect(result.tabs[0].idleDays).toBeGreaterThan(3)
    expect(result.staleAfterDays).toBe(3)
  })

  it("marks the tabs that are duplicates", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com"), tab(3, "https://b.com")],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.tabs.find((t) => t.id === 1).duplicate).toBe(true)
    expect(result.tabs.find((t) => t.id === 3).duplicate).toBe(false)
  })

  it("lists the tabs that may be unloaded", async () => {
    const old = Date.now() - 5 * 86400000
    const fake = await bootWorker({
      tabs: [
        tab(1, "https://a.com", { lastAccessed: old }),
        tab(2, "https://b.com", { lastAccessed: old }),
        tab(3, "https://c.com", { lastAccessed: Date.now() }),
      ],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.reclaimable).toEqual([1, 2])
  })

  it("never lists the active tab as reclaimable", async () => {
    const old = Date.now() - 5 * 86400000
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old })],
      activeTabId: 1,
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.reclaimable).toEqual([])
  })

  it("keeps pinned and playing tabs out of the reclaimable list", async () => {
    const old = Date.now() - 5 * 86400000
    const fake = await bootWorker({
      tabs: [
        tab(1, "https://a.com", { lastAccessed: old, pinned: true }),
        tab(2, "https://b.com", { lastAccessed: old, audible: true }),
        tab(3, "https://c.com", { lastAccessed: old }),
      ],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.reclaimable).toEqual([3])
  })

  it("includes pinned and playing tabs when the settings allow it", async () => {
    const old = Date.now() - 5 * 86400000
    const fake = await bootWorker({
      tabs: [
        tab(1, "https://a.com", { lastAccessed: old, pinned: true }),
        tab(2, "https://b.com", { lastAccessed: old, audible: true }),
      ],
      activeTabId: 99,
      settings: { ignorePinnedWhenClosing: false, skipAudibleWhenDiscarding: false },
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.reclaimable).toEqual([1, 2])
  })

  it("honours the stale threshold", async () => {
    const twoDays = Date.now() - 2 * 86400000

    const strict = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: twoDays })],
      activeTabId: 99,
    })
    expect((await strict.send({ type: "audit:get" })).reclaimable).toEqual([])

    const wide = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: twoDays })],
      activeTabId: 99,
      settings: { staleAfterDays: 1 },
    })
    expect((await wide.send({ type: "audit:get" })).reclaimable).toEqual([1])
  })
})

describe("tabs:close", () => {
  it("closes the requested duplicates", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com"), tab(3, "https://b.com")],
      activeTabId: 3,
    })

    const result = await fake.send({ type: "tabs:close", ids: [1] })

    expect(result.closed).toEqual([1])
    expect(fake.state.removed).toEqual([1])
    expect(fake.state.tabs).toHaveLength(2)
  })

  it("never closes the active tab", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com")],
      activeTabId: 1,
    })

    const result = await fake.send({ type: "tabs:close", ids: [1] })

    expect(result.closed).toEqual([])
    expect(result.skipped).toEqual([1])
    expect(fake.state.removed).toEqual([])
  })

  it("skips pinned tabs by default", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { pinned: true }), tab(2, "https://a.com")],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:close", ids: [1] })

    expect(result.closed).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("closes pinned tabs when the setting is off", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { pinned: true }), tab(2, "https://a.com")],
      activeTabId: 99,
      settings: { ignorePinnedWhenClosing: false },
    })

    const result = await fake.send({ type: "tabs:close", ids: [1] })

    expect(result.closed).toEqual([1])
    expect(fake.state.removed).toEqual([1])
  })

  it("skips ids that no longer exist", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com")],
      activeTabId: 2,
    })

    const result = await fake.send({ type: "tabs:close", ids: [999] })

    expect(result.closed).toEqual([])
    expect(result.skipped).toEqual([999])
    expect(fake.state.removed).toEqual([])
  })

  it("keeps closing after one tab fails to close", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com"), tab(3, "https://a.com")],
      activeTabId: 99,
    })

    // Tab 1 vanishes between the audit and the close.
    fake.state.failNextRemove = true

    await fake.send({ type: "tabs:close", ids: [1, 2, 3] })

    expect(fake.state.removed).toEqual([2, 3])
    expect(fake.state.tabs.map((t) => t.id)).toEqual([1])
  })

  it("counts only the tabs that were really closed", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com"), tab(2, "https://a.com"), tab(3, "https://a.com")],
      activeTabId: 99,
    })

    fake.state.failNextRemove = true

    const result = await fake.send({ type: "tabs:close", ids: [1, 2, 3] })

    expect(result.closed).toEqual([2, 3])
    expect(result.skipped).toEqual([1])
    expect(fake.state.removed).toEqual([2, 3])
  })

  it("closes a repeated id once", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com")],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:close", ids: [1, 1, 1] })

    expect(result.closed).toEqual([1])
    expect(fake.state.removed).toEqual([1])
  })

  it("rejects a request that is not a list of ids", async () => {
    const fake = await bootWorker({ tabs: [tab(1, "https://a.com")] })

    for (const ids of [undefined, 5, "12", [null], [{}]]) {
      const result = await fake.send({ type: "tabs:close", ids })
      expect(result.type).toBe("error")
    }

    expect(fake.state.removed).toEqual([])
  })

  it("does nothing for an empty id list", async () => {
    const fake = await bootWorker({ tabs: [tab(1, "https://a.com")], activeTabId: 1 })

    const result = await fake.send({ type: "tabs:close", ids: [] })

    expect(result.closed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(fake.state.removed).toEqual([])
  })
})

describe("tabs:discard", () => {
  const old = Date.now() - 5 * 86400000

  it("unloads the requested tabs", async () => {
    const fake = await bootWorker({
      tabs: [
        tab(1, "https://a.com", { lastAccessed: old }),
        tab(2, "https://b.com", { lastAccessed: old }),
      ],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([1])
    expect(fake.state.discarded).toEqual([1])
    expect(fake.state.tabs[0].discarded).toBe(true)
    expect(fake.state.tabs[1].discarded).toBe(false)
  })

  it("keeps the active tab", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old })],
      activeTabId: 1,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("keeps pinned tabs by default", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old, pinned: true })],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("keeps tabs playing audio by default", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old, audible: true })],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("unloads pinned and playing tabs when the settings allow it", async () => {
    const fake = await bootWorker({
      tabs: [
        tab(1, "https://a.com", { lastAccessed: old, pinned: true }),
        tab(2, "https://b.com", { lastAccessed: old, audible: true }),
      ],
      activeTabId: 99,
      settings: { ignorePinnedWhenClosing: false, skipAudibleWhenDiscarding: false },
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1, 2] })

    expect(result.discarded).toEqual([1, 2])
  })

  it("keeps tabs that are not stale", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: Date.now() })],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("keeps tabs that are already unloaded", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old, discarded: true })],
      activeTabId: 99,
    })

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("counts a refusal as skipped", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old })],
      activeTabId: 99,
    })
    fake.state.discardRefusals.add(1)

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("counts a failure as skipped", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com", { lastAccessed: old })],
      activeTabId: 99,
    })
    fake.state.failNextDiscard = true

    const result = await fake.send({ type: "tabs:discard", ids: [1] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([1])
  })

  it("skips ids that no longer exist", async () => {
    const fake = await bootWorker({ tabs: [], activeTabId: 99 })

    const result = await fake.send({ type: "tabs:discard", ids: [999] })

    expect(result.discarded).toEqual([])
    expect(result.skipped).toEqual([999])
  })

  it("rejects a request that is not a list of ids", async () => {
    const fake = await bootWorker({ tabs: [], activeTabId: 99 })

    for (const ids of [undefined, 5, "12", [null]]) {
      const result = await fake.send({ type: "tabs:discard", ids })
      expect(result.type).toBe("error")
    }
  })
})

describe("settings:get", () => {
  it("returns defaults when nothing is stored", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({ type: "settings:get" })

    expect(result.type).toBe("settings")
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
  })

  it("merges stored values over defaults", async () => {
    const fake = await bootWorker({
      tabs: [],
      settings: { ignorePinnedWhenClosing: false },
    })

    const result = await fake.send({ type: "settings:get" })

    expect(result.settings.ignorePinnedWhenClosing).toBe(false)
    expect(result.settings.confirmBeforeClosing).toBe(true)
  })

  it("ignores a stored value that is not an object", async () => {
    const fake = await bootWorker({ tabs: [], settings: "garbage" })

    const result = await fake.send({ type: "settings:get" })

    expect(result.settings).toEqual(DEFAULT_SETTINGS)
  })

  it("ignores a stored value of the wrong type", async () => {
    const fake = await bootWorker({
      tabs: [],
      settings: { ignorePinnedWhenClosing: "no" },
    })

    const result = await fake.send({ type: "settings:get" })

    expect(result.settings.ignorePinnedWhenClosing).toBe(true)
  })
})

describe("settings:set", () => {
  it("merges a patch without dropping other keys", async () => {
    const fake = await bootWorker({
      tabs: [],
      settings: { ignorePinnedWhenClosing: true },
    })

    const result = await fake.send({
      type: "settings:set",
      patch: { confirmBeforeClosing: false },
    })

    expect(result.settings.confirmBeforeClosing).toBe(false)
    expect(result.settings.ignorePinnedWhenClosing).toBe(true)
    expect(fake.state.settings.confirmBeforeClosing).toBe(false)
  })

  it("does not store a patch that is not an object", async () => {
    const fake = await bootWorker({ tabs: [] })

    await fake.send({ type: "settings:set", patch: "ab" })

    expect(fake.state.settings).toEqual(DEFAULT_SETTINGS)
  })

  it("does not store a value of the wrong type", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({
      type: "settings:set",
      patch: { confirmBeforeClosing: "no" },
    })

    expect(result.settings.confirmBeforeClosing).toBe(true)
  })
})

describe("the message channel", () => {
  it("replies with an error for an unrecognised type", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({ type: "nonsense" })

    expect(result.type).toBe("error")
    expect(result.message).toContain("nonsense")
  })

  it("replies with an error rather than undefined for a missing type", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({})

    expect(result.type).toBe("error")
  })

  it("replies with an error rather than throwing for null", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send(null)

    expect(result.type).toBe("error")
  })

  it("gives a readable error for a message with no type", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send(undefined)

    expect(result.type).toBe("error")
    expect(result.message).toContain("Unknown message type")
  })
})