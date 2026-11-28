/**
 * Pure math for the diagram zoom view (window.ZoomView): fitting, zooming about a point and
 * keeping the picture in view while panning. No DOM access, so it can be unit-tested in Node.
 *
 * A view is { scale, x, y }: the content (natural size width × height) is drawn at `scale`, with
 * its top-left corner at (x, y) in the viewport.
 */
(function (root) {
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 8;
  const MAX_FIT = 2; // a small diagram isn't blown up beyond 2× to fill the window

  const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  /** The scale at which the content fits the viewport (minus `padding` on each side). */
  function fitScale(content, viewport, padding = 24) {
    const w = Math.max(1, viewport.width - 2 * padding);
    const h = Math.max(1, viewport.height - 2 * padding);
    return clampScale(Math.min(MAX_FIT, w / content.width, h / content.height));
  }

  /**
   * Keeps the content in view: along an axis where it's smaller than the viewport it's centered;
   * where it's larger, no empty space is left at either edge.
   */
  function clampPan(view, content, viewport) {
    const axis = (pos, size, room) => {
      if (size <= room) return (room - size) / 2;
      return Math.min(0, Math.max(room - size, pos));
    };
    return {
      scale: view.scale,
      x: axis(view.x, content.width * view.scale, viewport.width),
      y: axis(view.y, content.height * view.scale, viewport.height),
    };
  }

  /** The whole content, fitted and centered. */
  function fitView(content, viewport, padding) {
    return clampPan({ scale: fitScale(content, viewport, padding), x: 0, y: 0 }, content, viewport);
  }

  /** Changes the scale, keeping the content point under `point` (viewport coordinates) in place. */
  function zoomAt(view, scale, point, content, viewport) {
    const next = clampScale(scale);
    const ratio = next / view.scale;
    return clampPan({
      scale: next,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    }, content, viewport);
  }

  /** Moves the content by (dx, dy), within the limits of clampPan. */
  function panBy(view, dx, dy, content, viewport) {
    return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, content, viewport);
  }

  const api = { MIN_SCALE, MAX_SCALE, clampScale, fitScale, clampPan, fitView, zoomAt, panBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZoomView = api;
})(typeof window !== 'undefined' ? window : globalThis);
