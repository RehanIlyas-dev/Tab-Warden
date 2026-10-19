# Chrome Web Store listing fields

Everything the Developer Dashboard asks for, ready to paste. Last updated 19 October 2026.

## Store listing tab

**Name** (max 75 characters)

```
Tab Warden
```

**Short description** (max 132 characters, 108 used)

```
Finds duplicate tabs by URL, lists every open tab grouped by site, and closes the copies you no longer need.
```

**Category**

```
Productivity
```

**Language**

```
English (United States)
```

**Detailed description** (plain text, the store strips markdown)

```
Tab Warden finds duplicate tabs for you and closes the ones you do not need.

Duplicate finder
The same page often sits in several tabs because you opened it from a newsletter, a search result, and a link in a chat. Tab Warden compares tabs by their real address, ignoring tracking parameters and matching YouTube links by video id, so those copies collapse into one row.

Close with guards
The Close duplicates button shows an inline confirmation and then closes the copies. It never closes the tab you are looking at, and it skips your pinned tabs by default. Afterwards it reports how many tabs were closed and how many were kept.

Every tab, grouped by site
The second list shows all your open tabs grouped by domain, most recent first. Click any row to jump straight to that tab and bring its window to the front. Rows carry a pinned or playing tag where it applies.

Private by design
Everything runs on your device. There are no network requests, no analytics, and no telemetry. Tab addresses and titles are read when the popup opens and are never saved. The only thing stored is your two preferences.

Support
Report a problem at https://github.com/RehanIlyas-dev/Tab-Warden/issues
```

**Graphic assets**

| Field | File |
| --- | --- |
| Store icon 128x128 | `public/assets/icon-128.png` |
| Screenshot 1280x800 | `docs/store/screenshot-1.png` |
| Small promo tile 440x280 | `docs/store/promo-440x280.png` |
| Marquee promo tile 1400x560 | `docs/store/marquee-1400x560.png` |
| Promo video | none, optional |

## Privacy tab

**Single purpose**

```
Find and close duplicate browser tabs.
```

**Permission justification, `tabs`**

```
Reads the URL and title of open tabs so duplicates can be found and every tab listed by site. Without this permission Chrome exposes only tab identifiers, which are not enough to compare pages.
```

**Permission justification, `storage`**

```
Saves two preferences on the device: whether pinned tabs are skipped when closing duplicates, and whether a confirmation appears before anything is closed.
```

**Remote code**

```
No, I am not using remote code.
```

**Data usage**

| Category | Collected | Transmitted off device | Purpose | Sold or shared |
| --- | --- | --- | --- | --- |
| Web history | Yes | No | App functionality, showing and closing duplicate tabs | No |
| All other categories | No | No | Not applicable | No |

The tab URL and title is what the extension reads, and Chrome classifies that as web history. It stays in memory for the session and is never written to disk or sent anywhere, so nothing leaves the device.

**Certifications**

- Data is not sold to third parties.
- Data is not used for purposes unrelated to the single purpose.
- Data is not used to determine creditworthiness or for lending.

**Privacy policy URL**

```
https://rehanilyas-dev.github.io/Tab-Warden/
```

## Distribution tab

```
Visibility: Public
Regions: all regions where the Chrome Web Store is available
```

## Developer info

```
Publisher name: Rehan Ilyas
Contact email: rehanilyas4726@gmail.com
Support URL: https://github.com/RehanIlyas-dev/Tab-Warden/issues
```

## Package

Upload `tab-warden-0.1.1.zip` from the repo root, built with `npm run package`.

## Review notes

Things that could draw a question from a reviewer:

- The single purpose is tab cleanup. The extension does not touch extensions or notifications, so it stays within one purpose.
- Only two permissions are requested and both are used by shipped features.
- No host permissions, no content scripts, and no remote code.
