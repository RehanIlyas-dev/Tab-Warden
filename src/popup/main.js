import { closableCount, closableIds } from "../lib/tab.js"
import { focusTab } from "../lib/focus.js"
import { STALE_AFTER_DAYS, idlePhrase, weightLabel } from "../lib/weight.js"

const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

let pending = null
let inFlight = false
let closing = false
let discarding = false

let closable = 0
let reclaimable = 0

let staleAfterDays = 3

// The popup and the worker ship together, but Chrome can keep the previous
// version of the worker alive after an update, so the reply is checked before
// anything is read out of it.
function readAuditResponse(response) {
  return {
    tabs: Array.isArray(response.tabs) ? response.tabs : [],
    groups: Array.isArray(response.groups) ? response.groups : [],
    reclaimable: Array.isArray(response.reclaimable) ? response.reclaimable : [],
    staleAfterDays: Number.isFinite(response.staleAfterDays)
      ? response.staleAfterDays
      : STALE_AFTER_DAYS,
  }
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function chip(text, extra = "") {
  const badge = document.createElement("span")
  badge.className = extra ? `badge ${extra}` : "badge"
  badge.textContent = text
  return badge
}

// The two buttons, the two confirm rows and their labels are worked out in one
// place, so the state of the popup can never disagree with what it shows.
function updateControls() {
  const closeButton = $("#close-duplicates")
  const freeButton = $("#free-memory")
  const kind = pending?.kind ?? null
  const busy = inFlight || closing || discarding

  closeButton.disabled = busy || (closable === 0 && kind !== "close")
  freeButton.disabled = busy || (reclaimable === 0 && kind !== "discard")

  if (kind === "close") freeButton.disabled = true
  if (kind === "discard") closeButton.disabled = true

  closeButton.textContent = closing
    ? "Closing..."
    : kind === "close"
      ? "Confirm close"
      : "Close duplicates"

  freeButton.textContent = discarding
    ? "Freeing..."
    : kind === "discard"
      ? "Confirm free"
      : "Free up memory"

  $("#confirm-bar").hidden = kind !== "close"
  $("#confirm-bar-free").hidden = kind !== "discard"
}

function renderStats(tabs, groups, closable, reclaimable) {
  const stats = $("#stats")
  stats.innerHTML = ""

  for (const [label, value] of [
    ["Tabs", tabs.length],
    ["Groups", groups.length],
    ["Closable", closable],
    ["Reclaimable", reclaimable],
  ]) {
    const box = document.createElement("div")
    box.className = "stat"

    const number = document.createElement("b")
    number.textContent = String(value)

    const caption = document.createElement("span")
    caption.className = "hint"
    caption.textContent = label

    box.append(number, caption)
    stats.append(box)
  }
}

function renderDuplicates(groups) {
  const list = $("#duplicates")
  list.innerHTML = ""

  if (groups.length === 0) {
    const empty = document.createElement("p")
    empty.className = "hint"
    empty.textContent = "No duplicate tabs found."
    list.append(empty)
    return
  }

  for (const group of groups) {
    const row = document.createElement("div")
    row.className = "item"

    const label = document.createElement("span")
    label.className = "title"
    label.textContent = `${group.tabs.length} × ${group.keeper.title}`
    label.title = group.keeper.url

    const focus = document.createElement("button")
    focus.textContent = "Show"
    focus.addEventListener("click", () => {
      void goToTab(group.keeper)
    })

    row.append(label, focus)
    list.append(row)
  }
}

// One row in the Heaviest tabs list, with the estimate, the age, and a button
// to unload it when it is allowed.
function weightRow(tab, reclaimableIds) {
  const row = document.createElement("div")
  row.className = "item weight-item"

  const text = document.createElement("div")
  text.className = "weight-text"

  const title = document.createElement("span")
  title.className = "title"
  title.textContent = tab.title || tab.url
  title.title = tab.url

  const line = document.createElement("div")
  line.className = "weight-line"

  const score = Number.isFinite(tab.weight) ? tab.weight : 0
  const label = weightLabel(score, tab.idleDays !== null)
  const tone = label.toLowerCase()

  const badge = chip(label, `weight-${tone}`)

  const meter = document.createElement("span")
  meter.className = "meter"
  const fill = document.createElement("span")
  fill.className = `meter-fill weight-${tone}`
  fill.style.width = `${score}%`
  meter.append(fill)

  const age = document.createElement("span")
  age.className = "hint"
  age.textContent = idlePhrase(tab.idleDays)

  line.append(badge, meter, age)
  text.append(title, line)

  if (reclaimableIds.has(tab.id)) {
    const free = document.createElement("button")
    free.className = "small"
    free.textContent = "Free"
    free.addEventListener("click", (event) => {
      event.stopPropagation()
      void freeTab(tab.id, free)
    })
    row.append(text, free)
  } else {
    const reasons = document.createElement("span")
    reasons.className = "badges"
    if (tab.pinned) reasons.append(chip("pinned"))
    if (tab.audible) reasons.append(chip("playing"))
    if (tab.idleDays === null) reasons.append(chip("no age"))
    row.append(text, reasons)
  }

  row.addEventListener("click", () => {
    void goToTab(tab)
  })

  return row
}

function renderHeaviest(tabs, reclaimableIds) {
  const list = $("#heaviest")
  list.innerHTML = ""

  if (tabs.length === 0) {
    const empty = document.createElement("p")
    empty.className = "hint"
    empty.textContent = "No tabs open."
    list.append(empty)
    return
  }

  const heaviest = [...tabs]
    .sort((a, b) => b.weight - a.weight || (b.idleDays ?? -1) - (a.idleDays ?? -1))
    .slice(0, 5)

  for (const tab of heaviest) {
    list.append(weightRow(tab, reclaimableIds))
  }
}

// Buckets tabs by site, biggest group first, then most recent inside a group.
//
// duplicateCount is passed in rather than recomputed here, because "duplicate"
// is a fact about the whole tab set. A site can hold five tabs where only two
// are duplicates of each other, and counting the site total would overstate it.
function groupBySite(tabs, duplicateCount) {
  const buckets = new Map()

  for (const tab of tabs) {
    const key = tab.origin || "(unknown)"
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(tab)
    } else {
      buckets.set(key, [tab])
    }
  }

  return [...buckets.entries()]
    .map(([origin, list]) => ({
      origin,
      tabs: [...list].sort((a, b) => b.lastAccessed - a.lastAccessed),
      duplicates: list.filter((tab) => duplicateCount(tab)).length,
    }))
    .sort((a, b) => b.tabs.length - a.tabs.length || a.origin.localeCompare(b.origin))
}

