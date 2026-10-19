import { groupDuplicates, normalizeUrl, originOf } from "../lib/tab.js"
import { STORAGE_KEYS, normalizeSettings, pickSettings } from "../lib/messages.js"
import { idleDays, isStale, reclaimableIds, weightScore } from "../lib/weight.js"

// Converts a chrome.tabs.Tab object to a record suitable for storage and comparison. Returns null if the tab is invalid (e.g. missing an ID or URL).
function toRecord(tab) {
  if (tab.id === undefined || !tab.url) return null

  return {
    id: tab.id,
    // Carried so the popup can bring the owning window forward. Without it a
    // tab in another window cannot be focused properly.
    windowId: tab.windowId,
    title: tab.title ?? tab.url,
    url: tab.url,
    origin: originOf(tab.url),
    normalizedUrl: normalizeUrl(tab.url),
    // Chrome only reports lastAccessed from 121, and null is not the epoch.
    lastAccessed: Number.isFinite(tab.lastAccessed) ? tab.lastAccessed : null,
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
  return normalizeSettings(stored[STORAGE_KEYS.settings])
}

// The tab the user is looking at, which is never closed and never unloaded.
async function queryActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return activeTab
}

// Handles a message from the extension pages and returns a response. The response is sent asynchronously via sendResponse, so this function returns a promise.
async function handle(request) {
  switch (request?.type) {
    case "audit:get": {
      const settings = await readSettings()
      const now = Date.now()
      const records = await queryRecords()
      const groups = groupDuplicates(records)
      const activeTab = await queryActiveTab()

      // Being a duplicate is a fact about the whole set, not about one tab.
      const duplicateIds = new Set(
        groups.flatMap((group) => group.tabs.map((tab) => tab.id)),
      )

      const tabs = records.map((record) => ({
        ...record,
        duplicate: duplicateIds.has(record.id),
        weight: weightScore(record, now, { staleAfterDays: settings.staleAfterDays }),
        idleDays: idleDays(record, now),
      }))

      const reclaimable = reclaimableIds(tabs, now, {
        activeTabId: activeTab?.id,
        skipPinned: settings.ignorePinnedWhenClosing,
        skipAudible: settings.skipAudibleWhenDiscarding,
        staleAfterDays: settings.staleAfterDays,
      })

      return {
        type: "audit",
        tabs,
        groups,
        reclaimable,
        staleAfterDays: settings.staleAfterDays,
      }
    }

    case "tabs:close": {
      const settings = await readSettings()

      if (!Array.isArray(request.ids) || request.ids.some((id) => !Number.isInteger(id))) {
        return { type: "error", message: "tabs:close needs a list of whole tab ids" }
      }

      // The same id twice would be closed twice.
      const wanted = [...new Set(request.ids)]

      // Build a map of the current tabs so we can check if the requested IDs are still alive.
      const live = new Map((await queryRecords()).map((tab) => [tab.id, tab]))
      const activeTab = await queryActiveTab()

      const close = []
      const skipped = []

      for (const id of wanted) {
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

      const closed = []

      for (const id of close) {
        try {
          await chrome.tabs.remove(id)
          closed.push(id)
        } catch {
          // The tab was closed by the user in the meantime, so we did not close it.
          skipped.push(id)
        }
      }

      return { type: "tabs:closed", closed, skipped }
    }

    case "tabs:discard": {
      const settings = await readSettings()

      if (!Array.isArray(request.ids) || request.ids.some((id) => !Number.isInteger(id))) {
        return { type: "error", message: "tabs:discard needs a list of whole tab ids" }
      }

      const wanted = [...new Set(request.ids)]
      const now = Date.now()
      const live = new Map((await queryRecords()).map((tab) => [tab.id, tab]))
      const activeTab = await queryActiveTab()

      const discarded = []
      const skipped = []

      for (const id of wanted) {
        const tab = live.get(id)

        if (!tab) {
          skipped.push(id)
          continue
        }
        if (tab.discarded) {
          skipped.push(id)
          continue
        }
        if (activeTab?.id === id) {
          skipped.push(id)
          continue
        }
        // The pinned setting covers closing and unloading, one switch for both.
        if (settings.ignorePinnedWhenClosing && tab.pinned) {
          skipped.push(id)
          continue
        }
        if (settings.skipAudibleWhenDiscarding && tab.audible) {
          skipped.push(id)
          continue
        }
        if (!isStale(tab, now, settings.staleAfterDays)) {
          skipped.push(id)
          continue
        }

        try {
          // chrome.tabs.discard resolves with the tab, or with nothing when it
          // refused, so the return value is the only honest check.
          const result = await chrome.tabs.discard(id)
          if (result) {
            discarded.push(id)
          } else {
            skipped.push(id)
          }
        } catch {
          skipped.push(id)
        }
      }

      return { type: "tabs:discarded", discarded, skipped }
    }

    case "settings:get":
      return { type: "settings", settings: await readSettings() }

    case "settings:set": {
      const current = await readSettings()
      const next = normalizeSettings({ ...current, ...pickSettings(request.patch) })
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next })
      return { type: "settings", settings: next }
    }

    default:
      // Without this, an unrecognised type falls out of the switch as
      // undefined. sendResponse(undefined) would leave the popup reading
      // .type of undefined, so every unrecognised message becomes a
      // TypeError instead of a readable error.
      return { type: "error", message: `Unknown message type: ${request?.type}` }
  }
}

// An event listener for messages from the extension pages
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
