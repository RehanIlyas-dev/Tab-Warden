import { describe, expect, it } from "vitest"

import { focusTab } from "../src/lib/focus.js"

function fakeDeps(overrides = {}) {
  const calls = { tabUpdate: [], windowGet: [], windowUpdate: [] }

  const deps = {
    calls,
    tabs: {
      async update(id, props) {
        calls.tabUpdate.push({ id, props })
        if (overrides.tabThrows) throw new Error(overrides.tabThrows)
      },
    },
    windows: {
      async get(id) {
        calls.windowGet.push(id)
        if (overrides.getThrows) throw new Error(overrides.getThrows)
        return { focused: overrides.windowFocused ?? false }
      },
      async update(id, props) {
        calls.windowUpdate.push({ id, props })
        if (overrides.windowUpdateThrows) throw new Error(overrides.windowUpdateThrows)
      },
    },
  }

  return deps
}

describe("focusTab", () => {
  it("activates the tab", async () => {
    const deps = fakeDeps()

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(deps.calls.tabUpdate).toEqual([{ id: 7, props: { active: true } }])
    expect(result.focusedTab).toBe(true)
    expect(result.ok).toBe(true)
  })

  it("raises the window that owns the tab", async () => {
    const deps = fakeDeps({ windowFocused: false })

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(deps.calls.windowUpdate).toEqual([{ id: 3, props: { focused: true } }])
    expect(result.focusedWindow).toBe(true)
  })

  it("does not steal focus when the window is already front", async () => {
    const deps = fakeDeps({ windowFocused: true })

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(deps.calls.windowUpdate).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("skips the window step when windowId is missing", async () => {
    const deps = fakeDeps()

    const result = await focusTab(deps, { id: 7 })

    expect(deps.calls.windowGet).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("reports a failing tab update instead of throwing", async () => {
    const deps = fakeDeps({ tabThrows: "No tab with id: 7" })

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(result.ok).toBe(false)
    expect(result.focusedTab).toBe(false)
    expect(result.error).toBe("No tab with id: 7")
  })

  it("still reports ok when the tab switched but the window vanished", async () => {
    const deps = fakeDeps({ getThrows: "No window with id: 3" })

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(result.focusedTab).toBe(true)
    expect(result.ok).toBe(true)
    expect(result.error).toBe("No window with id: 3")
  })

  it("survives a refused window focus", async () => {
    const deps = fakeDeps({ windowUpdateThrows: "cannot focus" })

    const result = await focusTab(deps, { id: 7, windowId: 3 })

    expect(result.ok).toBe(true)
    expect(result.focusedTab).toBe(true)
    expect(result.error).toBe("cannot focus")
  })

  it("handles a thrown non-Error value", async () => {
    const deps = {
      tabs: {
        async update() {
          throw "plain string failure"
        },
      },
      windows: { async get() {}, async update() {} },
    }

    const result = await focusTab(deps, { id: 1 })

    expect(result.ok).toBe(false)
    expect(result.error).toBe("plain string failure")
  })
})