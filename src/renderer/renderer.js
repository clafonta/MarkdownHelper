/* global marked, DOMPurify */
(() => {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const stats = document.getElementById('stats');
  const themeToggle = document.getElementById('theme-toggle');
  const bridge = window.markdownHelper || {};

  document.documentElement.dataset.platform = bridge.platform || 'web';

  const { tokenStartLines, createScrollMap, interpolate } = window.ScrollMap;

  // ---------- Preview rendering ----------
  marked.setOptions({ gfm: true, breaks: false });

  let renderQueued = false;
  function render() {
    renderQueued = false;
    const source = editor.value;
    const words = source.trim() ? source.trim().split(/\s+/).length : 0;
    stats.textContent = `${words} words · ${source.length} chars`;
    switch (kind) {
      case 'html': return scheduleHtmlRender(source);
      case 'code': return undefined; // no preview
      case 'csv': renderTable(source, ','); break;
      case 'tsv': renderTable(source, '\t'); break;
      case 'json': renderJson(source); break;
      case 'svg': renderSvg(source); break;
      default: renderMarkdown(source);
    }
    invalidateScrollMap();
    if (syncEnabled) syncScroll(editor);
    return undefined;
  }

  /**
   * Renders block by block so every top-level preview element can be tagged with the source
   * line it came from (data-line). Synchronized scrolling uses those tags as anchors.
   */
  function renderMarkdown(source) {
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
  }

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const previewMessage = (text) => preview.replaceChildren(make('p', 'preview-message', text));

  // CSV / TSV: a table, first row as the header. Each row is tagged with its source line.
  const MAX_TABLE_ROWS = 2000;
  function renderTable(source, delimiter) {
    const rows = window.DataPreview.parseDelimited(source, delimiter);
    if (!rows.length) { previewMessage('Nothing to show yet.'); return; }
    const columns = Math.max(...rows.map((r) => r.cells.length));
    const dataRows = rows.length - 1;
    stats.textContent = `${dataRows.toLocaleString()} ${dataRows === 1 ? 'row' : 'rows'} · ${columns} ${columns === 1 ? 'column' : 'columns'}`;

    const makeRow = (row, cellTag) => {
      const tr = document.createElement('tr');
      tr.dataset.line = String(row.line);
      for (let i = 0; i < columns; i += 1) tr.append(make(cellTag, '', row.cells[i] ?? ''));
      return tr;
    };
    const table = make('table', 'data-table');
    const thead = make('thead');
    thead.append(makeRow(rows[0], 'th'));
    const tbody = make('tbody');
    for (const row of rows.slice(1, MAX_TABLE_ROWS + 1)) tbody.append(makeRow(row, 'td'));
    table.append(thead, tbody);
    const parts = [table];
    if (dataRows > MAX_TABLE_ROWS) {
      parts.push(make('p', 'preview-message', `Showing the first ${MAX_TABLE_ROWS.toLocaleString()} of ${dataRows.toLocaleString()} rows.`));
    }
    preview.replaceChildren(...parts);
  }

  // JSON: a collapsible tree when valid; otherwise where and why it's invalid (click to jump there).
  //
  // Which objects/arrays are open is remembered by path (e.g. $/"users"/3) so it survives typing:
  // a node is open if the user opened it, or else if it's shallower than the default depth and
  // the user hasn't closed it. Children of closed nodes aren't rendered at all (big files stay fast).
  const JSON_AUTO_EXPAND_LIMIT = 1500; // containers; bigger files start with only 2 levels open
  const jsonView = { tree: null, open: new Set(), closed: new Set(), depth: Infinity };
  function resetJsonView() {
    Object.assign(jsonView, { tree: null, open: new Set(), closed: new Set(), depth: Infinity });
    jsonView.fresh = true;
  }

  const isContainer = (node) => node.type === 'object' || node.type === 'array';
  const childrenOf = (node) => (node.type === 'object'
    ? node.entries.map((e) => ({ key: e.key, node: e.value }))
    : node.items.map((n, i) => ({ index: i, node: n })));
  const childPath = (path, child) => `${path}/${child.key ?? child.index}`;
  const isOpen = (path, depth) => jsonView.open.has(path) || (!jsonView.closed.has(path) && depth < jsonView.depth);

  function countContainers(node) {
    if (!isContainer(node)) return 0;
    return 1 + childrenOf(node).reduce((n, c) => n + countContainers(c.node), 0);
  }

  function jsonRow(depth, line) {
    const row = make('div', 'json-row');
    row.style.setProperty('--depth', String(depth));
    row.dataset.line = String(line);
    return row;
  }

  function labelParts(child) {
    if (!child) return [];
    if (child.key !== undefined) return [make('span', 'json-key', child.key), make('span', 'json-punct', ': ')];
    if (child.index !== undefined) return [make('span', 'json-index', `${child.index}: `)];
    return [];
  }

  function buildJsonNode(node, path, depth, child) {
    if (!isContainer(node)) {
      const row = jsonRow(depth, node.line);
      row.append(make('span', 'json-spacer'), ...labelParts(child), make('span', `json-value json-${node.type}`, node.raw));
      return row;
    }
    const kids = childrenOf(node);
    const [openCh, closeCh] = node.type === 'object' ? ['{', '}'] : ['[', ']'];
    const wrap = make('div', 'json-node');
    wrap.dataset.path = path;
    const row = jsonRow(depth, node.line);
    if (!kids.length) {
      row.append(make('span', 'json-spacer'), ...labelParts(child), make('span', 'json-punct', openCh + closeCh));
      wrap.append(row);
      return wrap;
    }
    const open = isOpen(path, depth);
    const toggle = make('button', 'json-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = `${open ? 'Collapse' : 'Expand'} · ⌥-click: ${open ? 'collapse' : 'expand'} everything inside`;
    toggle.append(make('span', 'json-chevron'), ...labelParts(child), make('span', 'json-punct', openCh));
    row.append(toggle);
    if (!open) {
      const noun = node.type === 'object' ? (kids.length === 1 ? 'key' : 'keys') : (kids.length === 1 ? 'item' : 'items');
      row.append(make('span', 'json-punct', ` … ${closeCh}`), make('span', 'json-count', ` ${kids.length} ${noun}`));
      wrap.append(row);
      return wrap;
    }
    const body = make('div', 'json-children');
    for (const kid of kids) body.append(buildJsonNode(kid.node, childPath(path, kid), depth + 1, kid));
    const closing = jsonRow(depth, node.endLine);
    closing.append(make('span', 'json-spacer'), make('span', 'json-punct', closeCh));
    wrap.append(row, body, closing);
    return wrap;
  }

  function renderJsonTree() {
    const focusedPath = preview.contains(document.activeElement)
      ? document.activeElement.closest('.json-node')?.dataset.path : null;
    const bar = make('div', 'json-toolbar');
    for (const [label, action] of [['Expand all', 'expand-all'], ['Collapse all', 'collapse-all']]) {
      const btn = make('button', 'tool-btn', label);
      btn.type = 'button';
      btn.dataset.jsonAction = action;
      bar.append(btn);
    }
    bar.append(make('span', 'json-hint', 'Option-click an arrow to open or close everything inside it'));
    const tree = make('div', 'json-tree');
    tree.append(buildJsonNode(jsonView.tree, '$', 0, null));
    preview.replaceChildren(bar, tree);
    if (focusedPath) {
      [...preview.querySelectorAll('.json-node')].find((n) => n.dataset.path === focusedPath)
        ?.querySelector(':scope > .json-row > .json-toggle')?.focus();
    }
    invalidateScrollMap();
  }

  /** Every container path at or below `node` (for ⌥-click). */
  function containerPaths(node, path, out = []) {
    if (!isContainer(node)) return out;
    out.push(path);
    for (const kid of childrenOf(node)) containerPaths(kid.node, childPath(path, kid), out);
    return out;
  }

  function findJsonNode(path) {
    let node = jsonView.tree;
    let at = '$';
    while (at !== path) {
      const next = childrenOf(node).find((kid) => path === childPath(at, kid) || path.startsWith(`${childPath(at, kid)}/`));
      if (!next) return null;
      at = childPath(at, next);
      node = next.node;
    }
    return node;
  }

  function setJsonOpen(path, open) {
    (open ? jsonView.open : jsonView.closed).add(path);
    (open ? jsonView.closed : jsonView.open).delete(path);
  }

  preview.addEventListener('click', (e) => {
    if (kind !== 'json' || !jsonView.tree) return;
    const action = e.target.closest('[data-json-action]')?.dataset.jsonAction;
    if (action) {
      jsonView.open.clear();
      jsonView.closed.clear();
      jsonView.depth = action === 'expand-all' ? Infinity : 1; // collapse all: keep the top level visible
      renderJsonTree();
      return;
    }
    const toggle = e.target.closest('.json-toggle');
    if (!toggle) return;
    const path = toggle.closest('.json-node').dataset.path;
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    if (e.altKey) {
      for (const p of containerPaths(findJsonNode(path), path)) setJsonOpen(p, open);
    } else {
      setJsonOpen(path, open);
    }
    renderJsonTree();
  });

  function renderJson(source) {
    const result = window.DataPreview.checkJson(source);
    if (result.ok) {
      if (!result.pretty) { previewMessage('Nothing to show yet.'); return; }
      jsonView.tree = window.DataPreview.parseJsonTree(source);
      if (jsonView.fresh) {
        jsonView.fresh = false;
        jsonView.depth = countContainers(jsonView.tree) > JSON_AUTO_EXPAND_LIMIT ? 2 : Infinity;
      }
      renderJsonTree();
      return;
    }
    jsonView.tree = null;
    const box = make('div', 'json-error');
    box.append(make('strong', '', `Invalid JSON — line ${result.line}, column ${result.column}`));
    box.append(make('p', '', result.message));
    const lineText = source.split('\n')[result.line - 1] ?? '';
    const pre = make('pre');
    pre.append(make('code', '', `${lineText}\n${' '.repeat(Math.max(0, result.column - 1))}^`));
    box.append(pre);
    const jump = make('button', 'tool-btn', 'Show in editor');
    jump.type = 'button';
    jump.addEventListener('click', () => {
      const lines = editor.value.split('\n');
      const offset = lines.slice(0, result.line - 1).reduce((n, l) => n + l.length + 1, 0) + result.column - 1;
      editor.focus();
      editor.setSelectionRange(offset, Math.min(offset + 1, editor.value.length));
    });
    box.append(jump);
    preview.replaceChildren(box);
  }

  // SVG: shown as an image (an <img> never runs the SVG's scripts or loads external files).
  const svgImage = new Image();
  svgImage.alt = '';
  svgImage.addEventListener('load', () => preview.classList.remove('svg-broken'));
  svgImage.addEventListener('error', () => preview.classList.add('svg-broken'));
  function renderSvg(source) {
    if (!source.trim()) { previewMessage('Nothing to show yet.'); return; }
    if (!preview.querySelector('.svg-stage')) {
      const stage = make('div', 'svg-stage');
      stage.append(svgImage, make('p', 'preview-message svg-error', "This SVG can't be displayed — it may be incomplete or invalid."));
      preview.replaceChildren(stage);
    }
    svgImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  editor.addEventListener('input', scheduleRender);

  // ---------- Preview kinds (see ../file-types.js) ----------
  // markdown / text: rendered Markdown in #preview. csv / tsv / json / svg: rendered into #preview
  // too. html: the page itself in a sandboxed iframe (no scripts, forms or popups; relative CSS and
  // images resolve against the file's folder). code: nothing to preview.
  const { fileInfo } = window.FileTypes;
  const previewFrame = document.getElementById('preview-frame');
  const previewNone = document.getElementById('preview-none');
  const editorTitle = document.getElementById('editor-title');
  let markdownTools = true; // Remove new lines / Format tables only make sense for Markdown & text
  let caseMode = 'markdown'; // Text format: Markdown-aware, or 'literal' for code and data files
  let kind = null; // set by applyKind() when a document loads
  let htmlFresh = true; // next HTML render is a newly opened document: no delay, start at the top

  /** The element that scrolls on the preview side (null when there's no preview). */
  function previewScroller() {
    if (kind === 'html') return previewFrame.contentDocument?.scrollingElement || null;
    return kind === 'code' ? null : preview;
  }

  /** Sets up the panes for the document's type: editor title, preview, which controls apply. */
  function applyKind(filePath) {
    const info = fileInfo(filePath) || fileInfo(null);
    kind = info.kind;
    editorTitle.textContent = info.label;
    preview.hidden = kind === 'html' || kind === 'code';
    previewFrame.hidden = kind !== 'html';
    previewNone.hidden = kind !== 'code';
    previewNone.textContent = kind === 'code' ? `No preview for ${info.label} files.` : '';
    if (kind !== 'html') previewFrame.removeAttribute('srcdoc');
    preview.replaceChildren();
    preview.classList.remove('svg-broken');

    markdownTools = kind === 'markdown' || kind === 'text';
    caseMode = markdownTools ? 'markdown' : 'literal';
    // A single image has nothing to scroll in step with, and an image or code can't be pasted as text.
    syncToggle.disabled = kind === 'code' || kind === 'svg';
    copyBtn.disabled = kind === 'code' || kind === 'svg';
    clearTimeout(copyResetTimer);
    copyBtn.textContent = 'Copy';
    copyBtn.classList.remove('is-done');
    invalidateScrollMap();
  }

  // Re-rendering an iframe reloads it, so HTML is debounced and keeps its scroll position.
  let htmlTimer = 0;
  function scheduleHtmlRender(source) {
    clearTimeout(htmlTimer);
    const fresh = htmlFresh;
    htmlFresh = false;
    htmlTimer = setTimeout(() => renderHtml(source, fresh), fresh ? 0 : 250);
  }

  function folderUrl(filePath) {
    const dir = filePath.split(/[\\/]/).slice(0, -1);
    return `file://${dir.map(encodeURIComponent).join('/')}/`;
  }

  /** Adds <base> so relative links, stylesheets and images resolve next to the file. */
  function withBase(source, filePath) {
    if (!filePath) return source;
    const base = `<base href="${folderUrl(filePath).replace(/"/g, '&quot;')}">`;
    const head = source.match(/<head(\s[^>]*)?>/i);
    if (head) return source.slice(0, head.index + head[0].length) + base + source.slice(head.index + head[0].length);
    const doctype = source.match(/^\s*<!doctype[^>]*>/i);
    if (doctype) return doctype[0] + base + source.slice(doctype[0].length);
    return base + source;
  }

  function renderHtml(source, fresh) {
    if (kind !== 'html') return;
    const scroller = previewScroller();
    const keepY = scroller && !fresh ? scroller.scrollTop : 0;
    previewFrame.onload = () => {
      const frameDoc = previewFrame.contentDocument;
      const frameScroller = frameDoc?.scrollingElement;
      if (!frameDoc || !frameScroller) return;
      frameScroller.scrollTop = keepY;
      frameDoc.addEventListener('scroll', () => {
        if (echoTarget !== frameScroller) syncScroll(frameScroller);
      });
      // Links: web links open in the browser, #anchors scroll within the page, others do nothing.
      frameDoc.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[href]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#')) frameDoc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
        else if (/^https?:/i.test(a.href)) window.open(a.href);
      });
      invalidateScrollMap();
      if (syncEnabled) syncScroll(editor);
    };
    previewFrame.srcdoc = withBase(source, doc.filePath);
  }

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
    const scroller = previewScroller();
    const pairs = [];
    // Markdown blocks and table rows know their source line (data-line); anything else (an HTML
    // page, JSON) just scrolls proportionally.
    if (scroller === preview) {
      const anchors = preview.querySelectorAll('[data-line]');
      if (anchors.length) {
        const lineTops = measureLineTops();
        const origin = preview.getBoundingClientRect().top - preview.scrollTop;
        for (const node of anchors) {
          const top = lineTops[Number(node.dataset.line)];
          if (top !== undefined) pairs.push([top, node.getBoundingClientRect().top - origin]);
        }
      }
    }
    scrollMap = createScrollMap(
      pairs,
      editor.scrollHeight - editor.clientHeight,
      scroller.scrollHeight - scroller.clientHeight,
    );
    return scrollMap;
  }

  // Setting one pane's scrollTop fires a scroll event on it; ignore that echo briefly.
  let echoTarget = null;
  let echoTimer = 0;
  function syncScroll(source) {
    const scroller = previewScroller();
    if (!syncEnabled || !scroller) return;
    const target = source === editor ? scroller : editor;
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
  new ResizeObserver(invalidateScrollMap).observe(document.getElementById('preview-frame'));
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
  const workspace = document.querySelector('.panes'); // editor + divider + preview (not the sidebar)
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
    if (kind === 'code' || kind === 'svg') return;
    let source = kind === 'html' ? previewFrame.contentDocument?.body : preview;
    if (kind === 'json') {
      // Copy the JSON itself (pretty-printed when valid) as a code block, not the tree widget.
      const checked = window.DataPreview.checkJson(editor.value);
      const pre = make('pre');
      pre.append(make('code', '', checked.ok ? checked.pretty : editor.value));
      source = make('div');
      source.append(pre);
    }
    if (!source) return;
    const { html, text } = window.ExportHtml.buildExport(source);
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

  // Tab indents instead of moving focus: a real tab where the format needs one (Makefile, Go, TSV)
  // or the file is already tab-indented, otherwise two spaces. Set per document in loadDocument().
  let indentUnit = '  ';
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, indentUnit);
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
  const {
    removeNewlines, formatTables, changeCase, cleanUpText, toTable,
  } = window.MarkdownTools;

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
   * With `block`, no selection means the paragraph around the cursor (lines up to the nearest
   * blank lines) instead of the whole document.
   * The transform gets `{ wholeDocument }` as its second argument.
   */
  function applyTool(transform, { wholeLines = false, block = false } = {}) {
    const { value } = editor;
    let { selectionStart: s, selectionEnd: e } = editor;
    if (s === e && block) {
      const lines = value.split('\n');
      let row = value.slice(0, s).split('\n').length - 1;
      if (!lines[row].trim()) return; // cursor on a blank line: nothing to convert
      let first = row;
      while (first > 0 && lines[first - 1].trim()) first -= 1;
      while (row < lines.length - 1 && lines[row + 1].trim()) row += 1;
      s = lines.slice(0, first).join('\n').length + (first ? 1 : 0);
      e = s + lines.slice(first, row + 1).join('\n').length;
    }
    if (s === e) {
      replaceRange(0, value.length, transform(value, { wholeDocument: true }));
    } else {
      if (wholeLines) {
        s = value.lastIndexOf('\n', s - 1) + 1;
        const lineEnd = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
        e = lineEnd === -1 ? value.length : lineEnd;
      }
      const out = transform(value.slice(s, e), { wholeDocument: false });
      replaceRange(s, e, out);
      editor.setSelectionRange(s, s + out.length);
    }
    scheduleRender();
  }

  // Case changes: Markdown-aware for Markdown & text (code, URLs, tags untouched), every word
  // for everything else.
  const caseTool = (mode) => (text, opts) => changeCase(text, mode, { ...opts, markdown: caseMode !== 'literal' });

  const FORMAT_COMMANDS = {
    'clean-up': () => markdownTools && applyTool(cleanUpText),
    'remove-newlines': () => markdownTools && applyTool(removeNewlines),
    'format-tables': () => markdownTools && applyTool(formatTables, { wholeLines: true }),
    'convert-table': () => markdownTools && applyTool(toTable, { wholeLines: true, block: true }),
    uppercase: () => applyTool(caseTool('upper')),
    lowercase: () => applyTool(caseTool('lower')),
    'title-case': () => applyTool(caseTool('title')),
    'sentence-case': () => applyTool(caseTool('sentence')),
  };
  function runFormatCommand(command) {
    FORMAT_COMMANDS[command]?.();
  }

  // The Help! button (#btn-format) opens a native menu just below itself; picking an item comes back as a
  // 'format' command. The editor keeps focus the whole time: a textarea that loses focus stops
  // painting its selection, and the user needs to see what the format will apply to.
  const formatBtn = document.getElementById('btn-format');
  formatBtn.addEventListener('mousedown', (e) => e.preventDefault()); // don't take focus on click
  formatBtn.addEventListener('click', () => {
    editor.focus(); // also when opened from the keyboard (Tab + Space); keeps the selection as-is
    const r = formatBtn.getBoundingClientRect();
    formatBtn.setAttribute('aria-expanded', 'true');
    bridge.showFormatMenu?.({ x: r.left, y: r.bottom + 4, markdownTools })
      .finally(() => formatBtn.setAttribute('aria-expanded', 'false'));
  });

  // ---------- Document (open / save / dirty tracking) ----------
  const docNameEl = document.getElementById('doc-name');
  const docDirtyEl = document.getElementById('doc-dirty');
  // eol: the file's line ending, restored on save (the textarea itself only ever holds \n).
  const doc = { filePath: null, savedContent: '', dirty: false, eol: '\n' };

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

  function loadDocument(filePath, content, eol = '\n') {
    doc.filePath = filePath;
    doc.eol = eol;
    applyKind(filePath);
    htmlFresh = true;
    resetJsonView();
    const needsTabs = window.FileTypes.fileInfo(filePath)?.tabs;
    indentUnit = needsTabs || window.TextFormat.detectIndent(content) === 'tab' ? '\t' : '  ';
    doc.savedContent = content;
    doc.dirty = null; // force a state report
    editor.value = content;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    preview.scrollTop = 0;
    render();
    updateDirty();
    markActiveFile();
    editor.focus();
  }

  function reportError(action, err) {
    console.error(err);
    // Errors from the main process arrive as "Error invoking remote method 'x': Error: message".
    const message = String(err?.message || err).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '');
    window.alert(`Could not ${action}.\n\n${message}`);
  }

  async function save(saveAs = false) {
    try {
      const content = editor.value;
      const result = await bridge.saveFile(doc.filePath, content, { saveAs, defaultDir: folder?.path, eol: doc.eol });
      if (!result) return false; // user cancelled the save dialog
      doc.filePath = result.filePath;
      doc.savedContent = content;
      doc.dirty = null;
      updateDirty();
      applyKind(doc.filePath); // Save As may change the type (e.g. Untitled → page.html)
      render(); // applyKind() cleared the preview; for HTML, <base> also follows a new folder
      if (folder && isInFolder(result.filePath)) refreshFolder();
      else markActiveFile();
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
      if (result) loadDocument(result.filePath, result.content, result.eol);
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
      case 'open-folder': return openFolder();
      case 'open-folder-path': return openFolder(arg);
      case 'save': return save(false);
      case 'save-as': return save(true);
      case 'copy-formatted': return copyFormatted();
      case 'format': return runFormatCommand(arg);
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
    if (!filePath) return;
    bridge.isFolder(filePath).then((dir) => (dir ? openFolder(filePath) : openFile(filePath)));
  });

  // ---------- Folder sidebar ----------
  // `mdh some/folder`, File → Open Folder… or dropping a folder lists its .md / .txt files here.
  const sidebar = document.getElementById('sidebar');
  const fileTree = document.getElementById('file-tree');
  const folderNameEl = document.getElementById('folder-name');
  let folder = null; // { name, path, children } from the main process
  const expanded = new Set(); // folder paths the user has opened in the tree

  const SEP = bridge.platform === 'win32' ? '\\' : '/';
  const isInFolder = (p) => !!(folder && p && p.startsWith(folder.path.replace(/[\\/]$/, '') + SEP));

  const CHEVRON = '<svg class="tree-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DOC_ICON = '<svg class="tree-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h4l2.5 2.5v6.5h-6.5z M7 1.5v2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';

  function treeButton(node, depth) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tree-item ${node.type === 'dir' ? 'tree-dir' : 'tree-file'}`;
    btn.style.setProperty('--depth', String(depth));
    btn.dataset.path = node.path;
    btn.title = node.path;
    if (node.type === 'file' && !node.supported) {
      // Shown so the folder's contents are complete, but Markdown Helper can't open it.
      btn.classList.add('is-unsupported');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = `${node.name} — Markdown Helper can't open this type of file`;
    }
    btn.innerHTML = node.type === 'dir' ? CHEVRON : DOC_ICON;
    const label = document.createElement('span');
    label.className = 'tree-label';
    if (node.type === 'file') {
      const dot = node.name.lastIndexOf('.');
      if (dot > 0) {
        label.append(node.name.slice(0, dot));
        const ext = document.createElement('span');
        ext.className = 'tree-ext';
        ext.textContent = node.name.slice(dot);
        label.append(ext);
      } else {
        label.textContent = node.name;
      }
    } else {
      label.textContent = node.name;
    }
    btn.append(label);
    return btn;
  }

  function buildList(nodes, depth) {
    const ul = document.createElement('ul');
    if (depth === 0) ul.setAttribute('role', 'list');
    for (const node of nodes) {
      const li = document.createElement('li');
      const btn = treeButton(node, depth);
      li.append(btn);
      if (node.type === 'dir') {
        const open = expanded.has(node.path);
        btn.setAttribute('aria-expanded', String(open));
        const children = buildList(node.children, depth + 1);
        children.hidden = !open;
        li.append(children);
      }
      ul.append(li);
    }
    return ul;
  }

  function renderTree() {
    if (!folder) return;
    folderNameEl.textContent = folder.name;
    folderNameEl.title = folder.path;
    const focusedPath = fileTree.contains(document.activeElement) ? document.activeElement.dataset.path : null;
    if (!folder.children.length) {
      const empty = document.createElement('p');
      empty.className = 'file-tree-empty';
      empty.textContent = 'This folder is empty.';
      fileTree.replaceChildren(empty);
    } else {
      fileTree.replaceChildren(buildList(folder.children, 0));
    }
    if (folder.truncated) {
      const note = document.createElement('p');
      note.className = 'file-tree-empty';
      note.textContent = 'Too many files to list them all.';
      fileTree.append(note);
    }
    markActiveFile();
    if (focusedPath) {
      [...fileTree.querySelectorAll('.tree-item')].find((b) => b.dataset.path === focusedPath)?.focus();
    }
  }

  // Highlight the open document in the tree and make sure its parent folders are expanded.
  function markActiveFile() {
    if (!folder) return;
    let active = null;
    for (const btn of fileTree.querySelectorAll('.tree-file')) {
      const on = btn.dataset.path === doc.filePath;
      btn.classList.toggle('is-active', on);
      if (on) { btn.setAttribute('aria-current', 'page'); active = btn; } else btn.removeAttribute('aria-current');
    }
    for (let li = active?.parentElement; li && li !== fileTree; li = li.parentElement) {
      const dirBtn = li.tagName === 'LI' && li.firstElementChild?.classList.contains('tree-dir') ? li.firstElementChild : null;
      if (dirBtn && dirBtn.getAttribute('aria-expanded') !== 'true') toggleDir(dirBtn, true);
    }
    active?.scrollIntoView({ block: 'nearest' });
  }

  function toggleDir(btn, open = btn.getAttribute('aria-expanded') !== 'true') {
    btn.setAttribute('aria-expanded', String(open));
    btn.nextElementSibling.hidden = !open;
    if (open) expanded.add(btn.dataset.path); else expanded.delete(btn.dataset.path);
  }

  function showFolder(tree) {
    if (!tree) return;
    if (tree.path !== folder?.path) expanded.clear();
    folder = tree;
    sidebar.hidden = false;
    renderTree();
    applySplit(split, false); // the panes just got narrower
    invalidateScrollMap();
  }

  async function openFolder(folderPath) {
    try {
      showFolder(folderPath ? await bridge.listFolder(folderPath) : await bridge.openFolder());
    } catch (err) {
      reportError('open the folder', err);
    }
  }

  let refreshing = null;
  async function refreshFolder() {
    if (!folder || refreshing) return refreshing;
    refreshing = bridge.listFolder(folder.path)
      .then(showFolder)
      .catch((err) => console.error('Folder refresh failed:', err)) // e.g. folder deleted
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  function closeFolder() {
    folder = null;
    expanded.clear();
    sidebar.hidden = true;
    fileTree.replaceChildren();
    bridge.closeFolder?.();
    applySplit(split, false);
    invalidateScrollMap();
  }

  fileTree.addEventListener('click', (e) => {
    const btn = e.target.closest('.tree-item');
    if (!btn) return;
    if (btn.classList.contains('tree-dir')) toggleDir(btn);
    else if (btn.getAttribute('aria-disabled') === 'true') return;
    else if (btn.dataset.path !== doc.filePath) openFile(btn.dataset.path);
  });

  // Arrow keys walk the visible items; Left/Right collapse/expand folders.
  fileTree.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.tree-item');
    if (!btn) return;
    const visible = [...fileTree.querySelectorAll('.tree-item')].filter((b) => b.offsetParent !== null);
    const i = visible.indexOf(btn);
    const isDir = btn.classList.contains('tree-dir');
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    let next = null;
    if (e.key === 'ArrowDown') next = visible[i + 1];
    else if (e.key === 'ArrowUp') next = visible[i - 1];
    else if (e.key === 'Home') next = visible[0];
    else if (e.key === 'End') next = visible[visible.length - 1];
    else if (e.key === 'ArrowRight' && isDir) {
      if (isOpen) next = visible[i + 1]; else toggleDir(btn, true);
    } else if (e.key === 'ArrowLeft') {
      if (isDir && isOpen) toggleDir(btn, false);
      else next = btn.closest('ul')?.previousElementSibling; // parent folder
    } else return;
    e.preventDefault();
    next?.focus();
  });

  document.getElementById('btn-refresh-folder').addEventListener('click', refreshFolder);
  document.getElementById('btn-close-folder').addEventListener('click', closeFolder);
  // Pick up files added, renamed or deleted elsewhere when coming back to the app.
  window.addEventListener('focus', () => { if (folder) refreshFolder(); });

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
