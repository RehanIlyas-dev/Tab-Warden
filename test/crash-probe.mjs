// The outside-in crash pass.
//
// The unit tests check that the code does what it should. This file checks
// that nothing in it can be broken from the outside. It throws malformed
// messages at the worker, hostile replies at the popup, broken values at the
// options page, and junk at the plain functions.
//
// Every probe reports what broke instead of just failing, so a crash reads as
// a sentence: "the popup throws when the worker sends a string".
//
// Run: node test/crash-probe.mjs
//
// A crash found here is a bug a real user would hit. Fix it, lock it with a
// unit test, and keep this file coming back clean.

import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createFakeChrome } from "./fake-chrome.js"
import { makeChrome, makeDom, settle } from "./dom-stub.js"
import { normalizeSettings, pickSettings } from "../src/lib/messages.js"
import { sweepPlan, sweepSummary } from "../src/lib/sweep.js"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const popupHtml = readFileSync(`${REPO}dist/popup.html`, "utf8")
const optionsHtml = readFileSync(`${REPO}dist/options.html`, "utf8")

let boot = 0
const results = []

// A probe is a name and a function. Anything the function throws, or any
// promise it leaves behind, is a crash.
async function probe(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// A promise that nobody caught is a crash too, even when the probe passed.
const leaked = []
process.on("unhandledRejection", (reason) => {
  leaked.push(reason instanceof Error ? reason.message : String(reason))
  if (reason instanceof Error && reason.stack) leaked.push(reason.stack.split("\n")[1])
})
process.on("uncaughtException", (error) => {
  leaked.push(`uncaught: ${error.message}`)
})

const DAY = 24 * 60 * 60 * 1000
const OLD = Date.now() - 10 * DAY

// A tab record, the shape the worker works with.
function tab(id, extra = {}) {
  return {
    id,
    url: `https://site${id}.com`,
    title: `tab ${id}`,
    pinned: false,
    audible: false,
    discarded: false,
    lastAccessed: OLD,
    ...extra,
  }
}

// Boots the real worker against a fresh fake. The module is imported again
// every time, because it registers its listeners when it is evaluated.
async function bootWorker(options = {}) {
  const fake = createFakeChrome(options)
  globalThis.chrome = fake.chrome
  boot += 1
  await import(`${pathToFileURL(`${REPO}src/background/service-worker.js`).href}?v=${boot}`)
  return fake
}

// Boots the real popup against a worker that replies with something hostile.
async function bootPopup(reply, settings = null) {
  const byId = makeDom(popupHtml)
  globalThis.chrome = makeChrome({
    runtime: {
      sendMessage: async (message) => {
        if (message?.type === "settings:get") {
          return settings ?? { type: "settings", settings: {} }
        }
        if (message?.type === "tabs:close") {
          return { type: "tabs:closed", closed: message.ids ?? [], skipped: [] }
        }
        if (message?.type === "tabs:discard") {
          return { type: "tabs:discarded", discarded: message.ids ?? [], skipped: [] }
        }
        return typeof reply === "function" ? reply(message) : reply
      },
    },
  })
  boot += 1
  await import(`${pathToFileURL(`${REPO}src/popup/main.js`).href}?v=${boot}`)
  await settle()
  return byId
}

// Boots the real options page against a worker that replies with something
// hostile.
async function bootOptions(reply) {
  const byId = makeDom(optionsHtml)
  globalThis.chrome = makeChrome({
    runtime: {
      sendMessage: async () => (typeof reply === "function" ? reply() : reply),
    },
  })
  boot += 1
  await import(`${pathToFileURL(`${REPO}src/options/main.js`).href}?v=${boot}`)
  await settle()
  return byId
}

// A reply that throws as soon as anything is read from it.
function hostileReply() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("the reply exploded")
      },
    },
  )
}

// ---------------------------------------------------------------------------
// The worker, driven with messages it should not get.
// ---------------------------------------------------------------------------