function tabRow(tab) {
  const row = document.createElement("div")
  row.className = "item"

  const label = document.createElement("span")
  label.className = "title"
  label.textContent = tab.title || tab.url
  label.title = tab.url

  const badges = document.createElement("span")
  badges.className = "badges"

  if (tab.pinned) badges.append(chip("pinned"))
  if (tab.audible) badges.append(chip("playing"))
  if (isStale(tab)) badges.append(chip("stale", "stale"))

  const count = document.createElement("span")
  count.className = "hint"
  count.textContent = tab.origin
  badges.append(count)

  // Clicking a row jumps to that tab. The whole row is the target rather than
  // a button, because a 360px popup cannot fit a button per row.
  row.append(label, badges)
  row.addEventListener("click", () => {
    void goToTab(tab)
  })

  return row
}

function isStale(tab) {
  return tab.idleDays !== null && tab.idleDays >= staleAfterDays
}

// duplicateIds is the set of tab ids that appear in more than one group.
function renderAllTabs(tabs, duplicateIds) {
  const list = $("#all-tabs")
  list.innerHTML = ""

  if (tabs.length === 0) {
    const empty = document.createElement("p")
    empty.className = "hint"
    empty.textContent = "No tabs open."
    list.append(empty)
    return
  }

  const isDuplicate = (tab) => duplicateIds.has(tab.id)

  for (const group of groupBySite(tabs, isDuplicate)) {
    const head = document.createElement("div")
    head.className = "group-head"

    const name = document.createElement("span")
    name.className = "group-name"
    name.textContent = group.origin
    name.title = group.origin

    const tally = document.createElement("span")
    tally.className = "hint"
    const parts = [plural(group.tabs.length, "tab")]
    // Only mention duplicates when this site actually has some.
    if (group.duplicates > 0) {
      parts.push(plural(group.duplicates, "duplicate"))
    }
    tally.textContent = parts.join(", ")

    head.append(name, tally)
    list.append(head)

    for (const tab of group.tabs) {
      list.append(tabRow(tab))
    }
  }
}

