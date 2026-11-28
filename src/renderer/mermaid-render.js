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

  // Brand colors on mermaid's 'base' theme (the only one that takes themeVariables). A diagram's
  // own front-matter `config:` / %%{init}%% still overrides these. The font is a system one on
  // purpose: mermaid measures labels with the app's fonts, but the <img> can't load our bundled
  // fonts, so a brand font would be measured as Inter and drawn as a fallback (clipped labels).
  const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
  // Mid tones, so the labels (Graphite) read on every slice, in both themes.
  const PIE = {
    pie1: '#7b8fff', pie2: '#ffc14d', pie3: '#b8bec7', pie4: '#b9c4ff', pie5: '#ffdf99', pie6: '#9aa3ae',
    pie7: '#dde3ff', pie8: '#f7d08a', pie9: '#d9dce1', pie10: '#a3b1ff', pie11: '#e8b04a', pie12: '#c9ced5',
    pieOpacity: '1', pieSectionTextColor: '#1b1f24',
  };
  const THEMES = {
    light: {
      darkMode: false,
      fontFamily: FONT,
      fontSize: '15px',
      background: '#ffffff',
      textColor: '#1b1f24', // Graphite
      primaryColor: '#e8ecff', // Signal tint
      primaryBorderColor: '#3d5afe', // Signal
      gradientStart: '#3d5afe', gradientStop: '#3d5afe', // mermaid 12's "neo" look: one-color borders
      dropShadow: 'drop-shadow(0 1px 2px rgba(27, 31, 36, 0.12))',
      primaryTextColor: '#1b1f24',
      secondaryColor: '#fbf0d6', // Amber tint
      secondaryBorderColor: '#f59f00', // Amber
      secondaryTextColor: '#1b1f24',
      tertiaryColor: '#f6f5f1', // Paper
      tertiaryBorderColor: '#d9dce1', // Line
      tertiaryTextColor: '#1b1f24',
      lineColor: '#5b6470', // Slate
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#f6f5f1',
      clusterBorder: '#d9dce1',
      noteBkgColor: '#fff4d6',
      noteBorderColor: '#f0d68c',
      noteTextColor: '#1b1f24',
      actorBkg: '#e8ecff',
      actorBorder: '#3d5afe',
      actorTextColor: '#1b1f24',
      actorLineColor: '#b8bec7',
      signalColor: '#1b1f24',
      signalTextColor: '#1b1f24',
      labelBoxBkgColor: '#f6f5f1',
      labelBoxBorderColor: '#d9dce1',
      labelTextColor: '#1b1f24',
      loopTextColor: '#1b1f24',
      activationBkgColor: '#fbf0d6',
      activationBorderColor: '#f59f00',
      ...PIE,
      pieOuterStrokeColor: '#d9dce1', pieStrokeColor: '#ffffff', pieTitleTextColor: '#1b1f24', pieLegendTextColor: '#1b1f24',
      // Gantt
      taskBkgColor: '#e8ecff', taskBorderColor: '#3d5afe', taskTextColor: '#1b1f24', taskTextDarkColor: '#1b1f24',
      taskTextLightColor: '#1b1f24', taskTextOutsideColor: '#1b1f24', taskTextClickableColor: '#3d5afe',
      activeTaskBkgColor: '#c4ceff', activeTaskBorderColor: '#3d5afe',
      doneTaskBkgColor: '#eef0f3', doneTaskBorderColor: '#b8bec7',
      critBkgColor: '#fbf0d6', critBorderColor: '#f59f00',
      sectionBkgColor: '#f6f5f1', sectionBkgColor2: '#ffffff', altSectionBkgColor: '#ffffff',
      gridColor: '#e4e6ea', todayLineColor: '#f59f00',
    },
    dark: {
      darkMode: true,
      fontFamily: FONT,
      fontSize: '15px',
      background: '#1b1f24', // Graphite
      textColor: '#f6f5f1', // Paper
      primaryColor: '#222944', // Signal, dark tint
      primaryBorderColor: '#6b82ff', // Signal Light
      gradientStart: '#6b82ff', gradientStop: '#6b82ff',
      dropShadow: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))',
      primaryTextColor: '#f6f5f1',
      secondaryColor: '#2e2a20', // Amber, dark tint
      secondaryBorderColor: '#f59f00',
      secondaryTextColor: '#f6f5f1',
      tertiaryColor: '#22272e',
      tertiaryBorderColor: '#3a414b',
      tertiaryTextColor: '#f6f5f1',
      lineColor: '#b8bec7', // Mist
      edgeLabelBackground: '#1b1f24',
      clusterBkg: '#22272e',
      clusterBorder: '#3a414b',
      noteBkgColor: '#3a3220',
      noteBorderColor: '#5c4c22',
      noteTextColor: '#f6f5f1',
      actorBkg: '#222944',
      actorBorder: '#6b82ff',
      actorTextColor: '#f6f5f1',
      actorLineColor: '#4a525d',
      signalColor: '#f6f5f1',
      signalTextColor: '#f6f5f1',
      labelBoxBkgColor: '#22272e',
      labelBoxBorderColor: '#3a414b',
      labelTextColor: '#f6f5f1',
      loopTextColor: '#f6f5f1',
      activationBkgColor: '#2e2a20',
      activationBorderColor: '#f59f00',
      ...PIE,
      pieOuterStrokeColor: '#3a414b', pieStrokeColor: '#1b1f24', pieTitleTextColor: '#f6f5f1', pieLegendTextColor: '#f6f5f1',
      // Gantt
      taskBkgColor: '#222944', taskBorderColor: '#6b82ff', taskTextColor: '#f6f5f1', taskTextDarkColor: '#f6f5f1',
      taskTextLightColor: '#f6f5f1', taskTextOutsideColor: '#f6f5f1', taskTextClickableColor: '#6b82ff',
      activeTaskBkgColor: '#323c63', activeTaskBorderColor: '#6b82ff',
      doneTaskBkgColor: '#2a3038', doneTaskBorderColor: '#4a525d',
      critBkgColor: '#3a3220', critBorderColor: '#f59f00',
      sectionBkgColor: '#22272e', sectionBkgColor2: '#1b1f24', altSectionBkgColor: '#1b1f24',
      gridColor: '#3a414b', todayLineColor: '#f59f00',
    },
  };

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
        theme: 'base',
        themeVariables: THEMES[theme === 'dark' ? 'dark' : 'light'],
        fontFamily: FONT,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        gantt: { fontSize: 13, sectionFontSize: 13, barHeight: 26, barGap: 6, leftPadding: 80 },
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
