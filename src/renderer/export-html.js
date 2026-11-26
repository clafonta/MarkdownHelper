/**
 * Turns the rendered preview into clean, semantic HTML for the clipboard.
 *
 * The goal is a "clear formatting" style paste: real <h1>/<p>/<ul>/<strong>/<table> tags and no
 * fonts, sizes, colors or line heights, so the destination (Google Docs, Word, Outlook, Gmail,
 * Mail) applies its own body font and heading styles. Only what the Markdown itself means is kept
 * as inline style: monospace code, table borders, a quote's left rule, and a small gap after each
 * block (several editors drop default margins, which runs paragraphs into lists).
 */
(function (root) {
  const MONO = 'font-family: Consolas, Menlo, "Courier New", monospace;';
  const BORDER = '#d0d7de';
  const GAP = 'margin: 0 0 10pt;';

  const STYLES = {
    P: GAP,
    UL: `${GAP} padding-left: 2em;`,
    OL: `${GAP} padding-left: 2em;`,
    BLOCKQUOTE: `${GAP} padding: 0 0 0 1em; border-left: 3px solid ${BORDER};`,
    PRE: `${GAP} ${MONO} white-space: pre;`,
    CODE: MONO,
    TABLE: `${GAP} border-collapse: collapse;`,
    TH: `padding: 4pt 8pt; border: 1px solid ${BORDER}; font-weight: bold;`,
    TD: `padding: 4pt 8pt; border: 1px solid ${BORDER};`,
    HR: `${GAP} border: 0; border-top: 1px solid ${BORDER};`,
    IMG: 'max-width: 100%;',
  };

  /** Returns { html, text } for the given rendered preview element. */
  function buildExport(previewEl) {
    const clone = previewEl.cloneNode(true);
    // An HTML page's body can carry these; they aren't content.
    for (const el of clone.querySelectorAll('script, style, link, meta, template, noscript, iframe')) el.remove();
    for (const el of clone.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-') || ['class', 'id', 'style'].includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }
      let style = STYLES[el.tagName] || '';
      // A list's last item, or a paragraph inside a list item / quote, doesn't need its own gap.
      if (el.tagName === 'P' && el.parentElement && ['LI', 'BLOCKQUOTE'].includes(el.parentElement.tagName)
          && !el.nextElementSibling) style = 'margin: 0;';
      if ((el.tagName === 'UL' || el.tagName === 'OL') && el.parentElement && el.parentElement.tagName === 'LI') {
        style = 'margin: 0; padding-left: 2em;';
      }
      if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') style = '';
      const align = el.getAttribute('align');
      if (el.tagName === 'TH' || el.tagName === 'TD') style += ` text-align: ${align || 'left'};`;
      if (style) el.setAttribute('style', style);
    }
    return { html: clone.innerHTML, text: previewEl.innerText.trim() };
  }

  root.ExportHtml = { buildExport };
})(window);
