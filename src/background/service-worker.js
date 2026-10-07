import { groupDuplicates, normalizeUrl, originOf } from "../lib/tab.js"
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../lib/messages.js"

// Converts a chrome.tabs.Tab object to a record suitable for storage and comparison. Returns null if the tab is invalid (e.g. missing an ID or URL).
function toRecord(tab) {
  if (tab.id === undefined || !tab.url) return null

  return {
    id: tab.id,
    title: tab.title ?? tab.url,
    url: tab.url,
    origin: originOf(tab.url),
    normalizedUrl: normalizeUrl(tab.url),
    lastAccessed: tab.lastAccessed ?? 0,
    audible: tab.audible ?? false,
    pinned: tab.pinned ?? false,
    discarded: tab.discarded ?? false,
  }
}

// Returns a list of all tabs in the current window, as records.
async function queryRecords() {
  const tabs = await chrome.tabs.query({})
  const records = []

  for (const tab of tabs) {
    const record = toRecord(tab)
    if (record) records.push(record)
  }
  return records
}

async function readSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.settings] }
}

// Handles a message from the extension pages and returns a response. The response is sent asynchronously via sendResponse, so this function returns a promise.
async function handle(request) {
  switch (request.type) {
    case "audit:get": {
      const tabs = await queryRecords()
      return { type: "audit", tabs, groups: groupDuplicates(tabs) }
    }

    case "tabs:close": {
      const settings = await readSettings()

      // Build a map of the current tabs so we can check if the requested IDs are still alive.
      const live = new Map((await queryRecords()).map((tab) => [tab.id, tab]))
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

      const close = []
      const skipped = []

      for (const id of request.ids) {
        const tab = live.get(id)

        if (!tab) {
          skipped.push(id)
          continue
        }
        // Never close the tab the user is looking at.
        if (activeTab?.id === id) {
          skipped.push(id)
          continue
        }
        if (settings.ignorePinnedWhenClosing && tab.pinned) {
          skipped.push(id)
          continue
        }
        close.push(id)
      }

      // Close the tabs, ignoring any errors (e.g. if the tab was closed by the user in the meantime).
      for (const id of close) {
        await chrome.tabs.remove(id).catch(() => undefined)
      }

      return { type: "tabs:closed", closed: close, skipped }
    }

    case "settings:get":
      return { type: "settings", settings: await readSettings() }

    case "settings:set": {
      const next = { ...(await readSettings()), ...request.patch }
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next })
      return { type: "settings", settings: next }
    }
  }
}

// An Event listener for messages from the extension pages 
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error) => {
      console.error("[tab-warden] message failed", error)
      sendResponse({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    })

  return true
})