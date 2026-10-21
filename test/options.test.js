import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { makeChrome, makeDom, settle } from "./dom-stub.js"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const optionsHtml = readFileSync(`${REPO}options.html`, "utf8")

// The settings a worker sends when it knows about everything.
const fullSettings = {
  ignorePinnedWhenClosing: true,
  confirmBeforeClosing: true,
  staleAfterDays: 3,
  skipAudibleWhenDiscarding: true,
  autoFreeEnabled: false,
}

// The settings a worker sends when it is older than the page. It does not
// know about the daily clean up.
const oldSettings = {
  ignorePinnedWhenClosing: true,
  confirmBeforeClosing: true,
  staleAfterDays: 3,
  skipAudibleWhenDiscarding: true,
}

// Boots the options page against a worker that replies with something.
async function bootOptions(reply) {
  const byId = makeDom(optionsHtml)
  const sent = []

  globalThis.chrome = makeChrome({
    runtime: {
      sendMessage: async (message) => {
        sent.push(message)
        return typeof reply === "function" ? reply(message) : reply
      },
    },
  })

  vi.resetModules()
  await import("../src/options/main.js")
  await settle()

  return { byId, sent }
}

// Ticks a checkbox the way a click does.
function toggle(byId, id) {
  const box = byId.get(id)
  box.checked = !box.checked
  for (const fn of box.listeners.get("change") ?? []) fn({ target: box })
}

describe("the options page", () => {
  it("shows the stored settings", async () => {
    const { byId } = await bootOptions({ type: "settings", settings: fullSettings })

    expect(byId.get("ignore-pinned").checked).toBe(true)
    expect(byId.get("confirm-before-closing").checked).toBe(true)
    expect(byId.get("skip-audible").checked).toBe(true)
    expect(byId.get("auto-free").checked).toBe(false)
    expect(byId.get("stale-days").value).toBe("3")
  })

  it("saves the daily clean up when it is ticked", async () => {
    const { byId, sent } = await bootOptions({ type: "settings", settings: fullSettings })

    toggle(byId, "auto-free")
    await settle()

    const save = sent.find((message) => message.type === "settings:set")
    expect(save.patch.autoFreeEnabled).toBe(true)
  })

  it("keeps the switch ticked when the worker does not know about it", async () => {
    // This is the bug the user hit. The worker is older than the page, so the
    // reply has no autoFreeEnabled field, and writing undefined into the
    // checkbox unticked it right after the user ticked it.
    const { byId } = await bootOptions({ type: "settings", settings: oldSettings })

    toggle(byId, "auto-free")
    await settle()

    expect(byId.get("auto-free").checked).toBe(true)
  })

  it("says the worker is out of date when it does not know the switch", async () => {
    const { byId } = await bootOptions({ type: "settings", settings: oldSettings })

    expect(byId.get("options-status").textContent).toContain("chrome://extensions")
  })

  it("says nothing is wrong when the worker knows the switch", async () => {
    const { byId } = await bootOptions({ type: "settings", settings: fullSettings })

    expect(byId.get("options-status").textContent).not.toContain("chrome://extensions")
  })

  it("does not write a missing field into a box", async () => {
    // A box the worker said nothing about is left the way the browser has it,
    // which is unticked, instead of being written to with undefined.
    const { byId } = await bootOptions({
      type: "settings",
      settings: { staleAfterDays: 5 },
    })

    expect(byId.get("stale-days").value).toBe("5")
    expect(byId.get("ignore-pinned").checked).toBe(false)
    expect(byId.get("auto-free").checked).toBe(false)
  })

  it("keeps the days that make no sense out of the box", async () => {
    const { byId } = await bootOptions({
      type: "settings",
      settings: { ...fullSettings, staleAfterDays: "soon" },
    })

    expect(byId.get("stale-days").value).not.toBe("soon")
  })

  it("survives a worker that answers with an error", async () => {
    const { byId } = await bootOptions({ type: "error", message: "no" })

    expect(byId.get("options-status").textContent).toContain("no")
  })

  it("survives a worker that fails on every message", async () => {
    const byId = makeDom(optionsHtml)
    globalThis.chrome = makeChrome({
      runtime: {
        sendMessage: async () => {
          throw new Error("the worker is gone")
        },
      },
    })

    vi.resetModules()
    await import("../src/options/main.js")
    await settle()

    expect(byId.get("options-status").textContent).toContain("the worker is gone")
  })
})