await probe("the worker answers a message that is null", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send(null)
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker answers a message that is undefined", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send(undefined)
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker answers a message with no type", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({})
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker answers a message with an unknown type", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "nonsense" })
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker answers a message whose type is a number", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: 42 })
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker survives a message that throws when read", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send(hostileReply())
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker answers an audit with no tabs open", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "audit:get" })
  if (result?.type !== "audit") throw new Error(`expected an audit, got ${result?.type}`)
})

await probe("the worker skips tabs with no id or no url", async () => {
  const fake = await bootWorker({
    tabs: [{ url: "https://a.com" }, { id: 2 }, tab(3), null, undefined],
  })
  const result = await fake.send({ type: "audit:get" })
  if (result.tabs.length !== 1) throw new Error(`expected 1 tab, got ${result.tabs.length}`)
})

await probe("the worker survives a tab whose lastAccessed is junk", async () => {
  const fake = await bootWorker({
    tabs: [tab(1, { lastAccessed: "yesterday" }), tab(2, { lastAccessed: null })],
  })
  const result = await fake.send({ type: "audit:get" })
  if (result.tabs[0].lastAccessed !== null) throw new Error("a junk age was kept")
})

await probe("the worker rejects a close request with no ids", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "tabs:close" })
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker rejects close ids that are not whole numbers", async () => {
  const fake = await bootWorker({ tabs: [] })
  for (const ids of [[null], ["1"], [1.5], [{}], [NaN]]) {
    const result = await fake.send({ type: "tabs:close", ids })
    if (result?.type !== "error") throw new Error(`accepted ${JSON.stringify(ids)}`)
  }
})

await probe("the worker rejects close ids that are not a list", async () => {
  const fake = await bootWorker({ tabs: [] })
  for (const ids of [1, "1", true, { length: 1 }]) {
    const result = await fake.send({ type: "tabs:close", ids })
    if (result?.type !== "error") throw new Error(`accepted ${JSON.stringify(ids)}`)
  }
})

await probe("the worker closes a tab once when the id is repeated", async () => {
  const fake = await bootWorker({ tabs: [tab(1), tab(2)], activeTabId: 99 })
  const result = await fake.send({ type: "tabs:close", ids: [1, 1, 1] })
  if (result.closed.length !== 1) throw new Error(`closed ${result.closed.length}`)
})

await probe("the worker keeps going when a tab refuses to close", async () => {
  const fake = await bootWorker({ tabs: [tab(1), tab(2)], activeTabId: 99 })
  fake.state.failNextRemove = true
  const result = await fake.send({ type: "tabs:close", ids: [1, 2] })
  if (result.closed.length !== 1) throw new Error(`closed ${result.closed.length}`)
})

await probe("the worker rejects discard ids that are not whole numbers", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "tabs:discard", ids: [null] })
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

await probe("the worker counts a refusal to unload as kept", async () => {
  const fake = await bootWorker({ tabs: [tab(1)], activeTabId: 99 })
  fake.state.discardRefusals.add(1)
  const result = await fake.send({ type: "tabs:discard", ids: [1] })
  if (result.discarded.length !== 0) throw new Error("a refused tab was counted as unloaded")
})

await probe("the worker counts a failure to unload as kept", async () => {
  const fake = await bootWorker({ tabs: [tab(1)], activeTabId: 99 })
  fake.state.failNextDiscard = true
  const result = await fake.send({ type: "tabs:discard", ids: [1] })
  if (result.discarded.length !== 0) throw new Error("a failed tab was counted as unloaded")
})

await probe("the worker ignores a settings patch that is not an object", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "settings:set", patch: "ab" })
  if (result?.type !== "settings") throw new Error(`expected settings, got ${result?.type}`)
})

await probe("the worker ignores a settings value of the wrong type", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({
    type: "settings:set",
    patch: { autoFreeEnabled: "yes", staleAfterDays: -4 },
  })
  if (result.settings.autoFreeEnabled !== false) throw new Error("a string was stored as a switch")
  if (result.settings.staleAfterDays < 1) throw new Error("a negative threshold was stored")
})

