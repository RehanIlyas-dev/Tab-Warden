import { closableIds } from "../lib/tab.js"

const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

function totalClosable(groups) {
  return groups.reduce((sum, group) => sum + group.closable.length, 0)
}

// Render the statistics for the popup
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

// Render the list of duplicate tabs
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
      void chrome.tabs.update(group.keeper.id, { active: true })
    })

    row.append(label, focus)
    list.append(row)
  }
}

// Render the list of recently accessed tabs
function renderRecent(tabs) {
  const list = $("#recent")
  list.innerHTML = ""

  const recent = [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 5)

  for (const tab of recent) {
    const row = document.createElement("div")
    row.className = "item"

    const label = document.createElement("span")
    label.className = "title"
    label.textContent = tab.title
    label.title = tab.url

    const origin = document.createElement("span")
    origin.className = "hint"
    origin.textContent = tab.origin

    row.append(label, origin)
    list.append(row)
  }
}

function setSummary(text) {
  $("#summary").textContent = text
}

function setBusy(busy) {
  const button = $("#close-duplicates")
  button.disabled = busy
  button.textContent = busy ? "Closing..." : "Close duplicates"
}

async function readAudit() {
  return askWorker({ type: "audit:get" })
}

function describeClose(result) {
  if (result.type === "error") {
    return `Could not close tabs: ${result.message}`
  }
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

async function closeDuplicates() {
  const response = await readAudit()

  if (response.type === "error") {
    setSummary(response.message)
    return
  }

  const closable = totalClosable(response.groups)
  if (closable === 0) {
    setSummary("Nothing to close.")
    return
  }

  const settings = await askWorker({ type: "settings:get" })

  if (settings.type === "error") {
    setSummary(settings.message)
    return
  }

  if (settings.settings.confirmBeforeClosing) {
    const message = `Close ${closable} duplicate tab${closable === 1 ? "" : "s"}?`
    if (!window.confirm(message)) {
      setSummary("Cancelled.")
      return
    }
  }

  const result = await askWorker({ type: "tabs:close", ids: closableIds(response.groups) })
  await refresh()
  setSummary(describeClose(result))
}

async function refresh() {
  const response = await readAudit()

  if (response.type === "error") {
    setSummary(response.message)
    return
  }

  const closable = totalClosable(response.groups)
  renderStats(response.tabs, response.groups, closable)
  renderDuplicates(response.groups)
  renderRecent(response.tabs)
  $("#close-duplicates").disabled = closable === 0

  if (closable === 0) {
    setSummary("Nothing to close.")
  }
}

async function main() {
  $("#close-duplicates").addEventListener("click", () => {
    setBusy(true)
    void closeDuplicates()
      .catch((error) => setSummary(`Could not close tabs: ${error.message}`))
      .finally(() => setBusy(false))
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