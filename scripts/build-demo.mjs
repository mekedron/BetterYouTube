// Copies the built Chrome popup into docs/demo/ so the landing page can run
// the real popup in an iframe. Run after `pnpm build`.
//
// The popup references its files from the extension root ("/chunks/…",
// "/icon/…"); GitHub Pages serves the site from /BetterYouTube/, so every
// root path becomes relative to docs/demo/.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const build = join(root, '.output/chrome-mv3');
const out = join(root, 'docs/demo');

if (!existsSync(join(build, 'popup.html'))) {
  console.error('No popup build found. Run `pnpm build` first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['chunks', 'assets', 'icon']) cpSync(join(build, dir), join(out, dir), { recursive: true });

const relative = (text) => text.replaceAll('"/chunks/', '"./chunks/').replaceAll('"/assets/', '"./assets/').replaceAll('"/icon/', '"./icon/');

for (const dir of ['chunks', 'assets']) {
  for (const file of readdirSync(join(out, dir))) {
    const path = join(out, dir, file);
    // Inside a chunk, imports of sibling chunks resolve relative to the chunk,
    // while image paths resolve relative to the page.
    const text = readFileSync(path, 'utf8').replaceAll('"/chunks/', '"./').replaceAll('"/icon/', '"./icon/');
    writeFileSync(path, text);
  }
}

const messages = Object.fromEntries(
  readdirSync(join(build, '_locales')).map((code) => [
    code,
    JSON.parse(readFileSync(join(build, '_locales', code, 'messages.json'), 'utf8')),
  ]),
);
const { version } = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8'));
const shim = readFileSync(join(root, 'scripts/demo-shim.js'), 'utf8');
const head =
  `<script>window.__BYT_MESSAGES__=${JSON.stringify(messages)};window.__BYT_VERSION__=${JSON.stringify(version)};</script>` +
  `<script>${shim}</script>` +
  // The demo has no toolbar to hang from, so the popup fills the frame.
  '<style>body{width:auto!important}</style>';

const html = relative(readFileSync(join(build, 'popup.html'), 'utf8')).replace('<head>', `<head>${head}`);
writeFileSync(join(out, 'index.html'), html);
console.log(`Popup demo written to ${out}`);
