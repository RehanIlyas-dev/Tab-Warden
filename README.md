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

| Feature                | What it does                                               | Status  |
| ---------------------- | ---------------------------------------------------------- | ------- |
| **Duplicate finder**   | Groups tabs by normalized URL and closes the copies        | Shipped |
| **All tabs by site**   | Every open tab, grouped by domain, click to focus          | Shipped |
| **Guarded closing**    | Never closes the active tab or your pinned tabs            | Shipped |
| **Tab weight ranking** | Ranks tabs by memory pressure                              | Planned |
| **Extension audit**    | Scores installed extensions by permissions and host access | Planned |
| **Notification log**   | Aggregates notification events by registrable domain       | Planned |

Shipped features are covered by 66 unit tests. Planned features are not built and
are not requested as permissions.

## Using it

Open the toolbar icon. Three stat cards, then two lists:

- **Duplicate tabs**, one row per group, showing how many copies exist. The
  **Show** button jumps to that tab and raises its window.
- **All tabs**, every open tab grouped by domain, most recent first. Click any row
  to jump to it. Rows tagged `pinned` or `playing` are the ones cleanup will never
  close.

**Close duplicates** shows an inline confirmation, then closes the copies and
reports how many were closed and how many were kept.

Three guards protect you from losing work. The active tab is never closed, pinned
tabs are skipped, and live tab state is re-read before anything closes, so a tab
that navigated after the audit is left alone.

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

## Architecture

```
Tab-Warden/
├── public/manifest.json
├── public/assets/icon-16.png
├── scripts/make-icons.py
├── popup.html
├── options.html
├── vite.config.js
├── src/
│   ├── background/service-worker.js
│   ├── lib/tab.js
│   ├── lib/focus.js
│   ├── lib/messages.js
│   ├── popup/main.js
│   ├── popup/style.css
│   └── options/main.js
└── test/
    ├── tab.test.js
    ├── service-worker.test.js
    ├── focus.test.js
    └── fake-chrome.js
```

`src/lib/tab.js` is pure. No `chrome.*` calls, so it runs under plain Node and is
unit testable without a browser. All side effects live in the service worker.

`src/lib/focus.js` takes the `chrome.tabs` and `chrome.windows` objects as
arguments instead of importing them, which is what makes it testable. It returns
a result object rather than throwing, so a failed tab switch reaches the popup
footer instead of vanishing into a rejected promise.

`test/fake-chrome.js` is a hand-written stand-in for the slice of `chrome.*` the
service worker calls. A real service worker cannot run in Node, so without it the
guard rules would be untestable.

The worker queries tabs on demand rather than caching from `tabCreated` and
`tabRemoved` events. MV3 workers are killed when idle and revived with no memory,
so an incrementally patched index returns stale with nothing to signal it. One
`chrome.tabs.query` per popup open is cheap and always correct.

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

MIT. See [LICENSE](LICENSE).