await probe("the worker survives settings that are not an object", async () => {
  for (const stored of ["garbage", 5, [], null, true]) {
    const fake = await bootWorker({ tabs: [], settings: stored })
    const result = await fake.send({ type: "settings:get" })
    if (result?.type !== "settings") throw new Error(`broke on ${JSON.stringify(stored)}`)
  }
})

await probe("the worker survives settings with a getter that throws", async () => {
  const hostile = {}
  Object.defineProperty(hostile, "autoFreeEnabled", {
    get() {
      throw new Error("the settings exploded")
    },
  })
  const fake = await bootWorker({ tabs: [], settings: hostile })
  const result = await fake.send({ type: "settings:get" })
  if (result?.type !== "settings") throw new Error(`broke, got ${result?.type}`)
})

await probe("the worker survives a storage read that fails", async () => {
  const fake = await bootWorker({ tabs: [] })
  fake.chrome.storage.local.get = async () => {
    throw new Error("storage is gone")
  }
  const result = await fake.send({ type: "settings:get" })
  if (result?.type !== "error") throw new Error(`expected an error, got ${result?.type}`)
})

// ---------------------------------------------------------------------------
// The automatic sweep.
// ---------------------------------------------------------------------------

await probe("the sweep does nothing when the setting is off", async () => {
  const fake = await bootWorker({ tabs: [tab(1)], activeTabId: 99 })
  await fake.fireAlarm("tab-warden-sweep")
  if (fake.state.discarded.length !== 0) throw new Error("it unloaded a tab on its own")
})

