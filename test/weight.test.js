import { describe, expect, it } from "vitest"

import {
  byWeight,
  idleDays,
  idleMs,
  isReclaimable,
  isStale,
  reclaimableIds,
  weightLabel,
  weightScore,
} from "../src/lib/weight.js"

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

function tab(extra = {}) {
  return {
    id: extra.id ?? 1,
    lastAccessed: "lastAccessed" in extra ? extra.lastAccessed : NOW,
    audible: extra.audible ?? false,
    pinned: extra.pinned ?? false,
    discarded: extra.discarded ?? false,
    duplicate: extra.duplicate ?? false,
  }
}

function daysAgo(days) {
  return NOW - days * DAY
}

describe("idleMs", () => {
  it("measures the gap since the tab was last used", () => {
    expect(idleMs(tab({ lastAccessed: daysAgo(2) }), NOW)).toBe(2 * DAY)
  })

  it("returns null when Chrome did not report an age", () => {
    expect(idleMs(tab({ lastAccessed: undefined }), NOW)).toBe(null)
    expect(idleMs(tab({ lastAccessed: null }), NOW)).toBe(null)
  })

  it("returns null for an age that is not a number", () => {
    expect(idleMs(tab({ lastAccessed: NaN }), NOW)).toBe(null)
    expect(idleMs(tab({ lastAccessed: Infinity }), NOW)).toBe(null)
  })

  it("returns null when the clock is not a number", () => {
    expect(idleMs(tab(), undefined)).toBe(null)
    expect(idleMs(tab(), NaN)).toBe(null)
  })

  it("never returns a negative gap", () => {
    expect(idleMs(tab({ lastAccessed: NOW + 5000 }), NOW)).toBe(0)
  })
})

describe("idleDays", () => {
  it("converts the gap to whole days", () => {
    expect(idleDays(tab({ lastAccessed: daysAgo(3) }), NOW)).toBe(3)
  })

  it("keeps fractions", () => {
    expect(idleDays(tab({ lastAccessed: daysAgo(1.5) }), NOW)).toBe(1.5)
  })

  it("passes an unknown age through as null", () => {
    expect(idleDays(tab({ lastAccessed: undefined }), NOW)).toBe(null)
  })
})

describe("isStale", () => {
  it("is false for a tab used today", () => {
    expect(isStale(tab(), NOW)).toBe(false)
  })

  it("is false just under the threshold", () => {
    expect(isStale(tab({ lastAccessed: daysAgo(2.5) }), NOW)).toBe(false)
  })

  it("is true exactly at the threshold", () => {
    expect(isStale(tab({ lastAccessed: daysAgo(3) }), NOW)).toBe(true)
  })

  it("is true well past the threshold", () => {
    expect(isStale(tab({ lastAccessed: daysAgo(40) }), NOW)).toBe(true)
  })

  it("is never true when the age is unknown", () => {
    expect(isStale(tab({ lastAccessed: undefined }), NOW)).toBe(false)
  })

  it("falls back to the default for a threshold that is not a positive number", () => {
    const threeDays = tab({ lastAccessed: daysAgo(3) })
    expect(isStale(threeDays, NOW, 0)).toBe(true)
    expect(isStale(threeDays, NOW, -1)).toBe(true)
    expect(isStale(threeDays, NOW, NaN)).toBe(true)
  })

  it("honours a custom threshold", () => {
    const oneDay = tab({ lastAccessed: daysAgo(1) })
    expect(isStale(oneDay, NOW, 7)).toBe(false)
    expect(isStale(oneDay, NOW, 1)).toBe(true)
  })
})

