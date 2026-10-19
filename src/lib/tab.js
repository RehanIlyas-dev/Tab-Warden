const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "yclid",
  "ttclid",
  "twclid",
  "igshid",
  "si",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "ref_url",
  "_hsenc",
  "_hsmi",
  "spm",
  "scm",
]

// Removes www. and lowercases the hostname.
function bareHost(hostname) {
  return hostname.replace(/^www\./, "").toLowerCase()
}

// Normalizes a URL to a canonical form for duplicate detection. Youtube URLs are normalized to the video ID, and tracking parameters are stripped from other URLs. Non-HTTP(S) URLs are normalized to a scheme://host/path form. The port stays in the key, so two servers on the same machine are two different pages.
export function normalizeUrl(rawUrl) {
  // A non string url cannot come from Chrome, but this has to survive it.
  const text = typeof rawUrl === "string" ? rawUrl : ""

  let url

  try {
    url = new URL(text)
  } catch {
    return `raw:${text.trim().toLowerCase()}`
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    // chrome://, file://, about:blank and friends.
    return `scheme:${url.protocol}//${bareHost(url.host)}${url.pathname}`.toLowerCase()
  }

  // The host keeps the port, the site does not.
  const host = bareHost(url.host)
  const site = bareHost(url.hostname)

  if (site === "youtu.be") {
    const id = url.pathname.slice(1)
    return id ? `yt:${id}` : `url:${site}/`
  }

  if (site === "youtube.com" || site.endsWith(".youtube.com")) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v")
      if (id) return `yt:${id}`
    }
    if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/")[2]
      if (id) return `yt:${id}`
    }
  }

  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param)
  }

  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname
  const query = url.searchParams.toString()

  // The path is lowercased with everything else, so case only paths match.
  return `url:${host}${path}${query ? `?${query}` : ""}`.toLowerCase()
}

// Returns the origin of a URL, or an empty string if the URL is invalid.
// Uses .host rather than .hostname so the port is kept, which stops
// localhost:3000 and localhost:8080 from looking like the same site.
export function originOf(rawUrl) {
  try {
    return bareHost(new URL(rawUrl).host)
  } catch {
    return ""
  }
}

// Which duplicate survives: pinned, then audible, then most recently touched.
export function keeperOrder(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.audible !== b.audible) return a.audible ? -1 : 1
  return b.lastAccessed - a.lastAccessed
}

// Groups tabs pointing at the same page, biggest group first.
export function groupDuplicates(tabs) {
  if (!Array.isArray(tabs)) return []

  const buckets = new Map()

  for (const tab of tabs) {
    // A record without a usable key cannot be compared with anything.
    if (!tab || typeof tab.normalizedUrl !== "string") continue

    const bucket = buckets.get(tab.normalizedUrl)
    if (bucket) {
      bucket.push(tab)
    } else {
      buckets.set(tab.normalizedUrl, [tab])
    }
  }

  const groups = []

  for (const [key, list] of buckets) {
    if (list.length < 2) continue

    // Sort the tabs in the group by which one should be kept, and then create a group object with the keeper and the closable tabs.
    const sorted = [...list].sort(keeperOrder)
    groups.push({
      key,
      tabs: sorted,
      keeper: sorted[0],
      closable: sorted.slice(1),
    })
  }

  return groups.sort((a, b) => b.tabs.length - a.tabs.length || a.key.localeCompare(b.key))
}

// Returns the total number of closable tabs in a list of groups.
export function closableCount(groups) {
  if (!Array.isArray(groups)) return 0
  return groups.reduce((sum, group) => sum + (group?.closable?.length ?? 0), 0)
}

// Returns a flat list of the IDs of all closable tabs in a list of groups.
export function closableIds(groups) {
  if (!Array.isArray(groups)) return []
  return groups.flatMap((group) =>
    Array.isArray(group?.closable) ? group.closable.map((tab) => tab.id) : [],
  )
}
