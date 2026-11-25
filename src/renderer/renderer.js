/* global marked, DOMPurify */
(() => {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const stats = document.getElementById('stats');
  const themeToggle = document.getElementById('theme-toggle');
  const removeNewlinesBtn = document.getElementById('btn-remove-newlines');
  const bridge = window.markdownHelper || {};

  document.documentElement.dataset.platform = bridge.platform || 'web';

  const { tokenStartLines, createScrollMap, interpolate } = window.ScrollMap;

  // ---------- Preview rendering ----------
  marked.setOptions({ gfm: true, breaks: false });

  /**
   * Renders block by block so every top-level preview element can be tagged with the source
   * line it came from (data-line). Synchronized scrolling uses those tags as anchors.
   */
  let renderQueued = false;
  function render() {
    renderQueued = false;
    const source = editor.value;
    const tokens = marked.lexer(source);
    const startLines = tokenStartLines(tokens);
    const fragment = document.createDocumentFragment();
    tokens.forEach((token, i) => {
      if (token.type === 'space') return;
      const single = [token];
      single.links = tokens.links; // reference-style links are defined document-wide
      const html = DOMPurify.sanitize(marked.parser(single), { RETURN_DOM_FRAGMENT: true });
      for (const el of html.children) el.dataset.line = String(startLines[i]);
      fragment.append(html);
    });
    preview.replaceChildren(fragment);

    const words = source.trim() ? source.trim().split(/\s+/).length : 0;
    stats.textContent = `${words} words · ${source.length} chars`;

    invalidateScrollMap();
    if (syncEnabled) syncScroll(editor);
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  editor.addEventListener('input', scheduleRender);

  // ---------- Synchronized scrolling ----------
  const SYNC_KEY = 'markdown-helper:sync-scroll';
  const syncToggle = document.getElementById('sync-toggle');
  let syncEnabled = true;
  try { syncEnabled = localStorage.getItem(SYNC_KEY) !== 'off'; } catch { /* default on */ }

  // Hidden twin of the editor, used to measure where each source line sits (soft wraps included).
  const mirror = document.createElement('div');
  mirror.className = 'editor-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  editor.parentElement.appendChild(mirror);

  let scrollMap = null; // built lazily, thrown away whenever text or layout changes
  function invalidateScrollMap() { scrollMap = null; }

  function measureLineTops() {
    mirror.style.width = `${editor.clientWidth}px`;
    const lines = editor.value.split('\n');
    mirror.replaceChildren(...lines.map((line) => {
      const div = document.createElement('div');
      div.textContent = line || '​'; // keep empty lines one line tall
      return div;
    }));
    const tops = Array.from(mirror.children, (div) => div.offsetTop);
    mirror.replaceChildren();
    return tops;
  }

  function getScrollMap() {
    if (scrollMap) return scrollMap;
    const lineTops = measureLineTops();
    const pairs = [];
    for (const el of preview.children) {
      const top = lineTops[Number(el.dataset.line)];
      if (top !== undefined) pairs.push([top, el.offsetTop]);
    }
    scrollMap = createScrollMap(
      pairs,
      editor.scrollHeight - editor.clientHeight,
      preview.scrollHeight - preview.clientHeight,
    );
    return scrollMap;
  }

  // Setting one pane's scrollTop fires a scroll event on it; ignore that echo briefly.
  let echoTarget = null;
  let echoTimer = 0;
  function syncScroll(source) {
    if (!syncEnabled) return;
    const target = source === editor ? preview : editor;
    const y = interpolate(getScrollMap(), source.scrollTop, source === editor ? 0 : 1);
    if (Math.abs(target.scrollTop - y) < 1) return;
    echoTarget = target;
    clearTimeout(echoTimer);
    echoTimer = setTimeout(() => { echoTarget = null; }, 100);
    target.scrollTop = y;
  }
  editor.addEventListener('scroll', () => { if (echoTarget !== editor) syncScroll(editor); });
  preview.addEventListener('scroll', () => { if (echoTarget !== preview) syncScroll(preview); });

  // Layout changes (window resize, images finishing loading) move things around.
  new ResizeObserver(invalidateScrollMap).observe(editor);
  new ResizeObserver(invalidateScrollMap).observe(preview);
  preview.addEventListener('load', invalidateScrollMap, true);

  function applySync(enabled, persist) {
    syncEnabled = enabled;
    syncToggle.setAttribute('aria-checked', String(enabled));
    if (persist) {
      try { localStorage.setItem(SYNC_KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
    }
    if (enabled) syncScroll(editor);
  }
  applySync(syncEnabled, false);
  syncToggle.addEventListener('click', () => applySync(!syncEnabled, true));

  // ---------- Resizable panes ----------
  const SPLIT_KEY = 'markdown-helper:split';
  const DEFAULT_SPLIT = 0.5;
  const workspace = document.querySelector('.workspace');
  const divider = document.getElementById('divider');
  const paneMinWidth = () =>
    parseFloat(getComputedStyle(editor.parentElement).minWidth) || 0;

  let split = DEFAULT_SPLIT;
  try {
    const saved = parseFloat(localStorage.getItem(SPLIT_KEY));
    if (saved > 0 && saved < 1) split = saved;
  } catch { /* default */ }

  /** Editor share of the workspace, clamped so both panes keep their minimum width. */
  function clampSplit(ratio) {
    const total = workspace.clientWidth - divider.offsetWidth;
    if (total <= 0) return ratio;
    const min = Math.min(0.5, paneMinWidth() / total);
    return Math.min(1 - min, Math.max(min, ratio));
  }

  // `split` is what the user chose; the applied value may be clamped tighter in a narrow window.
  function applySplit(ratio, persist) {
    const applied = clampSplit(ratio);
    split = ratio === split ? split : applied;
    workspace.style.setProperty('--split', `${(applied * 100).toFixed(3)}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(applied * 100)));
    if (persist) {
      try { localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* ignore */ }
    }
  }
  applySplit(split, false);

  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
    const rect = workspace.getBoundingClientRect();
    // Keep the grab point under the cursor instead of snapping the divider to it.
    const grabOffset = e.clientX - divider.getBoundingClientRect().left;
    let frame = 0;
    let lastX = e.clientX;
    const onMove = (ev) => {
      lastX = ev.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const total = rect.width - divider.offsetWidth;
        applySplit((lastX - grabOffset - rect.left) / total, false);
      });
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      divider.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-resizing');
      applySplit((lastX - grabOffset - rect.left) / (rect.width - divider.offsetWidth), true);
      // Text reflowed in both panes; line the preview back up with the editor.
      syncScroll(editor);
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
    divider.addEventListener('pointercancel', onUp);
  });

  divider.addEventListener('dblclick', () => {
    applySplit(DEFAULT_SPLIT, true);
    syncScroll(editor);
  });

  divider.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const current = clampSplit(split);
    let next;
    if (e.key === 'ArrowLeft') next = current - step;
    else if (e.key === 'ArrowRight') next = current + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else if (e.key === 'Enter') next = DEFAULT_SPLIT;
    else return;
    e.preventDefault();
    applySplit(next, true);
    syncScroll(editor);
  });

  // The saved ratio is kept as the window resizes; only re-clamp to the minimum widths.
  window.addEventListener('resize', () => applySplit(split, false));

  // ---------- Copy formatted ----------
  const copyBtn = document.getElementById('btn-copy');
  let copyResetTimer = 0;
  async function copyFormatted() {
    const { html, text } = window.ExportHtml.buildExport(preview);
    let ok = false;
    try { ok = await bridge.copyRich(html, text); } catch (err) { console.error(err); }
    copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    copyBtn.classList.toggle('is-done', ok);
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('is-done');
    }, 1600);
  }
  copyBtn.addEventListener('click', copyFormatted);

  // Tab inserts two spaces instead of moving focus.
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  // ---------- Theme ----------
  const THEME_KEY = 'markdown-helper:theme';
  function readSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function applyTheme(mode, persist) {
    const dark = mode === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    themeToggle.setAttribute('aria-checked', String(dark));
    if (bridge.setTheme) bridge.setTheme(dark ? 'dark' : 'light');
    if (persist) {
      try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
    }
  }
  const initialTheme = readSavedTheme()
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(initialTheme, false);
  themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  // ---------- Tools ----------
  const { removeNewlines, formatTables } = window.MarkdownTools;

  // Replace text through execCommand so the change lands on the native undo stack (Cmd+Z works).
  // Only the span that actually differs is replaced: Chromium's redo mangles large replacements
  // whose start matches the original text, and a minimal edit also keeps undo granular.
  function replaceRange(start, end, text) {
    const original = editor.value.slice(start, end);
    if (original === text) return;
    let prefix = 0;
    const maxPrefix = Math.min(original.length, text.length);
    while (prefix < maxPrefix && original[prefix] === text[prefix]) prefix += 1;
    let suffix = 0;
    const maxSuffix = maxPrefix - prefix;
    while (suffix < maxSuffix
      && original[original.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix += 1;

    editor.focus();
    editor.setSelectionRange(start + prefix, end - suffix);
    const insert = text.slice(prefix, text.length - suffix);
    if (insert) document.execCommand('insertText', false, insert);
    else document.execCommand('delete');
  }

  /**
   * Runs a text transform on the selection, or on the whole document when nothing is selected.
   * With `wholeLines`, a selection is widened to full lines first (needed for line-based tools).
   */
  function applyTool(transform, { wholeLines = false } = {}) {
    const { value } = editor;
    let { selectionStart: s, selectionEnd: e } = editor;
    if (s === e) {
      replaceRange(0, value.length, transform(value));
    } else {
      if (wholeLines) {
        s = value.lastIndexOf('\n', s - 1) + 1;
        const lineEnd = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
        e = lineEnd === -1 ? value.length : lineEnd;
      }
      const out = transform(value.slice(s, e));
      replaceRange(s, e, out);
      editor.setSelectionRange(s, s + out.length);
    }
    scheduleRender();
  }

  removeNewlinesBtn.addEventListener('click', () => applyTool(removeNewlines));
  document.getElementById('btn-format-tables')
    .addEventListener('click', () => applyTool(formatTables, { wholeLines: true }));

  // ---------- Document (open / save / dirty tracking) ----------
  const docNameEl = document.getElementById('doc-name');
  const docDirtyEl = document.getElementById('doc-dirty');
  const doc = { filePath: null, savedContent: '', dirty: false };

  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : 'Untitled');

  function updateDirty() {
    const dirty = editor.value !== doc.savedContent;
    if (dirty === doc.dirty && docNameEl.textContent === baseName(doc.filePath)) return;
    doc.dirty = dirty;
    docNameEl.textContent = baseName(doc.filePath);
    docNameEl.title = doc.filePath || '';
    docDirtyEl.hidden = !dirty;
    bridge.reportState?.(doc.filePath, dirty);
  }
  editor.addEventListener('input', updateDirty);

  function loadDocument(filePath, content) {
    doc.filePath = filePath;
    doc.savedContent = content;
    doc.dirty = null; // force a state report
    editor.value = content;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    preview.scrollTop = 0;
    render();
    updateDirty();
    editor.focus();
  }

  function reportError(action, err) {
    console.error(err);
    window.alert(`Could not ${action}.\n\n${err?.message || err}`);
  }

  async function save(saveAs = false) {
    try {
      const content = editor.value;
      const result = await bridge.saveFile(doc.filePath, content, saveAs);
      if (!result) return false; // user cancelled the save dialog
      doc.filePath = result.filePath;
      doc.savedContent = content;
      doc.dirty = null;
      updateDirty();
      return true;
    } catch (err) {
      reportError('save the file', err);
      return false;
    }
  }

  // Resolves true if it's OK to discard the current document.
  async function confirmDiscard() {
    if (!doc.dirty) return true;
    const choice = await bridge.confirmUnsaved(baseName(doc.filePath));
    if (choice === 'save') return save();
    return choice === 'discard';
  }

  async function openFile(filePath) {
    if (!(await confirmDiscard())) return;
    try {
      const result = filePath ? await bridge.openPath(filePath) : await bridge.openFile();
      if (result) loadDocument(result.filePath, result.content);
    } catch (err) {
      reportError('open the file', err);
    }
  }

  async function newFile() {
    if (await confirmDiscard()) loadDocument(null, '');
  }

  bridge.onCommand?.(async (command, arg) => {
    switch (command) {
      case 'new': return newFile();
      case 'open': return openFile();
      case 'open-path': return openFile(arg);
      case 'save': return save(false);
      case 'save-as': return save(true);
      case 'copy-formatted': return copyFormatted();
      case 'request-close': return bridge.respondToClose(await confirmDiscard());
      default: return undefined;
    }
  });

  // Drag a file from Finder onto the window to open it.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth += 1;
    document.body.classList.add('drop-target');
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('drop-target');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('drop-target');
    const file = e.dataTransfer.files[0];
    const filePath = file && bridge.getPathForFile?.(file);
    if (filePath) openFile(filePath);
  });

  // ---------- Starter content ----------
  const welcome = `# Welcome to Markdown Helper

Type **Markdown** on the left and see it rendered on the right.

## Features in this draft

- Live preview with GitHub-flavored Markdown
- Dark mode toggle (top right)
- *Remove new lines* tool in the editor header

> Tip: select some text before clicking **Remove new lines**
> to only join the lines in your selection.

\`\`\`js
console.log('Hello, Markdown!');
\`\`\`

| Shortcut | Action |
| -------- | ------ |
| Cmd + Z  | Undo   |
| Tab      | Indent |
| Cmd + O  | Open   |
| Cmd + S  | Save   |
`;
  // The welcome text counts as "unchanged", so closing right away won't prompt.
  loadDocument(null, welcome);
})();
