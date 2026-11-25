/* global marked, DOMPurify */
(() => {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const stats = document.getElementById('stats');
  const themeToggle = document.getElementById('theme-toggle');
  const removeNewlinesBtn = document.getElementById('btn-remove-newlines');
  const bridge = window.markdownHelper || {};

  document.documentElement.dataset.platform = bridge.platform || 'web';

  // ---------- Preview rendering ----------
  marked.setOptions({ gfm: true, breaks: false });

  let renderQueued = false;
  function render() {
    renderQueued = false;
    const source = editor.value;
    preview.innerHTML = DOMPurify.sanitize(marked.parse(source));
    const words = source.trim() ? source.trim().split(/\s+/).length : 0;
    stats.textContent = `${words} words · ${source.length} chars`;
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  editor.addEventListener('input', scheduleRender);

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
