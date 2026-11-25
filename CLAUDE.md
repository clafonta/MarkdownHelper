# Markdown Helper – notes for Claude

Lightweight two-pane Markdown editor for macOS built on Electron (plain HTML/CSS/JS, no framework,
no bundler). Left pane: raw Markdown + tool buttons. Right pane: live preview + sync-scroll toggle
+ Copy. Global header: title (left), open file name / "Edited" (center), dark mode toggle (right).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run in dev (prestart re-brands the dev Electron.app, see below) |
| `npm test` | Unit tests (`node --test test/`) for the pure modules |
| `npm run assets` | Re-render `build/icon.png`, `build/icon.icns`, `build/background*.png` from the SVGs |
| `npm run dist` | DMG + ZIP for arm64 and x64 into `dist/` (`dist:arm64`, `dist:x64` for one arch) |

## Layout

- `src/main.js` – main process: window (hiddenInset title bar), menus, all file I/O and dialogs,
  unsaved-changes close/quit flow, clipboard writes, theme sync, external links.
- `src/preload.js` – the only bridge (`window.markdownHelper`). Renderer is sandboxed with
  contextIsolation, so anything needing Node/Electron goes through IPC here.
- `src/renderer/` – loaded as classic `<script>` tags in this order:
  - `tools.js` – pure text transforms: `removeNewlines`, `formatTables` (window.MarkdownTools)
  - `scroll-map.js` – pure sync-scroll math (window.ScrollMap)
  - `export-html.js` – clean semantic HTML for "Copy" (no fonts/sizes/colors) (window.ExportHtml; DOM-dependent)
  - `renderer.js` – UI wiring: rendering, document state, toolbar, sync scroll, theme
- `build/` – icon + DMG background SVG sources **and** their generated PNG/ICNS (committed on
  purpose: electron-builder reads them directly).
- `scripts/make-assets.js` – rasterizes SVGs with Electron's Chromium + `iconutil`.
- `scripts/brand-dev-electron.js` – renames dev `node_modules/electron/dist/Electron.app` to
  "Markdown Helper" + our icon and re-signs ad hoc (otherwise menu bar says "Electron").

## Conventions

- Pure logic goes in UMD-style modules (`module.exports` in Node, `window.X` in the browser) so it
  can be unit-tested in Node; add tests in `test/` for any new transform.
- Editor edits must go through `replaceRange()` in renderer.js (execCommand `insertText` on the
  minimal changed span) so Cmd+Z/redo work. Replacing the whole textarea value breaks Chromium redo.
- Toolbar tools use `applyTool(transform, { wholeLines })`: selection if any, else whole document.
- Text tools must leave Markdown structure alone (tables, lists, fenced/indented code, headings).
- Preview rendering is per top-level marked token, each element tagged `data-line` = source line;
  sync scroll depends on that. Sanitize everything with DOMPurify.
- Theme colors are CSS variables on `:root` / `:root[data-theme="dark"]`. Copy output sets no colors,
  fonts or sizes at all (the paste target's own styles apply), so the theme never leaks into it.
- localStorage keys are prefixed `markdown-helper:`.

## Gotchas

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