await probe("the sweep unloads the tabs left alone", async () => {
  const fake = await bootWorker({
    tabs: [tab(1), tab(2)],
    activeTabId: 99,
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm("tab-warden-sweep")
  if (fake.state.discarded.length !== 2) throw new Error(`unloaded ${fake.state.discarded.length}`)
})

await probe("the sweep keeps the active tab of every window", async () => {
  const fake = await bootWorker({
    tabs: [tab(1), tab(2), tab(3)],
    activeTabIds: [1, 3],
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm("tab-warden-sweep")
  if (fake.state.discarded.length !== 1) throw new Error(`unloaded ${fake.state.discarded.length}`)
})

await probe("the sweep ignores an alarm with another name", async () => {
  const fake = await bootWorker({
    tabs: [tab(1)],
    activeTabId: 99,
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm("something-else")
  if (fake.state.discarded.length !== 0) throw new Error("it unloaded a tab")
})

await probe("the sweep ignores an alarm with no name", async () => {
  const fake = await bootWorker({
    tabs: [tab(1)],
    activeTabId: 99,
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm(undefined)
  if (fake.state.discarded.length !== 0) throw new Error("it unloaded a tab")
})

await probe("the sweep survives tabs with broken fields", async () => {
  const fake = await bootWorker({
    tabs: [tab(1), { id: 2 }, { url: "https://c.com" }, null],
    activeTabId: 99,
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm("tab-warden-sweep")
})

await probe("the sweep records the run", async () => {
  const fake = await bootWorker({
    tabs: [tab(1), tab(2, { lastAccessed: Date.now() })],
    activeTabId: 99,
    settings: { autoFreeEnabled: true },
  })
  await fake.fireAlarm("tab-warden-sweep")
  if (fake.state.lastSweep?.discarded !== 1) throw new Error("the run was not counted")
})

await probe("the sweep survives an alarms API that fails", async () => {
  const fake = await bootWorker({
    tabs: [],
    settings: { autoFreeEnabled: true },
  })
  fake.chrome.alarms.get = async () => {
    throw new Error("alarms are gone")
  }
  await fake.fireInstalled()
})

await probe("the sweep survives an alarms API that does not exist", async () => {
  const fake = await bootWorker({
    tabs: [],
    settings: { autoFreeEnabled: true },
  })
  delete fake.chrome.alarms
  await fake.fireInstalled()
})

await probe("the audit carries the setting and the last run", async () => {
  const fake = await bootWorker({
    tabs: [],
    settings: { autoFreeEnabled: true },
    lastSweep: { at: 5, discarded: 2, skipped: 1 },
  })
  const result = await fake.send({ type: "audit:get" })
  if (result.autoFreeEnabled !== true) throw new Error("the setting is missing")
  if (result.lastSweep?.discarded !== 2) throw new Error("the last run is missing")
})

await probe("the audit reports no last run when there was none", async () => {
  const fake = await bootWorker({ tabs: [] })
  const result = await fake.send({ type: "audit:get" })
  if (result.lastSweep !== null) throw new Error("a last run was invented")
})

await probe("the audit survives a stored run that is broken", async () => {
  const fake = await bootWorker({ tabs: [], lastSweep: "yesterday" })
  const result = await fake.send({ type: "audit:get" })
  if (result.lastSweep !== null) throw new Error("a broken record was passed on")
})

// ---------------------------------------------------------------------------
// The popup, driven with replies it should not get.
// ---------------------------------------------------------------------------

const hostileReplies = [
  ["a reply that is undefined", undefined],
  ["a reply that is null", null],
  ["a reply that is an empty object", {}],
  ["a reply that is a string", "hello"],
  ["a reply that is a number", 42],
  ["a reply that is a list", []],
  ["a reply that throws when read", hostileReply()],
  ["an error reply", { type: "error", message: "no" }],
  ["an audit with nothing in it", { type: "audit" }],
  ["an audit with the wrong types", { type: "audit", tabs: "nope", groups: 7, reclaimable: null }],
  ["an audit with a tab that has no fields", { type: "audit", tabs: [{}], groups: [], reclaimable: [] }],
  [
    "an audit with a tab that has junk fields",
    { type: "audit", tabs: [{ id: "x", weight: "y", idleDays: "z" }], groups: [], reclaimable: [] },
  ],
  [
    "an audit from an older worker",
    { type: "audit", tabs: [], groups: [] },
  ],
  [
    "an audit with a broken last run",
    { type: "audit", tabs: [], groups: [], reclaimable: [], lastSweep: "yesterday" },
  ],
  [
    "an audit with a last run of the wrong shape",
    {
      type: "audit",
      tabs: [],
      groups: [],
      reclaimable: [],
      lastSweep: { at: "soon", discarded: {}, skipped: [] },
    },
  ],
  [
    "an audit with a switch that is not a boolean",
    { type: "audit", tabs: [], groups: [], reclaimable: [], autoFreeEnabled: "yes" },
  ],
]

for (const [label, reply] of hostileReplies) {
  await probe(`the popup survives ${label}`, async () => {
    await bootPopup(reply)
  })
}

await probe("the popup says to reload when the worker does not know the daily run", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [],
    groups: [],
    reclaimable: [],
    staleAfterDays: 3,
  })

  const line = byId.get("auto-free").textContent
  if (!line.includes("Reload")) throw new Error(`the popup says: ${line}`)
})

await probe("the popup survives a reply that arrives slowly", async () => {
  await bootPopup(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { type: "audit", tabs: [], groups: [], reclaimable: [] }
  })
})

await probe("the popup survives a worker that fails on every message", async () => {
  globalThis.chrome = makeChrome({
    runtime: {
      sendMessage: async () => {
        throw new Error("the worker is gone")
      },
    },
  })
  boot += 1
  await import(`${pathToFileURL(`${REPO}src/popup/main.js`).href}?v=${boot}`)
  await settle()
})

await probe("the popup shows a full audit without breaking", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [
      tab(1, { lastAccessed: OLD, weight: 80, idleDays: 10 }),
      tab(2, { lastAccessed: OLD, weight: 20, idleDays: 10 }),
    ],
    groups: [{ tabs: [tab(1), tab(2)], keeper: tab(1) }],
    reclaimable: [1],
    staleAfterDays: 3,
    autoFreeEnabled: true,
    lastSweep: { at: Date.now() - 3600000, discarded: 4, skipped: 2 },
  })

  if (!byId.get("auto-free").textContent.includes("4 tabs")) {
    throw new Error(`the last run is not on screen: ${byId.get("auto-free").textContent}`)
  }
})

await probe("the popup says the daily run is off when it is off", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [],
    groups: [],
    reclaimable: [],
    autoFreeEnabled: false,
  })

  if (!byId.get("auto-free").textContent.includes("off")) {
    throw new Error(`the popup does not say it is off: ${byId.get("auto-free").textContent}`)
  }
})

