// Contract between the service worker and the extension pages.
export const STORAGE_KEYS = {
  settings: "tabWarden.settings",
}

export const DEFAULT_SETTINGS = {
  ignorePinnedWhenClosing: true,
  confirmBeforeClosing: true,
}
