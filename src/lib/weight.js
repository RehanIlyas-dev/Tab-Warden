// Estimated cost of a tab, from the fields Chrome exposes. Not real memory:
export const STALE_AFTER_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

// Idle time alone reaches the Heavy threshold right at the stale cutoff.
const IDLE_MAX = 60
const AUDIBLE = 25
const DUPLICATE = 15
const DISCARDED = -80
const PINNED = -30

// A threshold that is not a positive number would mark every tab stale, or no
// tab at all, so anything odd falls back to the default.
function resolveDays(value) {
  return Number.isFinite(value) && value > 0 ? value : STALE_AFTER_DAYS
}

// Milliseconds since the tab was last used, or null when Chrome did not say.
export function idleMs(tab, now) {
  if (!Number.isFinite(tab?.lastAccessed) || !Number.isFinite(now)) return null
  return Math.max(0, now - tab.lastAccessed)
}

// Days since the tab was last used, or null when unknown.
export function idleDays(tab, now) {
  const ms = idleMs(tab, now)
  return ms === null ? null : ms / DAY_MS
}

// Past the threshold, or false when the age is unknown.
export function isStale(tab, now, staleAfterDays = STALE_AFTER_DAYS) {
  const days = idleDays(tab, now)
  return days !== null && days >= resolveDays(staleAfterDays)
}

// 0 to 100. tab.duplicate is set by the caller.
export function weightScore(tab, now, options = {}) {
  const staleAfterDays = resolveDays(options.staleAfterDays ?? STALE_AFTER_DAYS)
  const days = idleDays(tab, now)

  let score = 0

  if (days !== null) {
    score += Math.min(days / staleAfterDays, 1) * IDLE_MAX
  }
  if (tab?.audible) score += AUDIBLE
  if (tab?.duplicate) score += DUPLICATE
  if (tab?.discarded) score += DISCARDED
  if (tab?.pinned) score += PINNED

  return Math.max(0, Math.min(100, Math.round(score)))
}

// Fresh, Warm or Heavy. A tab with no known age is not Fresh, it is unknown.
export function weightLabel(score, known = true) {
  if (!known || !Number.isFinite(score)) return "Unknown"
  if (score >= 60) return "Heavy"
  if (score >= 30) return "Warm"
  return "Fresh"
}

// A short phrase for how long a tab has been idle.
export function idlePhrase(days) {
  if (days === null || !Number.isFinite(days)) return "last used an unknown time ago"
  if (days < 1 / 24) return "last used a moment ago"
  if (days < 1) {
    const hours = Math.round(days * 24)
    return hours === 1 ? "last used an hour ago" : `last used ${hours} hours ago`
  }
  if (days < 2) return "last used yesterday"
  return `last used ${Math.floor(days)} days ago`
}

// Guards: never the active tab, skips pinned and audio unless told otherwise.
export function isReclaimable(tab, now, options = {}) {
  if (!tab) return false
  if (tab.discarded) return false
  if (typeof options.activeTabId === "number" && tab.id === options.activeTabId) return false
  if (options.skipPinned !== false && tab.pinned) return false
  if (options.skipAudible !== false && tab.audible) return false
  return isStale(tab, now, options.staleAfterDays)
}

// Ids of every tab that may be unloaded.
export function reclaimableIds(tabs, now, options = {}) {
  return tabs.filter((tab) => isReclaimable(tab, now, options)).map((tab) => tab.id)
}

// Heaviest first, older tab first on a tie.
export function byWeight(tabs, now, options = {}) {
  return [...tabs].sort((a, b) => {
    const gap = weightScore(b, now, options) - weightScore(a, now, options)
    if (gap !== 0) return gap

    const idleA = idleMs(a, now)
    const idleB = idleMs(b, now)
    return (idleB ?? -1) - (idleA ?? -1)
  })
}