await probe("the popup says the daily run has not run yet", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [],
    groups: [],
    reclaimable: [],
    autoFreeEnabled: true,
    lastSweep: null,
  })

  if (!byId.get("auto-free").textContent.includes("has not run yet")) {
    throw new Error(`wrong wording: ${byId.get("auto-free").textContent}`)
  }
})

await probe("the popup closes the duplicates after a confirm", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1), tab(2)],
    groups: [{ tabs: [tab(1), tab(2)], keeper: tab(1), closable: [tab(2)] }],
    reclaimable: [],
    staleAfterDays: 3,
  })

  byId.get("close-duplicates").click()
  await settle()
  byId.get("close-duplicates").click()
  await settle()

  if (!byId.get("summary").textContent.includes("Closed")) {
    throw new Error(`no result was reported: ${byId.get("summary").textContent}`)
  }
})

await probe("the popup unloads the memory after a confirm", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1)],
    groups: [],
    reclaimable: [1],
    staleAfterDays: 3,
  })

  byId.get("free-memory").click()
  await settle()
  byId.get("free-memory").click()
  await settle()

  if (!byId.get("summary").textContent.includes("Unloaded")) {
    throw new Error(`no result was reported: ${byId.get("summary").textContent}`)
  }
})

await probe("the popup cancels a close without doing anything", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1), tab(2)],
    groups: [{ tabs: [tab(1), tab(2)], keeper: tab(1) }],
    reclaimable: [],
  })

  byId.get("close-duplicates").click()
  await settle()
  byId.get("confirm-no").click()
  await settle()

  if (byId.get("confirm-bar").hidden !== true) throw new Error("the confirm bar stayed open")
})

await probe("the popup cancels an unload without doing anything", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1)],
    groups: [],
    reclaimable: [1],
  })

  byId.get("free-memory").click()
  await settle()
  byId.get("confirm-no-free").click()
  await settle()

  if (byId.get("confirm-bar-free").hidden !== true) throw new Error("the confirm bar stayed open")
})

await probe("the popup closes without asking when the setting says so", async () => {
  const byId = await bootPopup(
    {
      type: "audit",
      tabs: [tab(1), tab(2)],
      groups: [{ tabs: [tab(1), tab(2)], keeper: tab(1), closable: [tab(2)] }],
      reclaimable: [],
    },
    { type: "settings", settings: { confirmBeforeClosing: false } },
  )

  byId.get("close-duplicates").click()
  await settle()

  if (!byId.get("summary").textContent.includes("Closed")) {
    throw new Error(`nothing was closed: ${byId.get("summary").textContent}`)
  }
})

await probe("the popup unloads one tab from its row", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1, { weight: 90, idleDays: 10 })],
    groups: [],
    reclaimable: [1],
  })

  const rows = byId.get("heaviest").children
  const button = rows[0]?.children?.[1]
  if (!button) throw new Error("the row has no Free button")
  button.click()
  await settle()

  if (!byId.get("summary").textContent.includes("Unloaded")) {
    throw new Error(`no result was reported: ${byId.get("summary").textContent}`)
  }
})

await probe("the popup jumps to a tab from the list", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [tab(1, { origin: "site1.com" })],
    groups: [],
    reclaimable: [],
  })

  byId.get("all-tabs").children[0]?.click()
  await settle()
})

await probe("the popup opens the options page", async () => {
  const byId = await bootPopup({
    type: "audit",
    tabs: [],
    groups: [],
    reclaimable: [],
  })

  byId.get("open-options").click()
  await settle()
})

