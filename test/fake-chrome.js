// A stand-in for the slice of the chrome.* API that
// src/background/service-worker.js actually calls.
//
// This exists because a service worker cannot run in Node. There is no
// chrome object, so the worker throws on import. This file builds a small
// object with the same shape, which lets us drive the worker from a test.
//
// It deliberately implements ONLY what the worker uses:
//   chrome.tabs.query, chrome.tabs.remove, chrome.tabs.discard
//   chrome.storage.local.get, chrome.storage.local.set
//   chrome.runtime.onMessage.addListener
//
// Anything else the worker starts calling will throw "not a function", which
// is the correct signal that this fake needs updating.

export function createFakeChrome(options = {}) {
  const state = {
    tabs: [...(options.tabs ?? [])],
    settings: options.settings ?? null,
    removed: [],
    discarded: [],
    queries: [],
    activeTabId: options.activeTabId ?? null,
    failNextRemove: false,
    failNextDiscard: false,
    discardRefusals: new Set(),
  }

  let listener = null

  const chrome = {
    tabs: {
      async query(info = {}) {
        state.queries.push(info)

        let result = [...state.tabs]

        if (info.active === true) {
          result = result.filter((tab) => tab.id === state.activeTabId)
        }

        return result
      },

      async remove(id) {
        if (state.failNextRemove) {
          state.failNextRemove = false
          throw new Error("No tab with id: " + id)
        }

        const index = state.tabs.findIndex((tab) => tab.id === id)
        if (index === -1) {
          throw new Error("No tab with id: " + id)
        }

        state.tabs.splice(index, 1)
        state.removed.push(id)
      },

      async discard(id) {
        if (state.failNextDiscard) {
          state.failNextDiscard = false
          throw new Error("No tab with id: " + id)
        }

        const index = state.tabs.findIndex((tab) => tab.id === id)
        if (index === -1) {
          throw new Error("No tab with id: " + id)
        }

        // Chrome resolves with the tab, or with nothing when it refuses.
        if (state.discardRefusals.has(id)) return undefined
        if (state.tabs[index].discarded) return undefined
        if (state.activeTabId === id) return undefined

        state.tabs[index] = { ...state.tabs[index], discarded: true }
        state.discarded.push(id)
        return state.tabs[index]
      },
    },

    storage: {
      local: {
        async get(key) {
          if (key === "tabWarden.settings") {
            return state.settings === null ? {} : { [key]: state.settings }
          }
          return {}
        },

        async set(values) {
          if ("tabWarden.settings" in values) {
            state.settings = values["tabWarden.settings"]
          }
        },
      },
    },

    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn
        },
      },
    },
  }

  // Sends a message to the worker the way the popup would, and resolves with
  // whatever the worker replies. Mirrors the real behaviour: if the listener
  // does not return true, the channel closes and the reply never arrives.
  async function send(message) {
    return new Promise((resolve, reject) => {
      if (listener === null) {
        reject(new Error("service worker never registered an onMessage listener"))
        return
      }

      const keptOpen = listener(message, { id: "fake-sender" }, resolve)

      if (keptOpen !== true) {
        reject(
          new Error(
            "listener returned " + String(keptOpen) + ", expected true. " +
              "A falsy return closes the message channel, so sendResponse would never arrive.",
          ),
        )
      }
    })
  }

  return { chrome, state, send }
}