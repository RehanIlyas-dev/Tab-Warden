const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

function setStatus(text) {
  $("#options-status").textContent = text
}

function showStoredSettings(settings) {
  $("#ignore-pinned").checked = settings.ignorePinnedWhenClosing
  $("#confirm-before-closing").checked = settings.confirmBeforeClosing
  $("#skip-audible").checked = settings.skipAudibleWhenDiscarding
  $("#stale-days").value = String(settings.staleAfterDays)
}

// Save a patch to the stored settings
async function savePatch(patch) {
  try {
    const response = await askWorker({ type: "settings:set", patch })

    if (response.type === "error") {
      setStatus(`Could not save: ${response.message}`)
      return
    }

    showStoredSettings(response.settings)
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

  try {
    await loadSettings()
  } catch (error) {
    setStatus(`Could not load settings: ${error.message}`)
  }
}

void main()
