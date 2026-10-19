import { STALE_AFTER_DAYS } from "./weight.js"

// Contract between the service worker and the extension pages.
export const STORAGE_KEYS = {
  settings: "tabWarden.settings",
}

// One place for every setting: the default and what a stored value may be.
// A value that fails the rule is dropped and the default is used instead.
const SETTINGS = {
  ignorePinnedWhenClosing: {
    default: true,
    ok: (value) => typeof value === "boolean",
  },
  confirmBeforeClosing: {
    default: true,
    ok: (value) => typeof value === "boolean",
  },
  staleAfterDays: {
    default: STALE_AFTER_DAYS,
    ok: (value) => Number.isFinite(value) && value > 0,
  },
  skipAudibleWhenDiscarding: {
    default: true,
    ok: (value) => typeof value === "boolean",
  },
}

export const DEFAULT_SETTINGS = Object.fromEntries(
  Object.entries(SETTINGS).map(([key, spec]) => [key, spec.default]),
)

// Picks the known settings out of an object, when the value is allowed.
export function pickSettings(source) {
  const picked = {}

  if (!source || typeof source !== "object" || Array.isArray(source)) return picked

  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (spec.ok(source[key])) picked[key] = source[key]
  }

  return picked
}

// The settings the rest of the code can rely on.
export function normalizeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...pickSettings(stored) }
}
