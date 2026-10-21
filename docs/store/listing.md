# Chrome Web Store listing fields

Everything the Developer Dashboard asks for, ready to paste. Last updated 21 October 2026.

## Store listing tab

**Name** (max 75 characters)

```
Tab Warden
```

**Short description** (max 132 characters, 117 used)

```
Finds duplicate tabs by URL, groups every open tab by site, closes the copies, and unloads the idle ones, once a day.
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
Tab Warden finds duplicate tabs for you, closes the ones you do not need, and frees the memory held by the tabs you have forgotten about.

Duplicate finder
The same page often sits in several tabs because you opened it from a newsletter, a search result, and a link in a chat. Tab Warden compares tabs by their real address, ignoring tracking parameters and matching YouTube links by video id, so those copies collapse into one row.

Close with guards
The Close duplicates button shows an inline confirmation and then closes the copies. It never closes the tab you are looking at, and it skips your pinned tabs by default. Afterwards it reports how many tabs were closed and how many were kept.

Heaviest tabs
The second list rates your tabs, heaviest first. A tab you have not touched for days sits at the top, and a tab playing music in the background counts too. The rating is an estimate. Chrome does not give extensions a real memory figure for a tab, so the rating comes from how long a tab has been idle, whether it is playing audio, and whether it is a duplicate.

Free up memory
The Free button unloads one idle tab, and Free up memory unloads all of them at once. Unloading empties the memory a background tab was holding and leaves the tab in place, so it reloads when you click it. Anything you had not saved on that page is lost, so the button asks first.

Daily clean up
Turn on one switch in the options and the same job runs on its own once a day, while the browser is open. It uses the same rules as the button, so pinned tabs and tabs playing audio are left alone, and it never touches a tab you are looking at in any window. The popup tells you when it last ran and how many tabs it freed.

Every tab, grouped by site
The third list shows all your open tabs grouped by domain, most recent first. Click any row to jump straight to that tab and bring its window to the front. Rows carry a pinned, playing, or stale tag where it applies.

Private by design
Everything runs on your device. There are no network requests, no analytics, and no telemetry. Tab addresses and titles are read when the popup opens, and once a day if you turn on the daily clean up, and are never saved. The only thing stored is your preferences and a record of the last clean up.

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
Clean up your open tabs by finding duplicates and unloading the ones you have not used.
```

**Permission justification, `tabs`**

```
Reads the URL and title of open tabs so duplicates can be found, every tab listed by site, and idle tabs unloaded. Without this permission Chrome exposes only tab identifiers, which are not enough to compare pages.
```

**Permission justification, `storage`**

```
Saves your preferences on the device: whether pinned tabs are skipped, whether a confirmation appears before anything is closed or unloaded, how many days count as stale, whether tabs playing audio are left alone, and whether the daily clean up runs on its own. It also keeps a record of the last clean up, which is a time and two counts.
```

**Permission justification, `alarms`**

```
Wakes the extension up once a day so the daily clean up can run while the browser is open. Without this permission the clean up could only happen while the popup was open, which is exactly when it is not needed.
```

**Remote code**

```
No, I am not using remote code.
```

**Data usage**

| Category | Collected | Transmitted off device | Purpose | Sold or shared |
| --- | --- | --- | --- | --- |
| Web history | Yes | No | App functionality, showing, closing, and unloading tabs | No |
| All other categories | No | No | Not applicable | No |

The tab URL and title is what the extension reads, and Chrome classifies that as web history. It stays in memory for the session and is never written to disk or sent anywhere, so nothing leaves the device. When the daily clean up is on, the same tab details are read once a day in the background for the same reason and are not stored either.

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

Upload `tab-warden-0.2.0.zip` from the repo root, built with `npm run package`. The same command also builds `tab-warden-0.2.0.tar.gz` for Linux users, which is attached to the GitHub release.

## Review notes

Things that could draw a question from a reviewer:

- The single purpose is tab cleanup. The extension does not touch extensions or notifications, so it stays within one purpose.
- Three permissions are requested and all three are used by shipped features. The tab weight and unload feature added no new permission, it uses the `tabs` permission that was already there. The `alarms` permission was added with the daily clean up and is used for nothing else.
- The daily clean up is off by default. The user has to turn it on in the options, and when it is on it only unloads tabs that have been idle for the number of days they set, using the same guards as the button.
- The weight shown in the popup is an estimate, not a memory reading. Chrome does not expose per tab memory to extensions, so the listing says so in plain words.
- Unloading a tab empties the memory it was holding and the tab reloads when you click it. The confirmation says this.
- No host permissions, no content scripts, and no remote code.
