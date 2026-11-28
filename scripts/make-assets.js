/**
 * Renders the SVG sources in build/ to the raster assets used for packaging:
 *   build/icon.svg           -> build/icon.png (1024px) + build/icon.icns
 *   build/dmg-background.svg -> build/background.png + build/background@2x.png (with the brand
 *     fonts from src/renderer/fonts embedded while rendering: an SVG image can't load font files)
 * Run with: npm run assets   (uses Electron's Chromium to rasterize, then macOS iconutil)
 */
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const icnsPath = path.join(buildDir, 'icon.icns');

let win;

/** The SVG with its style element filled with @font-face rules for the bundled brand fonts. */
function withBrandFonts(svg) {
  const fontsDir = path.join(__dirname, '..', 'src', 'renderer', 'fonts');
  const faces = [['Inter', 'inter'], ['Space Grotesk', 'space-grotesk'], ['JetBrains Mono', 'jetbrains-mono']]
    .map(([family, file]) => {
      const data = fs.readFileSync(path.join(fontsDir, `${file}-latin.woff2`)).toString('base64');
      return `@font-face { font-family: '${family}'; font-weight: 100 900; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
    });
  return svg.replace(/<style>[^<]*<\/style>/, `<style>${faces.join('\n')}</style>`);
}

async function rasterize(svg, width, height = width) {
  if (!win) {
    win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<canvas></canvas>');
  }
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.querySelector('canvas');
        c.width = ${width};
        c.height = ${height};
        c.getContext('2d').drawImage(img, 0, 0, ${width}, ${height});
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(svgPath, 'utf8');
    fs.writeFileSync(pngPath, await rasterize(svg, 1024));

    const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'mdh-')) + '/icon.iconset';
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), await rasterize(svg, size));
      fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), await rasterize(svg, size * 2));
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icnsPath]);
    fs.rmSync(path.dirname(iconset), { recursive: true, force: true });

    const bg = withBrandFonts(fs.readFileSync(path.join(buildDir, 'dmg-background.svg'), 'utf8'));
    fs.writeFileSync(path.join(buildDir, 'background.png'), await rasterize(bg, 540, 380));
    fs.writeFileSync(path.join(buildDir, 'background@2x.png'), await rasterize(bg, 1080, 760));
    console.log('Wrote build/icon.png, build/icon.icns, build/background.png, build/background@2x.png');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
