const TIMEOUT_MS = 3000

export async function focusTab(deps, tab, timeoutMs = TIMEOUT_MS) {
  const result = { ok: false, focusedTab: false, focusedWindow: false }

  if (!deps || !deps.tabs || typeof deps.tabs.update !== "function") {
    result.error = "The tabs API is not available"
    return result
  }

  if (!tab || typeof tab.id !== "number") {
    result.error = "That tab is gone"
    return result
  }

  try {
    await withTimeout(
      deps.tabs.update(tab.id, { active: true }),
      timeoutMs,
      "The tab did not answer",
    )
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

  if (!deps.windows || typeof deps.windows.get !== "function") {
    result.ok = true
    return result
  }

  try {
    const win = await withTimeout(
      deps.windows.get(tab.windowId),
      timeoutMs,
      "The window did not answer",
    )
    if (!win || win.focused) {
      // Already in front, nothing to raise.
      result.ok = true
      return result
    }
    await withTimeout(
      deps.windows.update(tab.windowId, { focused: true }),
      timeoutMs,
      "The window did not answer",
    )
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

// Fails the promise when it takes too long, so a stuck API cannot leave the
// popup waiting for ever.
function withTimeout(promise, ms, message) {
  let timer = null

  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
