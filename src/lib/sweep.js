import { isReclaimable } from "./weight.js"

// What an automatic run should do with the tabs it is given.
//
// This is the plan only. Nothing here touches Chrome, so the rules can be
// tested without a browser. The worker runs the plan and reports what really
// happened, because Chrome can still refuse to unload a tab.
//
// options:
//   activeTabIds    ids of the active tab of every window, never unloaded
//   skipPinned      keep pinned tabs, default true
//   skipAudible     keep tabs playing audio, default true
//   staleAfterDays  how many days of not being used counts as stale
export function sweepPlan(tabs, now, options = {}) {
  const unload = []
  const keep = []

  if (!Array.isArray(tabs)) return { unload, keep }

  for (const tab of tabs) {
    // A tab with no id is not a tab. It is skipped, not counted.
    if (!tab || !Number.isInteger(tab.id)) continue

    if (isReclaimable(tab, now, options)) {
      unload.push(tab.id)
    } else {
      keep.push(tab.id)
    }
  }

  return { unload, keep }
}

// The counts and the time of the last run, in the shape the popup reads.
export function sweepSummary(result, now) {
  try {
    const at = Number.isFinite(result?.at) ? result.at : now
    const discarded = Number.isFinite(result?.discarded) ? result.discarded : 0
    const skipped = Number.isFinite(result?.skipped) ? result.skipped : 0

    return { at, discarded, skipped }
  } catch {
    // A record that throws when it is read is treated as no record at all.
    return { at: now, discarded: 0, skipped: 0 }
  }
}
