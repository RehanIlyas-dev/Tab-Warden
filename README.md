<div align="center">

<h1>Tab Warden</h1>

<p><strong>A Chrome extension that finds duplicate tabs, ranks tab weight, audits your extensions, and reports notification spam.</strong></p>

<p>
<a href="https://developer.chrome.com/docs/extensions/mv3/intro"><img src="https://img.shields.io/badge/manifest-MV3-4285F4?style=flat-square" alt="Manifest V3" height="20"></a>
<a href="https://developer.chrome.com/docs/extensions/mv3/intro"><img src="https://img.shields.io/badge/chrome-120%2B-4285F4?style=flat-square" alt="Chrome 120+" height="20"></a>
<a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript"><img src="https://img.shields.io/badge/javascript-ES2022-F7DF1E?style=flat-square" alt="JavaScript ES2022" height="20"></a>
<a href="https://vite.dev/"><img src="https://img.shields.io/badge/build-vite-646CFF?style=flat-square" alt="Vite" height="20"></a>
<a href="https://www.npmjs.com/"><img src="https://img.shields.io/badge/npm-CB3837?style=flat-square" alt="npm" height="20"></a>
<a href="https://developer.chrome.com/docs/extensions/mv3/intro"><img src="https://img.shields.io/badge/runtime_dependencies-none-2EA44F?style=flat-square" alt="Zero runtime dependencies" height="20"></a>
<a href="https://developer.chrome.com/docs/extensions/mv3/intro"><img src="https://img.shields.io/badge/telemetry-none-2EA44F?style=flat-square" alt="No telemetry" height="20"></a>
<a href="https://github.com"><img src="https://img.shields.io/badge/build-passing-2EA44F?style=flat-square" alt="Build passing" height="20"></a>
</p>

</div>

---

## The problem

Chrome degrades quietly. You open the same article from a newsletter, then from
search, then from a link in Slack, and end up with nine tabs pointing at one page.
Memory climbs and nobody can tell which tab is responsible. Separately, extensions
run in the background for months without anyone checking what they hold. And sites
fire notifications from origins you stopped noticing weeks ago.

Chrome's built-in tools do not surface any of this. Task Manager shows memory but
not duplication. `chrome://extensions` lists permissions in developer language, not
in terms of what they cost you.

Tab Warden answers one question: what is costing me right now, and what can I close.

## Features

| Feature                | What it does                                              | Status          |
| ---------------------- | --------------------------------------------------------- | --------------- |
| **Duplicate finder**   | Groups tabs by normalized URL and closes the copies        | Engine complete |
| **Tab weight ranking** | Ranks tabs by staleness and origin to surface heavy ones   | Planned         |
| **Extension audit**    | Scores installed extensions by permissions and host access | Planned         |
| **Notification log**   | Aggregates notification events by registrable domain       | Planned         |

## How duplicate detection works

Naive URL comparison misses most real duplicates. Tab Warden normalizes before it
compares:

- **Campaign params stripped.** `utm_source`, `utm_medium`, `gclid`, `fbclid`,
  `msclkid` and 19 others, plus the fragment. The same article opened from three
  sources collapses to one tab.
- **YouTube keyed by video id.** `youtu.be/ID`, `/watch?v=ID` and `/embed/ID` all
  match, which is where most people's duplicate pile actually comes from.
- **Hosts normalized.** Lowercased, `www.` dropped, trailing slashes trimmed.
- **Never throws.** One malformed URL cannot break the whole audit.

When a group has several tabs, the survivor is chosen by intent: the pinned tab
first, then the audible one, then the most recently touched. Closing is guarded
three ways, live tab state is re-read before anything closes, the active tab is
never closed, and pinned tabs are skipped by default. The result reports `closed`
and `skipped` separately so the UI can state what was kept, not just what was
removed.

## Install

### From source

```sh
git clone https://github.com/RehanIlyas-dev/Tab-Warden.git
cd Tab-Warden
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
and select the `dist/` folder.

### Web Store

Not published yet.

## Usage

Click the Tab Warden icon in the toolbar. The popup lists every duplicate group,
largest first, with the tab that will be kept marked. **Close duplicates** clears
the rest.

## Architecture

```
Tab-Warden/
├── public/manifest.json
├── popup.html
├── options.html
├── vite.config.js
└── src/
    ├── background/service-worker.js
    ├── lib/tab.js
    ├── lib/messages.js
    ├── popup/main.js
    ├── popup/style.css
    └── options/main.js
```

`src/lib/` is pure. No `chrome.*` calls, so it runs under plain Node and is unit
testable without a browser. All side effects live in the service worker.

The worker queries tabs on demand rather than caching from `tabCreated` and
`tabRemoved` events. MV3 workers are killed when idle and revived with no memory,
so an incrementally patched index returns stale with nothing to signal it. One
`chrome.tabs.query` per popup open is cheap and always correct.

## Development

```sh
npm install
npm run dev
npm run build
npm test
npm run package
```

Chrome does not hot reload extensions. Run `npm run dev`, then press the reload
icon on the extension card in `chrome://extensions`.

| Permission      | Why                          | Required by      |
| --------------- | ---------------------------- | ---------------- |
| `tabs`          | Read tab URLs and titles     | Duplicate finder |
| `storage`       | Persist preferences          | Duplicate finder |
| `notifications` | Observe notification events  | Not shipped yet  |
| `management`    | List installed extensions    | Not shipped yet  |

## Privacy

Everything runs locally. No account, no telemetry, no network requests, no server.
Preferences live in `chrome.storage.local` and never leave your machine. Tab URLs
are read to compute duplicates in memory and are not persisted.

## Tech

Plain JavaScript (ES2022), Manifest V3, Vite, no UI framework, zero runtime
dependencies.

## Contributing

Issues and pull requests welcome.

```sh
npm run build
npm test
```

Keep logic that can be tested in `src/lib/`. Avoid adding runtime dependencies.

## License

Not yet licensed.

## Roadmap

1. Wire the popup UI to the existing audit engine
2. Tab weight ranking with per-tab memory pressure
3. Extension audit with a permission cost score
4. Notification spam report by registrable domain
5. Chrome Web Store submission