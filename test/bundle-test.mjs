// A check of the built extension, not the source.
//
// The unit tests and the crash pass both import from src/. The file that
// actually ships is dist/assets/*.js, and a build can differ from the source
// in ways no source test would notice. This drives the built worker and the
// built popup the way the browser would.
//
// Run: npm run bundle
// (it builds first, because the built files have to exist)

import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createFakeChrome } from "./fake-chrome.js"
import { makeChrome, makeDom, settle } from "./dom-stub.js"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

const results = []

function check(name, ok, detail = "") {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`)
}

function tab(id, url, extra = {}) {
  return {
    id,
    windowId: 1,
    url,
    title: extra.title ?? `tab ${id}`,
    pinned: extra.pinned ?? false,
    audible: extra.audible ?? false,
    discarded: extra.discarded ?? false,
    lastAccessed: extra.lastAccessed ?? now - 10 * DAY,
    ...extra,
  }
}

let bust = 0
const load = (relative) =>
  import(`${pathToFileURL(`${REPO}${relative}`).href}?v=${++bust}`)

// The fake chrome answers the messages the way the worker does, so the built
// worker can be driven through it.
const fake = createFakeChrome({
  tabs: [
    tab(1, "https://a.com/one"),
    tab(2, "https://a.com/one"),
    tab(3, "https://b.com/two", { lastAccessed: now - 0.1 * DAY }),
    tab(4, "https://c.com/three", { pinned: true }),
    tab(5, "https://d.com/four", { audible: true }),
  ],
  activeTabId: 3,
})
fake.chrome.runtime.sendMessage = (message) => fake.send(message)
fake.chrome.runtime.openOptionsPage = async () => {}
fake.chrome.tabs.update = async () => ({})
fake.chrome.windows = { get: async () => ({ focused: true }), update: async () => ({}) }
globalThis.chrome = fake.chrome

// The built worker.
await load("dist/assets/background.js")

const audit = await fake.send({ type: "audit:get" })
check("the built worker answers an audit", audit.type === "audit", audit.type)
check(
  "the built worker lists reclaimable tabs",
  Array.isArray(audit.reclaimable),
  JSON.stringify(audit.reclaimable),
)
check("the built worker scores the tabs", typeof audit.tabs[0].weight === "number", String(audit.tabs[0].weight))
check("the built worker says the daily run is off", audit.autoFreeEnabled === false, String(audit.autoFreeEnabled))
check("the built worker reports no last run", audit.lastSweep === null, JSON.stringify(audit.lastSweep))

// The built popup.
const popupHtml = readFileSync(`${REPO}dist/popup.html`, "utf8")
const byId = makeDom(popupHtml)
globalThis.chrome = makeChrome({
  runtime: {
    sendMessage: async (message) => {
      if (message?.type === "audit:get") return audit
      if (message?.type === "settings:get") {
        return { type: "settings", settings: { confirmBeforeClosing: true } }
      }
      if (message?.type === "tabs:close") {
        return { type: "tabs:closed", closed: message.ids ?? [], skipped: [] }
      }
      if (message?.type === "tabs:discard") {
        return { type: "tabs:discarded", discarded: message.ids ?? [], skipped: [] }
      }
      return { type: "error", message: "unknown" }
    },
  },
})
await load("dist/assets/popup.js")
await settle()

const stats = byId.get("stats").textContent
check("the built popup renders the stat cards", stats.includes("Reclaimable"), stats)

const heaviest = byId.get("heaviest").children
check("the built popup renders the heaviest rows", heaviest.length === 5, `${heaviest.length} rows`)

const freeButtons = heaviest.filter((row) => row.children[1]?.tagName === "button").length
check("only the reclaimable rows offer a Free button", freeButtons > 0 && freeButtons < 5, `${freeButtons} of 5`)

const allTabs = byId.get("all-tabs").textContent
check(
  "the built popup lists every tab",
  allTabs.includes("tab 1") && allTabs.includes("tab 5"),
  allTabs.slice(0, 100),
)

const autoFree = byId.get("auto-free").textContent
check("the built popup shows the daily run", autoFree.includes("Automatic clean up"), autoFree)
check("the built popup says the daily run is off", autoFree.includes("off"), autoFree)

// The close flow, through the built code.
byId.get("close-duplicates").click()
await settle()
const closeAsked = byId.get("confirm-text").textContent
check("the close confirmation appears", closeAsked.includes("Close"), closeAsked)
byId.get("close-duplicates").click()
await settle()
check(
  "the close flow reports the result",
  byId.get("summary").textContent.includes("Closed"),
  byId.get("summary").textContent,
)

// The unload flow, through the built code.
byId.get("free-memory").click()
await settle()
const freeAsked = byId.get("confirm-text-free").textContent
check("the unload confirmation appears", freeAsked.includes("Unload"), freeAsked)
check(
  "the close button is blocked during the unload confirmation",
  byId.get("close-duplicates").disabled === true,
)
byId.get("free-memory").click()
await settle()
check(
  "the unload flow reports the result",
  byId.get("summary").textContent.includes("Unloaded"),
  byId.get("summary").textContent,
)

// The built options page.
const optionsHtml = readFileSync(`${REPO}dist/options.html`, "utf8")
check(
  "the built options page has the new controls",
  optionsHtml.includes('id="stale-days"') && optionsHtml.includes('id="skip-audible"'),
)
check("the built options page has the daily run switch", optionsHtml.includes('id="auto-free"'))

// Back to the worker, and the daily run.
globalThis.chrome = fake.chrome

const settings = await fake.send({ type: "settings:set", patch: { autoFreeEnabled: true } })
check("the built worker stores the switch", settings.settings.autoFreeEnabled === true)
check("the built worker sets the alarm", fake.state.alarms.has("tab-warden-sweep"))

await fake.fireAlarm("tab-warden-sweep")
check(
  "the built worker unloads the idle tabs",
  fake.state.discarded.length === 2,
  JSON.stringify(fake.state.discarded),
)
check(
  "the built worker records the run",
  fake.state.lastSweep?.discarded === 2,
  JSON.stringify(fake.state.lastSweep),
)

const afterSweep = await fake.send({ type: "audit:get" })
check(
  "the built worker reports the last run",
  afterSweep.lastSweep?.discarded === 2,
  JSON.stringify(afterSweep.lastSweep),
)

await fake.send({ type: "settings:set", patch: { autoFreeEnabled: false } })
check("the built worker clears the alarm", !fake.state.alarms.has("tab-warden-sweep"))

// The built worker against a flood of odd messages.
const odd = []
for (const message of [
  null,
  undefined,
  {},
  { type: "nonsense" },
  { type: "tabs:close" },
  { type: "tabs:discard" },
  { type: "tabs:discard", ids: [null] },
  { type: "settings:set" },
  { type: "settings:set", patch: "x" },
]) {
  try {
    odd.push(await fake.send(message))
  } catch (error) {
    odd.push({ threw: String(error) })
  }
}
check(
  "the built worker answers every odd message",
  odd.every((reply) => reply && reply.type),
  JSON.stringify(odd).slice(0, 200),
)

const alive = await fake.send({ type: "audit:get" })
check("the built worker is still alive", alive.type === "audit", alive.type)

// The built popup again, now that there is a run to show.
globalThis.chrome = makeChrome({
  runtime: {
    sendMessage: async (message) => {
      if (message?.type === "audit:get") return afterSweep
      return { type: "settings", settings: { confirmBeforeClosing: true } }
    },
  },
})
await load("dist/assets/popup.js")
await settle()

const afterSweepLine = byId.get("auto-free").textContent
check(
  "the built popup says how many tabs were freed",
  afterSweepLine.includes("2 tabs"),
  afterSweepLine,
)

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length > 0) process.exitCode = 1
