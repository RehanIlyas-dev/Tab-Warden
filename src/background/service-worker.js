import { groupDuplicates, normalizeUrl, originOf } from "../lib/tab.js"
import { STORAGE_KEYS, normalizeSettings, pickSettings } from "../lib/messages.js"
import { idleDays, isStale, reclaimableIds, weightScore } from "../lib/weight.js"
import { sweepPlan, sweepSummary } from "../lib/sweep.js"

// The name of the alarm that wakes the worker for an automatic run.
const SWEEP_ALARM = "tab-warden-sweep"

// Once a day. Chrome keeps alarms alive for at least a minute, and a day is
// the shortest period that makes sense for tabs left open for days.
const SWEEP_PERIOD_MINUTES = 24 * 60

// The first run happens about an hour after the user turns the setting on, so
// they do not wait a whole day to see that it works.
const SWEEP_FIRST_RUN_MINUTES = 60

// Converts a chrome.tabs.Tab object to a record suitable for storage and comparison. Returns null if the tab is invalid (e.g. missing an ID or URL).
function toRecord(tab) {
  if (!tab || tab.id === undefined || !tab.url) return null

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

// The record of the last automatic run, or null when there has not been one.
async function readLastSweep() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.lastSweep)
    const record = stored[STORAGE_KEYS.lastSweep]
    return record && typeof record === "object" ? record : null
  } catch {
    return null
  }
}

// Creates or removes the alarm so it matches the setting. Alarms do not
// survive an extension reload, so this also runs on install and on start.
async function ensureSweepAlarm(enabled) {
  try {
    if (!enabled) {
      await chrome.alarms.clear(SWEEP_ALARM)
      return
    }

    const existing = await chrome.alarms.get(SWEEP_ALARM)
    if (existing) return

    chrome.alarms.create(SWEEP_ALARM, {
      delayInMinutes: SWEEP_FIRST_RUN_MINUTES,
      periodInMinutes: SWEEP_PERIOD_MINUTES,
    })
  } catch (error) {
    // A missing alarms API must never stop the worker from starting.
    console.error("[tab-warden] could not set the clean up alarm", error)
  }
}

// Puts the alarm in line with the stored setting.
async function syncSweepAlarm() {
  try {
    const settings = await readSettings()
    await ensureSweepAlarm(settings.autoFreeEnabled)
  } catch (error) {
    console.error("[tab-warden] could not sync the clean up alarm", error)
  }
}

// Frees the tabs that have been left alone for long enough, and records what
// happened. Chrome can still refuse a tab, so the result says what really
// happened and not what was asked for.
async function runSweep() {
  const settings = await readSettings()

  if (!settings.autoFreeEnabled) {
    return { type: "sweep:done", discarded: [], skipped: [], ran: false }
  }

  const now = Date.now()
  const records = await queryRecords()

  // The active tab of every window, because a background run has no window
  // in front of it and must not unload what the user is looking at.
  const activeTabs = await chrome.tabs.query({ active: true })
  const activeTabIds = activeTabs
    .map((tab) => tab?.id)
    .filter((id) => Number.isInteger(id))

  const plan = sweepPlan(records, now, {
    activeTabIds,
    skipPinned: settings.ignorePinnedWhenClosing,
    skipAudible: settings.skipAudibleWhenDiscarding,
    staleAfterDays: settings.staleAfterDays,
  })

  const discarded = []
  const skipped = [...plan.keep]

  for (const id of plan.unload) {
    try {
      // Chrome resolves with the tab, or with nothing when it refused.
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

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastSweep]: {
        at: now,
        discarded: discarded.length,
        skipped: skipped.length,
      },
    })
  } catch {
    // Losing the record of the run is not worth failing the run.
  }

  return { type: "sweep:done", discarded, skipped, ran: true }
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

      const lastSweep = await readLastSweep()

      return {
        type: "audit",
        tabs,
        groups,
        reclaimable,
        staleAfterDays: settings.staleAfterDays,
        autoFreeEnabled: settings.autoFreeEnabled,
        lastSweep: lastSweep ? sweepSummary(lastSweep, now) : null,
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
      // Turning the setting on or off has to move the alarm with it.
      await ensureSweepAlarm(next.autoFreeEnabled)
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

// The alarm that runs the clean up. Any other alarm is left alone.
// The promise is returned so the tests can wait for the run to finish. Chrome
// ignores what a listener returns.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== SWEEP_ALARM) return undefined

  return runSweep().catch((error) => {
    console.error("[tab-warden] clean up failed", error)
  })
})

// A new install, and the browser starting again, both need the alarm back.
// Chrome drops alarms when the extension is reloaded or updated.
// The promise is returned so the tests can wait. Chrome ignores it.
chrome.runtime.onInstalled.addListener(() => {
  return syncSweepAlarm()
})

chrome.runtime.onStartup.addListener(() => {
  return syncSweepAlarm()
})
