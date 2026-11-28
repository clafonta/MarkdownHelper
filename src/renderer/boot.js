// Runs in <head>, before the first paint: anything the header's layout or the colors depend on
// must be set here, not in renderer.js (loaded last), or the window first shows without it
// (the macOS traffic lights over the title, a light flash before the dark theme).
(() => {
  const root = document.documentElement;
  root.dataset.platform = window.markdownHelper?.platform || 'web';
  let theme = null;
  try { theme = localStorage.getItem('markdown-helper:theme'); } catch { /* ignore */ }
  root.dataset.theme = theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
