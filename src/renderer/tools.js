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

  // ---------- Bold / italic (Cmd+B / Cmd+I in the editor) ----------

  // Line-start Markdown that must stay outside the markers: "- **item**", not "**- item**".
  const LINE_PREFIX = /^\s*(?:(?:#{1,6}|>|[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)*/;

  const runLength = (text, from, step, ch) => {
    let n = 0;
    for (let i = from; i >= 0 && i < text.length && text[i] === ch; i += step) n += 1;
    return n;
  };
  // marker: what's written; chars: marker characters that count when unwrapping;
  // has(len): a run of that many marker characters contains the style (*** = bold + italic).
  const INLINE_STYLES = {
    bold: { marker: '**', chars: ['*', '_'], has: (len) => len >= 2 },
    italic: { marker: '*', chars: ['*', '_'], has: (len) => len % 2 === 1 },
    strike: { marker: '~~', chars: ['~'], has: (len) => len >= 2 },
    code: { marker: '`', chars: ['`'], has: (len) => len >= 1 },
  };
  const hasStyle = (len, style) => INLINE_STYLES[style].has(len);

  /**
   * Toggles bold, italic, strike(through) or (inline) code on text[start, end). Returns
   * { text, start, end } with the new selection. Unwraps when the selection is already wrapped
   * (markers just outside or just inside it; `_` counts for bold/italic too); otherwise wraps each
   * selected line, keeping spaces and line-start markers (list bullets, `#`, `>`) outside.
   * No selection: inserts an empty pair, cursor inside.
   */
  function toggleInline(text, start, end, style) {
    const { marker, chars } = INLINE_STYLES[style];
    const m = marker.length;
    if (start === end) {
      return { text: text.slice(0, start) + marker + marker + text.slice(end), start: start + m, end: start + m };
    }
    for (const ch of chars) {
      // Markers just outside the selection.
      const before = runLength(text, start - 1, -1, ch);
      const after = runLength(text, end, 1, ch);
      if (hasStyle(before, style) && hasStyle(after, style) && !text.slice(start, end).includes('\n')) {
        return { text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m), start: start - m, end: end - m };
      }
      // Markers just inside it.
      const sel = text.slice(start, end);
      const open = runLength(sel, 0, 1, ch);
      const close = runLength(sel, sel.length - 1, -1, ch);
      if (sel.length >= 2 * m + 1 && open < sel.length && hasStyle(open, style) && hasStyle(close, style) && !sel.includes('\n')) {
        return { text: text.slice(0, start) + sel.slice(m, sel.length - m) + text.slice(end), start, end: end - 2 * m };
      }
    }
    // Wrap (or, if every selected line is already wrapped, unwrap) line by line.
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const segments = text.slice(start, end).split('\n').map((seg, i) => {
      const prefix = i > 0 || start === lineStart ? seg.match(LINE_PREFIX)[0] : seg.match(/^\s*/)[0];
      const rest = seg.slice(prefix.length);
      const trail = rest.match(/\s*$/)[0];
      return { prefix, core: rest.slice(0, rest.length - trail.length), trail };
    });
    const filled = segments.filter((s) => s.core);
    const wrapped = (core) => core.length > 2 * m
      && hasStyle(runLength(core, 0, 1, core[0]), style) && hasStyle(runLength(core, core.length - 1, -1, core[0]), style)
      && chars.includes(core[0]) && core[core.length - 1] === core[0];
    const unwrap = filled.length > 0 && filled.every((s) => wrapped(s.core));
    const out = segments.map(({ prefix, core, trail }) => {
      if (!core) return prefix + trail;
      return prefix + (unwrap ? core.slice(m, core.length - m) : marker + core + marker) + trail;
    }).join('\n');
    const result = text.slice(0, start) + out + text.slice(end);
    if (segments.length === 1 && segments[0].core) {
      // One line: select the text between the markers, so pressing the shortcut again undoes it.
      const s = start + segments[0].prefix.length + (unwrap ? 0 : m);
      const len = unwrap ? segments[0].core.length - 2 * m : segments[0].core.length;
      return { text: result, start: s, end: s + len };
    }
    return { text: result, start, end: start + out.length };
  }
  const toggleEmphasis = toggleInline; // (bold / italic: the original name)

  const lineIndexAt = (text, pos) => text.slice(0, pos).split('\n').length - 1;
  const lineOffset = (lines, i) => lines.slice(0, i).join('\n').length + (i ? 1 : 0);

  // Spans per style, for the menu's checkmarks (a heuristic; *** counts as bold only).
  const INLINE_SPANS = {
    bold: /(\*\*|__)(?=\S)(.*?\S)\1/g,
    italic: /(?<![*_\w])([*_])(?![*_\s])(.*?[^\s*_])\1(?![*_\w])/g,
    strike: /(~~)(?=\S)(.*?\S)~~/g,
    code: /(`+)(.+?)\1(?!`)/g,
  };

  /** Which inline styles cover text[start, end) (both on one line). */
  function inlineStylesAt(text, start, end) {
    const result = { bold: false, italic: false, strike: false, code: false };
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = text.length;
    if (end > lineEnd) return result;
    const line = text.slice(lineStart, lineEnd);
    for (const [style, re] of Object.entries(INLINE_SPANS)) {
      for (const match of line.matchAll(re)) {
        const open = lineStart + match.index + match[1].length;
        const close = lineStart + match.index + match[0].length - match[1].length;
        if (open <= start && end <= close) result[style] = true;
      }
    }
    return result;
  }

  /** [open, close] line indices of each fenced code block (close = last line if unclosed). */
  function fencedBlocks(lines) {
    const blocks = [];
    let open = -1;
    let fence = null;
    lines.forEach((line, i) => {
      if (fence) {
        if (closesFence(line, fence)) { blocks.push([open, i]); fence = null; }
        return;
      }
      const m = line.match(FENCE);
      if (m) { fence = m[1]; open = i; }
    });
    if (fence) blocks.push([open, lines.length - 1]);
    return blocks;
  }

  /** The paragraph type of the line `pos` is on: p, h1–h3, ul, ol, blockquote, pre, table. */
  function blockTypeAt(text, pos) {
    const lines = text.split('\n');
    const i = lineIndexAt(text, pos);
    const kind = classifyLines(lines)[i];
    const line = lines[i];
    if (kind === 'code') return 'pre';
    if (kind === 'table') return 'table';
    if (kind === 'heading') return `h${Math.min(3, line.match(/#+/)[0].length)}`;
    if (kind === 'list') return /^\s*\d/.test(line) ? 'ol' : 'ul';
    if (kind === 'quote') return 'blockquote';
    return 'p';
  }

  const BLOCK_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/;
  const stripBlockPrefix = (line) => {
    let out = line;
    while (BLOCK_PREFIX.test(out) && out.replace(BLOCK_PREFIX, '') !== out) out = out.replace(BLOCK_PREFIX, '');
    return out;
  };

  /**
   * Makes the selected lines (no selection: the paragraph or line at the cursor) one paragraph
   * type: 'p' (plain text), 'h1'–'h3', 'ul', 'ol', 'blockquote' or 'pre' (fenced code). Picking
   * the type they already have turns it back into plain text. Returns { text, start, end }.
   */
  function setBlockType(text, start, end, type) {
    const lines = text.split('\n');
    let first = lineIndexAt(text, start);
    let last = lineIndexAt(text, end > start && text[end - 1] === '\n' ? end - 1 : end);
    const kinds = classifyLines(lines);
    const current = blockTypeAt(text, start);
    const fence = fencedBlocks(lines).find(([a, b]) => a <= first && first <= b);
    let content;
    if (fence) {
      first = fence[0];
      last = Math.max(last, fence[1]);
      content = lines.slice(first + 1, fence[1]).concat(lines.slice(fence[1] + 1, last + 1));
    } else {
      if (start === end && kinds[first] === 'para') { // the whole paragraph around the cursor
        while (first > 0 && kinds[first - 1] === 'para') first -= 1;
        while (last < lines.length - 1 && kinds[last + 1] === 'para') last += 1;
      }
      content = lines.slice(first, last + 1).map(stripBlockPrefix);
    }
    const target = type === current && type !== 'p' ? 'p' : type;
    const filled = content.filter((l) => l.trim());
    let out;
    let number = 0;
    switch (target) {
      case 'h1': case 'h2': case 'h3':
        out = [`${'#'.repeat(Number(target[1]))} ${filled.map((l) => l.trim()).join(' ')}`];
        break;
      case 'ul': out = content.map((l) => (l.trim() ? `- ${l.trim()}` : l)); break;
      case 'ol': out = content.map((l) => (l.trim() ? `${(number += 1)}. ${l.trim()}` : l)); break;
      case 'blockquote': out = content.map((l) => (l.trim() ? `> ${l}` : '>')); break;
      case 'pre': out = ['```', ...content, '```']; break;
      default: out = content;
    }
    const from = lineOffset(lines, first);
    const to = lineOffset(lines, last) + lines[last].length;
    const block = out.join('\n');
    const result = text.slice(0, from) + block + text.slice(to);
    return start === end
      ? { text: result, start: from + block.length, end: from + block.length }
      : { text: result, start: from, end: from + block.length };
  }

  // ---------- Tables in the editor (insert / delete rows and columns, column alignment) ----------

  /** The table around `pos`: line range, cells, alignments, and the cursor's row and column. */
  function tableAt(text, pos) {
    const lines = text.split('\n');
    const row = lineIndexAt(text, pos);
    const tableLines = findTableLines(lines);
    if (!tableLines.has(row)) return null;
    let first = row;
    while (tableLines.has(first - 1)) first -= 1;
    let last = row;
    while (tableLines.has(last + 1)) last += 1;
    const cells = lines.slice(first, last + 1).map(splitCells);
    const columns = Math.max(...cells.map((r) => r.length));
    const aligns = [];
    for (let c = 0; c < columns; c += 1) aligns.push(alignmentOf(cells[1][c] || '---'));
    const rows = [cells[0], ...cells.slice(2)].map((r) => Array.from({ length: columns }, (_, c) => r[c] ?? ''));
    // Column: unescaped pipes before the cursor on its line.
    const line = lines[row];
    const col = pos - lineOffset(lines, row);
    let pipes = 0;
    for (let i = 0; i < col; i += 1) if (line[i] === '|' && line[i - 1] !== '\\') pipes += 1;
    const leading = line.trim().startsWith('|') ? 1 : 0;
    const column = Math.max(0, Math.min(columns - 1, pipes - leading));
    const r = row - first;
    return {
      first, last, rows, aligns, column,
      row: r <= 1 ? 0 : r - 1, // 0 = header (also when on the --- line)
      indent: lines[first].match(/^\s*/)[0],
      align: aligns[column] === 'none' ? '' : aligns[column],
      header: r <= 1,
    };
  }

  /** Where the text of cell `column` ends in a table line (just inside an empty cell). */
  function cellEnd(line, column) {
    const pipes = [];
    for (let i = 0; i < line.length; i += 1) if (line[i] === '|' && line[i - 1] !== '\\') pipes.push(i);
    const leading = line.trim().startsWith('|') ? 1 : 0;
    const open = column + leading - 1 >= 0 ? pipes[column + leading - 1] : -1;
    const close = pipes[column + leading] ?? line.length;
    let end = close;
    while (end > open + 1 && line[end - 1] === ' ') end -= 1;
    return end === open + 1 ? Math.min(open + 2, close) : end;
  }

  /**
   * Table commands at the cursor: 'table-row-above' | 'table-row-below' | 'table-col-left' |
   * 'table-col-right' | 'table-delete-row' | 'table-delete-col' | 'table-delete' |
   * 'table-align-left' | 'table-align-center' | 'table-align-right' (again = no alignment).
   * The table is rewritten aligned. Returns { text, start, end } or null when not in a table.
   */
  function tableEdit(text, pos, command) {
    const t = tableAt(text, pos);
    if (!t) return null;
    const lines = text.split('\n');
    const { rows, aligns } = t;
    let { row, column } = t;
    const columns = aligns.length;
    const empty = () => Array(columns).fill('');
    let removeTable = false;
    switch (command) {
      case 'table-row-above': rows.splice(row, 0, empty()); break; // above the header: new header
      case 'table-row-below': rows.splice(row + 1, 0, empty()); row += 1; break;
      case 'table-col-left':
      case 'table-col-right': {
        const at = command === 'table-col-left' ? column : column + 1;
        for (const r of rows) r.splice(at, 0, '');
        aligns.splice(at, 0, 'none');
        column = at;
        break;
      }
      case 'table-delete-row':
        if (rows.length === 1) removeTable = true;
        else { rows.splice(row, 1); row = Math.min(row, rows.length - 1); }
        break;
      case 'table-delete-col':
        if (columns === 1) removeTable = true;
        else {
          for (const r of rows) r.splice(column, 1);
          aligns.splice(column, 1);
          column = Math.min(column, aligns.length - 1);
        }
        break;
      case 'table-delete': removeTable = true; break;
      case 'table-align-left':
      case 'table-align-center':
      case 'table-align-right': {
        const want = command.slice('table-align-'.length);
        aligns[column] = aligns[column] === want ? 'none' : want;
        break;
      }
      default: return null;
    }
    const from = lineOffset(lines, t.first);
    const to = lineOffset(lines, t.last) + lines[t.last].length;
    if (removeTable) {
      const out = lines.slice();
      let at = t.first;
      let count = t.last - t.first + 1;
      // Between two blank lines (or a blank line and the end): take one blank line with it.
      if (at > 0 && !out[at - 1].trim() && (t.last + 1 >= out.length || !out[t.last + 1].trim())) {
        at -= 1;
        count += 1;
      }
      out.splice(at, count);
      const caret = lineOffset(out, Math.min(at, out.length - 1));
      return { text: out.join('\n'), start: caret, end: caret };
    }
    const delim = aligns.map((a) => ({ left: ':--', center: ':-:', right: '--:' }[a] || '---'));
    const raw = [rows[0], delim, ...rows.slice(1)].map((r) => `${t.indent}| ${r.join(' | ')} |`);
    const table = formatTables(raw.join('\n'));
    const result = text.slice(0, from) + table + text.slice(to);
    const tableLinesOut = table.split('\n');
    const lineNo = row === 0 ? 0 : row + 1;
    const caret = from + lineOffset(tableLinesOut, lineNo) + cellEnd(tableLinesOut[lineNo], column);
    return { text: result, start: caret, end: caret };
  }

  /**
   * Inserts a new table (a "Column 1 … Column n" header and `rows` empty rows) on the blank line
   * at `pos`, or after the paragraph / block the cursor is in, with blank lines around it.
   * Returns { text, start, end } with "Column 1" selected, ready to be typed over.
   */
  function insertTable(text, pos, columns = 3, rows = 2) {
    const header = Array.from({ length: columns }, (_, c) => `Column ${c + 1}`);
    const table = formatTables([
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...Array.from({ length: rows }, () => `| ${header.map(() => '').join(' | ')} |`),
    ].join('\n'));
    const lines = text.split('\n');
    let i = lineIndexAt(text, pos);
    if (lines[i].trim()) { // after the block the cursor is in
      while (i < lines.length - 1 && lines[i + 1].trim()) i += 1;
      lines.splice(i + 1, 0, '', table);
      i += 2;
    } else {
      lines[i] = table;
      if (i > 0 && lines[i - 1].trim()) { lines.splice(i, 0, ''); i += 1; }
    }
    if (i < lines.length - 1 && lines[i + 1].trim()) lines.splice(i + 1, 0, ''); // a blank line after
    const start = lineOffset(lines, i) + 2; // "| " → Column 1
    return { text: lines.join('\n'), start, end: start + 'Column 1'.length };
  }

  // ---------- CSV / TSV ↔ Markdown tables ----------

  /** A CSV / TSV (first row = header) as an aligned Markdown table ('' if it's empty). */
  function delimitedToMarkdown(text, delimiter) {
    const rows = parseDelimited(text, delimiter);
    if (!rows.length) return '';
    const columns = Math.max(...rows.map((r) => r.cells.length));
    const cell = (c) => (c ?? '').trim().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const line = (r) => `| ${Array.from({ length: columns }, (_, k) => cell(r.cells[k])).join(' | ')} |`;
    return formatTables([line(rows[0]), `| ${Array(columns).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'));
  }

  /** A Markdown table cell's plain text: no emphasis / code / link markup, escapes undone. */
  function markdownCellText(cell) {
    return cell
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // ![alt](src) → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
      .replace(/(`+)(.+?)\1/g, '$2')
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
      .replace(/(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])/g, '$2')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1');
  }

  /** The Markdown table around `pos` as CSV text (plain cell text), or null if not in a table. */
  function markdownTableToCsv(text, pos) {
    const t = tableAt(text, pos);
    if (!t) return null;
    const field = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    return `${t.rows.map((r) => r.map((c) => field(markdownCellText(c))).join(',')).join('\n')}\n`;
  }

  // ---------- Typing in lists: Enter continues a list, Tab / Shift+Tab nest ----------

  // Optional quote markers, indentation, a list marker, spaces, an optional task box.
  const LIST_LINE = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
  const QUOTE_LINE = /^(?:[ \t]*>[ \t]?)+/;

  /**
   * Enter at text[start, end) in Markdown. In a list item: a new item with the same marker
   * (numbers count up, a task item starts unticked), taking the text after the cursor along. In
   * an empty item: removes the marker (ends the list; an enclosing quote stays). In a quote:
   * continues it; an empty quote line ends it. Returns { text, start, end }, or null where Enter
   * should just insert a newline (not a list or quote, cursor inside the marker, code blocks).
   */
  function continueList(text, start, end) {
    const base = text.slice(0, start) + text.slice(end);
    const lines = base.split('\n');
    const i = lineIndexAt(base, start);
    if (classifyLines(lines)[i] === 'code') return null;
    const line = lines[i];
    const lineStart = lineOffset(lines, i);
    const list = line.match(LIST_LINE);
    const quote = !list && line.match(QUOTE_LINE);
    if (!list && !quote) return null;
    const prefix = (list || quote)[0];
    if (start - lineStart < prefix.length) return null; // cursor in the marker: a plain newline
    if (!line.slice(prefix.length).trim()) {
      // An empty item / quote line: end the list (or quote) here.
      const rest = list ? list[1] : '';
      const out = base.slice(0, lineStart) + rest + base.slice(lineStart + line.length);
      const at = lineStart + rest.length;
      return { text: out, start: at, end: at };
    }
    let next = quote ? prefix : '';
    if (list) {
      const marker = list[3] || `${Number(list[4]) + 1}${list[5]}`;
      next = list[1] + list[2] + marker + list[6] + (list[7] ? '[ ] ' : '');
    }
    // Splitting "- buy |milk": no trailing space on the first item, no leading one on the new one.
    let before = base.slice(0, start);
    if (start - lineStart > prefix.length) before = before.replace(/[ \t]+$/, '');
    const after = base.slice(start).replace(/^[ \t]+/, '');
    const at = before.length + 1 + next.length;
    const out = `${before}\n${next}${after}`;
    if (!list || !list[4]) return { text: out, start: at, end: at };
    // A numbered item: renumber the items after it (inserting "3." before "3. c" makes it "4.").
    const r = renumberList(out, i + 1);
    return { text: r.text, start: r.map(at), end: r.map(at) };
  }

  const leadOf = (line) => line.match(/^[ \t]*/)[0];

  /** Is there a list item with indentation `lead` above line i, in the same list? */
  function hasItemAbove(lines, i, lead) {
    for (let j = i - 1; j >= 0; j -= 1) {
      const l = lines[j];
      if (!l.trim() || leadOf(l).length > lead.length) continue; // blank or nested: same list
      const m = l.match(LIST_LINE);
      return !!(m && !m[1] && m[2] === lead);
    }
    return false;
  }

  /**
   * Renumbers the numbered list that line `index` belongs to (items at the same indent, with
   * nested lines and blank lines between them), counting up from its first item's number (or
   * from `start`).
   * Returns { text, map } where map(pos) moves a position in `text` past numbers that got wider
   * or narrower. Lists inside quotes are left alone.
   */
  function renumberList(text, index, start) {
    const identity = { text, map: (pos) => pos };
    const lines = text.split('\n');
    const m = (lines[index] || '').match(LIST_LINE);
    if (!m || !m[4] || m[1]) return identity;
    const lead = m[2];
    const isItem = (l) => { const x = l.match(LIST_LINE); return !!(x && x[4] && !x[1] && x[2] === lead); };
    const inside = (l) => !l.trim() || leadOf(l).length > lead.length;
    let first = index;
    for (let j = index - 1; j >= 0; j -= 1) {
      if (isItem(lines[j])) first = j;
      else if (!inside(lines[j])) break;
    }
    let last = index;
    for (let j = index + 1; j < lines.length; j += 1) {
      if (isItem(lines[j])) last = j;
      else if (!inside(lines[j])) break;
    }
    const starts = []; // each line's offset in the original text
    let offset = 0;
    for (const l of lines) { starts.push(offset); offset += l.length + 1; }
    const changes = []; // [offset of a number in the original text, its length change]
    let number = start ?? Number(lines[first].match(LIST_LINE)[4]);
    for (let j = first; j <= last; j += 1) {
      if (!isItem(lines[j])) continue;
      const old = lines[j].match(LIST_LINE)[4];
      const now = String(number);
      number += 1;
      if (old === now) continue;
      changes.push([starts[j] + lead.length, now.length - old.length]);
      lines[j] = lead + now + lines[j].slice(lead.length + old.length);
    }
    if (!changes.length) return identity;
    return {
      text: lines.join('\n'),
      map: (pos) => changes.reduce((p, [at, delta]) => (at < pos ? p + delta : p), pos),
    };
  }

  /**
   * The indentation a list item at line i gets when nested one level deeper: under the text of
   * the item above it at the same level ("1. " nests by 3), or one `unit` more.
   */
  function nestedLead(lines, i, unit) {
    const lead = leadOf(lines[i]);
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!lines[j].trim()) continue;
      const m = lines[j].match(LIST_LINE);
      if (!m || m[1]) break; // (items inside quotes: keep it simple)
      if (m[2].length === lead.length) {
        return unit === '\t' ? `${lead}\t` : lead + ' '.repeat(m[0].length - m[2].length - (m[7] || '').length);
      }
      if (m[2].length < lead.length) break;
    }
    return lead + unit;
  }

  /** The indentation of the item a nested list item at line i belongs to ('' at the top level). */
  function parentLead(lines, i) {
    const lead = leadOf(lines[i]).length;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!lines[j].trim()) continue;
      const m = lines[j].match(LIST_LINE);
      if (!m || m[1]) break;
      if (m[2].length < lead) return m[2];
    }
    return '';
  }

  /**
   * Tab (outdent = false) / Shift+Tab (outdent = true) at text[start, end). A Markdown list item
   * (cursor anywhere on it; only with `lists`) is nested one level deeper / brought up a level;
   * several selected lines are all indented / outdented by the same amount. Returns
   * { text, start, end }, or null for a plain Tab on an ordinary line (the caller inserts an
   * indent at the cursor).
   */
  function indentLines(text, start, end, unit, outdent = false, { lists = true } = {}) {
    const lines = text.split('\n');
    const first = lineIndexAt(text, start);
    const last = lineIndexAt(text, end > start && text[end - 1] === '\n' ? end - 1 : end);
    const isList = lists && LIST_ITEM.test(lines[first]);
    if (first === last && !isList && !outdent) return null;
    // The change is worked out on the first line and applied to every selected line alike.
    const lead = leadOf(lines[first]);
    let add = '';
    let remove = 0;
    if (!outdent) {
      add = isList ? nestedLead(lines, first, unit).slice(lead.length) : unit;
    } else if (isList) {
      remove = lead.length - parentLead(lines, first).length;
    } else {
      remove = lead.startsWith('\t') ? 1 : Math.min(lead.length, unit === '\t' ? 4 : unit.length);
    }
    const selectedFromLineStart = start !== end && start === lineOffset(lines, first);
    let newStart = start;
    let newEnd = end;
    for (let i = first; i <= last; i += 1) {
      if (!lines[i].trim() && first !== last) continue;
      const before = lines[i];
      const cut = Math.min(remove, leadOf(before).length);
      lines[i] = add + before.slice(cut);
      const delta = lines[i].length - before.length;
      const lineStart = lineOffset(lines, i);
      // A selection that began at the start of the line still does (it takes in the new indent).
      if (i === first) newStart = selectedFromLineStart ? lineStart : Math.max(lineStart, start + delta);
      newEnd += delta;
    }
    if (start === end) newEnd = newStart;
    let result = { text: lines.join('\n'), start: newStart, end: Math.max(newStart, newEnd) };
    if (isList) {
      // Renumber both numbered lists involved: the level the item joined (starting at 1 if it's
      // the first item there) and the level it left (whose next item takes over the moved item's
      // number if the moved item was the first).
      const renumber = (index, from) => {
        const r = renumberList(result.text, index, from);
        result = { text: r.text, start: r.map(result.start), end: r.map(result.end) };
      };
      const original = text.split('\n');
      const moved = original[first].match(LIST_LINE);
      const leftFirst = !hasItemAbove(original, first, lead);
      const now = result.text.split('\n');
      renumber(first, hasItemAbove(now, first, leadOf(now[first])) ? undefined : 1);
      const isOldLevelItem = (l) => { const x = l.match(LIST_LINE); return !!(x && x[4] && !x[1] && x[2] === lead); };
      const after = result.text.split('\n');
      const near = [...after.keys()].filter((k) => k > last).concat([...after.keys()].filter((k) => k < first).reverse())
        .find((k) => isOldLevelItem(after[k]));
      if (near !== undefined) renumber(near, near > last && leftFirst && moved?.[4] ? Number(moved[4]) : undefined);
    }
    return result;
  }

  const api = {
    removeNewlines, formatTables, changeCase, cleanUpText, toTable, toggleEmphasis, toggleInline,
    inlineStylesAt, blockTypeAt, setBlockType, tableAt, tableEdit, insertTable, continueList, indentLines,
    delimitedToMarkdown, markdownTableToCsv,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarkdownTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
