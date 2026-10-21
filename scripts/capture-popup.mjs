// Captures the built popup as a PNG, for the store graphics and the README.
//
// The extension cannot be loaded into Chrome from the command line on this
// machine, so this renders the built popup page and stubs the one thing the
// popup cannot do on its own: talk to the background worker. The result is
// the real UI with real-looking data in it.
//
// Run: npm run build && node scripts/capture-popup.mjs
//
// Writes docs/screenshot.png and docs/screenshot@2x.png, then the store
// graphics with: npm run store-assets

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

// The tabs the popup is shown with. They are made up, but they are the shape
// the worker really sends.
const tabs = [
  {
    id: 1,
    title: "How to build a Chrome extension - Chrome for Developers",
    url: "https://developer.chrome.com/docs/extensions/mv3/intro",
    origin: "developer.chrome.com",
    normalizedUrl: "url:developer.chrome.com/docs/extensions/mv3/intro",
    lastAccessed: now - 9 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: true,
    weight: 88,
    idleDays: 9,
  },
  {
    id: 2,
    title: "How to build a Chrome extension - Chrome for Developers",
    url: "https://developer.chrome.com/docs/extensions/mv3/intro",
    origin: "developer.chrome.com",
    normalizedUrl: "url:developer.chrome.com/docs/extensions/mv3/intro",
    lastAccessed: now - 8 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: true,
    weight: 86,
    idleDays: 8,
  },
  {
    id: 3,
    title: "Inbox (12) - mail@example.com",
    url: "https://mail.example.com/inbox",
    origin: "mail.example.com",
    normalizedUrl: "url:mail.example.com/inbox",
    lastAccessed: now - 7 * DAY,
    pinned: true,
    audible: false,
    discarded: false,
    duplicate: false,
    weight: 0,
    idleDays: 7,
  },
  {
    id: 4,
    title: "Deep Work - Focus Timer",
    url: "https://focus.example.com/session",
    origin: "focus.example.com",
    normalizedUrl: "url:focus.example.com/session",
    lastAccessed: now - 6 * DAY,
    pinned: false,
    audible: true,
    discarded: false,
    duplicate: false,
    weight: 65,
    idleDays: 6,
  },
  {
    id: 5,
    title: "Release notes - Tab Warden",
    url: "https://github.com/RehanIlyas-dev/Tab-Warden/releases",
    origin: "github.com",
    normalizedUrl: "url:github.com/rehanilyas-dev/tab-warden/releases",
    lastAccessed: now - 5 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: false,
    weight: 55,
    idleDays: 5,
  },
  {
    id: 6,
    title: "Neko - a study app",
    url: "https://neko.example.com/study",
    origin: "neko.example.com",
    normalizedUrl: "url:neko.example.com/study",
    lastAccessed: now - 4 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: false,
    weight: 50,
    idleDays: 4,
  },
  {
    id: 7,
    title: "What is new - Tab Warden",
    url: "https://github.com/RehanIlyas-dev/Tab-Warden/releases",
    origin: "github.com",
    normalizedUrl: "url:github.com/rehanilyas-dev/tab-warden/releases",
    lastAccessed: now - 3 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: true,
    weight: 45,
    idleDays: 3,
  },
  {
    id: 8,
    title: "Search",
    url: "https://www.google.com/search?q=chrome+extension+memory",
    origin: "google.com",
    normalizedUrl: "url:google.com/search",
    lastAccessed: now - 0.2 * DAY,
    pinned: false,
    audible: false,
    discarded: false,
    duplicate: false,
    weight: 5,
    idleDays: 0.2,
  },
]

const keeper = tabs[0]
const audit = {
  type: "audit",
  tabs,
  groups: [
    {
      key: "url:developer.chrome.com/docs/extensions/mv3/intro",
      tabs: [tabs[0], tabs[1]],
      keeper,
      closable: [tabs[1]],
    },
    {
      key: "url:github.com/rehanilyas-dev/tab-warden/releases",
      tabs: [tabs[4], tabs[6]],
      keeper: tabs[4],
      closable: [tabs[6]],
    },
  ],
  reclaimable: [2, 6],
  staleAfterDays: 3,
  autoFreeEnabled: true,
  lastSweep: { at: now - 2 * 60 * 60 * 1000, discarded: 5, skipped: 3 },
}

// The stub the popup finds instead of the background worker.
const stub = `
<script>
  const AUDIT = ${JSON.stringify(audit)};
  window.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "settings:get") {
          return { type: "settings", settings: { confirmBeforeClosing: true } };
        }
        if (message.type === "tabs:close") {
          return { type: "tabs:closed", closed: message.ids, skipped: [] };
        }
        if (message.type === "tabs:discard") {
          return { type: "tabs:discarded", discarded: message.ids, skipped: [] };
        }
        return AUDIT;
      },
      openOptionsPage: () => {},
    },
    tabs: { update: async () => ({}) },
    windows: { get: async () => ({ focused: true }), update: async () => ({}) },
  };
</script>
`

// The built page, with the stub in front of the popup script.
const popup = readFileSync(`${ROOT}dist/popup.html`, "utf8")
const page = popup.replace(
  '<script type="module" crossorigin src="/assets/popup.js"></script>',
  `${stub}\n<script type="module" crossorigin src="/assets/popup.js"></script>`,
)

if (page === popup) {
  console.error("could not find the popup script tag in dist/popup.html")
  process.exit(1)
}

mkdirSync(`${ROOT}docs`, { recursive: true })

const TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
}

const server = createServer((request, response) => {
  if (request.url === "/" || request.url.startsWith("/popup")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(page)
    return
  }
  if (request.url.startsWith("/assets/")) {
    const name = request.url.replace("/assets/", "")
    const ext = name.slice(name.lastIndexOf("."))
    try {
      // A module served with the wrong type is refused by the browser, so the
      // type has to be right or the popup never runs.
      const file = readFileSync(`${ROOT}dist/assets/${name}`)
      response.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" })
      response.end(file)
    } catch {
      response.writeHead(404)
      response.end()
    }
    return
  }
  response.writeHead(404)
  response.end()
})

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port

// The popup is 360 wide and grows to 580 tall, which is what Chrome shows.
//
// Chrome runs in its own process, so this cannot block the node event loop.
// If it did, the file server below would never answer Chrome and the capture
// would wait for a page that never finishes loading.
function capture(file, scale) {
  // A profile that is still locked by an earlier run stops Chrome from
  // starting, so each capture gets a clean one.
  rmSync("/tmp/tab-warden-capture", { recursive: true, force: true })

  return new Promise((resolve, reject) => {
    const child = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=/tmp/tab-warden-capture",
        "--hide-scrollbars",
        "--force-device-scale-factor=" + scale,
        "--window-size=360,580",
        `--screenshot=${file}`,
        `http://127.0.0.1:${port}/popup.html`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`chrome did not finish the capture for ${file}`))
    }, 60000)

    child.on("error", reject)
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`chrome exited with code ${code}`))
      }
    })
  })
}

await capture(`${ROOT}docs/screenshot@2x.png`, 2)
await capture(`${ROOT}docs/screenshot.png`, 1)

server.close()

console.log("wrote docs/screenshot.png and docs/screenshot@2x.png")
