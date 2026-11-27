/**
 * Find & Replace in the editor: the pure part (no DOM), unit-tested in Node.
 *
 * findMatches(text, query, { matchCase, wholeWord }) → [[start, end], …] in text order (at most
 * MAX_MATCHES). Plain text, not a regular expression. Whole words: the match must not touch a
 * letter, digit or underscore on either side.
 * matchAfter(matches, pos, backwards) → the index of the next match starting at/after pos (or the
 * previous one ending at/before pos), wrapping around; -1 if there are none.
 * replaceMatches(text, matches, replacement) → the text with every match replaced.
 */
(function (root) {
  const MAX_MATCHES = 10000;
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function findMatches(text, query, { matchCase = false, wholeWord = false } = {}) {
    if (!query) return [];
    const re = new RegExp(escapeRegExp(query), matchCase ? 'gu' : 'giu');
    const matches = [];
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (wholeWord && (WORD_CHAR.test(text[start - 1] || '') || WORD_CHAR.test(text[end] || ''))) continue;
      matches.push([start, end]);
      if (matches.length >= MAX_MATCHES) break;
    }
    return matches;
  }

  function matchAfter(matches, pos, backwards = false) {
    if (!matches.length) return -1;
    if (backwards) {
      for (let i = matches.length - 1; i >= 0; i -= 1) if (matches[i][1] <= pos) return i;
      return matches.length - 1;
    }
    const i = matches.findIndex(([start]) => start >= pos);
    return i === -1 ? 0 : i;
  }

  function replaceMatches(text, matches, replacement) {
    let out = '';
    let at = 0;
    for (const [start, end] of matches) {
      out += text.slice(at, start) + replacement;
      at = end;
    }
    return out + text.slice(at);
  }

  const api = { findMatches, matchAfter, replaceMatches, MAX_MATCHES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Find = api;
})(typeof window !== 'undefined' ? window : globalThis);
