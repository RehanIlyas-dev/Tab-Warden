const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

function setStatus(text) {
  $("#options-status").textContent = text
}

// Writes a value into a checkbox, but only when the worker actually sent one.
// Writing undefined into a checkbox unticks it, which is what happens when
// the worker is older than this page.
function setChecked(selector, value) {
  if (typeof value === "boolean") $(selector).checked = value
}

function showStoredSettings(settings) {
  setChecked("#ignore-pinned", settings.ignorePinnedWhenClosing)
  setChecked("#confirm-before-closing", settings.confirmBeforeClosing)
  setChecked("#skip-audible", settings.skipAudibleWhenDiscarding)
  setChecked("#auto-free", settings.autoFreeEnabled)

  if (Number.isFinite(settings.staleAfterDays)) {
    $("#stale-days").value = String(settings.staleAfterDays)
  }
}

// The worker is older than this page when it does not know about a setting
// the page has. The setting cannot be stored until the extension is reloaded,
// so the page has to say so instead of showing a switch that cannot stick.
function workerIsOld(settings) {
  return typeof settings?.autoFreeEnabled !== "boolean"
}

const RELOAD_HINT =
  "The background worker is out of date. Reload Tab Warden in chrome://extensions, then set this again."

// Save a patch to the stored settings
async function savePatch(patch) {
  try {
    const response = await askWorker({ type: "settings:set", patch })

    if (response.type === "error") {
      setStatus(`Could not save: ${response.message}`)
      return
    }

    showStoredSettings(response.settings)

    if (workerIsOld(response.settings)) {
      setStatus(`Saved, but not this switch. ${RELOAD_HINT}`)
      return
    }

    setStatus("Saved.")
  } catch (error) {
    setStatus(`Could not save: ${error.message}`)
  }
}

// Save the number of days, and put the old value back if it makes no sense.
async function saveDays(value) {
  const days = Math.round(Number(value))

  if (!Number.isFinite(days) || days < 1) {
    setStatus("Days must be a whole number of at least 1.")
    await loadSettings()
    return
  }

  await savePatch({ staleAfterDays: days })
}

// Load the stored settings and display them
async function loadSettings() {
  const response = await askWorker({ type: "settings:get" })

  if (response.type === "error") {
    setStatus(`Could not load settings: ${response.message}`)
    return
  }

  showStoredSettings(response.settings)

  if (workerIsOld(response.settings)) {
    setStatus(RELOAD_HINT)
  }
}

// Main function starting point
async function main() {
  $("#ignore-pinned").addEventListener("change", (event) => {
    void savePatch({ ignorePinnedWhenClosing: event.target.checked })
  })

  $("#confirm-before-closing").addEventListener("change", (event) => {
    void savePatch({ confirmBeforeClosing: event.target.checked })
  })

  $("#skip-audible").addEventListener("change", (event) => {
    void savePatch({ skipAudibleWhenDiscarding: event.target.checked })
  })

  $("#stale-days").addEventListener("change", (event) => {
    void saveDays(event.target.value)
  })

  $("#auto-free").addEventListener("change", (event) => {
    void savePatch({ autoFreeEnabled: event.target.checked })
  })

  try {
    await loadSettings()
  } catch (error) {
    setStatus(`Could not load settings: ${error.message}`)
  }
}

void main()