describe("weightScore", () => {
  it("scores a fresh silent tab at zero", () => {
    expect(weightScore(tab(), NOW)).toBe(0)
  })

  it("scores half the threshold as half the idle weight", () => {
    expect(weightScore(tab({ lastAccessed: daysAgo(1.5) }), NOW)).toBe(30)
  })

  it("reaches the heavy threshold right at the stale cutoff", () => {
    expect(weightScore(tab({ lastAccessed: daysAgo(3) }), NOW)).toBe(60)
  })

  it("caps idle time so an ancient tab does not run away", () => {
    expect(weightScore(tab({ lastAccessed: daysAgo(400) }), NOW)).toBe(60)
  })

  it("adds for a tab playing audio in the background", () => {
    expect(weightScore(tab({ audible: true }), NOW)).toBe(25)
  })

  it("adds for a duplicate", () => {
    expect(weightScore(tab({ duplicate: true }), NOW)).toBe(15)
  })

  it("drops a stale tab that is already unloaded", () => {
    expect(weightScore(tab({ lastAccessed: daysAgo(9), discarded: true }), NOW)).toBe(0)
  })

  it("drops a stale tab the user pinned", () => {
    expect(weightScore(tab({ lastAccessed: daysAgo(9), pinned: true }), NOW)).toBe(30)
  })

  it("stacks the signals", () => {
    const heavy = tab({ lastAccessed: daysAgo(9), audible: true, duplicate: true })
    expect(weightScore(heavy, NOW)).toBe(100)
  })

  it("never goes below zero", () => {
    const everySignal = tab({
      lastAccessed: daysAgo(9),
      audible: true,
      duplicate: true,
      discarded: true,
      pinned: true,
    })
    expect(weightScore(everySignal, NOW)).toBe(0)
  })

  it("returns a whole number", () => {
    expect(Number.isInteger(weightScore(tab({ lastAccessed: daysAgo(1.3) }), NOW))).toBe(true)
  })

  it("leaves an unknown age at zero unless another signal applies", () => {
    expect(weightScore(tab({ lastAccessed: undefined }), NOW)).toBe(0)
    expect(weightScore(tab({ lastAccessed: undefined, audible: true }), NOW)).toBe(25)
  })

  it("never returns a number that is not a number", () => {
    expect(Number.isFinite(weightScore(tab(), undefined))).toBe(true)
    expect(Number.isFinite(weightScore(tab({ lastAccessed: NaN }), NOW))).toBe(true)
  })

  it("falls back to the default for a threshold that is not a positive number", () => {
    const oneDay = tab({ lastAccessed: daysAgo(1) })
    expect(weightScore(oneDay, NOW, { staleAfterDays: 0 })).toBe(20)
    expect(weightScore(oneDay, NOW, { staleAfterDays: NaN })).toBe(20)
  })

  it("honours a custom threshold", () => {
    const oneDay = tab({ lastAccessed: daysAgo(1) })
    expect(weightScore(oneDay, NOW, { staleAfterDays: 1 })).toBe(60)
    expect(weightScore(oneDay, NOW, { staleAfterDays: 7 })).toBe(9)
  })
})

describe("weightLabel", () => {
  it("calls the bottom of the range fresh", () => {
    expect(weightLabel(0)).toBe("Fresh")
    expect(weightLabel(29)).toBe("Fresh")
  })

  it("calls the middle warm", () => {
    expect(weightLabel(30)).toBe("Warm")
    expect(weightLabel(59)).toBe("Warm")
  })

  it("calls the top heavy", () => {
    expect(weightLabel(60)).toBe("Heavy")
    expect(weightLabel(100)).toBe("Heavy")
  })

  it("calls a tab with no known age unknown", () => {
    expect(weightLabel(0, false)).toBe("Unknown")
    expect(weightLabel(NaN)).toBe("Unknown")
  })
})

