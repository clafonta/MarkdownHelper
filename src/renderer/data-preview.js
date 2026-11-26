/**
 * Pure parsing for the CSV / TSV and JSON previews. No DOM access, so it can be unit-tested in Node.
 */
(function (root) {
  /**
   * Splits delimited text into rows: [{ cells: string[], line }] where `line` is the 0-based
   * source line the row starts on (used for synchronized scrolling).
   * With `quotes` (CSV), fields may be "quoted", contain the delimiter or line breaks, and
   * escape quotes as "". TSV has no quoting, so a " is just a character there.
   * Blank lines are skipped.
   */
  function parseDelimited(text, delimiter, { quotes = delimiter === ',' } = {}) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let fieldStarted = false; // a quoted empty field ("") still counts as a field
    let line = 0;
    let rowLine = 0;

    const endField = () => { row.push(field); field = ''; fieldStarted = false; };
    const endRow = () => {
      endField();
      if (!(row.length === 1 && row[0] === '')) rows.push({ cells: row, line: rowLine });
      row = [];
    };

    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
        } else {
          if (c === '\n') line += 1;
          field += c;
        }
      } else if (c === '"' && quotes && !field && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else if (c === delimiter) {
        endField();
      } else if (c === '\n') {
        endRow();
        line += 1;
        rowLine = line;
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field || fieldStarted || row.length) endRow();
    return rows;
  }

  /**
   * Re-indents valid JSON with 2 spaces, keeping every literal exactly as written
   * (JSON.stringify would round big numbers and rewrite 1.0 as 1).
   */
  function prettyJson(source) {
    let out = '';
    let indent = 0;
    let inString = false;
    let escaped = false;
    const newline = () => `\n${'  '.repeat(indent)}`;
    for (let i = 0; i < source.length; i += 1) {
      const c = source[i];
      if (inString) {
        out += c;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
        out += c;
      } else if (c === '{' || c === '[') {
        let j = i + 1;
        while (/\s/.test(source[j] || '')) j += 1;
        if (source[j] === (c === '{' ? '}' : ']')) { // empty {} / []
          out += c + source[j];
          i = j;
        } else {
          indent += 1;
          out += c + newline();
        }
      } else if (c === '}' || c === ']') {
        indent -= 1;
        out += newline() + c;
      } else if (c === ',') {
        out += `,${newline()}`;
      } else if (c === ':') {
        out += ': ';
      } else if (!/\s/.test(c)) {
        out += c;
      }
    }
    return out;
  }

  /**
   * Offset of the first syntax error in `s` (null if valid). Only used when V8's message doesn't
   * say where the problem is (e.g. "Unexpected token 'o', "nope" is not valid JSON").
   */
  function jsonErrorOffset(s) {
    let i = 0;
    const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    const fail = () => { throw i; };
    const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i += 1; };
    function string() {
      i += 1;
      while (i < s.length) {
        if (s[i] === '"') { i += 1; return; }
        if (s[i] < ' ') fail();
        i += s[i] === '\\' ? 2 : 1;
      }
      fail();
    }
    function value() {
      ws();
      const c = s[i];
      if (c === '{' || c === '[') {
        const close = c === '{' ? '}' : ']';
        i += 1;
        ws();
        if (s[i] === close) { i += 1; return; }
        for (;;) {
          if (c === '{') {
            ws();
            if (s[i] !== '"') fail();
            string();
            ws();
            if (s[i] !== ':') fail();
            i += 1;
          }
          value();
          ws();
          if (s[i] === ',') { i += 1; continue; }
          if (s[i] === close) { i += 1; return; }
          fail();
        }
      }
      if (c === '"') { string(); return; }
      NUMBER.lastIndex = i;
      const num = NUMBER.exec(s);
      if (num && num[0]) { i += num[0].length; return; }
      for (const literal of ['true', 'false', 'null']) {
        if (literal[0] !== c) continue;
        let k = 0;
        while (k < literal.length && s[i + k] === literal[k]) k += 1;
        i += k;
        if (k === literal.length) return;
        fail();
      }
      fail();
    }
    try {
      value();
      ws();
      if (i < s.length) fail();
      return null;
    } catch (offset) {
      if (typeof offset === 'number') return offset;
      throw offset;
    }
  }

  /**
   * { ok: true, pretty } for valid JSON (empty text counts as valid, with pretty ''),
   * otherwise { ok: false, message, line, column } with 1-based line/column.
   */
  function checkJson(source) {
    if (!source.trim()) return { ok: true, pretty: '' };
    try {
      JSON.parse(source);
      return { ok: true, pretty: prettyJson(source) };
    } catch (err) {
      const raw = String(err.message);
      const pos = raw.match(/at position (\d+)/);
      const offset = pos ? Number(pos[1]) : (jsonErrorOffset(source) ?? source.length);
      const before = source.slice(0, offset);
      const line = (before.match(/\n/g) || []).length + 1;
      const column = offset - (before.lastIndexOf('\n') + 1) + 1;
      const message = raw
        .replace(/^JSON\.parse: /, '')
        // V8 quotes the input ("nope" / ..."a", "b"...); we show the line and column instead.
        .replace(/,\s.*\bis not valid JSON$/s, '')
        .replace(/\s*(in JSON )?at position \d+.*$/s, '')
        .trim();
      return { ok: false, message, line, column };
    }
  }

  /**
   * Parses valid JSON (check with checkJson first) into a tree for the collapsible preview,
   * keeping every literal exactly as written. Nodes:
   *   { type: 'object', line, endLine, entries: [{ key, value }] }   key = the raw "quoted" key
   *   { type: 'array',  line, endLine, items: [node] }
   *   { type: 'string' | 'number' | 'boolean' | 'null', raw, line }
   * `line` / `endLine` are 0-based source lines of the value's first / closing character.
   */
  function parseJsonTree(source) {
    let i = 0;
    let line = 0;
    const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    const ws = () => {
      while (i < source.length && ' \t\n\r'.includes(source[i])) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
    };
    const string = () => {
      const start = i;
      i += 1;
      while (source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
      i += 1;
      return source.slice(start, i);
    };
    function value() {
      ws();
      const c = source[i];
      const at = line;
      if (c === '{' || c === '[') {
        const isObject = c === '{';
        const close = isObject ? '}' : ']';
        const children = [];
        i += 1;
        ws();
        while (source[i] !== close) {
          if (isObject) {
            const key = string();
            ws();
            i += 1; // :
            children.push({ key, value: value() });
          } else {
            children.push(value());
          }
          ws();
          if (source[i] === ',') { i += 1; ws(); }
        }
        const endLine = line;
        i += 1;
        return isObject
          ? { type: 'object', line: at, endLine, entries: children }
          : { type: 'array', line: at, endLine, items: children };
      }
      if (c === '"') return { type: 'string', raw: string(), line: at };
      for (const [literal, type] of [['true', 'boolean'], ['false', 'boolean'], ['null', 'null']]) {
        if (source.startsWith(literal, i)) { i += literal.length; return { type, raw: literal, line: at }; }
      }
      NUMBER.lastIndex = i;
      const raw = NUMBER.exec(source)[0];
      i += raw.length;
      return { type: 'number', raw, line: at };
    }
    return value();
  }

  const api = { parseDelimited, prettyJson, checkJson, jsonErrorOffset, parseJsonTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataPreview = api;
})(typeof window !== 'undefined' ? window : globalThis);
