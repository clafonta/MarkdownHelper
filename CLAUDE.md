# Markdown Helper – notes for Claude

Lightweight two-pane Markdown editor for macOS built on Electron (plain HTML/CSS/JS, no framework,
no bundler). Header view switch (Markdown only / both / Preview only, ⌘1–3; `applyView` in
renderer.js, `data-view` on `.panes`, Lucide icons inlined, see `src/renderer/LICENSE-lucide.txt`).
Left pane: raw Markdown + an "Edit" menu button (formatting + text tools; same menu on right-click). Right pane: live preview + sync-scroll toggle
+ Copy. Optional left-most file sidebar (only while a folder is open: `mdh somefolder`, File → Open
Folder…, or dropping a folder) listing all the folder's files, unsupported ones greyed out.
Opens Markdown, text, HTML, CSV/TSV, JSON, SVG and common code/config files (list in
`src/file-types.js`), up to 20 MB. Global header: title (left), open file name / "Edited" (center),
dark mode toggle (right).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run in dev (prestart copies vendor bundles and re-brands the dev Electron.app, see below) |
| `npm test` | Unit tests (`node --test test/`) for the pure modules |
| `npm run assets` | Re-render `build/icon.png`, `build/icon.icns`, `build/background*.png` from the SVGs |
| `npm run dist` | DMG + ZIP for arm64 and x64 into `dist/` (`dist:arm64`, `dist:x64` for one arch) |

## Layout

- `src/main.js` – main process: window (hiddenInset title bar), menus, all file I/O and dialogs,
  unsaved-changes close/quit flow, clipboard writes, theme sync, external links. `open-file` with a
  directory (from `open -a`, i.e. `mdh folder`) sends `menu:open-folder-path` instead of `menu:open-path`.
- `src/file-types.js` – UMD, shared by main (`require`) and renderer (`window.FileTypes`, loaded
  as `../file-types.js`). `TYPES` table (by extension or exact file name) → `fileInfo(path)` =
  `{ kind, label, tabs }`, kind ∈ `markdown|text|html|csv|tsv|json|svg|code` (no path = untitled
  Markdown; unsupported = null). Single source of truth; `scripts/mdh` mirrors the lists and a test
  fails if they drift. Adding a type = one row here (+ mdh), plus a preview only if it needs one.
- `src/text-format.js` – UMD, shared: line-ending detect/normalize/restore, tab-vs-space detection.
- `src/folder-scan.js` – `scanFolder(root)` → sidebar tree (Node only, main process). Lists all
  files with a `supported` flag; skips hidden folders, `node_modules`, and hidden files we can't
  open; depth/file-count capped. `readDocument` in main refuses unsupported and >20 MB files.
- `src/preload.js` – the only bridge (`window.markdownHelper`). Renderer is sandboxed with
  contextIsolation, so anything needing Node/Electron goes through IPC here.
- `src/renderer/boot.js` – the only script in `<head>`: sets `data-platform` and `data-theme` on
  `<html>` before the first paint (header room for the traffic lights, no light flash). Anything the
  first paint depends on goes here, not in renderer.js (loaded last).
- `src/renderer/` – loaded as classic `<script>` tags in this order:
  - `tools.js` – pure text transforms: `removeNewlines`, `formatTables` (window.MarkdownTools)
  - `scroll-map.js` – pure sync-scroll math (window.ScrollMap)
  - `data-preview.js` – pure CSV/TSV parsing and JSON pretty-print/error location (window.DataPreview)
  - `mermaid-render.js` – Mermaid: lazy-loads `../vendor/mermaid.min.js`, renders one diagram at a
    time, caches by theme + source, SVG→PNG for Copy (window.MermaidRender; DOM-dependent)
  - `html-to-markdown.js` – preview DOM → Markdown (`blocksToMarkdown`) and `patchSource`
    (3-way: keep the user's own Markdown where an edit didn't touch it) (window.HtmlToMarkdown)
  - `undo-history.js` – app-owned undo/redo snapshots shared by both panes (window.UndoHistory)
  - `text-diff.js` – `changedRanges(old, new)`: what a format command added, minus whitespace/dash
    padding, for the editor highlight (window.TextDiff)
  - `find.js` – Find & Replace matching: `findMatches` (literal, case / whole-word options),
    `matchAfter`, `replaceMatches` (window.Find)
  - `export-html.js` – clean semantic HTML for "Copy" (no fonts/sizes/colors) (window.ExportHtml; DOM-dependent)
  - `renderer.js` – UI wiring: rendering, document state, toolbar, sync scroll, theme, folder sidebar