describe("isReclaimable", () => {
  it("allows a stale silent tab", () => {
    expect(isReclaimable(tab({ lastAccessed: daysAgo(5) }), NOW)).toBe(true)
  })

  it("refuses a tab used today", () => {
    expect(isReclaimable(tab({ lastAccessed: daysAgo(1) }), NOW)).toBe(false)
  })

  it("refuses a tab that is already unloaded", () => {
    expect(isReclaimable(tab({ lastAccessed: daysAgo(5), discarded: true }), NOW)).toBe(false)
  })

  it("refuses the active tab", () => {
    const active = tab({ id: 7, lastAccessed: daysAgo(5) })
    expect(isReclaimable(active, NOW, { activeTabId: 7 })).toBe(false)
    expect(isReclaimable(active, NOW, { activeTabId: 99 })).toBe(true)
    expect(isReclaimable(active, NOW)).toBe(true)
  })

  it("refuses a pinned tab unless the caller opts out", () => {
    const pinned = tab({ lastAccessed: daysAgo(5), pinned: true })
    expect(isReclaimable(pinned, NOW)).toBe(false)
    expect(isReclaimable(pinned, NOW, { skipPinned: false })).toBe(true)
  })

  it("refuses a tab playing audio unless the caller opts out", () => {
    const playing = tab({ lastAccessed: daysAgo(5), audible: true })
    expect(isReclaimable(playing, NOW)).toBe(false)
    expect(isReclaimable(playing, NOW, { skipAudible: false })).toBe(true)
  })

  it("refuses a tab with no reported age", () => {
    expect(isReclaimable(tab({ lastAccessed: undefined }), NOW)).toBe(false)
  })

  it("honours a custom threshold", () => {
    const oneDay = tab({ lastAccessed: daysAgo(1) })
    expect(isReclaimable(oneDay, NOW, { staleAfterDays: 1 })).toBe(true)
    expect(isReclaimable(oneDay, NOW, { staleAfterDays: 7 })).toBe(false)
  })

  it("still refuses the active tab when the skips are turned off", () => {
    const active = tab({ id: 7, lastAccessed: daysAgo(9), pinned: true, audible: true })
    const options = { activeTabId: 7, skipPinned: false, skipAudible: false }
    expect(isReclaimable(active, NOW, options)).toBe(false)
  })
})

describe("reclaimableIds", () => {
  it("returns the ids of the stale tabs only", () => {
    const tabs = [
      tab({ id: 1, lastAccessed: daysAgo(5) }),
      tab({ id: 2, lastAccessed: daysAgo(5), pinned: true }),
      tab({ id: 3, lastAccessed: daysAgo(5), audible: true }),
      tab({ id: 4, lastAccessed: daysAgo(5), discarded: true }),
      tab({ id: 5, lastAccessed: NOW }),
      tab({ id: 6, lastAccessed: daysAgo(9) }),
    ]
    expect(reclaimableIds(tabs, NOW)).toEqual([1, 6])
  })

  it("is empty for an empty list", () => {
    expect(reclaimableIds([], NOW)).toEqual([])
  })

  it("can be widened by the caller", () => {
    const tabs = [
      tab({ id: 1, lastAccessed: daysAgo(5), pinned: true }),
      tab({ id: 2, lastAccessed: daysAgo(5), audible: true }),
    ]
    expect(reclaimableIds(tabs, NOW, { skipPinned: false, skipAudible: false })).toEqual([1, 2])
  })
})

describe("byWeight", () => {
  it("puts the heaviest first", () => {
    const fresh = tab({ id: 1 })
    const heavy = tab({ id: 2, lastAccessed: daysAgo(10) })
    const warm = tab({ id: 3, lastAccessed: daysAgo(2) })
    expect(byWeight([fresh, heavy, warm], NOW).map((t) => t.id)).toEqual([2, 3, 1])
  })

  it("puts the older tab first when the scores tie", () => {
    const older = tab({ id: 1, lastAccessed: daysAgo(40) })
    const newer = tab({ id: 2, lastAccessed: daysAgo(6) })
    expect(byWeight([newer, older], NOW).map((t) => t.id)).toEqual([1, 2])
  })

  it("sinks a tab with no reported age behind an equally scored one", () => {
    const unknown = tab({ id: 1, lastAccessed: undefined })
    const fresh = tab({ id: 2 })
    expect(weightScore(unknown, NOW)).toBe(weightScore(fresh, NOW))
    expect(byWeight([unknown, fresh], NOW).map((t) => t.id)).toEqual([2, 1])
  })

  it("does not mutate the list it was given", () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, lastAccessed: daysAgo(9) })]
    byWeight(tabs, NOW)
    expect(tabs.map((t) => t.id)).toEqual([1, 2])
  })

  it("returns an empty list unchanged", () => {
    expect(byWeight([], NOW)).toEqual([])
  })
})
