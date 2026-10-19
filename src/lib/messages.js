// Contract between the service worker and the extension pages.
export const STORAGE_KEYS = {
  settings: "tabWarden.settings",
}

export const DEFAULT_SETTINGS = {
  ignorePinnedWhenClosing: true,
  confirmBeforeClosing: true,
}

// The type each setting has to have. Keep in step with DEFAULT_SETTINGS.
const SETTING_TYPES = {
  ignorePinnedWhenClosing: "boolean",
  confirmBeforeClosing: "boolean",
}

// Picks the known settings out of an object, when the type is right.
export function pickSettings(source) {
  const picked = {}

  if (!source || typeof source !== "object" || Array.isArray(source)) return picked

  for (const [key, type] of Object.entries(SETTING_TYPES)) {
    if (typeof source[key] === type) picked[key] = source[key]
  }

  return picked
}

// The settings the rest of the code can rely on.
export function normalizeSettings(stored) {
  return { ...DEFAULT_SETTINGS, ...pickSettings(stored) }
}
