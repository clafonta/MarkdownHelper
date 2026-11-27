/**
 * What to highlight in the editor after a preview format command (the "teaching" flash).
 *
 * changedRanges(oldText, newText) → [[start, end], …] offsets in newText of what was added,
 * without layout noise: runs that are only spaces or dashes (a table re-padding its columns)
 * are left out, so making a table cell bold lights up just the two `**`. Lines are matched
 * first (an inserted table row lights up as a whole line), then characters within changed
 * lines. Pure (no DOM), unit-tested in Node.
 */
(function (root) {
  const MAX_CELLS = 250000; // LCS table size limit; beyond it, fall back to one span

  /** Longest common subsequence of a and b (arrays or strings) as index pairs. */
  function lcs(a, b) {
    const n = a.length;
    const m = b.length;
    if (n * m > MAX_CELLS) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const pairs = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
    }
    return pairs;
  }

  const NOISE = /^[\s-]*$/;

  /** Ranges of characters added to `newLine` (relative offsets), noise left out. */
  function addedInLine(oldLine, newLine) {
    const pairs = lcs(oldLine, newLine);
    if (!pairs) return [[0, newLine.length]];
    const kept = new Uint8Array(newLine.length);
    for (const [, j] of pairs) kept[j] = 1;
    const out = [];
    for (let j = 0; j < newLine.length;) {
      if (kept[j]) { j += 1; continue; }
      const start = j;
      while (j < newLine.length && !kept[j]) j += 1;
      if (!NOISE.test(newLine.slice(start, j))) out.push([start, j]);
    }
    return out;
  }

  function changedRanges(oldText, newText) {
    if (oldText === newText) return [];
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    // Skip identical lines at both ends.
    let top = 0;
    while (top < oldLines.length && top < newLines.length && oldLines[top] === newLines[top]) top += 1;
    let bottom = 0;
    while (bottom < oldLines.length - top && bottom < newLines.length - top
      && oldLines[oldLines.length - 1 - bottom] === newLines[newLines.length - 1 - bottom]) bottom += 1;
    const oldMid = oldLines.slice(top, oldLines.length - bottom);
    const newMid = newLines.slice(top, newLines.length - bottom);

    const lineStart = [];
    let offset = 0;
    for (const line of newLines) { lineStart.push(offset); offset += line.length + 1; }
    const ranges = [];
    const wholeLine = (k) => { // k: index into newMid
      const s = lineStart[top + k];
      if (newMid[k].length && !NOISE.test(newMid[k])) ranges.push([s, s + newMid[k].length]);
    };
    const pairLines = (oldK, newK) => {
      for (const [a, b] of addedInLine(oldMid[oldK], newMid[newK])) ranges.push([lineStart[top + newK] + a, lineStart[top + newK] + b]);
    };

    const pairs = lcs(oldMid, newMid);
    if (!pairs) return [[lineStart[top], lineStart[top] + newMid.join('\n').length]];
    // Between matched lines: pair changed lines in order; extra new lines are additions.
    let i = 0;
    let j = 0;
    for (const [pi, pj] of [...pairs, [oldMid.length, newMid.length]]) {
      const oldGap = pi - i;
      const newGap = pj - j;
      for (let k = 0; k < newGap; k += 1) {
        if (k < oldGap) pairLines(i + k, j + k); else wholeLine(j + k);
      }
      i = pi + 1;
      j = pj + 1;
    }
    return ranges;
  }

  const api = { changedRanges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
