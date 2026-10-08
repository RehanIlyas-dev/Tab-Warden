import { describe, expect, it } from "vitest"

import {
  closableCount,
  closableIds,
  groupDuplicates,
  keeperOrder,
  normalizeUrl,
  originOf,
} from "../src/lib/tab.js"

function tab(id, url, extra = {}) {
  return {
    id,
    title: extra.title ?? `tab ${id}`,
    url,
    origin: originOf(url),
    normalizedUrl: normalizeUrl(url),
    lastAccessed: extra.lastAccessed ?? id * 1000,
    audible: extra.audible ?? false,
    pinned: extra.pinned ?? false,
    discarded: false,
  }
}

describe("normalizeUrl", () => {
  it("lowercases the host", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe("url:example.com/path")
  })

  it("drops the www prefix", () => {
    expect(normalizeUrl("https://www.example.com/a")).toBe("url:example.com/a")
  })

  it("trims trailing slashes", () => {
    expect(normalizeUrl("https://example.com/a/b/")).toBe("url:example.com/a/b")
  })

  it("keeps the root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("url:example.com/")
  })

  it("strips utm tracking params", () => {
    expect(normalizeUrl("https://example.com/a?utm_source=news&utm_campaign=x")).toBe(
      "url:example.com/a",
    )
  })

  it("strips ad click ids", () => {
    expect(normalizeUrl("https://example.com/a?gclid=1&fbclid=2")).toBe("url:example.com/a")
  })

  it("keeps params that identify the page", () => {
    expect(normalizeUrl("https://example.com/s?q=chrome&page=2")).toBe(
      "url:example.com/s?q=chrome&page=2",
    )
  })

  it("keeps params that identify the page even when mixed with tracking params", () => {
    expect(normalizeUrl("https://example.com/s?utm_source=news&q=chrome")).toBe(
      "url:example.com/s?q=chrome",
    )
  })

  it("strips the fragment", () => {
    expect(normalizeUrl("https://example.com/a#section-1")).toBe("url:example.com/a")
  })

  it("collapses all three youtube shapes to one key", () => {
    const short = normalizeUrl("https://youtu.be/dQw4w9WgXcQ")
    const watch = normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30")
    const embed = normalizeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")

    expect(short).toBe("yt:dQw4w9WgXcQ")
    expect(watch).toBe(short)
    expect(embed).toBe(short)
  })

  it("gives different videos different keys", () => {
    expect(normalizeUrl("https://youtu.be/aaaaaaaaaaa")).not.toBe(
      normalizeUrl("https://youtu.be/bbbbbbbbbbb"),
    )
  })

  it("does not throw on garbage", () => {
    expect(() => normalizeUrl("not a url")).not.toThrow()
    expect(normalizeUrl("not a url")).toBe("raw:not a url")
  })

  it("trims and lowercases the garbage fallback", () => {
    expect(normalizeUrl("  NOT A URL  ")).toBe("raw:not a url")
  })

  it("handles chrome internal pages", () => {
    expect(normalizeUrl("chrome://settings/privacy")).toBe("scheme:chrome://settings/privacy")
  })

  it("does not throw on about:blank", () => {
    expect(() => normalizeUrl("about:blank")).not.toThrow()
  })

  it("keeps file paths apart from http paths", () => {
    const file = normalizeUrl("file:///home/rehan/a.txt")
    const web = normalizeUrl("https://home/rehan/a.txt")
    expect(file).not.toBe(web)
  })

  it("returns a bare youtu.be host when there is no id", () => {
    expect(normalizeUrl("https://youtu.be/")).toBe("url:youtu.be/")
  })

  it("does not treat a non youtube path as a video", () => {
    expect(normalizeUrl("https://youtube.com/feed/subscriptions")).toBe(
      "url:youtube.com/feed/subscriptions",
    )
  })
})

describe("originOf", () => {
  it("returns the host without www", () => {
    expect(originOf("https://www.example.com/a/b?c=1")).toBe("example.com")
  })

  it("keeps the port so local dev servers stay distinct", () => {
    expect(originOf("http://localhost:3000/x")).toBe("localhost:3000")
    expect(originOf("http://localhost:8080/x")).toBe("localhost:8080")
  })

  it("returns an empty string for garbage", () => {
    expect(originOf("nonsense")).toBe("")
  })
})

