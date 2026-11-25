# Markdown Helper

A lightweight two-pane Markdown editor for macOS, built with Electron.

## Run

```sh
npm install
npm start
```

`npm start` runs inside Electron's stock `Electron.app`. macOS takes the menu-bar name and Dock icon
from that bundle, so `scripts/brand-dev-electron.js` renames it to "Markdown Helper" and gives it our
icon. It runs automatically after `npm install` and before `npm start`.

## Layout

- `src/main.js` – Electron main process (window, theme sync, external links)
- `src/preload.js` – minimal bridge exposed to the UI
- `src/renderer/` – UI: `index.html`, `styles.css`, `renderer.js`

Markdown is rendered with [marked](https://github.com/markedjs/marked) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify).

## Files

| Shortcut        | Action   |
| --------------- | -------- |
| Cmd + N         | New      |
| Cmd + O         | Open     |
| Cmd + S         | Save     |
| Cmd + Shift + S | Save As  |

You can also drag a file onto the window to open it. Unsaved changes are flagged in the header,
and you're asked to save before closing, quitting, or replacing the document.

## Tools

- **Remove new lines** – joins hard-wrapped lines inside each paragraph. Tables, lists, code,
  headings and HTML are left untouched; quoted paragraphs keep a single `>`.
- **Format tables** – repairs tables whose rows were merged onto one line and aligns every column.

Both apply to the selection, or to the whole document when nothing is selected. Cmd+Z undoes them.

In the preview header:

- **Sync scroll** – keeps the editor and preview on the same content as you scroll either one
  (on by default, remembered between launches).
- **Copy** (also Edit → Copy Formatted, Shift+Cmd+C) – copies the rendered preview as clean rich
  text: headings, bold/italic, lists, links, code and tables, but no fonts, sizes or colors, so it
  takes on the style of wherever you paste it (Google Docs headings, your email font, etc.). Plain text is
  included for apps that don't accept formatting.
Drag the divider between the panes to resize them (double-click it to reset to 50/50). It can
also be focused with Tab and moved with the arrow keys (Shift for bigger steps). The split is
remembered between launches.

The transforms live in `src/renderer/tools.js` and the scroll-sync math in `src/renderer/scroll-map.js`;
run their unit tests with `npm test`.

## Building the app

```sh
npm run dist          # Apple silicon + Intel
npm run dist:arm64    # Apple silicon only
npm run dist:x64      # Intel only
npm run assets        # regenerate icon / DMG background from build/*.svg
```

Output in `dist/`, per architecture:

- `Markdown-Helper-<version>-<arch>.dmg` – drag-to-install disk image
- `Markdown-Helper-<version>-<arch>.zip` – the bare `.app`, for unzipping anywhere

Pick `arm64` for Apple silicon (M-series) Macs and `x64` for Intel Macs
( → About This Mac shows "Chip: Apple M…" or "Processor: Intel").

## Installing

**With admin rights:** open the `.dmg` and drag **Markdown Helper** onto the **Applications** shortcut.

**Without admin rights (e.g. a managed work laptop):** the app needs no installer and no admin
rights. It runs from anywhere you can write to. The usual place is `~/Applications`, which
Launchpad and Spotlight also index:

1. In Finder, press Cmd+Shift+H to open your Home folder. Create a folder named `Applications` if it isn't there.
2. Open the `.dmg` and drag **Markdown Helper** into that folder. Or unzip the `.zip` there:
   ```sh
   mkdir -p ~/Applications
   ditto -x -k ~/Downloads/Markdown-Helper-0.1.0-arm64.zip ~/Applications
   ```

### First launch (unsigned build)

The build is ad-hoc signed, not signed with an Apple Developer ID. If the file was downloaded
(email, browser, chat), macOS will refuse to open it the first time. Either:

- open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**, or
- clear the download flag (no `sudo` needed for apps in your own folders):
  ```sh
  xattr -dr com.apple.quarantine ~/Applications/Markdown\ Helper.app
  ```

Some corporate device-management policies block all apps that aren't notarized. In that case
the app has to be signed with an Apple Developer ID and notarized ($99/year Apple Developer
Program). electron-builder does this when `CSC_LINK`/`CSC_KEY_PASSWORD` and the notarization
credentials are set. Also set `build.mac.hardenedRuntime` back to `true`.
