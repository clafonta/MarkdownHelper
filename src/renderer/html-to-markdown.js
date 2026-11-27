/**
 * Turns edited preview DOM back into Markdown (the editable preview's "reverse" direction).
 *
 * Only the DOM interface below is used, so it can be unit-tested in Node with plain objects:
 * nodeType (1 element, 3 text), tagName, childNodes, nodeValue, getAttribute(name) and, for
 * checkboxes, the `checked` property.
 *
 * blocksToMarkdown(nodes, { bullet, rawOf }) – Markdown for a list of top-level preview nodes (blocks joined by a
 *   blank line). Handles what marked produces (p, h1–h6, lists incl. task lists, blockquote,
 *   pre/code, table, hr, strong/em/del/code/a/img/br) plus what Chromium's contenteditable adds
 *   while editing (b, i, div, span with bold/italic style, <br> placeholders, no-break spaces).
 *   Text is escaped so that whatever was typed shows up literally.
 *
 * patchSource(m0, c0, c1) – the user's own Markdown m0 rendered to a block whose canonical
 *   Markdown was c0, and the edited block is now c1. Applies the c0 → c1 change to m0 when it
 *   falls where m0 and c0 agree (so `_em_`, `*` bullets, padded tables … survive edits elsewhere
 *   in the block); otherwise returns c1.
 */
