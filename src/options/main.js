const $ = (selector) => document.querySelector(selector)

async function askWorker(request) {
  return chrome.runtime.sendMessage(request)
}

function showStoredSettings(settings) {
  $("#ignore-pinned").checked = settings.ignorePinnedWhenClosing
  $("#confirm-before-closing").checked = settings.confirmBeforeClosing
}

// Save a patch to the stored settings
async function savePatch(patch) {
  const response = await askWorker({ type: "settings:set", patch })

  if (response.type === "error") {
    $("#extensions").textContent = `Could not save: ${response.message}`
    return
  }

  showStoredSettings(response.settings)
}

// Load the stored settings and display them in the options page
async function loadSettings() {
  const response = await askWorker({ type: "settings:get" })

  if (response.type === "error") {
    $("#extensions").textContent = `Could not load settings: ${response.message}`
    return
  }

  showStoredSettings(response.settings)
}

// Display a message that the extension audit feature has not yet shipped, so there is no data to show.
function reportMissing() {
  const list = $("#extensions")
  list.innerHTML = ""

  const message = document.createElement("p")
  message.className = "hint"
  message.textContent =
    "No installed extension data yet. This panel fills in once the extension audit feature ships."

  list.append(message)
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
    $("#extensions").textContent = `Could not load settings: ${error.message}`
  }

  reportMissing()
}

void main()