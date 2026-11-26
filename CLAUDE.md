# Markdown Helper – notes for Claude

Lightweight two-pane Markdown editor for macOS built on Electron (plain HTML/CSS/JS, no framework,
no bundler). Left pane: raw Markdown + a "Help!" menu button (text tools). Right pane: live preview + sync-scroll toggle
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
- `src/renderer/` – loaded as classic `<script>` tags in this order:
  - `tools.js` – pure text transforms: `removeNewlines`, `formatTables` (window.MarkdownTools)
  - `scroll-map.js` – pure sync-scroll math (window.ScrollMap)
  - `data-preview.js` – pure CSV/TSV parsing and JSON pretty-print/error location (window.DataPreview)
  - `mermaid-render.js` – Mermaid: lazy-loads `../vendor/mermaid.min.js`, renders one diagram at a
    time, caches by theme + source, SVG→PNG for Copy (window.MermaidRender; DOM-dependent)
  - `export-html.js` – clean semantic HTML for "Copy" (no fonts/sizes/colors) (window.ExportHtml; DOM-dependent)
  - `renderer.js` – UI wiring: rendering, document state, toolbar, sync scroll, theme, folder sidebar
- `build/` – icon + DMG background SVG sources **and** their generated PNG/ICNS (committed on
  purpose: electron-builder reads them directly).
- `scripts/make-assets.js` – rasterizes SVGs with Electron's Chromium + `iconutil`.
- `scripts/brand-dev-electron.js` – renames dev `node_modules/electron/dist/Electron.app` to
  "Markdown Helper" + our icon and re-signs ad hoc (otherwise menu bar says "Electron").
- `scripts/vendor.js` – copies `node_modules/mermaid/dist/mermaid.min.js` (+ license) into
  `src/vendor/` (git-ignored) on postinstall / prestart / predist. mermaid is a **devDependency on
  purpose**: as a dependency electron-builder would pack its ~200 MB dependency tree into the app.
- `scripts/mdh` – shell launcher (`open -a "Markdown Helper" …`); creates missing files, passes
  folders through (the app shows them in the sidebar).

## Conventions

- Pure logic goes in UMD-style modules (`module.exports` in Node, `window.X` in the browser) so it
  can be unit-tested in Node; add tests in `test/` for any new transform.
- Editor edits must go through `replaceRange()` in renderer.js (execCommand `insertText` on the
  minimal changed span) so Cmd+Z/redo work. Replacing the whole textarea value breaks Chromium redo.
- Text tools live in the native **Help!** menu, one flat list (button `#btn-format`,
  `formatMenuTemplate` in main.js, popped up via
  `showFormatMenu`; picks come back as the `format` command → `FORMAT_COMMANDS` in renderer.js).
  New tool = transform in tools.js + test, a menu item, and a `FORMAT_COMMANDS` entry.
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
  selection (Help!) must not take focus: `mousedown` → `preventDefault()`, and `editor.focus()`
  before opening the menu.
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
`require`s `src/main.js`, hooks `app.on('browser-window-created')`, drives the page with
`webContents.executeJavaScript(...)` / `webContents.send('menu:...')`, saves
`webContents.capturePage()` PNGs, and calls `app.exit(0)`. Run it with
`npx electron <harness>.js` (needs the sandbox disabled to launch). For a packaged build, launch
`dist/mac-arm64/Markdown Helper.app/Contents/MacOS/Markdown --remote-debugging-port=9333` and
drive it over CDP.