(function (root) {
  const tools = typeof module !== 'undefined' && module.exports
    ? require('./tools.js')
    : root.MarkdownTools;

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE',
    'TABLE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'DETAILS', 'DL',
  ]);
  // Inline HTML that has no Markdown form but means something: kept as tags.
  const KEEP_TAGS = new Set(['KBD', 'SUP', 'SUB', 'MARK', 'INS', 'SMALL', 'ABBR', 'CITE', 'Q']);
  const BR = '\u0001'; // a hard line break, turned into "  " once lines are trimmed
  const MARKS = { strong: '**', em: '*', del: '~~' };

  const tagOf = (n) => (n.nodeType === 1 ? String(n.tagName).toUpperCase() : '');
  const kidsOf = (n) => Array.from(n.childNodes || []);
  const attr = (n, name) => (n.getAttribute ? n.getAttribute(name) : null);
  const isBlock = (n) => BLOCK_TAGS.has(tagOf(n));

  /** Text as shown, with <br> as a newline. */
  function textOf(n) {
    if (n.nodeType === 3) return n.nodeValue;
    if (tagOf(n) === 'BR') return '\n';
    return kidsOf(n).map(textOf).join('');
  }

  function escapeText(s, ctx) {
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      const prev = s[i - 1] || '';
      const next = s[i + 1] || '';
      if (c === '\\') out += /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : '\\';
      else if ('`*[]~'.includes(c)) out += `\\${c}`;
      else if (c === '_') out += /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next) ? '_' : '\\_';
      else if (c === '<') out += /[A-Za-z/!?]/.test(next) ? '\\<' : '<';
      else if (c === '&') out += /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(s.slice(i)) ? '&amp;' : '&';
      else if (c === '|' && ctx.table) out += '\\|';
      else if (c === '\u00a0') out += ' ';
      else out += c;
    }
    return out;
  }

  /** Escapes what would turn a line into a heading, quote, list item or rule. */
  function escapeLineStart(line) {
    return line
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^>/, '\\>')
      .replace(/^([-+])(?=\s|$)/, '\\$1')
      .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^([=-])(?=\1*\s*$)/, '\\$1');
  }

  function formatOf(n) {
    const tag = tagOf(n);
    if (tag === 'STRONG' || tag === 'B') return 'strong';
    if (tag === 'EM' || tag === 'I') return 'em';
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return 'del';
    if (tag === 'SPAN') {
      const style = attr(n, 'style') || '';
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) return 'strong';
      if (/font-style:\s*italic/i.test(style)) return 'em';
    }
    return null;
  }

  function wrap(format, children, ctx) {
    if (ctx[format]) return inline(children, ctx); // already inside the same formatting
    const inner = inline(children, { ...ctx, [format]: true });
    if (!inner.trim()) return inner;
    // Markers must hug the text: "**word** " works, "**word **" doesn't.
    const lead = inner.match(/^\s*/)[0];
    const trail = inner.slice(lead.length).match(/\s*$/)[0];
    const core = inner.slice(lead.length, inner.length - trail.length);
    return lead + MARKS[format] + core + MARKS[format] + trail;
  }

  function codeSpan(text) {
    if (!text) return '';
    let n = 1;
    const runs = new Set(text.match(/`+/g) || []);
    while (runs.has('`'.repeat(n))) n += 1;
    const fence = '`'.repeat(n);
    const pad = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
    return fence + pad + text + pad + fence;
  }

  function link(n, ctx) {
    const href = attr(n, 'href') || '';
    const title = attr(n, 'title');
    const text = inline(kidsOf(n), ctx);
    if (!text.trim()) return text; // link text deleted: drop the link
    const plain = textOf(n);
    if (!title && plain === href && /^https?:\/\//i.test(href)) return href; // bare URL
    if (!title && href === `mailto:${plain}`) return plain; // bare e-mail address
    if (!href) return text;
    const dest = /[\s()<>]/.test(href) ? `<${href}>` : href;
    return `[${text}](${dest}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
  }

  function image(n) {
    const src = attr(n, 'src') || '';
    if (!src) return '';
    const alt = (attr(n, 'alt') || '').replace(/([[\]\\])/g, '\\$1');
    const title = attr(n, 'title');
    const dest = /[\s()<>]/.test(src) ? `<${src}>` : src;
    return `![${alt}](${dest}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
  }

  function inlineNode(n, ctx) {
    if (n.nodeType === 3) return escapeText(n.nodeValue, ctx);
    if (n.nodeType !== 1) return '';
    const tag = tagOf(n);
    switch (tag) {
      case 'BR': return ctx.table ? ' ' : `${BR}\n`;
      case 'CODE': return codeSpan(textOf(n).replace(/\u00a0/g, ' ').replace(/\n/g, ' '));
      case 'A': return link(n, ctx);
      case 'IMG': return image(n);
      case 'INPUT': return ''; // task-list checkbox, written by listItem()
      default:
        if (KEEP_TAGS.has(tag)) {
          const name = tag.toLowerCase();
          return `<${name}>${inline(kidsOf(n), ctx)}</${name}>`;
        }
        // A block inside inline content (e.g. a <div> Chromium put in a paragraph) starts a line.
        if (isBlock(n)) return `\n${inline(kidsOf(n), ctx)}\n`;
        return inline(kidsOf(n), ctx);
    }
  }

  function inline(nodes, ctx) {
    let out = '';
    for (let i = 0; i < nodes.length; i += 1) {
      const format = formatOf(nodes[i]);
      if (!format) {
        out += inlineNode(nodes[i], ctx);
        continue;
      }
      // <b>a</b><b>b</b> → **ab**, not **a****b**
      const run = [nodes[i]];
      while (i + 1 < nodes.length && formatOf(nodes[i + 1]) === format) run.push(nodes[(i += 1)]);
      out += wrap(format, run.flatMap(kidsOf), ctx);
    }
    return out;
  }

  /** Inline Markdown → finished lines: trimmed, line starts escaped, hard breaks as "  ". */
  function finishInline(s) {
    const body = s.replace(/^\s+/, '').replace(/[\s\u0001]+$/, '');
    if (!body) return '';
    return body.split('\n')
      .map((line) => escapeLineStart(line.replace(/^[ \t]+/, '').replace(/[ \t]+(\u0001?)$/, '$1')))
      .join('\n')
      .replace(/\u0001/g, '  ');
  }

  const paragraph = (nodes, ctx) => finishInline(inline(nodes, ctx));

  function heading(n, ctx) {
    const text = finishInline(inline(kidsOf(n), ctx).replace(/\u0001?\n/g, ' '))
      .replace(/\s*\n\s*/g, ' ');
    return text ? `${'#'.repeat(Number(tagOf(n)[1]))} ${text}` : '';
  }

  function preText(n) {
    let out = '';
    for (const k of kidsOf(n)) {
      if (k.nodeType === 3) out += k.nodeValue;
      else if (tagOf(k) === 'BR') out += '\n';
      else if (tagOf(k) === 'DIV' || tagOf(k) === 'P') {
        if (out && !out.endsWith('\n')) out += '\n';
        out += preText(k);
      } else out += preText(k);
    }
    return out;
  }

  function codeBlock(n) {
    const code = kidsOf(n).find((k) => tagOf(k) === 'CODE') || n;
    const lang = ((attr(code, 'class') || '').match(/language-(\S+)/) || [])[1] || '';
    // (A <pre> made while editing can start with a newline the HTML parser would have dropped.)
    const text = preText(code).replace(/\u00a0/g, ' ').replace(/^\n/, '').replace(/\n$/, '');
    const longest = Math.max(0, ...(text.match(/^`{3,}/gm) || []).map((r) => r.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}${lang}\n${text}\n${fence}`;
  }

  function blockquote(n, ctx) {
    const inner = blocks(kidsOf(n), ctx);
    return inner ? inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') : '';
  }

  /** The checkbox at the start of a task-list item (directly, or in its first paragraph). */
  function leadingCheckbox(nodes) {
    for (const k of nodes) {
      if (k.nodeType === 3 && !k.nodeValue.trim()) continue;
      if (tagOf(k) === 'INPUT' && (attr(k, 'type') || '').toLowerCase() === 'checkbox') return k;
      if (tagOf(k) === 'P') return leadingCheckbox(kidsOf(k));
      return null;
    }
    return null;
  }

  function listItem(li, ctx, loose) {
    const kids = kidsOf(li);
    const box = leadingCheckbox(kids);
    const body = blocks(kids, ctx, loose ? '\n\n' : '\n');
    const prefix = box ? (box.checked ? '[x] ' : '[ ] ') : '';
    return (prefix + body).trimEnd();
  }

  function list(n, ctx) {
    const ordered = tagOf(n) === 'OL';
    let number = parseInt(attr(n, 'start'), 10);
    if (!Number.isFinite(number)) number = 1;
    const items = kidsOf(n).filter((k) => k.nodeType === 1 || (k.nodeType === 3 && k.nodeValue.trim()));
    const loose = items.some((li) => kidsOf(li).some((k) => tagOf(k) === 'P'));
    return items.map((li) => {
      const marker = ordered ? `${number++}. ` : `${ctx.bullet || '-'} `;
      const body = li.nodeType === 1 && tagOf(li) === 'LI' ? listItem(li, ctx, loose) : blocks([li], ctx);
      if (!body) return marker.trimEnd();
      const pad = ' '.repeat(marker.length);
      const [first, ...rest] = body.split('\n');
      return marker + first + rest.map((l) => (l ? `\n${pad}${l}` : '\n')).join('');
    }).join(loose ? '\n\n' : '\n');
  }

  function table(n, ctx) {
    const rows = [];
    const collect = (node) => {
      for (const k of kidsOf(node)) {
        if (tagOf(k) === 'TR') rows.push(k);
        else if (k.nodeType === 1) collect(k);
      }
    };
    collect(n);
    if (!rows.length) return '';
    const cellsOf = (tr) => kidsOf(tr).filter((c) => tagOf(c) === 'TH' || tagOf(c) === 'TD');
    const cellText = (c) => inline(kidsOf(c), { ...ctx, table: true })
      .replace(/[\u0001\n]/g, ' ').replace(/\s+/g, ' ').trim();
    const header = cellsOf(rows[0]);
    const columns = Math.max(...rows.map((r) => cellsOf(r).length));
    if (!columns) return '';
    const line = (cells) => {
      const out = [];
      for (let i = 0; i < columns; i += 1) out.push(cells[i] ?? '');
      return `| ${out.join(' | ')} |`;
    };
    const delims = [];
    for (let i = 0; i < columns; i += 1) {
      const c = header[i];
      const align = c ? (attr(c, 'align') || ((attr(c, 'style') || '').match(/text-align:\s*(\w+)/) || [])[1] || '') : '';
      delims.push({ left: ':--', center: ':-:', right: '--:' }[align.toLowerCase()] || '---');
    }
    const lines = [line(header.map(cellText)), line(delims), ...rows.slice(1).map((r) => line(cellsOf(r).map(cellText)))];
    return tools.formatTables(lines.join('\n'));
  }

  function block(n, ctx) {
    switch (tagOf(n)) {
      case 'P': return paragraph(kidsOf(n), ctx);
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return heading(n, ctx);
      case 'HR': return '---';
      case 'PRE': return codeBlock(n);
      case 'BLOCKQUOTE': return blockquote(n, ctx);
      case 'UL': case 'OL': return list(n, ctx);
      case 'TABLE': return table(n, ctx);
      default: return blocks(kidsOf(n), ctx); // div, li outside a list, section, …
    }
  }

  /**
   * Markdown for a sequence of nodes. Runs of inline nodes form a paragraph. `ctx.rawOf(node)`
   * may return the Markdown to use for a node as-is (string), '' to skip it, or undefined.
   */
  function blocks(nodes, ctx = {}, separator = '\n\n') {
    const parts = [];
    let run = [];
    const flush = () => {
      if (run.length) {
        const text = paragraph(run, ctx);
        if (text) parts.push(text);
      }
      run = [];
    };
    for (const n of nodes) {
      const raw = ctx.rawOf ? ctx.rawOf(n) : undefined;
      if (raw !== undefined) {
        flush();
        if (raw) parts.push(raw);
      } else if (n.nodeType === 1 && isBlock(n)) {
        flush();
        const text = block(n, ctx);
        if (text) parts.push(text);
      } else if (n.nodeType === 1 || (n.nodeType === 3 && (run.length || n.nodeValue.trim()))) {
        run.push(n);
      }
    }
    flush();
    return parts.join(separator);
  }

  /** `bullet`: the list marker to write ('-', '*' or '+'; follow the source's own). */
  function blocksToMarkdown(nodes, { rawOf, bullet } = {}) {
    return blocks(Array.from(nodes), { rawOf, bullet });
  }

  // ---------- Keeping the user's own Markdown ----------

  /** The single changed span between a and b: a[start, endA) became b[start, endB). */
  function changedSpan(a, b) {
    let start = 0;
    const max = Math.min(a.length, b.length);
    while (start < max && a[start] === b[start]) start += 1;
    let tail = 0;
    while (tail < max - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
    return { start, endA: a.length - tail, endB: b.length - tail };
  }

  /** c0 → c1 applied to m0 if the change lies where m0 and c0 are identical, else null. */
  function patchIfAligned(m0, c0, c1) {
    if (c1 === c0) return m0;
    if (m0 === c0) return c1;
    const { start, endA, endB } = changedSpan(c0, c1);
    const insert = c1.slice(start, endB);
    let prefix = 0;
    while (prefix < Math.min(m0.length, c0.length) && m0[prefix] === c0[prefix]) prefix += 1;
    if (endA <= prefix) return m0.slice(0, start) + insert + m0.slice(endA);
    let suffix = 0;
    const maxSuffix = Math.min(m0.length, c0.length);
    while (suffix < maxSuffix && m0[m0.length - 1 - suffix] === c0[c0.length - 1 - suffix]) suffix += 1;
    if (start >= c0.length - suffix) {
      const shift = m0.length - c0.length;
      return m0.slice(0, start + shift) + insert + m0.slice(endA + shift);
    }
    return null;
  }

  function patchSource(m0, c0, c1) {
    const direct = patchIfAligned(m0, c0, c1);
    if (direct !== null) return direct;
    // Same number of lines (lists, tables, wrapped paragraphs): patch just the edited lines.
    const c0Lines = c0.split('\n');
    const m0Lines = m0.split('\n');
    if (c0Lines.length === m0Lines.length) {
      const { start, endA } = changedSpan(c0, c1);
      const first = c0.slice(0, start).split('\n').length - 1;
      const last = c0.slice(0, endA).split('\n').length - 1;
      const cStart = c0Lines.slice(0, first).join('\n').length + (first ? 1 : 0);
      const cEnd = cStart + c0Lines.slice(first, last + 1).join('\n').length;
      const mStart = m0Lines.slice(0, first).join('\n').length + (first ? 1 : 0);
      const mSub = m0Lines.slice(first, last + 1).join('\n');
      const sub = patchIfAligned(mSub, c0.slice(cStart, cEnd), c1.slice(cStart, cEnd + c1.length - c0.length));
      if (sub !== null) return m0.slice(0, mStart) + sub + m0.slice(mStart + mSub.length);
    }
    return c1;
  }

  const api = { blocksToMarkdown, patchSource, escapeText: (s) => escapeText(s, {}) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HtmlToMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
