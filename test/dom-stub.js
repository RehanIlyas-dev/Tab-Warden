// A tiny stand-in for the parts of the DOM that the popup and the options
// page use.
//
// The extension pages are plain scripts that read and write elements, so they
// can be driven without a browser. This file gives the tests enough of a DOM
// to click a button and read what was written.
//
// It is deliberately small. Anything the pages start using that is not here
// shows up as a clear failure, which is the signal to add it.

class El {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.className = ""
    this.text = ""
    this.title = ""
    this.hidden = false
    this.disabled = false
    this.checked = false
    this.style = { setProperty() {} }
    this.listeners = new Map()
  }

  set textContent(value) {
    this.text = String(value)
    this.children = []
  }

  get textContent() {
    return [this.text, ...this.children.map((child) => child.textContent)]
      .filter(Boolean)
      .join(" | ")
  }

  set innerHTML(value) {
    // The pages only ever clear a list this way. Anything else would be
    // markup going in unescaped, which is worth failing on.
    if (value !== "") throw new Error(`innerHTML was given markup: ${value}`)
    this.text = ""
    this.children = []
  }

  append(...nodes) {
    this.children.push(...nodes)
  }

  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }

  // Runs the click handlers, like a real click. The event carries a target so
  // the pages can stop propagation the way they do in a browser.
  click() {
    for (const fn of this.listeners.get("click") ?? []) {
      fn({ target: this, stopPropagation() {} })
    }
  }
}

// Reads the ids out of a built page so the stub has one element per id.
export function makeDom(html) {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
  const byId = new Map(ids.map((id) => [id, new El("div")]))

  const document = {
    createElement: (tag) => new El(tag),
    querySelector: (selector) => {
      const id = selector.replace(/^#/, "")
      if (!byId.has(id)) throw new Error(`no element with the id ${id}`)
      return byId.get(id)
    },
    querySelectorAll: () => [],
  }

  globalThis.document = document
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }

  return byId
}

// A stand-in for the slice of chrome.* the extension pages call.
export function makeChrome(overrides = {}) {
  return {
    runtime: {
      sendMessage: async () => ({ type: "error", message: "no worker" }),
      openOptionsPage: async () => {},
      ...overrides.runtime,
    },
    tabs: {
      update: async () => ({}),
      ...overrides.tabs,
    },
    windows: {
      get: async () => ({ focused: true }),
      update: async () => ({}),
      ...overrides.windows,
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        ...overrides.storage,
      },
    },
  }
}

// Lets the pending promises and timers settle, so anything the pages kicked
// off has finished before the probe moves on.
export async function settle(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}