function setSummary(text) {
  $("#summary").textContent = text
}

// Switches to a tab and reports back. focusTab itself never throws, so a
// failure lands in the footer instead of vanishing into a rejected promise,
// which is what made this button look dead.
async function goToTab(tab) {
  const result = await focusTab({ tabs: chrome.tabs, windows: chrome.windows }, tab)

  if (!result.ok) {
    setSummary(`Could not switch tab: ${result.error}`)
  } else if (result.focusedTab && !result.focusedWindow && result.error) {
    setSummary("Switched tab, but could not raise the window.")
  } else {
    setSummary(`Switched to ${tab.title || tab.url}`)
  }
}

// The confirm rows live inside the popup instead of using window.confirm,
// which renders a native dialog clipped to the popup's 360px width.
function showConfirm(kind, ids) {
  pending = { kind, ids }

  if (kind === "close") {
    $("#confirm-text").textContent = `Close ${plural(ids.length, "duplicate tab")}?`
  } else {
    $("#confirm-text-free").textContent = `Unload ${plural(ids.length, "tab")}? They reload when you click them.`
  }

  updateControls()
}

function clearConfirm() {
  pending = null
  updateControls()
}

function describeClose(result) {
  if (result.closed.length === 0 && result.skipped.length === 0) {
    return "Nothing was closed."
  }

  const parts = []
  if (result.closed.length > 0) {
    parts.push(`Closed ${result.closed.length}.`)
  }
  if (result.skipped.length > 0) {
    parts.push(`Kept ${result.skipped.length}.`)
  }
  return parts.join(" ")
}

function describeDiscard(result) {
  if (result.discarded.length === 0 && result.skipped.length === 0) {
    return "Nothing was unloaded."
  }

  const parts = []
  if (result.discarded.length > 0) {
    parts.push(`Unloaded ${result.discarded.length}.`)
  }
  if (result.skipped.length > 0) {
    parts.push(`Kept ${result.skipped.length}.`)
  }
  return parts.join(" ")
}

async function readAudit() {
  return askWorker({ type: "audit:get" })
}

async function doClose(ids) {
  closing = true
  updateControls()

  try {
    const result = await askWorker({ type: "tabs:close", ids })
    clearConfirm()
    await refresh()

    if (result.type === "error") {
      setSummary(result.message)
      return
    }

    setSummary(describeClose(result))
  } catch (error) {
    clearConfirm()
    setSummary(`Could not close tabs: ${error.message}`)
  } finally {
    closing = false
    updateControls()
  }
}

async function closeDuplicates() {
  if (inFlight) return

  inFlight = true
  updateControls()

  try {
    const response = await readAudit()

    if (response.type === "error") {
      setSummary(response.message)
      return
    }

    const ids = closableIds(response.groups)

    if (ids.length === 0) {
      setSummary("Nothing to close.")
      return
    }

    const settings = await askWorker({ type: "settings:get" })

    if (settings.type === "error") {
      setSummary(settings.message)
      return
    }

    if (!settings.settings.confirmBeforeClosing) {
      await doClose(ids)
      return
    }

    showConfirm("close", ids)
  } catch (error) {
    setSummary(`Could not read tabs: ${error.message}`)
  } finally {
    inFlight = false
    updateControls()
  }
}