- `build/` – icon + DMG background SVG sources **and** their generated PNG/ICNS (committed on
  purpose: electron-builder reads them directly). `icon.svg` is the brand icon
  (`brand/BrandIcon.dc.html`, "Brand 01": ".md" on an amber highlight + a five-arm asterisk; 64-unit
  grid, same art at every size) placed on the macOS grid (824px tile on 1024); its ".md" is
  JetBrains Mono Bold converted to outlines. The kit's "Brand ·" boards (BrandIcon, BrandLockup,
  BrandPalette, BrandType) are the source of truth; the others are exploration. `brand/` is
  git-ignored (local only), so `build/icon.svg` is the committed source of the icon. Its ".md" is JetBrains Mono Bold converted to outlines (no font needed to
  render). After changing it: `npm run assets`, then `node scripts/brand-dev-electron.js`.
- `scripts/make-assets.js` – rasterizes SVGs with Electron's Chromium + `iconutil`. The DMG
  background (`build/dmg-background.svg`, brand colors + type) gets the bundled brand fonts injected
  into its `<style>` while rendering, since an SVG drawn as an image can't load font files.
- `scripts/brand-dev-electron.js` – renames dev `node_modules/electron/dist/Electron.app` to
  `Markdown Helper.app` (the Dock's hover label is the bundle's file name) and points
  `node_modules/electron/path.txt` at it, sets the Info.plist names (menu bar), copies our icon,
  re-signs ad hoc. Electron's installer then sees path.txt as changed, so `npm install`
  re-extracts a stock Electron.app; postinstall re-brands it. Restart `npm start` after it runs.
- `scripts/vendor.js` – copies `node_modules/mermaid/dist/mermaid.min.js` (+ license) into
  `src/vendor/` (git-ignored) on postinstall / prestart / predist. mermaid is a **devDependency on
  purpose**: as a dependency electron-builder would pack its ~200 MB dependency tree into the app.
- `scripts/mdh` – shell launcher (`open -a "Markdown Helper" …`); creates missing files, passes
  folders through (the app shows them in the sidebar).

## Conventions

- Pure logic goes in UMD-style modules (`module.exports` in Node, `window.X` in the browser) so it
  can be unit-tested in Node; add tests in `test/` for any new transform.
- Editor edits go through `replaceRange()` in renderer.js (execCommand `insertText` on the minimal
  changed span). Undo/redo is **not** Chromium's: Edit → Undo/Redo are custom menu items
  (`menu:undo`/`menu:redo`) driving `undo-history.js`; every change must be `history.record`ed
  (editor `input` does it; preview sync does it). Chromium's page-wide native stack can't be used:
  preview edits write the textarea programmatically and replaying old textarea steps corrupts text.
  `beforeinput` historyUndo/Redo is intercepted as a backstop.
- Editable preview (markdown/text kinds, `#preview` contenteditable): native DOM editing; on
  `input`, `syncFromPreview` finds changed top-level groups (elements tagged `data-block` = marked
  token index; untagged/new nodes join the previous block), converts only those with
  `blocksToMarkdown`, `patchSource`s them into the token's source, and writes the textarea with
  `setRangeText` (no focus change). The preview is not re-rendered while edited (caret); it is on
  editor focus/input. Mermaid and raw-HTML tokens are `contenteditable=false` and pass through via
  `rawOf`. A plain Save doesn't re-render the preview.
- Preview formatting (shortcuts + right-click menu `previewMenuTemplate` in main.js → `preview-format`
  command → `applyPreviewFormat` in renderer.js): execCommand for bold / italic / strikethrough
  only. Paragraph types (`setPreviewBlockType`: every selected paragraph / list item / quote line /
  code line becomes one line of the new type; partly selected lists and quotes are split) and
  un-`code` (`toggleInlineCode`) are direct DOM changes that call `syncFromPreview` themselves. Format
  commands set `teachPending` → `flashEditorRanges(changedRanges(...))` highlights the added
  Markdown (`.editor-flash`, laid out like `.editor-mirror`). Table commands live in a Table submenu
  (`formattingItems`: Insert Table outside a table, rows/columns/alignment in one via
  `state.table`); `tableCommand()` / `insertPreviewTable()` edit the DOM directly and sync; Tab
  moves between cells; Enter / ↓ in the last row and a click below the last block add an empty
  `<p><br></p>` (`paragraphAfter`), which only reaches the Markdown once something is typed in it. `previewFormatState()` feeds the menu's checkmarks. Never let a
  `closest()` from the selection escape `#preview`. The editor's own Cmd+B/I is `toggleEmphasis`.
- Editor formatting and text tools live in the native **Edit** menu (button `#btn-format` and
  right-click in the editor; `formatMenuTemplate` in main.js, popped up via `showFormatMenu` with
  `editorFormatState()` for checkmarks; picks come back as the `format` command →
  `FORMAT_COMMANDS` in renderer.js). Its formatting/table items are shared with the preview's
  menu (`formattingItems`), but editor commands edit the Markdown text through pure tools.js
  functions (`toggleInline`, `setBlockType`, `tableEdit`, + `inlineStylesAt`/`blockTypeAt`/
  `tableAt` for state) and `applyEdit` → `replaceRange`. New tool = transform in tools.js + test,
  a menu item, and a `FORMAT_COMMANDS` entry.
