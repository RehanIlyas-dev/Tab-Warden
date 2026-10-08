import { describe, expect, it, vi } from "vitest"

import { createFakeChrome } from "./fake-chrome.js"

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

  it("groups urls that differ only by tracking params", async () => {
    const fake = await bootWorker({
      tabs: [tab(1, "https://a.com/p?utm_source=news"), tab(2, "https://a.com/p")],
    })

    const result = await fake.send({ type: "audit:get" })

    expect(result.groups).toHaveLength(1)
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

  it("does nothing for an empty id list", async () => {
    const fake = await bootWorker({ tabs: [tab(1, "https://a.com")], activeTabId: 1 })

    const result = await fake.send({ type: "tabs:close", ids: [] })

    expect(result.closed).toEqual([])
    expect(result.skipped).toEqual([])
    expect(fake.state.removed).toEqual([])
  })
})

describe("settings:get", () => {
  it("returns defaults when nothing is stored", async () => {
    const fake = await bootWorker({ tabs: [] })

    const result = await fake.send({ type: "settings:get" })

    expect(result.type).toBe("settings")
    expect(result.settings).toEqual({
      ignorePinnedWhenClosing: true,
      confirmBeforeClosing: true,
    })
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
})