describe("keeperOrder", () => {
  it("puts pinned first", () => {
    const pinned = tab(1, "https://a.com", { pinned: true })
    const normal = tab(2, "https://a.com")
    expect(keeperOrder(pinned, normal)).toBeLessThan(0)
  })

  it("puts audible before non audible", () => {
    const playing = tab(1, "https://a.com", { audible: true })
    const silent = tab(2, "https://a.com")
    expect(keeperOrder(playing, silent)).toBeLessThan(0)
  })

  it("prefers pinned over audible", () => {
    const pinned = tab(1, "https://a.com", { pinned: true })
    const playing = tab(2, "https://a.com", { audible: true })
    expect(keeperOrder(pinned, playing)).toBeLessThan(0)
  })

  it("falls back to most recently accessed", () => {
    const older = tab(1, "https://a.com", { lastAccessed: 100 })
    const newer = tab(2, "https://a.com", { lastAccessed: 900 })
    expect(keeperOrder(newer, older)).toBeLessThan(0)
    expect(keeperOrder(older, newer)).toBeGreaterThan(0)
  })

  it("returns zero when nothing distinguishes them", () => {
    const a = tab(1, "https://a.com", { lastAccessed: 500 })
    const b = tab(2, "https://a.com", { lastAccessed: 500 })
    expect(keeperOrder(a, b)).toBe(0)
  })
})

describe("groupDuplicates", () => {
  it("returns nothing for an empty list", () => {
    expect(groupDuplicates([])).toEqual([])
  })

  it("ignores unique tabs", () => {
    expect(groupDuplicates([tab(1, "https://a.com"), tab(2, "https://b.com")])).toEqual([])
  })

  it("groups the same url", () => {
    const groups = groupDuplicates([tab(1, "https://a.com"), tab(2, "https://a.com")])
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toHaveLength(2)
  })

  it("groups urls that differ only by tracking params", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com/p?utm_source=news"),
      tab(2, "https://a.com/p"),
    ])
    expect(groups).toHaveLength(1)
  })

  it("marks the pinned tab as keeper", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com"),
      tab(2, "https://a.com", { pinned: true }),
    ])
    expect(groups[0].keeper.id).toBe(2)
    expect(groups[0].closable.map((t) => t.id)).toEqual([1])
  })

  it("puts every non keeper in closable", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com"),
      tab(2, "https://a.com"),
      tab(3, "https://a.com"),
    ])
    expect(groups[0].closable).toHaveLength(2)
    expect(groups[0].tabs).toHaveLength(3)
  })

  it("sorts the biggest group first", () => {
    const groups = groupDuplicates([
      tab(1, "https://small.com"),
      tab(2, "https://small.com"),
      tab(3, "https://big.com"),
      tab(4, "https://big.com"),
      tab(5, "https://big.com"),
    ])
    expect(groups[0].tabs).toHaveLength(3)
    expect(groups[1].tabs).toHaveLength(2)
  })

  it("keeps separate groups separate", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com"),
      tab(2, "https://a.com"),
      tab(3, "https://b.com"),
      tab(4, "https://b.com"),
    ])
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.key)).size).toBe(2)
  })

  it("does not mutate the tabs it was given", () => {
    const tabs = [tab(2, "https://a.com"), tab(1, "https://a.com", { pinned: true })]
    const orderBefore = tabs.map((t) => t.id)
    groupDuplicates(tabs)
    expect(tabs.map((t) => t.id)).toEqual(orderBefore)
  })

  it("handles a single tab", () => {
    expect(groupDuplicates([tab(1, "https://a.com")])).toEqual([])
  })
})

describe("closableCount", () => {
  it("is zero when there are no groups", () => {
    expect(closableCount([])).toBe(0)
  })

  it("sums closable across groups", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com"),
      tab(2, "https://a.com"),
      tab(3, "https://b.com"),
      tab(4, "https://b.com"),
      tab(5, "https://b.com"),
    ])
    expect(closableCount(groups)).toBe(3)
  })
})

describe("closableIds", () => {
  it("returns a flat list of ids", () => {
    const groups = groupDuplicates([
      tab(7, "https://a.com"),
      tab(8, "https://a.com"),
      tab(9, "https://b.com"),
      tab(10, "https://b.com"),
    ])
    const ids = closableIds(groups)
    expect(Array.isArray(ids)).toBe(true)
    expect(ids.every((id) => typeof id === "number")).toBe(true)
    expect(ids).toHaveLength(2)
  })

  it("never includes the keeper", () => {
    const groups = groupDuplicates([
      tab(1, "https://a.com"),
      tab(2, "https://a.com", { pinned: true }),
    ])
    expect(closableIds(groups)).not.toContain(2)
  })

  it("is empty when there are no groups", () => {
    expect(closableIds([])).toEqual([])
  })
})