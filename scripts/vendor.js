#!/usr/bin/env node
/**
 * Copies browser bundles we ship as single files into src/vendor/ (git-ignored).
 *
 * mermaid is a devDependency on purpose: as a regular dependency electron-builder would pack its
 * whole dependency tree (d3, cytoscape, katex, … ~200 MB) into the app, while the renderer only
 * needs the self-contained dist/mermaid.min.js. Runs on postinstall, prestart and predist.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'src', 'vendor');

const FILES = [
  ['node_modules/mermaid/dist/mermaid.min.js', 'mermaid.min.js'],
  ['node_modules/mermaid/LICENSE', 'mermaid.LICENSE.txt'],
];

fs.mkdirSync(vendor, { recursive: true });
for (const [from, to] of FILES) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) {
    console.error(`vendor: ${from} is missing. Run \`npm install\` first.`);
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(vendor, to));
}
console.log(`vendor: copied ${FILES.length} files to src/vendor/`);
