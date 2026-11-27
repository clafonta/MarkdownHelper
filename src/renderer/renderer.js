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
    updateStats(source);
    switch (kind) {
      case 'html': return scheduleHtmlRender(source);
      case 'code': return undefined; // no preview
      case 'csv': renderTable(source, ','); break;
      case 'tsv': renderTable(source, '\t'); break;
      case 'json': renderJson(source); break;
      case 'svg': renderSvg(source); break;
      case 'mermaid': renderMermaidFile(source); break;
      default: renderMarkdown(source);
    }
    invalidateScrollMap();
    if (syncEnabled) syncScroll(editor);
    return undefined;
  }

  function updateStats(source) {
    if (kind === 'csv' || kind === 'tsv') return; // renderTable shows rows · columns instead
    const words = source.trim() ? source.trim().split(/\s+/).length : 0;
    stats.textContent = `${words} words · ${source.length} chars`;
  }

  /**
   * Renders block by block so every top-level preview element can be tagged with the source
   * line it came from (data-line). Synchronized scrolling uses those tags as anchors.
   */
  function renderMarkdown(source) {
    const tokens = marked.lexer(source);
    const startLines = tokenStartLines(tokens);
    const fragment = document.createDocumentFragment();
    const previous = [...preview.querySelectorAll('.mermaid-diagram')];
    let diagrams = 0;
    resetPreviewBlocks(tokens);
    tokens.forEach((token, i) => {
      if (token.type === 'space') return;
      if (token.type === 'code' && /^mermaid\b/i.test((token.lang || '').trim())) {
        const block = mermaidBlock(token.text, startLines[i], previous[diagrams]);
        block.dataset.block = String(i);
        fragment.append(block);
        lockPreviewBlock(i, [block]);
        diagrams += 1;
        return;
      }
      const html = DOMPurify.sanitize(marked.parser(tokenList(token, tokens.links)), { RETURN_DOM_FRAGMENT: true });
      for (const el of html.children) {
        el.dataset.line = String(startLines[i]);
        el.dataset.block = String(i); // which token it came from, for editing in the preview
      }
      // Raw HTML can't be edited as Markdown: it stays as written (but can be deleted).
      if (token.type === 'html') lockPreviewBlock(i, [...html.childNodes]);
      for (const box of html.querySelectorAll('input[type="checkbox"]')) box.disabled = false; // tickable
      fragment.append(html);
    });
    preview.replaceChildren(fragment);
    previewRendered();
    if (diagrams) drawPendingDiagrams();
  }

  /** A one-token list for marked.parser(); reference-style links are defined document-wide. */
  function tokenList(token, links) {
    const list = [token];
    list.links = links;
    return list;
  }

  // ---------- Mermaid diagrams (```mermaid blocks, and .mmd / .mermaid files) ----------
  // Each diagram is an <img> of the SVG mermaid draws (see mermaid-render.js). Drawing is async,
  // so a block first shows the cached drawing, or the previous drawing at the same position
  // (faded) while the new one is made, then gets filled in.
  const mermaidSources = new WeakMap(); // .mermaid-diagram element → its source
  const previewTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  function fillDiagram(block, result) {
    block.classList.remove('is-stale');
    delete block.dataset.pending;
    if (result.error) {
      const box = make('div', 'json-error mermaid-error');
      box.append(make('strong', '', 'Mermaid diagram error'));
      const pre = make('pre');
      pre.append(make('code', '', result.error));
      box.append(pre);
      block.replaceChildren(box);
      return;
    }
    const img = new Image();
    img.alt = 'Diagram';
    img.style.width = `${result.width}px`;
    img.src = window.MermaidRender.svgUrl(result.svg);
    block.replaceChildren(img);
  }

  function mermaidBlock(source, line, previous) {
    const block = make('div', 'mermaid-diagram');
    block.dataset.line = String(line);
    block.contentEditable = 'false';
    mermaidSources.set(block, source);
    const done = window.MermaidRender.cached(source, previewTheme());
    if (done) {
      fillDiagram(block, done);
    } else {
      block.dataset.pending = '1';
      if (previous && !previous.querySelector('.mermaid-error')) {
        block.append(...[...previous.childNodes].map((n) => n.cloneNode(true)));
        block.classList.add('is-stale');
      } else {
        block.append(make('p', 'preview-message', 'Drawing diagram…'));
      }
    }
    return block;
  }

  let diagramTimer = 0;
  function drawPendingDiagrams() {
    clearTimeout(diagramTimer);
    // Redraw right away the first time; while typing, wait for a pause.
    const typing = preview.querySelector('.mermaid-diagram.is-stale');
    diagramTimer = setTimeout(async () => {
      const theme = previewTheme();
      for (const block of preview.querySelectorAll('.mermaid-diagram[data-pending]')) {
        const result = await window.MermaidRender.render(mermaidSources.get(block), theme);
        if (!block.isConnected) continue; // the preview was re-rendered meanwhile
        fillDiagram(block, result);
        invalidateScrollMap();
      }
      if (syncEnabled) syncScroll(editor);
    }, typing ? 300 : 0);
  }

  function renderMermaidFile(source) {
    if (!source.trim()) { previewMessage('Nothing to show yet.'); return; }
    const previous = preview.querySelector('.mermaid-diagram');
    preview.replaceChildren(mermaidBlock(source, 0, previous));
    drawPendingDiagrams();
  }

  /** Copy: diagrams go to the clipboard as light-theme PNGs (documents and mail don't take SVG). */
  async function prepareDiagramsForCopy() {
    for (const block of preview.querySelectorAll('.mermaid-diagram')) {
      const img = block.querySelector('img');
      if (!img) continue;
      const result = await window.MermaidRender.render(mermaidSources.get(block), 'light');
      if (result.error) continue;
      try {
        img.dataset.exportSrc = await window.MermaidRender.toPng(result);
        img.dataset.exportWidth = String(result.width);
      } catch (err) {
        console.error(err);
      }
    }
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

  // ---------- Editing in the preview (Markdown & text) ----------
  // The preview is contenteditable. Chromium edits its DOM natively (typing, Enter, Delete,
  // Cmd+Z in the preview, Cmd+B/I via execCommand). After each edit, only the top-level blocks
  // that changed are turned back into Markdown (html-to-markdown.js) and spliced into the
  // source, so every block that wasn't touched keeps its exact original text.
  //
  // Every top-level element carries data-block = index of the marked token it came from.
  // Elements Chromium creates (Enter splits a paragraph) copy that attribute or have none;
  // either way they belong to the block before them. The preview isn't re-rendered while it's
  // being edited (that would lose the caret and the preview's undo history); it's re-rendered
  // from the source when the editor is used again.
  const { blocksToMarkdown, patchSource } = window.HtmlToMarkdown;
  // Per token: body = its current Markdown, trail = the newlines that belong to it (a code block
  // owns one), raw = body + trail ('' once deleted), canon = canonical Markdown of what it
  // renders to now; body0 / canon0 = the same as first rendered.
  let previewBlocks = [];
  let previewLinks = {};
  let leadBlock = null; // text typed before the first block (e.g. into an empty document)
  let lockedNodes = new WeakMap(); // non-editable node (diagram, raw HTML) → token index
  let lastGroups = new Map();
  let previewEdited = false; // preview DOM was edited since it was last rendered
  document.execCommand('defaultParagraphSeparator', false, 'p'); // Enter makes <p>, not <div>
  const previewObserver = new MutationObserver(() => {});
  previewObserver.observe(preview, { subtree: true, childList: true, characterData: true });

  const isPreviewEditable = () => kind === 'markdown' || kind === 'text';

  function resetPreviewBlocks(tokens) {
    previewLinks = tokens.links;
    previewBlocks = tokens.map((token) => {
      const body = token.raw.replace(/\s+$/, '');
      const bullet = token.type === 'list' ? (token.raw.match(/^\s*([-*+])\s/) || [])[1] : undefined;
      return { token, raw: token.raw, body, body0: body, trail: token.raw.slice(body.length), editable: true, bullet };
    });
    leadBlock = { raw: '', body: '', body0: '', trail: '', editable: true, canon0: '', canon: '' };
    lockedNodes = new WeakMap();
  }

  function lockPreviewBlock(index, nodes) {
    previewBlocks[index].editable = false;
    for (const node of nodes) {
      if (node.nodeType === 1) node.contentEditable = 'false';
      lockedNodes.set(node, index);
    }
  }

  function previewRendered() {
    previewObserver.takeRecords(); // our own rendering isn't an edit
    lastGroups = groupPreviewNodes().groups;
    previewEdited = false;
  }

  /** Top-level preview nodes by the token they belong to (-1: before the first block). */
  function groupPreviewNodes() {
    const groups = new Map();
    const owner = new Map();
    let current = -1;
    for (const node of preview.childNodes) {
      if (node.nodeType === 3 && !node.nodeValue.trim()) continue;
      if (node.nodeType !== 1 && node.nodeType !== 3) continue;
      const index = node.nodeType === 1 && node.dataset.block !== undefined ? Number(node.dataset.block) : NaN;
      if (index > current) current = index; // copied attributes that go backwards don't count
      if (!groups.has(current)) groups.set(current, []);
      groups.get(current).push(node);
      owner.set(node, current);
    }
    return { groups, owner };
  }

  const blockInfo = (index) => (index === -1 ? leadBlock : previewBlocks[index]);

  /** Canonical Markdown of a token as rendered (what html-to-markdown makes of it). */
  function canonOf(info) {
    if (info.canon === undefined) {
      if (!info.editable) info.canon = info.body0;
      else {
        const html = DOMPurify.sanitize(marked.parser(tokenList(info.token, previewLinks)), { RETURN_DOM_FRAGMENT: true });
        info.canon = blocksToMarkdown(html.childNodes, { bullet: info.bullet });
      }
      info.canon0 = info.canon;
    }
    return info.canon;
  }

  function updateBlock(index, nodes) {
    const info = blockInfo(index);
    if (!info) return;
    const emitted = new Set();
    // Diagrams and raw HTML: their original source, once per block (or '' for the rest).
    const rawOf = (node) => {
      if (!lockedNodes.has(node)) return undefined;
      const owner = lockedNodes.get(node);
      if (emitted.has(owner)) return '';
      emitted.add(owner);
      return previewBlocks[owner].body0;
    };
    const markdown = nodes.length ? blocksToMarkdown(nodes, { rawOf, bullet: info.bullet }) : '';
    const before = canonOf(info);
    let body;
    if (!markdown) body = '';
    else if (markdown === info.canon0) body = info.body0; // back to how it was (e.g. undo)
    else body = patchSource(info.body, before, markdown);
    info.body = body;
    info.canon = markdown;
    info.removed = !body && !!info.body0;
    const trail = index === -1 && previewBlocks.length ? '\n\n' : info.trail;
    info.raw = body ? body + trail : '';
  }

  function assembleSource() {
    let out = leadBlock.raw;
    let skipSpace = false;
    for (const b of previewBlocks) {
      if (b.token.type === 'space') {
        if (!skipSpace) out += b.raw; // a deleted block takes its blank line with it
        skipSpace = false;
        continue;
      }
      out += b.raw;
      skipSpace = !!b.removed;
    }
    return out;
  }

  /** Writes the source without moving focus out of the preview (and without an undo step). */
  function writeEditorQuietly(text) {
    const old = editor.value;
    if (old === text) return;
    let start = 0;
    const max = Math.min(old.length, text.length);
    while (start < max && old[start] === text[start]) start += 1;
    let tail = 0;
    while (tail < max - start && old[old.length - 1 - tail] === text[text.length - 1 - tail]) tail += 1;
    editor.setRangeText(text.slice(start, text.length - tail), start, old.length - tail, 'preserve');
    if (flashNextChange) {
      flashNextChange = false;
      // What was added, minus table re-padding (text-diff.js); a pure removal shows its line.
      flashEditorRanges(window.TextDiff.changedRanges(old, text), start);
    }
  }

  /** Keeps data-line (sync scroll) roughly right while the preview is being edited. */
  function retagPreviewLines(groups) {
    let line = (leadBlock.raw.match(/\n/g) || []).length;
    const starts = previewBlocks.map((b) => {
      const start = line;
      line += (b.raw.match(/\n/g) || []).length;
      return start;
    });
    for (const [index, nodes] of groups) {
      for (const node of nodes) {
        if (node.nodeType === 1) node.dataset.line = String(index === -1 ? 0 : starts[index]);
      }
    }
  }

  function syncFromPreview(target, inputType) {
    if (!isPreviewEditable()) return;
    const records = previewObserver.takeRecords();
    const { groups, owner } = groupPreviewNodes();
    const dirty = new Set();
    const topOf = (node) => {
      let n = node;
      while (n && n.parentNode !== preview) n = n.parentNode;
      return n;
    };
    for (const node of [...records.map((r) => r.target), target]) {
      const top = node && node !== preview ? topOf(node) : null;
      if (top && owner.has(top)) dirty.add(owner.get(top));
    }
    for (const index of new Set([...groups.keys(), ...lastGroups.keys()])) {
      const now = groups.get(index) || [];
      const was = lastGroups.get(index) || [];
      if (now.length !== was.length || now.some((n, i) => n !== was[i])) dirty.add(index);
    }
    lastGroups = groups;
    if (!dirty.size) return;
    for (const index of dirty) updateBlock(index, groups.get(index) || []);
    previewEdited = true;
    flashNextChange = teachPending;
    teachPending = false;
    writeEditorQuietly(assembleSource());
    history.record(editor.value, editorSelection(), inputGroup('preview', inputType));
    retagPreviewLines(groups);
    updateStats(editor.value);
    updateDirty();
    invalidateScrollMap();
  }

  preview.addEventListener('input', (e) => syncFromPreview(e.target, e.inputType));
  // Task-list checkboxes can be ticked in the preview.
  preview.addEventListener('change', (e) => {
    if (!e.target.matches?.('input[type="checkbox"]')) return;
    e.target.toggleAttribute('checked', e.target.checked); // Copy clones attributes, not state
    syncFromPreview(e.target);
  });

  // ---------- Formatting in the preview: shortcuts and the right-click menu ----------
  // Formats are applied to the preview DOM with execCommand (the input event then updates the
  // source like any edit). The Markdown that changed lights up in the editor ("teaching" flash),
  // so people who don't know Markdown see what e.g. bold looks like there.
  let teachPending = false; // the next preview sync came from a format command: flash it
  let flashNextChange = false;
  let applyingFormat = false; // our own commands may use input types we otherwise block

  const PREVIEW_SHORTCUTS = { b: 'bold', i: 'italic', e: 'code', 'shift+x': 'strike' };
  preview.addEventListener('keydown', (e) => {
    if (!isPreviewEditable() || !e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.shiftKey ? 'shift+' : '') + e.key.toLowerCase();
    if (PREVIEW_SHORTCUTS[key]) {
      e.preventDefault();
      applyPreviewFormat(PREVIEW_SHORTCUTS[key]);
    } else if (key === 'u') {
      e.preventDefault(); // Markdown has no underline
    }
  });

  /** The element the cursor / selection start is in. */
  function selectionElement() {
    const node = getSelection().anchorNode;
    if (!node || !preview.contains(node)) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  /** What the right-click menu shows as checked. */
  function previewFormatState() {
    const el = selectionElement();
    if (!el || !el.isContentEditable) return { editable: false };
    const inPre = !!el.closest('pre');
    const heading = el.closest('h1, h2, h3, h4, h5, h6');
    const li = el.closest('li');
    let block = 'p';
    if (inPre) block = 'pre';
    else if (heading) block = heading.tagName.toLowerCase().replace(/^h[4-6]$/, 'h3');
    else if (li) block = li.parentElement.tagName === 'OL' ? 'ol' : 'ul';
    else if (el.closest('blockquote')) block = 'blockquote';
    const cell = el.closest('td, th');
    let table = null;
    if (cell && preview.contains(cell)) {
      const head = cell.closest('table').rows[0];
      table = { align: head.cells[cell.cellIndex]?.getAttribute('align') || '', header: cell.parentElement === head };
    }
    return {
      editable: true,
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      strike: document.queryCommandState('strikeThrough'),
      code: !inPre && !!el.closest('code'),
      block,
      table,
    };
  }

  // ---------- Table editing (right-click menu inside a table, Tab between cells) ----------
  // The table in the preview is changed directly; syncFromPreview then rewrites the Markdown
  // table (always aligned, see html-to-markdown.js). Column alignment = the align attribute
  // marked puts on every cell of the column.

  function cellAtCursor() {
    const cell = selectionElement()?.closest('td, th');
    return cell && preview.contains(cell) && cell.isContentEditable ? cell : null;
  }

  function putCaretIn(node, atEnd = true) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!atEnd);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }

  function emptyCell(tag, align) {
    const cell = make(tag);
    if (align) cell.setAttribute('align', align);
    cell.append(make('br')); // keeps an empty cell clickable; written as an empty Markdown cell
    return cell;
  }

  /** A copy of `row` with every cell turned into `tag` (th for the header, td for the body). */
  function retagRow(row, tag) {
    const tr = make('tr');
    for (const old of row.cells) {
      const cell = make(tag);
      if (old.getAttribute('align')) cell.setAttribute('align', old.getAttribute('align'));
      cell.append(...old.childNodes);
      tr.append(cell);
    }
    return tr;
  }

  function tableCommand(command) {
    const cell = cellAtCursor();
    if (!cell) return;
    const table = cell.closest('table');
    const rows = [...table.rows];
    const row = cell.parentElement;
    const r = rows.indexOf(row);
    const c = cell.cellIndex;
    const columns = Math.max(...rows.map((tr) => tr.cells.length));
    const head = table.tHead || table.createTHead();
    const body = table.tBodies[0] || table.appendChild(make('tbody'));
    const alignOf = (i) => rows[0].cells[i]?.getAttribute('align') || '';
    const newRow = (tag) => {
      const tr = make('tr');
      for (let i = 0; i < columns; i += 1) tr.append(emptyCell(tag, alignOf(i)));
      return tr;
    };
    let focus = null;
    let target = table;

    switch (command) {
      case 'table-row-above':
        if (r === 0) { // a new header; the old one becomes the first body row
          const tr = newRow('th');
          body.prepend(retagRow(row, 'td'));
          head.replaceChildren(tr);
          focus = tr.cells[c];
        } else {
          const tr = newRow('td');
          row.before(tr);
          focus = tr.cells[c];
        }
        break;
      case 'table-row-below': {
        const tr = newRow('td');
        if (r === 0) body.prepend(tr); else row.after(tr);
        focus = tr.cells[c];
        break;
      }
      case 'table-col-left':
      case 'table-col-right':
        for (const tr of rows) {
          const added = emptyCell(tr.parentElement === head ? 'th' : 'td', '');
          const ref = tr.cells[c];
          if (!ref) tr.append(added);
          else if (command === 'table-col-left') ref.before(added);
          else ref.after(added);
          if (tr === row) focus = added;
        }
        break;
      case 'table-delete-row':
        if (rows.length === 1) {
          target = preview;
          table.remove();
        } else if (r === 0) { // the next row becomes the header
          const promoted = retagRow(rows[1], 'th');
          rows[1].remove();
          head.replaceChildren(promoted);
          focus = promoted.cells[Math.min(c, promoted.cells.length - 1)];
        } else {
          const next = rows[r + 1] || rows[r - 1];
          row.remove();
          focus = next.cells[Math.min(c, next.cells.length - 1)];
        }
        break;
      case 'table-delete-col':
        if (columns <= 1) {
          target = preview;
          table.remove();
        } else {
          for (const tr of rows) tr.cells[c]?.remove();
          focus = row.cells[Math.min(c, row.cells.length - 1)];
        }
        break;
      case 'table-delete':
        target = preview;
        table.remove();
        break;
      case 'table-align-left':
      case 'table-align-center':
      case 'table-align-right': {
        const want = command.slice('table-align-'.length);
        const align = alignOf(c) === want ? '' : want; // picking the current one again: no alignment
        for (const tr of rows) {
          const td = tr.cells[c];
          if (!td) continue;
          if (align) td.setAttribute('align', align); else td.removeAttribute('align');
        }
        break;
      }
      default:
        return;
    }
    if (focus) putCaretIn(focus);
    else if (target === preview) preview.focus();
    syncFromPreview(target, 'formatTable'); // direct DOM changes: no input event
  }

  // Tab / Shift+Tab move between cells; Tab in the last cell adds a row.
  preview.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey || !isPreviewEditable()) return;
    const cell = cellAtCursor();
    if (!cell) return;
    e.preventDefault();
    const cells = [...cell.closest('table').querySelectorAll('th, td')];
    const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
    if (next) putCaretIn(next);
    else if (!e.shiftKey) applyPreviewFormat('table-row-below');
  });

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toggleInlineCode() {
    const el = selectionElement();
    const code = el?.closest('code');
    const sel = getSelection();
    if (code && !code.closest('pre')) {
      // Unwrap directly: execCommand re-creates the <code> around re-inserted text.
      const text = document.createTextNode(code.textContent);
      code.replaceWith(text);
      const range = document.createRange();
      range.selectNodeContents(text);
      sel.removeAllRanges();
      sel.addRange(range);
      syncFromPreview(text, 'formatRemove'); // no input event for a direct DOM change
    } else if (!sel.isCollapsed) {
      document.execCommand('insertHTML', false, `<code>${escapeHtml(sel.toString().replace(/\s*\n\s*/g, ' '))}</code>`);
    }
  }

  /** Replaces `old` with `nodes`, puts the cursor at the end of the first, syncs the source. */
  function replaceBlock(old, nodes) {
    old.replaceWith(...nodes);
    const range = document.createRange();
    range.selectNodeContents(nodes[0]);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    syncFromPreview(nodes[0], 'formatBlock'); // direct DOM change: no input event
  }

  // Code blocks are converted by hand: Chromium's formatBlock nests a <p> inside a <pre>
  // instead of replacing it, and can't make <pre><code>.
  function toCodeBlock() {
    const blockAtCursor = () => {
      const block = selectionElement()?.closest('p, h1, h2, h3, h4, h5, h6, div');
      return block && block !== preview && preview.contains(block) ? block : null; // never leave the preview
    };
    // Text that isn't in a block (e.g. just taken out of a quote) gets one first.
    if (!blockAtCursor()) document.execCommand('formatBlock', false, 'p');
    const block = blockAtCursor();
    if (!block) return;
    const pre = make('pre');
    pre.append(make('code', '', block.innerText.replace(/\n$/, '')));
    replaceBlock(block, [pre]);
  }

  function fromCodeBlock(command) {
    const pre = selectionElement()?.closest('pre');
    if (!pre) return;
    const lines = pre.innerText.replace(/^\n/, '').replace(/\n$/, '').split('\n').filter((l) => l.trim());
    if (!lines.length) lines.push('');
    const filled = (tag) => lines.map((line) => make(tag, '', line));
    let nodes;
    if (command === 'ul' || command === 'ol') {
      nodes = [make(command)];
      nodes[0].append(...filled('li'));
    } else if (command === 'blockquote') {
      nodes = [make('blockquote')];
      nodes[0].append(...filled('p'));
    } else {
      nodes = filled(command === 'pre' ? 'p' : command); // Code Block again = back to text
    }
    replaceBlock(pre, nodes);
  }

  function applyPreviewFormat(command) {
    if (!isPreviewEditable()) return;
    const state = previewFormatState();
    if (!state.editable) return;
    preview.focus();
    teachPending = true;
    applyingFormat = true;
    try {
      if (command.startsWith('table-')) {
        tableCommand(command);
        return;
      }
      if (state.block === 'pre' && !['bold', 'italic', 'strike', 'code'].includes(command)) {
        fromCodeBlock(command);
        return;
      }
      switch (command) {
        case 'bold': document.execCommand('bold'); break;
        case 'italic': document.execCommand('italic'); break;
        case 'strike': document.execCommand('strikeThrough'); break;
        case 'code': toggleInlineCode(); break;
        case 'ul': case 'ol': {
          const listCommand = command === 'ul' ? 'insertUnorderedList' : 'insertOrderedList';
          // Out of a quote / heading / code block first, so the list is a plain list.
          if (state.block !== 'ul' && state.block !== 'ol' && state.block !== 'p') document.execCommand('formatBlock', false, 'p');
          document.execCommand(listCommand);
          break;
        }
        case 'pre':
          if (state.block === 'ul' || state.block === 'ol') {
            document.execCommand(state.block === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
          } else if (state.block === 'blockquote') {
            document.execCommand('outdent');
          }
          toCodeBlock();
          break;
        default: { // p, h1–h3, blockquote: picking the current one again turns it off
          const off = state.block === command;
          if (state.block === 'ul' || state.block === 'ol') {
            document.execCommand(state.block === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
          } else if (state.block === 'blockquote') {
            document.execCommand('outdent'); // formatBlock can't take a paragraph out of a quote
          }
          if (off || command === 'p') {
            if (state.block !== 'blockquote') document.execCommand('formatBlock', false, 'p');
          } else {
            document.execCommand('formatBlock', false, command);
          }
        }
      }
    } finally {
      applyingFormat = false;
      teachPending = false; // already used by the input event(s) above, if anything changed
    }
  }

  preview.addEventListener('contextmenu', (e) => {
    if (!isPreviewEditable() || !bridge.showPreviewMenu) return;
    e.preventDefault();
    // Nothing selected: right-clicking a word selects it, so Bold & co. apply to that word.
    const sel = getSelection();
    if (sel.isCollapsed || !preview.contains(sel.anchorNode)) {
      const hit = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (hit && preview.contains(hit.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(hit);
        const node = hit.startContainer;
        const around = node.nodeType === 3 ? node.nodeValue.slice(Math.max(0, hit.startOffset - 1), hit.startOffset + 1) : '';
        if (/[\p{L}\p{N}]/u.test(around)) {
          sel.modify('move', 'backward', 'word');
          sel.modify('extend', 'forward', 'word');
          // A word selection may include the space after it; leave that out.
          const extra = sel.toString().match(/\s+$/)?.[0].length || 0;
          for (let i = 0; i < extra; i += 1) sel.modify('extend', 'backward', 'character');
        }
      }
    }
    bridge.showPreviewMenu({ x: e.clientX, y: e.clientY, state: previewFormatState() });
  });

  // Formatting Markdown can't express isn't applied in the first place.
  const PREVIEW_BLOCKED_INPUT = /^format(Underline|Superscript|Subscript|Justify|Indent|Outdent|FontColor|FontName|BackColor|SetBlockTextDirection|SetInlineTextDirection)/;
  preview.addEventListener('beforeinput', (e) => {
    if (isPreviewEditable() && !applyingFormat && PREVIEW_BLOCKED_INPUT.test(e.inputType)) e.preventDefault();
  });

  // The teaching flash: an overlay laid out exactly like the editor (same styles as
  // .editor-mirror) with the changed text marked; it fades out on its own.
  const flash = document.createElement('div');
  flash.className = 'editor-flash';
  flash.setAttribute('aria-hidden', 'true');
  editor.parentElement.appendChild(flash);
  let flashTimer = 0;

  function flashEditorRanges(ranges, at) {
    const text = editor.value;
    if (!ranges.length) { // something was only removed: show the line it was on
      const start = text.lastIndexOf('\n', at - 1) + 1;
      const end = text.indexOf('\n', start);
      ranges = [[start, end === -1 ? text.length : end]];
    }
    const parts = [];
    let pos = 0;
    for (const [start, end] of ranges) {
      const mark = document.createElement('mark');
      mark.textContent = text.slice(start, end) || ' ';
      parts.push(text.slice(pos, start), mark);
      pos = end;
    }
    parts.push(`${text.slice(pos)}\n`);
    flash.replaceChildren(...parts);
    const mark = flash.querySelector('mark');
    Object.assign(flash.style, {
      top: `${editor.offsetTop}px`,
      left: `${editor.offsetLeft}px`,
      width: `${editor.clientWidth}px`,
      height: `${editor.clientHeight}px`,
    });
    flash.hidden = false;
    // Make sure the change is in view in the editor.
    const top = mark.offsetTop;
    if (top < editor.scrollTop || top + mark.offsetHeight > editor.scrollTop + editor.clientHeight) {
      echoTarget = editor; // don't drag the preview along
      clearTimeout(echoTimer);
      echoTimer = setTimeout(() => { echoTarget = null; }, 100);
      editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
    }
    flash.scrollTop = editor.scrollTop;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash.hidden = true; flash.replaceChildren(); }, 2000);
  }
  editor.addEventListener('scroll', () => { if (!flash.hidden) flash.scrollTop = editor.scrollTop; });

  // Paste plain text only: arbitrary styled HTML from elsewhere has no Markdown equivalent.
  preview.addEventListener('paste', (e) => {
    if (!isPreviewEditable()) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
  });

  // Clicking a link puts the cursor in it (it's editable); Cmd+click opens it.
  preview.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || !isPreviewEditable()) return;
    e.preventDefault();
    if (!e.metaKey) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) preview.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView();
    else if (/^https?:/i.test(a.href)) window.open(a.href);
  });

  // Back in the editor: redraw the preview from the source (Chromium's edited DOM is close to,
  // but not exactly, what the Markdown renders to).
  editor.addEventListener('focus', () => {
    if (previewEdited) render();
  });

  // ---------- Undo / redo: one history for both panes (see undo-history.js) ----------
  const history = window.UndoHistory.createHistory();
  const editorSelection = () => [editor.selectionStart, editor.selectionEnd];
  let toolEdit = false; // replaceRange() is running: a step of its own, never merged with typing
  const INPUT_GROUPS = {
    insertText: 'type',
    deleteContentBackward: 'delete',
    deleteContentForward: 'delete',
    deleteWordBackward: 'delete',
    deleteWordForward: 'delete',
  };
  const inputGroup = (pane, inputType) => (INPUT_GROUPS[inputType] ? `${pane}-${INPUT_GROUPS[inputType]}` : null);

  editor.addEventListener('input', (e) => {
    history.record(editor.value, editorSelection(), toolEdit ? null : inputGroup('editor', e.inputType));
  });
  // Moving the cursor ends a typing step, as in native text fields.
  const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter']);
  for (const pane of [editor, preview]) {
    pane.addEventListener('mousedown', () => history.breakGroup());
    pane.addEventListener('keydown', (e) => { if (NAV_KEYS.has(e.key)) history.breakGroup(); });
  }

  /** Puts the preview's cursor at the end of the block that shows source line `line`. */
  function placePreviewCaret(line) {
    let target = null;
    for (const el of preview.querySelectorAll(':scope > [data-line]')) {
      if (Number(el.dataset.line) <= line) target = el; else break;
    }
    preview.focus({ preventScroll: true });
    if (!target || !target.isContentEditable) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    target.scrollIntoView({ block: 'nearest' });
  }

  function applyHistory(state) {
    if (!state) return;
    const inPreview = isPreviewEditable() && preview.contains(document.activeElement);
    const old = editor.value;
    const { text } = state;
    let start = 0;
    const max = Math.min(old.length, text.length);
    while (start < max && old[start] === text[start]) start += 1;
    let tail = 0;
    while (tail < max - start && old[old.length - 1 - tail] === text[text.length - 1 - tail]) tail += 1;
    writeEditorQuietly(text);
    render(); // the preview, redrawn from the restored source
    updateDirty();
    if (inPreview) {
      placePreviewCaret(text.slice(0, start).split('\n').length - 1);
    } else {
      // Select what came back (or put the cursor where text went away), like native undo.
      editor.focus();
      editor.setSelectionRange(start, text.length - tail);
    }
  }
  const undo = () => applyHistory(history.undo());
  const redo = () => applyHistory(history.redo());
  // Chromium's own undo (e.g. from a context menu) would replay steps that no longer fit.
  document.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    if (e.inputType === 'historyUndo') undo(); else redo();
  }, true);

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
    preview.contentEditable = markdownTools ? 'true' : 'false'; // see "Editing in the preview"
    preview.spellcheck = false;
    caseMode = markdownTools ? 'markdown' : 'literal';
    // A single image has nothing to scroll in step with, and an image or code can't be pasted as text.
    syncToggle.disabled = kind === 'code' || kind === 'svg' || kind === 'mermaid';
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
    if (source === preview) await prepareDiagramsForCopy();
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
  // Tab / Shift+Tab on a Markdown list item nest it / bring it up a level, and with several lines
  // selected indent / outdent them all. Enter continues a Markdown list or quote; on an empty
  // item it ends the list (tools.js continueList / indentLines). Shift+Enter: a plain newline.
  let indentUnit = '  ';
  editor.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // (an input method is composing text)
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Tab' && plainKey) {
      e.preventDefault();
      const r = T.indentLines(editor.value, editor.selectionStart, editor.selectionEnd, indentUnit,
        e.shiftKey, { lists: markdownTools });
      if (r) applyEdit(r);
      else if (!e.shiftKey) document.execCommand('insertText', false, indentUnit);
      return;
    }
    if (e.key === 'Enter' && plainKey && !e.shiftKey && markdownTools) {
      const r = T.continueList(editor.value, editor.selectionStart, editor.selectionEnd);
      if (r) {
        e.preventDefault();
        applyEdit(r);
      }
      return;
    }
    // Same shortcuts as the preview (Markdown & text only): bold, italic, strikethrough, code.
    const shortcut = EDITOR_SHORTCUTS[(e.shiftKey ? 'shift+' : '') + e.key.toLowerCase()];
    if (e.metaKey && !e.ctrlKey && !e.altKey && shortcut && markdownTools) {
      e.preventDefault();
      runFormatCommand(shortcut);
    }
  });
  const EDITOR_SHORTCUTS = { b: 'bold', i: 'italic', e: 'code', 'shift+x': 'strike' };

  // ---------- Theme ----------
  const THEME_KEY = 'markdown-helper:theme';
  function readSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function applyTheme(mode, persist) {
    const dark = mode === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (preview.querySelector('.mermaid-diagram')) scheduleRender(); // redraw in the new theme
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

  // Replace text through execCommand, like typing: the textarea keeps its scroll position and
  // fires a normal input event (which records the undo step, see "Undo / redo"). Only the span
  // that actually differs is replaced, so the cursor and scroll position stay put.
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
    toolEdit = true;
    history.breakGroup();
    try {
      if (insert) document.execCommand('insertText', false, insert);
      else document.execCommand('delete');
    } finally {
      toolEdit = false;
    }
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

  /** Applies a { text, start, end } result from tools.js to the editor (one undo step). */
  function applyEdit(result) {
    if (!result) return;
    replaceRange(0, editor.value.length, result.text);
    editor.setSelectionRange(result.start, result.end);
    scheduleRender();
  }
  const T = window.MarkdownTools;
  const inlineCommand = (style) => () => markdownTools
    && applyEdit(T.toggleInline(editor.value, editor.selectionStart, editor.selectionEnd, style));
  const blockCommand = (type) => () => markdownTools
    && applyEdit(T.setBlockType(editor.value, editor.selectionStart, editor.selectionEnd, type));
  const tableCommandAt = (command) => () => markdownTools
    && applyEdit(T.tableEdit(editor.value, editor.selectionStart, command));

  /** What the Markdown pane's menu shows as checked (see formatMenuTemplate in main.js). */
  function editorFormatState() {
    if (!markdownTools) return { markdownTools };
    const { value, selectionStart: s, selectionEnd: e } = editor;
    const block = T.blockTypeAt(value, s);
    const table = block === 'table' ? T.tableAt(value, s) : null;
    return {
      markdownTools,
      ...T.inlineStylesAt(value, s, e),
      block,
      table: table && { align: table.align, header: table.header },
    };
  }

  const FORMAT_COMMANDS = {
    bold: inlineCommand('bold'),
    italic: inlineCommand('italic'),
    strike: inlineCommand('strike'),
    code: inlineCommand('code'),
    ...Object.fromEntries(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'pre'].map((t) => [t, blockCommand(t)])),
    ...Object.fromEntries(['table-row-above', 'table-row-below', 'table-col-left', 'table-col-right',
      'table-delete-row', 'table-delete-col', 'table-delete', 'table-align-left', 'table-align-center',
      'table-align-right'].map((c) => [c, tableCommandAt(c)])),
    'clean-up': () => markdownTools && applyTool(cleanUpText),
    'remove-newlines': () => markdownTools && applyTool(removeNewlines),
    'format-tables': () => markdownTools && applyTool(formatTables, { wholeLines: true }),
    'convert-table': () => markdownTools && applyTool(toTable, { wholeLines: true, block: true }),
    uppercase: () => applyTool(caseTool('upper')),
    lowercase: () => applyTool(caseTool('lower')),
    'title-case': () => applyTool(caseTool('title')),
    'sentence-case': () => applyTool(caseTool('sentence')),
  };
  /** Runs a menu / shortcut command; what it changed lights up briefly, as in the preview. */
  function runFormatCommand(command) {
    const before = editor.value;
    const at = editor.selectionStart;
    FORMAT_COMMANDS[command]?.();
    if (editor.value !== before) flashEditorRanges(window.TextDiff.changedRanges(before, editor.value), at);
  }

  // The Edit button (#btn-format) opens a native menu just below itself; right-clicking in the
  // editor opens the same menu (plus Cut / Copy / Paste). Picks come back as 'format' commands.
  // The editor keeps focus the whole time: a textarea that loses focus stops painting its
  // selection, and the user needs to see what the format will apply to.
  const formatBtn = document.getElementById('btn-format');
  formatBtn.addEventListener('mousedown', (e) => e.preventDefault()); // don't take focus on click
  formatBtn.addEventListener('click', () => {
    editor.focus(); // also when opened from the keyboard (Tab + Space); keeps the selection as-is
    const r = formatBtn.getBoundingClientRect();
    formatBtn.setAttribute('aria-expanded', 'true');
    bridge.showFormatMenu?.({ x: r.left, y: r.bottom + 4, ...editorFormatState() })
      .finally(() => formatBtn.setAttribute('aria-expanded', 'false'));
  });
  editor.addEventListener('contextmenu', (e) => {
    if (!bridge.showFormatMenu) return;
    e.preventDefault();
    bridge.showFormatMenu({ x: e.clientX, y: e.clientY, context: true, ...editorFormatState() });
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
    history.reset(content, [0, 0]);
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
      const moved = result.filePath !== doc.filePath;
      doc.filePath = result.filePath;
      doc.savedContent = content;
      doc.dirty = null;
      updateDirty();
      if (moved) {
        applyKind(doc.filePath); // Save As may change the type (e.g. Untitled → page.html)
        render(); // applyKind() cleared the preview; for HTML, <base> also follows a new folder
      }
      // (A plain Save leaves the preview alone, so editing in it can go on undisturbed.)
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
      case 'undo': return undo();
      case 'redo': return redo();
      case 'format': return runFormatCommand(arg);
      case 'preview-format': return applyPreviewFormat(arg);
      case 'folder-action': return runFolderAction(arg);
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
    if (treeEditing) return null; // don't redraw the tree under an open name field
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

  // ---------- Folder sidebar: right-click menu (new file / folder, rename, trash, …) ----------
  // The menu is built in main (folderMenuTemplate); picks come back as 'folder-action'. Names
  // are typed into a field inside the tree, like Finder and VS Code. The file operations run in
  // main, which refuses anything outside the open folder.
  let treeEditing = null; // the open name field, if any

  const parentDir = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
  const treeItemFor = (p) => [...fileTree.querySelectorAll('.tree-item')].find((b) => b.dataset.path === p);
  /** Is `p` the open document's file, or a folder it's in? */
  const holdsOpenDoc = (p) => !!doc.filePath && (doc.filePath === p || doc.filePath.startsWith(p + SEP));

  sidebar.addEventListener('contextmenu', (e) => {
    if (!folder || !bridge.showFolderMenu || e.target.closest('.tree-name-row')) return;
    e.preventDefault();
    const btn = e.target.closest('.tree-item');
    const target = btn
      ? {
        path: btn.dataset.path,
        type: btn.classList.contains('tree-dir') ? 'dir' : 'file',
        root: false,
        supported: btn.getAttribute('aria-disabled') !== 'true',
      }
      : { path: folder.path, type: 'dir', root: true };
    btn?.classList.add('is-context');
    bridge.showFolderMenu({ x: e.clientX, y: e.clientY, target })
      .finally(() => btn?.classList.remove('is-context'));
  });

  /**
   * An inline name field. Enter commits (onCommit may throw: the error is shown and the field
   * stays), Escape cancels, clicking elsewhere commits a changed name or cancels.
   */
  function nameField({ row, value = '', selectTo, onCommit }) {
    const input = make('input', 'tree-name-input');
    input.type = 'text';
    input.value = value;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Name');
    row.append(input);
    let busy = false;
    const finish = () => {
      if (treeEditing !== input) return;
      treeEditing = null;
      row.remove();
      refreshFolder();
    };
    const commit = async () => {
      if (busy) return;
      const name = input.value.trim();
      if (!name || name === value) { finish(); return; }
      busy = true;
      try {
        await onCommit(name);
        finish();
      } catch (err) {
        reportError('do that', err);
        input.focus();
      } finally {
        busy = false;
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // not the tree's arrow-key navigation
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
    });
    // Clicking elsewhere in the window commits (or cancels); switching apps leaves it open.
    input.addEventListener('blur', () => setTimeout(() => {
      if (treeEditing === input && document.hasFocus() && document.activeElement !== input && !busy) commit();
    }, 0));
    treeEditing = input;
    input.focus();
    input.setSelectionRange(0, selectTo ?? value.length);
    return input;
  }

  function treeRow(depth, icon) {
    const row = make('div', 'tree-name-row');
    row.style.setProperty('--depth', String(depth));
    row.innerHTML = icon;
    return row;
  }

  /** New file / folder: a name field at the top of folder `dir` (expanded first). */
  function askNewEntry(dir, kind) {
    let list;
    let depth = 0;
    if (dir === folder.path) {
      list = fileTree.querySelector(':scope > ul');
      if (!list) { // an empty folder shows a message instead of a list
        list = make('ul');
        fileTree.replaceChildren(list);
      }
    } else {
      const btn = treeItemFor(dir);
      if (!btn) return;
      toggleDir(btn, true);
      list = btn.nextElementSibling;
      depth = Number(btn.style.getPropertyValue('--depth')) + 1;
    }
    const li = make('li');
    const row = treeRow(depth, kind === 'folder' ? CHEVRON : DOC_ICON);
    li.append(row);
    list.prepend(li);
    row.scrollIntoView({ block: 'nearest' });
    nameField({
      row,
      onCommit: async (typed) => {
        // A file name without an extension becomes a Markdown file.
        const name = kind === 'file' && !/\.[^.]+$/.test(typed) ? `${typed}.md` : typed;
        const created = await bridge.createEntry(dir, name, kind);
        li.remove();
        if (kind === 'folder') expanded.add(created);
        treeEditing = null;
        await refreshFolder();
        if (kind === 'file') openFile(created);
        else treeItemFor(created)?.focus();
      },
    });
  }

  /** Rename: the item's label becomes a name field, the name selected without its extension. */
  function askRename(target) {
    const btn = treeItemFor(target);
    if (!btn) return;
    const name = btn.querySelector('.tree-label').textContent; // the full name, extension included
    const dot = btn.classList.contains('tree-file') ? name.lastIndexOf('.') : -1;
    const row = treeRow(Number(btn.style.getPropertyValue('--depth')), btn.classList.contains('tree-dir') ? CHEVRON : DOC_ICON);
    btn.hidden = true;
    btn.after(row);
    const input = nameField({
      row,
      value: name,
      selectTo: dot > 0 ? dot : name.length,
      onCommit: async (newName) => {
        const renamed = await bridge.renameEntry(target, newName);
        movedOnDisk(target, renamed);
      },
    });
    // Cancelled or done: show the item again (a refresh redraws it anyway).
    input.addEventListener('blur', () => setTimeout(() => { if (!row.isConnected) btn.hidden = false; }, 0));
    row.addEventListener('keydown', (e) => { if (e.key === 'Escape') btn.hidden = false; });
  }

  /** A file or folder was renamed: follow it with the open document and the expanded folders. */
  function movedOnDisk(from, to) {
    for (const p of [...expanded]) {
      if (p === from || p.startsWith(from + SEP)) {
        expanded.delete(p);
        expanded.add(to + p.slice(from.length));
      }
    }
    if (!holdsOpenDoc(from)) return;
    const before = kind;
    doc.filePath = to + doc.filePath.slice(from.length);
    if (fileInfo(doc.filePath)?.kind !== before) { // e.g. notes.md → notes.txt keeps, .md → .json changes
      applyKind(doc.filePath);
      render();
    }
    doc.dirty = null; // report the new name (title bar, Save)
    updateDirty();
  }

  async function runFolderAction({ action, path: target, type }) {
    if (!folder) return;
    try {
      switch (action) {
        case 'open': await openFile(target); break;
        case 'new-file':
        case 'new-folder':
          askNewEntry(type === 'dir' ? target : parentDir(target), action === 'new-file' ? 'file' : 'folder');
          break;
        case 'rename': askRename(target); break;
        case 'duplicate': {
          const copy = await bridge.duplicateEntry(target);
          await refreshFolder();
          treeItemFor(copy)?.focus();
          break;
        }
        case 'trash':
          if (await bridge.trashEntry(target)) {
            if (holdsOpenDoc(target)) {
              // Its text stays in the editor, as an unsaved Untitled document.
              doc.filePath = null;
              doc.savedContent = null;
              doc.dirty = null;
              updateDirty();
            }
            await refreshFolder();
          }
          break;
        case 'reveal': await bridge.revealEntry(target); break;
        case 'copy-path': await bridge.copyEntryPath(target, false); break;
        case 'copy-relative-path': await bridge.copyEntryPath(target, true); break;
        case 'refresh': await refreshFolder(); break;
        case 'close-folder': closeFolder(); break;
        default: break;
      }
    } catch (err) {
      reportError('do that', err);
    }
  }
  // Pick up files added, renamed or deleted elsewhere when coming back to the app.
  window.addEventListener('focus', () => { if (folder) refreshFolder(); });

  // ---------- Starter content ----------
  const welcome = `# Write Markdown. Paste it anywhere.

Type on the left, see the result on the right, then **Copy** it into Docs, Word or email.

## Features

- Live preview with GitHub-flavored Markdown
- Edit on **either side**: changes in the preview update the Markdown
- **Cmd+B** / *Cmd+I* for bold and italic
- **Mermaid diagrams** (see below)
- Dark mode toggle (top right)
- Text tools in the **Edit** menu above the editor (or right-click)

> Tip: select some text before using an **Edit** tool
> to change only your selection.

\`\`\`js
console.log('Hello, Markdown!');
\`\`\`

## Mermaid diagrams

Write a code block marked \`mermaid\` and it's drawn as a diagram:
flowcharts, sequence diagrams, pie charts, mind maps and more.
\`.mmd\` and \`.mermaid\` files open as diagrams too.

\`\`\`mermaid
flowchart LR
  A[Write Markdown] --> B[Preview]
  B --> C[Copy into Docs or email]
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
