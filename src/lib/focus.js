// Focus logic, separated from the DOM so it can be tested without a browser.
//
// The popup calls focusTab on a click. If the underlying chrome call rejects and
// nothing catches it, the popup looks completely dead: no error, no movement.
// Everything here returns a result object instead of throwing, so the caller
// always has something to report.

/**
 * @param {object} deps
 * @param {{update: Function, get: Function}} deps.tabs chrome.tabs subset
 * @param {{get: Function, update: Function}} deps.windows chrome.windows subset
 * @param {{id: number, windowId?: number}} tab
 * @returns {Promise<{ok: boolean, focusedTab: boolean, focusedWindow: boolean, error?: string}>}
 */
export async function focusTab({ tabs, windows }, tab) {
  const result = { ok: false, focusedTab: false, focusedWindow: false }

  try {
    await tabs.update(tab.id, { active: true })
    result.focusedTab = true
  } catch (error) {
    result.error = describe(error)
    return result
  }

  // Only worth trying when we know which window owns the tab.
  if (typeof tab.windowId !== "number") {
    result.ok = true
    return result
  }

  try {
    const win = await windows.get(tab.windowId)
    if (win.focused) {
      // Already in front, nothing to raise.
      result.ok = true
      return result
    }
    await windows.update(tab.windowId, { focused: true })
    result.focusedWindow = true
    result.ok = true
  } catch (error) {
    // The tab switch already succeeded. A window that vanished or refuses
    // focus is not a failure the user needs to act on, but it is worth
    // recording rather than discarding.
    result.ok = true
    result.error = describe(error)
  }

  return result
}

function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}