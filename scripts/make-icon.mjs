// Rasterise assets/atc-logo.svg into the PNG Wails builds its icon from.
//
// The SVG stays the source of truth; this exists so the PNGs can never drift from it.
// Also renders a few small sizes so the mark can be checked where it is hardest to
// read -- a 16px taskbar icon is the real test, not the 1024px artboard.
//
//   node scripts/make-icon.mjs
//
// Wails regenerates build/windows/icon.ico from build/appicon.png only when the .ico is
// missing, so delete it (and refresh packaging/icon.ico for the installers) after a change.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets', 'atc-logo.svg'), 'utf8');

function render(size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

const png = render(1024);
writeFileSync(join(root, 'assets', 'atc-logo.png'), png);
// The one Wails consumes.
writeFileSync(join(root, 'build', 'appicon.png'), png);

// Proof sizes, kept out of the repo — these are for looking at, not shipping.
const previewDir = join(root, 'assets', 'preview');
mkdirSync(previewDir, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128]) {
  writeFileSync(join(previewDir, `atc-${size}.png`), render(size));
}

console.log('wrote assets/atc-logo.png and build/appicon.png (1024), and assets/preview/atc-{16,24,32,48,64,128}.png');
