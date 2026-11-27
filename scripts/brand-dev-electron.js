/**
 * Dev-only: `npm start` runs our code inside node_modules/electron's stock Electron.app, and macOS
 * takes the app's name and icon from that bundle, not from our code: the menu-bar name (next to
 * the Apple menu) from Info.plist's CFBundleName, the Dock's hover label from the bundle's file
 * name, and the Dock icon from its .icns. So this renames the bundle to "<productName>.app"
 * (pointing node_modules/electron/path.txt at it, which is how `electron` finds its binary), sets
 * the Info.plist names, and gives it our icon.
 *
 * Electron's installer sees the changed path.txt as "not installed", so a later `npm install`
 * re-extracts a stock Electron.app (from Electron's download cache); postinstall then runs this
 * again and brands the fresh copy.
 *
 * Packaged builds (npm run dist) are unaffected; electron-builder brands those itself.
 * Runs automatically on `npm install` (postinstall) and `npm start` (prestart); safe to re-run.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const root = path.join(__dirname, '..');
const { productName } = require(path.join(root, 'package.json'));
const electronDir = path.join(root, 'node_modules', 'electron');
const stockBundle = path.join(electronDir, 'dist', 'Electron.app');
const appBundle = path.join(electronDir, 'dist', `${productName}.app`);
const pathTxt = path.join(electronDir, 'path.txt');
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

let changed = false;
if (fs.existsSync(stockBundle)) {
  // A fresh stock bundle (first install, or re-extracted by Electron's installer): it replaces
  // any older branded copy.
  fs.rmSync(appBundle, { recursive: true, force: true });
  fs.renameSync(stockBundle, appBundle);
  try { execFileSync(lsregister, ['-u', stockBundle], { stdio: 'ignore' }); } catch { /* best effort */ }
  changed = true;
}
const plist = path.join(appBundle, 'Contents', 'Info.plist');
if (!fs.existsSync(plist)) process.exit(0); // electron not installed yet
const executable = `${productName}.app/Contents/MacOS/Electron`;
if (!fs.existsSync(pathTxt) || fs.readFileSync(pathTxt, 'utf8') !== executable) {
  fs.writeFileSync(pathTxt, executable);
}

const read = (key) => {
  try { return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim(); } catch { return null; }
};

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  if (read(key) !== productName) {
    execFileSync('plutil', ['-replace', key, '-string', productName, plist]);
    changed = true;
  }
}

const iconSrc = path.join(root, 'build', 'icon.icns');
const iconDest = path.join(appBundle, 'Contents', 'Resources', 'electron.icns');
if (fs.existsSync(iconSrc) && !fs.readFileSync(iconSrc).equals(fs.readFileSync(iconDest))) {
  fs.copyFileSync(iconSrc, iconDest);
  changed = true;
}

if (changed) {
  // Editing the bundle invalidates its signature; re-sign ad hoc so it still launches on Apple silicon.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'ignore' });
  // Make Launch Services pick up the new name/icon instead of its cached copy.
  try { execFileSync(lsregister, ['-f', appBundle], { stdio: 'ignore' }); } catch { /* best effort */ }
  fs.utimesSync(appBundle, new Date(), new Date());
  console.log(`Branded dev Electron app as "${productName}.app"`);
}
