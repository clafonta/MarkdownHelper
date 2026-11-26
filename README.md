# Markdown Helper

A lightweight two-pane Markdown editor for macOS, built with Electron. It also edits plain text,
HTML, CSV/TSV, JSON, SVG and common code and config files.

## Run

```sh
npm install
npm start
```

`npm start` runs inside Electron's stock `Electron.app`. macOS takes the menu-bar name and Dock icon
from that bundle, so `scripts/brand-dev-electron.js` renames it to "Markdown Helper" and gives it our
icon. It runs automatically after `npm install` and before `npm start`.

## Layout

- `src/main.js` – Electron main process (window, menus, file I/O, theme sync, external links)
- `src/file-types.js` – which extensions can be opened and how each kind is previewed
- `src/folder-scan.js` – builds the sidebar's file tree for an opened folder
- `src/preload.js` – minimal bridge exposed to the UI
- `src/renderer/` – UI: `index.html`, `styles.css`, `renderer.js`

Markdown is rendered with [marked](https://github.com/markedjs/marked) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify).

## Files

| Shortcut        | Action   |
| --------------- | -------- |
| Cmd + N         | New      |
| Cmd + O         | Open     |
| Cmd + Shift + O | Open Folder |
| Cmd + S         | Save     |
| Cmd + Shift + S | Save As  |

You can also drag a file onto the window to open it. Unsaved changes are flagged in the header,
and you're asked to save before closing, quitting, or replacing the document.

### Folders

Open a folder (File → Open Folder…, drag a folder onto the window, or `mdh somefolder` from the
terminal) to get a **file sidebar** on the left listing everything in the folder, including
subfolders. Click a file to open it in the editor. Files Markdown Helper can't open are shown
greyed out; hidden files and `node_modules` are left out. The list refreshes when you
switch back to the app or save a file into the folder (or click ↻), and × closes the sidebar.
Arrow keys move through the list; Left/Right collapse and expand folders.

### Command line

`scripts/mdh` opens files and folders from the terminal. Install it without admin rights:

```sh
mkdir -p ~/.local/bin && ln -s "$PWD/scripts/mdh" ~/.local/bin/mdh
```

```sh
mdh                 # launch / focus Markdown Helper
mdh notes.md        # open notes.md (created empty if it doesn't exist; also .txt/.html/.css)
mdh docs            # open the docs folder in the file sidebar
mdh .               # same, for the current folder
```

### File types

| Files | Editor | Preview |
| --- | --- | --- |
| `.md` (also `.markdown`, `.mdown`, `.mkd`, `.mdx`) | ✓ | Rendered Markdown |
| `.txt`, `README`, `LICENSE`, `CHANGELOG` | ✓ | Rendered as Markdown |
| `.html`, `.htm` | ✓ | The page itself, as a browser shows it. Scripts don't run; stylesheets and images next to the file load. Links open in your browser. |
| `.csv`, `.tsv` | ✓ | A table (first row as the header), with row and column counts. Copy pastes it as a real table. |
| `.json` | ✓ | A collapsible tree (see below); if it's invalid, the line and column of the problem (**Show in editor** jumps there) |
| `.svg` | ✓ | The image |
| Code and config: `.css`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.py`, `.rb`, `.go`, `.java`, `.swift`, `.sh`, `.bash`, `.zsh`, `.sql`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.env`, `.xml`, `.log`, `Makefile`, `Dockerfile`, `.gitignore`, `.gitattributes`, `.editorconfig` | ✓ | None |

Other files (images, PDFs, …) can't be opened, and neither can files over 20 MB. The Markdown
tools below only apply to Markdown and text files.

- **JSON tree:** click an arrow to open or close one object/array; **Option-click** opens or closes
  it and everything inside it; **Expand all** / **Collapse all** do the whole file. Closed items
  show a count ("12 items", "3 keys"). What's open is kept while you edit. Values are shown exactly
  as written (big numbers aren't rounded). Very large files start with two levels open. **Copy**
  copies the JSON text (pretty-printed), not the tree.
- **Tab** inserts two spaces, or a real tab in Makefiles, Go and TSV files and in files that are
  already indented with tabs.
- **Line endings are kept:** a file with Windows (CRLF) line endings is saved with CRLF again.

## Tools

The **Help!** menu in the editor header:

- **Clean Up Pasted Text** – fixes the usual mess from PDFs, Word and e-mail:
  - rejoins words split across lines (`exam-` / `ple` → `example`); note that a real hyphenated
    word that happens to break at a line end (`well-` / `known`) is joined too
  - turns `•`, `◦`, `▪`, `–` … bullets into Markdown list items
  - replaces no-break and thin spaces with normal spaces and removes invisible characters
  - collapses runs of spaces inside text, removes trailing spaces (keeping a two-space Markdown
    line break) and squeezes multiple blank lines into one

  Code and tables are left alone.
- **Remove New Lines** – joins hard-wrapped lines inside each paragraph. Tables, lists, code,
  headings and HTML are left untouched; quoted paragraphs keep a single `>`.
- **Format Tables** – repairs tables whose rows were merged onto one line and aligns every column.
- **Convert to Table** – turns rows pasted from a spreadsheet, a CSV or a PDF (separated by tabs,
  commas, semicolons or runs of spaces) into an aligned Markdown table, first row as the header.
  With nothing selected it converts the block of lines around the cursor.
- **UPPERCASE** / **lowercase** / **Title Case** / **Sentence case** – change the case of the text.
  - Title Case keeps short words lowercase (*a, of, the, and, from, with…*) except at the start,
    the end, or after a colon.
  - Sentence case capitalizes the start of each sentence, including across wrapped lines, and
    fixes a lone "i". It can't recognize names, so "Ada Lovelace" becomes "Ada lovelace".
  - Both keep acronyms (NASA) and brand casing (iPhone). Three or more capitalized words in a
    row, or an all-caps line, count as shouting and are re-cased.
  - In Markdown and text files, things whose case matters are left alone: code (inline and
    blocks), link and image URLs, bare URLs and e-mail addresses, HTML tags, entities like
    `&nbsp;`, reference link definitions, and front matter at the top. In other files (code,
    JSON, CSV, …) every word is changed.

All of them apply to the selection, or to the whole document when nothing is selected. Cmd+Z
undoes them. Clean Up, Remove New Lines, Format Tables and Convert to Table are only available
for Markdown and text files.

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
