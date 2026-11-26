/**
 * Pure text transforms used by the editor toolbar. No DOM access, so they can be unit-tested in Node.
 */
(function (root) {
  const { parseDelimited } = typeof module !== 'undefined' && module.exports
    ? require('./data-preview.js') : root.DataPreview;
  const DELIM_CELL = /^:?-+:?$/;
  const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
  const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
  const RULE_OR_UNDERLINE = /^\s{0,3}(=+|-+|(\*\s*){3,}|(_\s*){3,})\s*$/;
  const HTML_BLOCK = /^\s{0,3}<\/?[a-zA-Z!]/;
  const INDENTED_CODE = /^( {4}|\t)/;
  const QUOTE = /^(\s{0,3}>\s?)(.*)$/;

  // ---------- Remove new lines ----------

  /**
   * Joins hard-wrapped lines inside each plain paragraph into a single line. Handy for text
   * pasted from PDFs or emails. Structure is left alone: tables, lists, fenced and indented
   * code, headings, rules and HTML blocks are copied through untouched, and blockquote
   * paragraphs are joined while keeping a single `>` marker.
   */
  function removeNewlines(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const tableLines = findTableLines(lines);
    const out = [];
    let para = null; // { prefix, parts } for the paragraph currently being joined
    let inFence = null;
    let inList = false;

    const flush = () => {
      if (para) out.push(para.prefix + para.parts.join(' '));
      para = null;
    };
    const addToPara = (prefix, content) => {
      if (para && para.prefix !== prefix) flush();
      if (!para) para = { prefix, parts: [] };
      para.parts.push(content.trim());
    };

    lines.forEach((line, i) => {
      if (inFence) {
        out.push(line);
        if (closesFence(line, inFence)) inFence = null;
        return;
      }
      const fence = line.match(FENCE);
      if (fence) {
        flush();
        inFence = fence[1];
        out.push(line);
        return;
      }
      if (!line.trim()) {
        flush();
        inList = false; // a list may resume after the blank line; LIST_ITEM/indent rules catch that
        out.push(line);
        return;
      }
      // Indented lines that don't continue a paragraph are code or nested list content.
      const indentedBlock = INDENTED_CODE.test(line) && !para;
      if (LIST_ITEM.test(line)) inList = true;
      if (inList || indentedBlock || tableLines.has(i)
        || HEADING.test(line) || HTML_BLOCK.test(line) || RULE_OR_UNDERLINE.test(line)) {
        flush();
        out.push(line);
        return;
      }
      const quote = line.match(QUOTE);
      if (quote) {
        const inner = quote[2];
        // Quoted structure (lists, headings, tables, code) is kept line-for-line too.
        if (!inner.trim() || LIST_ITEM.test(inner) || HEADING.test(inner) || FENCE.test(inner)
          || hasPipe(inner) || RULE_OR_UNDERLINE.test(inner)) {
          flush();
          out.push(line);
        } else {
          addToPara(quote[1].replace(/\s*$/, ' '), inner);
        }
        return;
      }
      addToPara(line.match(/^\s*/)[0], line);
    });
    flush();
    return out.join('\n');
  }

  function closesFence(line, openFence) {
    const fence = line.match(FENCE);
    return Boolean(fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length
      && !line.slice(line.indexOf(fence[1]) + fence[1].length).trim());
  }

  // ---------- Format tables ----------

  const charLen = (s) => [...s].length;

  function hasPipe(line) {
    return /(^|[^\\])\|/.test(line);
  }

  /** Splits a table line into trimmed cells, honouring escaped pipes (\|). */
  function splitCells(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === '\\' && s[i + 1] === '|') {
        cur += '\\|';
        i += 1;
      } else if (s[i] === '|') {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += s[i];
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  /** Finds the first run of delimiter cells (---, :--, --:, :-:) in a row. */
  function findDelimiterRun(cells) {
    const start = cells.findIndex((c) => DELIM_CELL.test(c));
    if (start === -1) return null;
    let end = start;
    while (end < cells.length && DELIM_CELL.test(cells[end])) end += 1;
    return { start, count: end - start };
  }

  /**
   * A line holding several rows glued together looks like `a | b | | c | d`: groups of
   * `n` cells separated by one empty cell. Splits it back into rows when it fits that shape.
   */
  function splitMergedRows(cells, n) {
    const groups = (cells.length + 1) / (n + 1);
    if (cells.length > n && Number.isInteger(groups)) {
      const rows = [];
      for (let g = 0; g < groups; g += 1) {
        const start = g * (n + 1);
        if (g < groups - 1 && cells[start + n] !== '') return [cells];
        rows.push(cells.slice(start, start + n));
      }
      return rows;
    }
    return [cells];
  }

  function alignmentOf(delim) {
    const left = delim.startsWith(':');
    const right = delim.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'none';
  }

  function pad(text, width, align) {
    const gap = width - charLen(text);
    if (gap <= 0) return text;
    if (align === 'right') return ' '.repeat(gap) + text;
    if (align === 'center') {
      const before = Math.floor(gap / 2);
      return ' '.repeat(before) + text + ' '.repeat(gap - before);
    }
    return text + ' '.repeat(gap);
  }

  function delimiterCell(width, align) {
    const w = Math.max(width, 3);
    if (align === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (align === 'left') return `:${'-'.repeat(w - 1)}`;
    if (align === 'right') return `${'-'.repeat(w - 1)}:`;
    return '-'.repeat(w);
  }

  /**
   * Formats one run of consecutive pipe-containing lines. Returns the replacement lines,
   * or the original lines unchanged when the run isn't a recognizable table.
   */
  /**
   * Locates the table inside a run of pipe-containing lines. Returns the index of the header
   * line and the column count, or null when the run has no delimiter row (so isn't a table).
   */
  function locateTable(cellLines) {
    const delimLine = cellLines.findIndex((cells) => findDelimiterRun(cells));
    if (delimLine === -1) return null;
    const run = findDelimiterRun(cellLines[delimLine]);
    // Header is the line before a stand-alone delimiter row, or the same line when merged.
    const headerLine = run.start === 0 ? delimLine - 1 : delimLine;
    return headerLine < 0 ? null : { headerLine, columns: run.count };
  }

  /** Calls `onRun(startIndex, runLines)` for each run of pipe lines outside code fences. */
  function forEachPipeRun(lines, onLine, onRun) {
    let inFence = null;
    let start = -1;
    const flush = (end) => {
      if (start !== -1) onRun(start, lines.slice(start, end));
      start = -1;
    };
    lines.forEach((line, i) => {
      if (inFence) {
        if (closesFence(line, inFence)) inFence = null;
        onLine(line, i, false);
        return;
      }
      const fence = line.match(FENCE);
      if (fence) {
        flush(i);
        inFence = fence[1];
        onLine(line, i, false);
        return;
      }
      if (line.trim() && hasPipe(line)) {
        if (start === -1) start = i;
        onLine(line, i, true);
      } else {
        flush(i);
        onLine(line, i, false);
      }
    });
    flush(lines.length);
  }

  /** Indices of all lines that belong to a Markdown table. */
  function findTableLines(lines) {
    const result = new Set();
    forEachPipeRun(lines, () => {}, (start, run) => {
      const table = locateTable(run.map(splitCells));
      if (!table) return;
      for (let i = table.headerLine; i < run.length; i += 1) result.add(start + i);
    });
    return result;
  }

  function formatBlock(lines) {
    const cellLines = lines.map(splitCells);
    const table = locateTable(cellLines);
    if (!table) return lines;
    const { headerLine, columns: n } = table;

    const rows = [];
    for (let i = headerLine; i < cellLines.length; i += 1) {
      rows.push(...splitMergedRows(cellLines[i], n));
    }
    if (rows.length < 2 || !rows[1].length || !rows[1].every((c) => DELIM_CELL.test(c))) return lines;

    const columns = Math.max(...rows.map((r) => r.length));
    const aligns = [];
    for (let c = 0; c < columns; c += 1) aligns.push(alignmentOf(rows[1][c] || '---'));

    const widths = new Array(columns).fill(3);
    rows.forEach((row, r) => {
      if (r === 1) return;
      for (let c = 0; c < columns; c += 1) widths[c] = Math.max(widths[c], charLen(row[c] || ''));
    });

    const indent = lines[headerLine].match(/^\s*/)[0];
    const formatted = rows.map((row, r) => {
      const cells = [];
      for (let c = 0; c < columns; c += 1) {
        cells.push(r === 1 ? delimiterCell(widths[c], aligns[c]) : pad(row[c] || '', widths[c], aligns[c]));
      }
      return `${indent}| ${cells.join(' | ')} |`;
    });

    return [...lines.slice(0, headerLine), ...formatted];
  }

  /** Repairs and aligns every Markdown table in `text` (fenced code blocks are left alone). */
  function formatTables(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    // A run is reported before the line that ends it is visited, so `pending` only ever
    // holds lines that precede the run.
    const pending = [];
    forEachPipeRun(
      lines,
      (line, _i, inRun) => { if (!inRun) pending.push(line); },
      (_start, run) => out.push(...pending.splice(0), ...formatBlock(run)),
    );
    out.push(...pending);
    return out.join('\n');
  }

  // ---------- Shared: which lines are prose ----------

  // Inline spans whose text matters as written: changing them would break the Markdown.
  const PROTECTED_SPANS = [
    /(`+)[\s\S]*?\1(?!`)/g, // `code spans`
    /\]\([^)]*\)/g, // link / image destination and title: [text](URL "title")
    /<[^<>\n]+>/g, // HTML tags, comments and <autolinks>
    /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()]+/gi, // bare URLs
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail addresses
    /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, // entities (&nbsp; &#169;)
  ];
  const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S/;

  /** Sorted, non-overlapping [start, end) ranges of PROTECTED_SPANS in one line. */
  function protectedRanges(line) {
    const ranges = [];
    for (const pattern of PROTECTED_SPANS) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
        ranges.push([m.index, m.index + m[0].length]);
        if (!m[0].length) pattern.lastIndex += 1;
      }
    }
    ranges.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    return merged;
  }

  /** Applies `fn` to the parts of one line outside protected spans. */
  function mapUnprotected(line, fn) {
    let out = '';
    let pos = 0;
    for (const [start, end] of protectedRanges(line)) {
      out += fn(line.slice(pos, start)) + line.slice(start, end);
      pos = end;
    }
    return out + fn(line.slice(pos));
  }

  /**
   * Classifies each line: 'frontmatter' | 'code' | 'blank' | 'refdef' | 'table' | 'heading' |
   * 'list' | 'quote' | 'para'. Front matter (--- … --- at the very top) only counts for a whole
   * document: a selection starting with a --- rule isn't front matter.
   */
  function classifyLines(lines, { wholeDocument = false } = {}) {
    let start = 0;
    if (wholeDocument && lines[0] === '---') {
      const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
      if (end > 0) start = end + 1;
    }
    const tables = findTableLines(lines);
    let inFence = null;
    let prevBlank = true; // an indented line after a blank line (or at the start) is code...
    let inList = false; // ...unless it continues a list item
    return lines.map((line, i) => {
      if (i < start) return 'frontmatter';
      if (inFence) {
        if (closesFence(line, inFence)) inFence = null;
        return 'code';
      }
      const fence = line.match(FENCE);
      if (fence) {
        inFence = fence[1];
        return 'code';
      }
      if (!line.trim()) {
        prevBlank = true;
        return 'blank';
      }
      if (INDENTED_CODE.test(line) && prevBlank && !inList) return 'code';
      prevBlank = false;
      if (LIST_ITEM.test(line)) inList = true;
      else if (!INDENTED_CODE.test(line)) inList = false;
      if (tables.has(i)) return 'table';
      if (REFERENCE_DEFINITION.test(line)) return 'refdef';
      if (HEADING.test(line)) return 'heading';
      if (LIST_ITEM.test(line)) return 'list';
      if (QUOTE.test(line)) return 'quote';
      return 'para';
    });
  }

  const UNTOUCHABLE = new Set(['frontmatter', 'code', 'blank', 'refdef']);

  // ---------- Text format: UPPERCASE / lowercase / Title Case / Sentence case ----------

  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  // Not capitalized in Title Case unless first or last (Chicago-style short words).
  const SMALL_WORDS = new Set('a an and as at but by en for from if in into nor of off on onto or per so the to up via vs with yet'.split(' '));
  const capitalize = (w) => { const [first, ...rest] = w; return first.toUpperCase() + rest.join(''); };
  const hasInnerCapital = (w) => /\p{Lu}/u.test([...w].slice(1).join(''));

  function titleWord(word, { start, last, allCaps }) {
    const w = allCaps ? word.toLowerCase() : word;
    if (!start && !last && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
    if (!allCaps && /^\p{Ll}/u.test(w) && hasInnerCapital(w)) return w; // iPhone, eBay stay as-is
    return capitalize(w); // the rest of the word is kept: NASA, McDonald
  }

  function sentenceWord(word, { start, allCaps }) {
    let w = word;
    // Keep acronyms (NASA) and brand casing (iPhone) unless the whole line is shouting.
    if (allCaps || !hasInnerCapital(word)) w = word.toLowerCase();
    if (/^i(['’]|$)/.test(w)) w = `I${w.slice(1)}`;
    return start ? capitalize(w) : w;
  }

  /**
   * Re-cases each word of prose with wordFn(word, { start, last, allCaps }):
   *   start   – first word of a block or sentence (after . ! ? — and : in Title Case — or a table |)
   *   last    – last word of a block (heading, list item, paragraph, table cell row)
   *   allCaps – the line has no lowercase letters, or the word is in a run of 3+ ALL-CAPS words
 *             (shouting, not ACRONYMS): re-case it like any other word
   * With `markdown`, code, URLs, tags etc. are skipped (see classifyLines / PROTECTED_SPANS).
   */
  function recaseWords(text, wordFn, { wholeDocument = false, markdown = true, colonStarts = false } = {}) {
    const lines = text.split('\n');
    const types = markdown ? classifyLines(lines, { wholeDocument }) : lines.map((l) => (l.trim() ? 'para' : 'blank'));
    const sentenceEnd = colonStarts ? /[.!?:]['"”’)\]*_]*(\s|$)|\|/ : /[.!?]['"”’)\]*_]*(\s|$)|\|/;
    let start = true;
    return lines.map((line, i) => {
      const type = types[i];
      if (UNTOUCHABLE.has(type)) {
        if (type === 'blank') start = true;
        return line;
      }
      const prev = types[i - 1];
      const continues = (type === 'para' || type === 'quote') && prev === type;
      if (!continues) start = true;
      const next = types[i + 1];
      const endsBlock = !((next === 'para' && (type === 'para' || type === 'list')) || (next === 'quote' && type === 'quote'));

      const ranges = markdown ? protectedRanges(line) : [];
      const inRange = (a, b) => ranges.some(([s, e]) => a < e && b > s);
      const prose = ranges.reduce((acc, [s, e]) => acc.slice(0, s) + ' '.repeat(e - s) + acc.slice(e), line);
      const allCaps = !/\p{Ll}/u.test(prose) && (prose.match(/\p{Lu}/gu) || []).length >= 2;

      const words = [];
      WORD.lastIndex = 0;
      for (let m = WORD.exec(line); m; m = WORD.exec(line)) {
        if (!inRange(m.index, m.index + m[0].length)) words.push({ index: m.index, text: m[0] });
      }
      // Three or more ALL-CAPS words in a row are shouting, not acronyms: re-case them too.
      const isCaps = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t);
      const shouting = words.map(() => false);
      for (let k = 0; k < words.length;) {
        let end = k;
        while (end < words.length && isCaps(words[end].text)) end += 1;
        if (end - k >= 3) shouting.fill(true, k, end);
        k = Math.max(end, k + 1);
      }
      let out = '';
      let pos = 0;
      words.forEach((w, k) => {
        const gap = line.slice(pos, w.index);
        if (k > 0 || continues) {
          if (sentenceEnd.test(gap)) start = true;
        }
        // "Last" only if nothing but punctuation follows (not, say, a `code span`).
        const last = endsBlock && k === words.length - 1 && !/[\p{L}\p{N}]/u.test(line.slice(w.index + w.text.length));
        out += gap + wordFn(w.text, { start, last, allCaps: allCaps || shouting[k] });
        start = false;
        pos = w.index + w.text.length;
      });
      const tail = line.slice(pos);
      if (words.length && /[.!?]['"”’)\]*_]*\s*$/.test(tail)) start = true;
      return out + tail;
    }).join('\n');
  }

  /**
   * Changes the case of text: 'upper' | 'lower' | 'title' | 'sentence'. With `markdown` (the
   * default) everything whose case is meaningful is left alone: fenced and indented code, inline
   * code, link URLs, HTML tags, entities, reference definitions, and (with `wholeDocument`) YAML
   * front matter. Without it (code and data files) every word is changed.
   */
  function changeCase(text, mode, { wholeDocument = false, markdown = true } = {}) {
    if (mode === 'title') return recaseWords(text, titleWord, { wholeDocument, markdown, colonStarts: true });
    if (mode === 'sentence') return recaseWords(text, sentenceWord, { wholeDocument, markdown });
    const fn = mode === 'upper' ? (t) => t.toUpperCase() : (t) => t.toLowerCase();
    if (!markdown) return fn(text);
    const lines = text.split('\n');
    const types = classifyLines(lines, { wholeDocument });
    return lines.map((line, i) => (UNTOUCHABLE.has(types[i]) ? line : mapUnprotected(line, fn))).join('\n');
  }

  // ---------- Clean up pasted text ----------

  const BULLET = /^(\s*)[•◦▪▫●‣○■□►▸➢➤–—]\s+/;
  const INVISIBLE = /[​⁠﻿­]/g; // zero-width space, word joiner, BOM, soft hyphen
  const ODD_SPACES = /[     ]/g; // no-break, figure, thin and hair spaces

  /**
   * Fixes the usual mess in text pasted from PDFs, Word and e-mail, leaving code alone:
   *  - rejoins words hyphenated across a line break (exam-/ple → example)
   *  - turns •, ◦, ▪, – … bullets into Markdown list items
   *  - replaces no-break / thin spaces with normal spaces and drops invisible characters
   *  - collapses runs of spaces inside text (not indentation, tables or code)
   *  - removes trailing spaces (except a two-space Markdown line break) and extra blank lines
   */
  function cleanUpText(text, { wholeDocument = false } = {}) {
    const lines = text.split('\n');
    const types = classifyLines(lines, { wholeDocument });
    const keep = lines.map(() => true);
    const prose = (t) => t === 'para' || t === 'list' || t === 'quote';

    // Rejoin words hyphenated across a line break: "exam-" + "ple next" → "example" + "next".
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (!prose(types[i]) || types[i + 1] !== 'para' || !keep[i + 1]) continue;
      const end = lines[i].replace(/\s+$/, '');
      const next = lines[i + 1].match(/^(\s*)(\p{Ll}[^\s]*)\s*(.*)$/u);
      if (!/\p{L}[-­]$/u.test(end) || !next) continue;
      lines[i] = end.slice(0, -1) + next[2];
      if (next[3]) lines[i + 1] = next[1] + next[3];
      else keep[i + 1] = false;
    }

    const out = [];
    let blankRun = 0;
    lines.forEach((raw, i) => {
      if (!keep[i]) return;
      const type = types[i];
      if (type === 'code' || type === 'frontmatter') {
        blankRun = 0;
        out.push(raw);
        return;
      }
      let line = raw.replace(ODD_SPACES, ' ').replace(INVISIBLE, '');
      // Trailing whitespace goes, except exactly two spaces: that's a Markdown line break.
      const trailing = line.match(/[ \t]*$/)[0];
      line = line.slice(0, line.length - trailing.length);
      const hardBreak = trailing === '  ' && line.trim() && types[i + 1] && prose(types[i + 1]);
      if (!line.trim()) {
        blankRun += 1;
        if (blankRun === 1) out.push('');
        return;
      }
      blankRun = 0;
      if (prose(type) || type === 'heading') {
        line = line.replace(BULLET, '$1- ');
        const indent = line.match(/^\s*/)[0];
        line = indent + mapUnprotected(line.slice(indent.length), (t) => t.replace(/ {2,}/g, ' '));
      }
      out.push(hardBreak ? `${line}  ` : line);
    });
    return out.join('\n');
  }

  // ---------- Convert to table ----------

  /** Splits rows by `delimiter`: '\t', ',', ';' (CSV-style quoting) or 'spaces' (2+ spaces). */
  function splitRows(text, delimiter) {
    if (delimiter === 'spaces') {
      return text.split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\s{2,}|\t/));
    }
    return parseDelimited(text, delimiter, { quotes: delimiter !== '\t' }).map((r) => r.cells);
  }

  /**
   * Turns rows pasted from a spreadsheet, CSV or a PDF (tab-, comma-, semicolon- or
   * multi-space-separated) into an aligned Markdown table, first row as the header. The
   * delimiter is whichever gives the most rows with the same number of columns.
   * Returns the text unchanged if it doesn't look like rows and columns.
   */
  function toTable(text) {
    let best = null;
    for (const delimiter of ['\t', ',', ';', 'spaces']) {
      const rows = splitRows(text, delimiter);
      const counts = new Map();
      for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1);
      const [columns, score] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [0, 0];
      if (columns > 1 && score > (best?.score ?? 0)) best = { rows, columns, score };
    }
    if (!best || best.rows.length < 2) return text;
    const columns = Math.max(...best.rows.map((r) => r.length));
    const cell = (c) => (c ?? '').trim().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const row = (r) => `| ${Array.from({ length: columns }, (_, k) => cell(r[k])).join(' | ')} |`;
    const [header, ...body] = best.rows;
    const table = [row(header), `| ${Array(columns).fill('---').join(' | ')} |`, ...body.map(row)];
    return formatTables(table.join('\n'));
  }

  const api = {
    removeNewlines, formatTables, changeCase, cleanUpText, toTable,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarkdownTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
