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
//   chrome.runtime.onInstalled.addListener, chrome.runtime.onStartup.addListener
//   chrome.alarms.create, chrome.alarms.get, chrome.alarms.clear
//   chrome.alarms.onAlarm.addListener
//
// Anything else the worker starts calling will throw "not a function", which
// is the correct signal that this fake needs updating.

export function createFakeChrome(options = {}) {
  const state = {
    tabs: [...(options.tabs ?? [])],
    settings: options.settings ?? null,
    lastSweep: options.lastSweep ?? null,
    removed: [],
    discarded: [],
    queries: [],
    activeTabId: options.activeTabId ?? null,
    // Several active tabs at once, one per window. Null means use activeTabId.
    activeTabIds: options.activeTabIds ?? null,
    failNextRemove: false,
    failNextDiscard: false,
    discardRefusals: new Set(),
    alarms: new Map(),
  }

  let listener = null
  let alarmListener = null
  let installedListener = null
  let startupListener = null

  const chrome = {
    tabs: {
      async query(info = {}) {
        state.queries.push(info)

        let result = [...state.tabs]

        if (info.active === true) {
          const ids = state.activeTabIds ?? (state.activeTabId === null ? [] : [state.activeTabId])
          result = result.filter((tab) => tab && ids.includes(tab.id))
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
        if (state.activeTabIds?.includes(id)) return undefined
        if (state.activeTabId === id) return undefined

        state.tabs[index] = { ...state.tabs[index], discarded: true }
        state.discarded.push(id)
        return state.tabs[index]
      },
    },

    storage: {
      local: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key]
          const found = {}

          for (const name of keys) {
            if (name === "tabWarden.settings") {
              if (state.settings !== null) found[name] = state.settings
            }
            if (name === "tabWarden.lastSweep") {
              if (state.lastSweep !== null) found[name] = state.lastSweep
            }
          }

          return found
        },

        async set(values) {
          if ("tabWarden.settings" in values) {
            state.settings = values["tabWarden.settings"]
          }
          if ("tabWarden.lastSweep" in values) {
            state.lastSweep = values["tabWarden.lastSweep"]
          }
        },
      },
    },

    alarms: {
      create(name, info = {}) {
        state.alarms.set(name, { name, ...info })
      },

      async get(name) {
        return state.alarms.get(name)
      },

      async clear(name) {
        return state.alarms.delete(name)
      },

      onAlarm: {
        addListener(fn) {
          alarmListener = fn
        },
      },
    },

    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn
        },
      },

      onInstalled: {
        addListener(fn) {
          installedListener = fn
        },
      },

      onStartup: {
        addListener(fn) {
          startupListener = fn
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

  // Fires the alarm, the way Chrome does when the time comes. Resolves once
  // the worker has finished with it.
  async function fireAlarm(name) {
    if (alarmListener === null) {
      throw new Error("service worker never registered an onAlarm listener")
    }

    await alarmListener({ name })
  }

  // The extension being installed, or the browser starting again.
  async function fireInstalled() {
    if (installedListener === null) {
      throw new Error("service worker never registered an onInstalled listener")
    }

    await installedListener()
  }

  async function fireStartup() {
    if (startupListener === null) {
      throw new Error("service worker never registered an onStartup listener")
    }

    await startupListener()
  }

  return { chrome, state, send, fireAlarm, fireInstalled, fireStartup }
}