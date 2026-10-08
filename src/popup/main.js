import { closableIds } from "../lib/tab.js"
import { focusTab } from "../lib/focus.js"

const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

// Ids the user has agreed to close, or null when no confirmation is pending.Show
// Kept at module scope so the confirm row and the close handler agree.
let pendingIds = null

function totalClosable(groups) {
  return groups.reduce((sum, group) => sum + group.closable.length, 0)
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function renderStats(tabs, groups, closable) {
  const stats = $("#stats")
  stats.innerHTML = ""

  for (const [label, value] of [
    ["Tabs", tabs.length],
    ["Duplicate groups", groups.length],
    ["Closable", closable],
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

  if (tab.pinned) {
    const pin = document.createElement("span")
    pin.className = "badge"
    pin.textContent = "pinned"
    badges.append(pin)
  }
  if (tab.audible) {
    const sound = document.createElement("span")
    sound.className = "badge"
    sound.textContent = "playing"
    badges.append(sound)
  }

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

function setBusy(busy) {
  const button = $("#close-duplicates")
  button.disabled = busy
  button.textContent = busy ? "Closing..." : "Close duplicates"
}

// The confirm row lives inside the popup instead of using window.confirm,
// which renders a native dialog clipped to the popup's 360px width.
function showConfirm(ids) {
  pendingIds = ids
  $("#confirm-bar").hidden = false
  $("#confirm-text").textContent = `Close ${plural(ids.length, "duplicate tab")}?`
  $("#close-duplicates").textContent = "Confirm close"
}

function clearConfirm() {
  pendingIds = null
  $("#confirm-bar").hidden = true
  $("#close-duplicates").textContent = "Close duplicates"
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

async function readAudit() {
  return askWorker({ type: "audit:get" })
}

async function doClose(ids) {
  setBusy(true)

  try {
    const result = await askWorker({ type: "tabs:close", ids })
    clearConfirm()
    await refresh()
    setSummary(describeClose(result))
  } catch (error) {
    clearConfirm()
    setSummary(`Could not close tabs: ${error.message}`)
  } finally {
    setBusy(false)
  }
}

async function closeDuplicates() {
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

  showConfirm(ids)
}

async function refresh() {
  const response = await readAudit()

  if (response.type === "error") {
    setSummary(response.message)
    return
  }

  const closable = totalClosable(response.groups)

  // Every id that belongs to a group of 2 or more. A group's keeper counts as a
  // duplicate too, since it shares its URL with the others.
  const duplicateIds = new Set()
  for (const group of response.groups) {
    for (const tab of group.tabs) {
      duplicateIds.add(tab.id)
    }
  }

  renderStats(response.tabs, response.groups, closable)
  renderDuplicates(response.groups)
  renderAllTabs(response.tabs, duplicateIds)
  $("#close-duplicates").disabled = closable === 0

  if (pendingIds === null && closable === 0) {
    setSummary("Nothing to close.")
  }
}

async function main() {
  $("#close-duplicates").addEventListener("click", () => {
    // If a confirmation is already on screen, this click means "yes".
    if (pendingIds !== null) {
      const ids = pendingIds
      clearConfirm()
      void doClose(ids)
      return
    }
    void closeDuplicates()
  })

  $("#confirm-no").addEventListener("click", () => {
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