import { describe, expect, it } from "vitest"

import { sweepPlan, sweepSummary } from "../src/lib/sweep.js"

const DAY = 24 * 60 * 60 * 1000
const NOW = 1700000000000

function tab(id, extra = {}) {
  return {
    id,
    url: `https://site${id}.com`,
    title: `tab ${id}`,
    pinned: false,
    audible: false,
    discarded: false,
    lastAccessed: NOW - 10 * DAY,
    ...extra,
  }
}

describe("sweepPlan", () => {
  it("unloads a tab that has been left alone", () => {
    const plan = sweepPlan([tab(1)], NOW)

    expect(plan.unload).toEqual([1])
    expect(plan.keep).toEqual([])
  })

  it("keeps a tab that was used recently", () => {
    const plan = sweepPlan([tab(1, { lastAccessed: NOW - 1000 })], NOW)

    expect(plan.unload).toEqual([])
    expect(plan.keep).toEqual([1])
  })

  it("keeps the active tab of every window", () => {
    const plan = sweepPlan([tab(1), tab(2), tab(3)], NOW, { activeTabIds: [1, 3] })

    expect(plan.unload).toEqual([2])
    expect(plan.keep).toEqual([1, 3])
  })

  it("keeps a single active tab given by id", () => {
    const plan = sweepPlan([tab(1), tab(2)], NOW, { activeTabId: 2 })

    expect(plan.unload).toEqual([1])
  })

  it("keeps pinned tabs by default", () => {
    const plan = sweepPlan([tab(1, { pinned: true })], NOW)

    expect(plan.unload).toEqual([])
  })

  it("unloads pinned tabs when told to", () => {
    const plan = sweepPlan([tab(1, { pinned: true })], NOW, { skipPinned: false })

    expect(plan.unload).toEqual([1])
  })

  it("keeps tabs that are playing audio by default", () => {
    const plan = sweepPlan([tab(1, { audible: true })], NOW)

    expect(plan.unload).toEqual([])
  })

  it("unloads audible tabs when told to", () => {
    const plan = sweepPlan([tab(1, { audible: true })], NOW, { skipAudible: false })

    expect(plan.unload).toEqual([1])
  })

  it("keeps a tab that is already unloaded", () => {
    const plan = sweepPlan([tab(1, { discarded: true })], NOW)

    expect(plan.unload).toEqual([])
  })

  it("keeps a tab whose age Chrome does not know", () => {
    const plan = sweepPlan([tab(1, { lastAccessed: null })], NOW)

    expect(plan.unload).toEqual([])
  })

  it("uses the threshold it is given", () => {
    const plan = sweepPlan([tab(1, { lastAccessed: NOW - 5 * DAY })], NOW, { staleAfterDays: 10 })

    expect(plan.unload).toEqual([])
  })

  it("returns nothing to do when the tabs are not a list", () => {
    for (const value of [null, undefined, 42, "tabs", { id: 1 }]) {
      const plan = sweepPlan(value, NOW)

      expect(plan.unload).toEqual([])
      expect(plan.keep).toEqual([])
    }
  })

  it("does not throw on a tab that is missing", () => {
    const plan = sweepPlan([null, undefined, tab(1)], NOW)

    expect(plan.unload).toEqual([1])
    expect(plan.keep).toEqual([])
  })
})

describe("sweepSummary", () => {
  it("reads the counts out of a record", () => {
    const summary = sweepSummary({ at: NOW, discarded: 3, skipped: 2 }, NOW)

    expect(summary.at).toBe(NOW)
    expect(summary.discarded).toBe(3)
    expect(summary.skipped).toBe(2)
  })

  it("falls back when the record is missing or broken", () => {
    const summary = sweepSummary(null, NOW)

    expect(summary.at).toBe(NOW)
    expect(summary.discarded).toBe(0)
    expect(summary.skipped).toBe(0)
  })

  it("does not trust a broken count", () => {
    const summary = sweepSummary({ at: "soon", discarded: "3", skipped: null }, NOW)

    expect(summary.at).toBe(NOW)
    expect(summary.discarded).toBe(0)
    expect(summary.skipped).toBe(0)
  })

  it("survives a record that throws when it is read", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("the record exploded")
        },
      },
    )

    const summary = sweepSummary(hostile, NOW)

    expect(summary.at).toBe(NOW)
    expect(summary.discarded).toBe(0)
    expect(summary.skipped).toBe(0)
  })
})
