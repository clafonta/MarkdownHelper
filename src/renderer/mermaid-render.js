/**
 * Mermaid diagrams for the preview (window.MermaidRender; DOM-dependent).
 *
 * - The 5 MB mermaid bundle (src/vendor/, copied by scripts/vendor.js) is only loaded the first
 *   time a diagram is shown.
 * - Diagrams render one at a time (mermaid uses a shared scratch element) and are cached by
 *   theme + source, so re-rendering the preview while typing elsewhere doesn't redraw them.
 * - Results are SVG strings meant for an <img> (data: URL): an image can't run scripts or leak
 *   styles into the app. securityLevel 'strict' and htmlLabels off keep the SVG plain (no HTML in
 *   <foreignObject>), which also lets Copy turn it into a PNG through a canvas.
 */
(function (root) {
  const SCRIPT = '../vendor/mermaid.min.js';
  const CACHE_LIMIT = 100;

  let loading = null;
  function load() {
    if (root.mermaid) return Promise.resolve(root.mermaid);
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.onload = () => resolve(root.mermaid);
      script.onerror = () => { loading = null; reject(new Error('The Mermaid library could not be loaded.')); };
      document.head.append(script);
    });
    return loading;
  }

  const cache = new Map(); // `${theme}\n${source}` → { svg, width, height } | { error }
  let queue = Promise.resolve();
  let counter = 0;
  let configuredTheme = null;

  /** Reads the diagram's natural size from its viewBox. */
  function sizeOf(svg) {
    const box = svg.match(/viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/);
    return box ? { width: Math.ceil(Number(box[1])), height: Math.ceil(Number(box[2])) } : { width: 600, height: 400 };
  }

  async function renderNow(mermaid, source, theme) {
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      });
      configuredTheme = theme;
    }
    const id = `mdh-mermaid-${(counter += 1)}`;
    try {
      await mermaid.parse(source); // throws a readable error; render() would also add an error SVG to the page
      const { svg } = await mermaid.render(id, source);
      return { svg, ...sizeOf(svg) };
    } catch (err) {
      const message = String(err?.message || err).trim();
      return { error: message || 'This diagram has a syntax error.' };
    } finally {
      // render() leaves scratch elements behind when it fails.
      for (const leftover of [document.getElementById(id), document.getElementById(`d${id}`)]) leftover?.remove();
    }
  }

  /** Resolves to { svg, width, height } or { error } for one diagram. Never rejects. */
  function render(source, theme = 'light') {
    const key = `${theme}\n${source}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const job = queue.then(async () => {
      if (cache.has(key)) return cache.get(key);
      let result;
      try {
        result = await renderNow(await load(), source, theme);
      } catch (err) {
        result = { error: String(err?.message || err) };
      }
      cache.set(key, result);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return result;
    });
    queue = job;
    return job;
  }

  /** The cached result, if this diagram was already rendered with this theme. */
  const cached = (source, theme = 'light') => cache.get(`${theme}\n${source}`) || null;

  const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  /** PNG data URL of an SVG (for pasting into apps that don't take SVG), at `scale`× size. */
  function toPng({ svg, width, height }, scale = 2) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // documents and e-mails are white; a transparent PNG can vanish
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL('image/png')); } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error('Could not convert the diagram to an image.'));
      img.src = svgUrl(svg);
    });
  }

  root.MermaidRender = { render, cached, svgUrl, toPng };
})(window);