- CSV / TSV preview: every cell is `contenteditable="plaintext-only"` (the preview itself isn't
  editable); `csvCellEdited` → `DataPreview.editDelimited` (data-preview.js: rewrites only that
  row; `parseDelimited` gives each row's `start`/`end` and fields' `raws`). Row/column commands
  (`dataTableCommand`, right-click menu `state.dataTable`) rewrite the table and re-render.
  Conversions: `delimitedToMarkdown` / `markdownTableToCsv` (tools.js); preview tables are
  exported from the DOM (`tableElementToCsv`). `file:export` (main) saves a converted copy.
- Finder "Open With": `build.fileAssociations` in package.json (rank Alternate) for the document
  types; only takes effect in packaged builds.
- Find & Replace: Edit ▸ Find menu items (Cmd+F / ⌥⌘F / ⌘G / ⇧⌘G) send `menu:find` →
  `openFind` / `findNext` in renderer.js. Matches are painted on `.editor-find` (an overlay laid
  out like `.editor-mirror`, since the textarea doesn't paint its selection while the find field
  has focus); the current match is also the editor selection. `updateDirty` calls
  `refreshFind()`, so any text change (typing, preview sync, undo, tools) re-searches.
- Unsaved-text recovery: renderer keeps a copy per open document (`docId`, written by
  `saveRecovery` 1 s after a change via `noteRecovery` in `updateDirty`; deleted when the doc is
  clean). `flushRecovery()` writes it immediately before a document is replaced (`loadDocument`)
  or a window closes after "Don't Save". Storage: `recovery:*` IPC in main → userData/Recovery/
  `<id>.json` (written via tmp + rename; ids validated; >7 days pruned). `recovery:list` answers
  only the first window per launch; the renderer shows `#recovery-bar`.
