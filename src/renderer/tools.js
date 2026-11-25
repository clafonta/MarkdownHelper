/**
 * Pure text transforms used by the editor toolbar. No DOM access, so they can be unit-tested in Node.
 */
(function (root) {
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

  const api = { removeNewlines, formatTables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarkdownTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
