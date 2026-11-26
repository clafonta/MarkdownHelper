/**
 * Which files Markdown Helper can open, and how each kind is previewed.
 * Shared by the main process (require) and the renderer (classic <script>, window.FileTypes).
 * scripts/mdh mirrors the extension and name lists (test/file-types.test.js keeps them in sync).
 *
 * Preview kinds:
 *   markdown – rendered Markdown (also an unsaved, untitled document)
 *   text     – plain text, also rendered as Markdown (notes are often Markdown-ish)
 *   html     – the page itself in a sandboxed frame (no scripts)
 *   csv, tsv – a table
 *   json     – pretty-printed, or where it's invalid
 *   svg      – the image
 *   mermaid  – the diagram (```mermaid blocks in Markdown are drawn too)
 *   code     – editable, no preview
 * `tabs: true` makes the Tab key insert a real tab (the format needs them).
 */
(function (root) {
  const TYPES = [
    { kind: 'markdown', label: 'Markdown', ext: ['md', 'markdown', 'mdown', 'mkd'] },
    { kind: 'markdown', label: 'MDX', ext: ['mdx'] },
    { kind: 'text', label: 'Text', ext: ['txt'], names: ['README', 'LICENSE', 'CHANGELOG'] },
    { kind: 'html', label: 'HTML', ext: ['html', 'htm'] },
    { kind: 'csv', label: 'CSV', ext: ['csv'] },
    { kind: 'tsv', label: 'TSV', ext: ['tsv'], tabs: true },
    { kind: 'json', label: 'JSON', ext: ['json'] },
    { kind: 'svg', label: 'SVG', ext: ['svg'] },
    { kind: 'mermaid', label: 'Mermaid', ext: ['mmd', 'mermaid'] },
    { kind: 'code', label: 'CSS', ext: ['css'] },
    { kind: 'code', label: 'JavaScript', ext: ['js', 'mjs', 'cjs', 'jsx'] },
    { kind: 'code', label: 'TypeScript', ext: ['ts', 'mts', 'cts', 'tsx'] },
    { kind: 'code', label: 'Python', ext: ['py'] },
    { kind: 'code', label: 'Ruby', ext: ['rb'] },
    { kind: 'code', label: 'Go', ext: ['go'], tabs: true },
    { kind: 'code', label: 'Java', ext: ['java'] },
    { kind: 'code', label: 'Swift', ext: ['swift'] },
    { kind: 'code', label: 'Shell', ext: ['sh', 'bash', 'zsh'] },
    { kind: 'code', label: 'SQL', ext: ['sql'] },
    { kind: 'code', label: 'YAML', ext: ['yaml', 'yml'] },
    { kind: 'code', label: 'TOML', ext: ['toml'] },
    { kind: 'code', label: 'Config', ext: ['ini', 'cfg', 'conf', 'env'], names: ['.env', '.editorconfig'] },
    { kind: 'code', label: 'XML', ext: ['xml'] },
    { kind: 'code', label: 'Log', ext: ['log'] },
    { kind: 'code', label: 'Makefile', names: ['Makefile', 'makefile', 'GNUmakefile'], tabs: true },
    { kind: 'code', label: 'Dockerfile', names: ['Dockerfile'] },
    { kind: 'code', label: 'Git', names: ['.gitignore', '.gitattributes'] },
  ];

  const BY_EXT = new Map();
  const BY_NAME = new Map();
  for (const type of TYPES) {
    const info = { kind: type.kind, label: type.label, tabs: !!type.tabs };
    for (const ext of type.ext || []) BY_EXT.set(ext, info);
    for (const name of type.names || []) BY_NAME.set(name, info);
  }
  const UNTITLED = { kind: 'markdown', label: 'Markdown', tabs: false };

  const baseName = (filePath) => String(filePath || '').split(/[\\/]/).pop();

  /** Lower-case extension without the dot ('' if none). Works with / and \ separators. */
  function extensionOf(filePath) {
    const name = baseName(filePath);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  /** { kind, label, tabs } for a supported file, null otherwise. No path = untitled Markdown. */
  function fileInfo(filePath) {
    if (!filePath) return UNTITLED;
    return BY_NAME.get(baseName(filePath)) || BY_EXT.get(extensionOf(filePath)) || null;
  }

  const fileKind = (filePath) => fileInfo(filePath)?.kind ?? null;
  const isSupported = (filePath) => !!filePath && fileInfo(filePath) !== null;

  const EXTENSIONS = [...BY_EXT.keys()];
  const NAMES = [...BY_NAME.keys()];

  const exts = (...labels) => TYPES.filter((t) => labels.includes(t.label)).flatMap((t) => t.ext || []);
  /** Filters for Electron's open/save dialogs. "All Files" lets name-only types (Makefile) be picked. */
  const DIALOG_FILTERS = [
    { name: 'Supported Files', extensions: EXTENSIONS },
    { name: 'Markdown', extensions: exts('Markdown', 'MDX') },
    { name: 'Text', extensions: exts('Text') },
    { name: 'HTML', extensions: exts('HTML') },
    { name: 'Data (CSV, TSV, JSON)', extensions: exts('CSV', 'TSV', 'JSON') },
    { name: 'SVG Image', extensions: exts('SVG') },
    { name: 'Mermaid Diagram', extensions: exts('Mermaid') },
    { name: 'All Files', extensions: ['*'] },
  ];

  const api = { fileInfo, fileKind, isSupported, extensionOf, DIALOG_FILTERS, EXTENSIONS, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FileTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