async function doDiscard(ids) {
  discarding = true
  updateControls()

  try {
    const result = await askWorker({ type: "tabs:discard", ids })
    clearConfirm()
    await refresh()

    if (result.type === "error") {
      setSummary(result.message)
      return
    }

    setSummary(describeDiscard(result))
  } catch (error) {
    clearConfirm()
    setSummary(`Could not unload tabs: ${error.message}`)
  } finally {
    discarding = false
    updateControls()
  }
}

// Unloads one tab, straight from its row, with no confirmation.
async function freeTab(id, button) {
  button.disabled = true

  try {
    const result = await askWorker({ type: "tabs:discard", ids: [id] })

    if (result.type === "error") {
      setSummary(result.message)
      return
    }

    await refresh()

    if (result.discarded.length > 0) {
      setSummary("Unloaded 1 tab.")
    } else {
      setSummary("That tab was kept.")
    }
  } catch (error) {
    setSummary(`Could not unload the tab: ${error.message}`)
  }
}

async function freeMemory() {
  if (inFlight) return

  inFlight = true
  updateControls()

  try {
    const response = await readAudit()

    if (response.type === "error") {
      setSummary(response.message)
      return
    }

    const ids = readAuditResponse(response).reclaimable

    if (ids.length === 0) {
      setSummary("Nothing to unload.")
      return
    }

    showConfirm("discard", ids)
  } catch (error) {
    setSummary(`Could not read tabs: ${error.message}`)
  } finally {
    inFlight = false
    updateControls()
  }
}

async function refresh() {
  const response = await readAudit()

  if (response.type === "error") {
    setSummary(response.message)
    return
  }

  if (response.type !== "audit") {
    setSummary("The background worker sent an unexpected reply.")
    return
  }

  const audit = readAuditResponse(response)

  closable = closableCount(audit.groups)
  reclaimable = audit.reclaimable.length
  staleAfterDays = audit.staleAfterDays

  // Every id that belongs to a group of 2 or more. A group's keeper counts as a
  // duplicate too, since it shares its URL with the others.
  const duplicateIds = new Set()
  for (const group of audit.groups) {
    for (const tab of group.tabs) {
      duplicateIds.add(tab.id)
    }
  }

  renderStats(audit.tabs, audit.groups, closable, reclaimable)
  renderDuplicates(audit.groups)
  renderHeaviest(audit.tabs, new Set(audit.reclaimable))
  renderAllTabs(audit.tabs, duplicateIds)
  updateControls()

  // The worker is missing the fields this popup needs, so it is an older one.
  if (response.reclaimable === undefined) {
    setSummary("Reload the extension to refresh the background worker.")
    return
  }

  if (pending === null && closable === 0 && reclaimable === 0) {
    setSummary("Nothing to close or unload.")
  }
}

async function main() {
  $("#close-duplicates").addEventListener("click", () => {
    // If a confirmation is already on screen, this click means "yes".
    if (pending?.kind === "close") {
      const ids = pending.ids
      clearConfirm()
      void doClose(ids)
      return
    }
    void closeDuplicates()
  })

  $("#free-memory").addEventListener("click", () => {
    if (pending?.kind === "discard") {
      const ids = pending.ids
      clearConfirm()
      void doDiscard(ids)
      return
    }
    void freeMemory()
  })

  $("#confirm-no").addEventListener("click", () => {
    clearConfirm()
    setSummary("Cancelled.")
  })

  $("#confirm-no-free").addEventListener("click", () => {
    clearConfirm()
    setSummary("Cancelled.")
  })

  $("#open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage()
  })

  try {
    await refresh()
  } catch (error) {
    setSummary(`Could not read tabs: ${error.message}`)
  }
}

void main()
