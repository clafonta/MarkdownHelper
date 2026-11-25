/**
 * Dev-only: `npm start` runs our code inside node_modules/electron's stock Electron.app, and macOS
 * takes the menu-bar app name (next to the Apple menu) and the Dock icon from that bundle, not from
 * our code. This renames the dev bundle to our productName and gives it our icon.
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
const appBundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = path.join(appBundle, 'Contents', 'Info.plist');
if (!fs.existsSync(plist)) process.exit(0); // electron not installed yet

const read = (key) => {
  try { return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim(); } catch { return null; }
};

let changed = false;
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
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  try { execFileSync(lsregister, ['-f', appBundle], { stdio: 'ignore' }); } catch { /* best effort */ }
  fs.utimesSync(appBundle, new Date(), new Date());
  console.log(`Branded dev Electron.app as "${productName}"`);
}