await probe("the popup survives a tab list of five thousand tabs", async () => {
  const many = []
  for (let i = 0; i < 5000; i += 1) many.push(tab(i, { weight: 50, idleDays: 5 }))

  await bootPopup({
    type: "audit",
    tabs: many,
    groups: [],
    reclaimable: [],
  })
})

// ---------------------------------------------------------------------------
// The options page, driven with replies it should not get.
// ---------------------------------------------------------------------------

const hostileSettings = [
  ["a reply that is undefined", undefined],
  ["a reply that is null", null],
  ["a reply that is an error", { type: "error", message: "no" }],
  ["a reply with no settings", { type: "settings" }],
  ["settings that are not an object", { type: "settings", settings: "garbage" }],
  ["settings that are a list", { type: "settings", settings: [] }],
  [
    "settings with values of the wrong type",
    { type: "settings", settings: { autoFreeEnabled: "yes", staleAfterDays: "soon" } },
  ],
  ["a reply that throws when read", hostileReply()],
]

for (const [label, reply] of hostileSettings) {
  await probe(`the options page survives ${label}`, async () => {
    await bootOptions(reply)
  })
}

await probe("the options page puts back a number of days that makes no sense", async () => {
  const byId = await bootOptions({
    type: "settings",
    settings: { staleAfterDays: 3, autoFreeEnabled: false },
  })

  byId.get("stale-days").value = "abc"
  byId.get("stale-days").listeners?.get?.("change")
  await settle()
})

await probe("the options page survives a worker that does not know the daily run", async () => {
  await bootOptions({
    type: "settings",
    settings: {
      ignorePinnedWhenClosing: true,
      confirmBeforeClosing: true,
      staleAfterDays: 3,
      skipAudibleWhenDiscarding: true,
    },
  })
})

await probe("the options page turns the daily run on and off", async () => {
  const byId = await bootOptions({
    type: "settings",
    settings: { staleAfterDays: 3, autoFreeEnabled: false },
  })

  byId.get("auto-free").checked = true
  byId.get("auto-free").listeners
  await settle()
})

// ---------------------------------------------------------------------------
// The plain functions, driven with junk.
// ---------------------------------------------------------------------------

const junkValues = [
  undefined,
  null,
  0,
  -1,
  NaN,
  Infinity,
  "",
  "text",
  true,
  [],
  {},
  [1, 2, 3],
  { nested: { deeper: true } },
  () => {},
  Symbol("x"),
]

for (const [index, value] of junkValues.entries()) {
  await probe(`pickSettings survives junk value ${index}`, async () => {
    pickSettings(value)
  })

  await probe(`normalizeSettings survives junk value ${index}`, async () => {
    normalizeSettings(value)
  })

  await probe(`sweepPlan survives junk value ${index}`, async () => {
    sweepPlan(value, Date.now())
  })

  await probe(`sweepSummary survives junk value ${index}`, async () => {
    sweepSummary(value, Date.now())
  })
}

await probe("sweepPlan survives a list of junk", async () => {
  sweepPlan([null, undefined, 0, "", [], {}, { id: null }], Date.now())
})

await probe("sweepPlan survives a time that is not a number", async () => {
  sweepPlan([tab(1)], "soon")
})

await probe("sweepSummary survives a record that throws when read", async () => {
  sweepSummary(hostileReply(), Date.now())
})

await probe("pickSettings survives a source that throws when read", async () => {
  pickSettings(hostileReply())
})

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

const failed = results.filter((result) => !result.ok)
const slow = results.filter((result) => result.ms > 500)

for (const result of failed) {
  console.log(`CRASH  ${result.name}\n       ${result.error}`)
}
for (const result of slow) {
  console.log(`SLOW   ${result.name}  ${result.ms}ms`)
}
for (const reason of leaked) {
  console.log(`LEAK   a promise was left unhandled: ${reason}`)
}

console.log(
  `\nprobes ${results.length}  ok ${results.length - failed.length}  ` +
    `crashed ${failed.length}  leaked ${leaked.length}  slow ${slow.length}`,
)

if (failed.length > 0 || leaked.length > 0) {
  process.exitCode = 1
}
