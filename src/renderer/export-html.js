/**
 * Turns the rendered preview into self-contained HTML for the clipboard. Email clients and word
 * processors ignore our stylesheet, so every element gets inline styles. Colors are always the
 * light theme, so a copy made in dark mode doesn't paste as light text on a white page.
 */
(function (root) {
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const MONO = 'font-family: SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;';
  const BORDER = '#d0d7de';
  const MUTED = '#59636e';
  const HEADING = 'font-weight: 600; line-height: 1.25; margin: 24px 0 16px;';

  const STYLES = {
    H1: `${HEADING} font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid ${BORDER};`,
    H2: `${HEADING} font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid ${BORDER};`,
    H3: `${HEADING} font-size: 1.25em;`,
    H4: `${HEADING} font-size: 1em;`,
    H5: `${HEADING} font-size: 0.875em;`,
    H6: `${HEADING} font-size: 0.85em; color: ${MUTED};`,
    P: 'margin: 0 0 16px;',
    UL: 'margin: 0 0 16px; padding-left: 2em;',
    OL: 'margin: 0 0 16px; padding-left: 2em;',
    LI: 'margin: 0.25em 0;',
    BLOCKQUOTE: `margin: 0 0 16px; padding: 0 1em; color: ${MUTED}; border-left: 4px solid ${BORDER};`,
    PRE: `${MONO} font-size: 85%; line-height: 1.45; margin: 0 0 16px; padding: 16px; background: #f6f8fa; border-radius: 6px; white-space: pre; overflow: auto;`,
    CODE: `${MONO} font-size: 85%; padding: 0.2em 0.4em; background: #eff1f3; border-radius: 6px;`,
    TABLE: 'border-collapse: collapse; border-spacing: 0; margin: 0 0 16px;',
    TH: `padding: 6px 13px; border: 1px solid ${BORDER}; font-weight: 600; background: #f6f8fa; text-align: left;`,
    TD: `padding: 6px 13px; border: 1px solid ${BORDER};`,
    A: 'color: #0969da; text-decoration: underline;',
    HR: `height: 0; margin: 24px 0; border: 0; border-top: 1px solid ${BORDER};`,
    IMG: 'max-width: 100%;',
  };
  const CODE_IN_PRE = `${MONO} font-size: inherit; padding: 0; background: transparent; border-radius: 0;`;

  /** Returns { html, text } for the given rendered preview element. */
  function buildExport(previewEl) {
    const clone = previewEl.cloneNode(true);
    for (const el of clone.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
          el.removeAttribute(attr.name);
        }
      }
      let style = STYLES[el.tagName] || '';
      if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') style = CODE_IN_PRE;
      const align = el.getAttribute('align');
      if ((el.tagName === 'TH' || el.tagName === 'TD') && align) style += ` text-align: ${align};`;
      if (style) el.setAttribute('style', style);
    }
    const html = `<div style="font-family: ${FONT.replace(/"/g, '&quot;')}; font-size: 14px; line-height: 1.5; color: #1f2328;">${clone.innerHTML}</div>`;
    return { html, text: previewEl.innerText.trim() };
  }

  root.ExportHtml = { buildExport };
})(window);
