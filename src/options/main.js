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

  try {
    await loadSettings()
  } catch (error) {
    setStatus(`Could not load settings: ${error.message}`)
  }
}

void main()