- Folder sidebar right-click: `folderMenuTemplate` in main → `folder-action` → `runFolderAction`
  in renderer.js. Names are typed inline (`nameField`; `treeEditing` blocks tree refreshes while
  it's open). File ops are `entry:*` IPC handlers in main; every path goes through
  `inOpenFolder()` (main tracks each window's folder in `folderRoots`), names through
  `checkName()`. Rename/trash of the open document's file (or a parent folder) updates
  `doc.filePath` (`movedOnDisk`; trashed → Untitled, dirty). Electron 45 `clipboard.writeText` is
  async.
- Folder sidebar keyboard: clicks open with `openFile(path, { focusEditor: false })` so focus stays
  in the tree; Up/Down (`openOnArrow`, 120 ms debounce) open the file landed on unless `doc.dirty`;
  Enter opens + focuses the editor. `openSeq` makes the last of overlapping opens win.
- Typing in the editor (Markdown/text): Enter → `continueList`, Tab/Shift+Tab → `indentLines`
  (tools.js, pure, tested in test/list-typing.test.js), applied with `applyEdit` (one undo step).
  They return null where the key should do its normal thing. Both renumber numbered lists
  (`renumberList`, which returns a position `map` for the cursor). Skip while `e.isComposing` (IME).
  In other kinds Tab only indents/outdents (no list logic: YAML `- x` isn't a Markdown list).
- Tools use `applyTool(transform, { wholeLines })`: selection if any, else whole document. The
  transform is called as `transform(text, { wholeDocument })`.
- Text tools must leave Markdown structure alone (tables, lists, fenced/indented code, headings).
  In tools.js, `classifyLines()` (code / table / heading / list / para …) and `protectedRanges()`
  (inline code, URLs, tags, entities) are the shared building blocks: reuse them for new tools.
  `changeCase(text, 'upper'|'lower'|'title'|'sentence', { markdown })`; non-Markdown kinds pass
  `markdown: false`. `toTable` reuses `parseDelimited` from data-preview.js (loaded first).
- `applyTool(..., { block: true })`: no selection = the paragraph around the cursor (Convert to Table).
- Preview rendering is per top-level marked token, each element tagged `data-line` = source line;
  sync scroll depends on that. Sanitize everything with DOMPurify.
- Brand in the UI: palette tokens in styles.css (`:root` = brand light; dark = Graphite + Signal
  Light), the header lockup (`.app-title`: inline icon SVG colored by `--icon-*` tokens + "Markdown
  Helper" in Space Grotesk), fonts bundled in `src/renderer/fonts/` (`fonts.css`; Inter = UI/body,
  Space Grotesk = headings/wordmark, JetBrains Mono = editor/code, ligatures off in the editor;
  OFL licenses alongside). No fonts from the network (CSP + offline).
- Theme colors are CSS variables on `:root` / `:root[data-theme="dark"]`. Copy output sets no colors,
  fonts or sizes at all (the paste target's own styles apply), so the theme never leaks into it.
- localStorage keys are prefixed `markdown-helper:`.
- Preview per kind (`applyKind()` + `render()` in renderer.js): markdown/text → `#preview`
  (Markdown tools only here); csv/tsv/json/svg → also rendered into `#preview`; html →
  `#preview-frame`, an iframe with `sandbox="allow-same-origin"` (no scripts; the parent can still
  read it for Copy/scroll) fed via `srcdoc` with an injected `<base>` pointing at the file's folder,
  re-rendered debounced; code → no preview. Copy/sync are off for code and svg.
  Anything touching the preview scroll position goes through `previewScroller()`.
- JSON tree (renderer.js `jsonView`): open/closed state is kept by path (`$/"key"/3`) in
  `open`/`closed` sets plus a default `depth`, so it survives re-renders while typing; reset per
  document in `loadDocument`. Closed nodes' children aren't rendered. Each row carries `data-line`
  (from `parseJsonTree`) for sync scroll. Copy for JSON exports the pretty text, not the widget.
- Mermaid: ```mermaid blocks (and `.mmd`/`.mermaid` files) become `.mermaid-diagram` blocks with
  `data-line`, filled asynchronously with an `<img>` of the SVG. Rendered as images, not inline
  SVG, so they need no DOMPurify pass: an image can't run scripts or leak styles. Config is
  `securityLevel: 'strict'` + `htmlLabels: false` (no `<foreignObject>`, otherwise the canvas used
  for Copy's PNG gets tainted). Theme changes re-render; Copy always exports the light theme.
- Sync scroll anchors are any `#preview [data-line]` element (Markdown blocks, CSV/TSV rows),
  measured with getBoundingClientRect; without anchors (HTML, JSON) it's proportional.
- Line endings: main normalizes to `\n` on read and returns `eol`; the renderer passes `doc.eol`
  back on save. Never hand CRLF text to the textarea (it rewrites it anyway).
- The split divider sizes panes inside `.panes` (editor + divider + preview), not `.workspace`, so
  the sidebar doesn't affect the split ratio. With the sidebar shown, main raises the window's
  minimum width (`MIN_WIDTH_WITH_SIDEBAR`) so both pane headers still fit.

## Gotchas

- Don't use `webContents.isLoading()` to decide whether a window can take an IPC message: it's
  also true while a sub-frame (the HTML preview iframe) loads. main tracks `loadedWindows` instead.
- A `<textarea>` stops painting its selection when it loses focus. Buttons that act on the
  selection (Edit) must not take focus: `mousedown` → `preventDefault()`, and `editor.focus()`
  before opening the menu.
- Don't use Chromium's `formatBlock` / `insertUnorderedList` / `insertOrderedList` / `outdent` in
  the preview: across several paragraphs they produce `<p><ul>…</ul></p>`, one heading joined by
  `<br>`s, `<br>`-separated quote lines, and can't turn a `<pre>` back into anything.
- Sticky `<thead>` needs `border-collapse: separate` (`.data-table`); with collapsed borders
  Chromium lets scrolled rows show through the header's top edge.

- **Electron 45 clipboard API is async and W3C-style**:
  `await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })])`;
  read with `clipboard.read()` + `item.getType(type)`. `clipboard.readHTML()` no longer exists.
- Packaged executable is `Contents/MacOS/Markdown` (electron-builder strips " Helper").
- Builds are ad-hoc signed (`mac.identity: "-"`) with `hardenedRuntime: false`; hardened runtime
  + ad-hoc breaks launch. Re-enable it only together with Developer ID signing + notarization.
- npm 11 blocks dependency install scripts by default; `electron-winstaller`'s is irrelevant on Mac.

## Verifying changes in the real app

Unit tests don't cover the UI. To check behavior, write a throwaway harness in the scratchpad that
calls `app.setPath('userData', <scratch dir>)` **before** requiring main (a harness that quits
with unsaved text would otherwise leave recovery copies in the real profile, offered on the
user's next launch), then
`require`s `src/main.js`, hooks `app.on('browser-window-created')`, drives the page with
`webContents.executeJavaScript(...)` / `webContents.send('menu:...')`, saves
`webContents.capturePage()` PNGs, and calls `app.exit(0)`. Run it with
`npx electron <harness>.js` (needs the sandbox disabled to launch). For a packaged build, launch
`dist/mac-arm64/Markdown Helper.app/Contents/MacOS/Markdown --remote-debugging-port=9333` and
drive it over CDP.
