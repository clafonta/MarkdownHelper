/**
 * Pure helpers for synchronized scrolling between the editor and the preview.
 * No DOM access, so they can be unit-tested in Node.
 *
 * The idea: each top-level preview block knows the source line it came from. Pairing that
 * line's pixel offset in the editor with the block's pixel offset in the preview gives a
 * list of anchor points; scroll positions between anchors are linearly interpolated.
 */
(function (root) {
  /** 0-based starting source line of each marked lexer token (from newlines in token.raw). */
  function tokenStartLines(tokens) {
    let line = 0;
    return tokens.map((token) => {
      const start = line;
      line += (token.raw.match(/\n/g) || []).length;
      return start;
    });
  }

  /**
   * Builds a strictly increasing list of [editorY, previewY] anchors, starting at [0, 0] and
   * ending at the two maximum scroll positions so the bottoms of both panes line up.
   * Anchors that would go backwards (or past the end) are dropped.
   */
  function createScrollMap(pairs, maxEditor, maxPreview) {
    const anchors = [[0, 0]];
    const sorted = pairs.slice().sort((x, y) => x[0] - y[0]);
    for (const [a, b] of sorted) {
      const [lastA, lastB] = anchors[anchors.length - 1];
      if (a > lastA && b > lastB && a < maxEditor && b < maxPreview) anchors.push([a, b]);
    }
    if (maxEditor > 0 && maxPreview > 0) anchors.push([maxEditor, maxPreview]);
    return anchors;
  }

  /**
   * Maps a scroll position from one side to the other.
   * `from` is 0 to map editor -> preview, 1 to map preview -> editor.
   */
  function interpolate(anchors, value, from) {
    const to = 1 - from;
    if (anchors.length < 2 || value <= anchors[0][from]) return anchors[0][to];
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const lo = anchors[i];
      const hi = anchors[i + 1];
      if (value <= hi[from]) {
        const span = hi[from] - lo[from];
        const t = span > 0 ? (value - lo[from]) / span : 0;
        return lo[to] + t * (hi[to] - lo[to]);
      }
    }
    return anchors[anchors.length - 1][to];
  }

  const api = { tokenStartLines, createScrollMap, interpolate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScrollMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
