/**
 * Line endings and indentation of a text file. Shared by the main process (require) and the
 * renderer (classic <script>, window.TextFormat).
 *
 * The editor is a <textarea>, which turns every \r\n into \n. To avoid silently rewriting a
 * Windows file's line endings on save, main normalizes to \n when reading, remembers the file's
 * line ending, and puts it back when writing.
 */
(function (root) {
  /** '\r\n' if most line breaks are CRLF, otherwise '\n'. */
  function detectLineEnding(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const lf = (text.match(/\n/g) || []).length - crlf;
    return crlf > lf ? '\r\n' : '\n';
  }

  /** Text with \n line breaks (CRLF and lone CR both become \n), as the textarea holds it. */
  const normalizeLineEndings = (text) => text.replace(/\r\n?/g, '\n');

  /** Converts \n-only text to the given line ending for writing. */
  const withLineEnding = (text, eol) => (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text);

  /** 'tab' if more lines are indented with tabs than with spaces, otherwise 'spaces'. */
  function detectIndent(text) {
    let tabs = 0;
    let spaces = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('\t')) tabs += 1;
      else if (line.startsWith('  ')) spaces += 1;
    }
    return tabs > spaces ? 'tab' : 'spaces';
  }

  const api = { detectLineEnding, normalizeLineEndings, withLineEnding, detectIndent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
