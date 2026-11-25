// Renders the Dream New 11 mark into every icon/splash PNG the Expo app needs.
// Usage: npm run icons   (re-run after changing the mark below)
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'apps', 'mobile', 'assets');
const brandDir = resolve(out, 'brand');
const NAVY = '#0A1128';

/** The mark on a 64×64 grid, matching src/components/Logo.tsx. */
const mark = (navy = NAVY, mono = false) => `
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3BF283"/><stop offset="0.55" stop-color="#22E06B"/><stop offset="1" stop-color="#0FA44B"/>
    </linearGradient>
    <linearGradient id="ball" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF6B6B"/><stop offset="1" stop-color="#C81E3A"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="18" fill="${mono ? '#fff' : 'url(#badge)'}"/>
  ${mono ? '' : '<rect x="2" y="2" width="60" height="30" rx="18" fill="#fff" opacity="0.08"/>'}
  <rect x="17" y="12" width="13" height="4" rx="2" fill="${navy}"/>
  <rect x="33" y="12" width="13" height="4" rx="2" fill="${navy}"/>
  <path d="M20 22 L25 18 H29 V50 H22 V27 L20 28 Z" fill="${navy}"/>
  <path d="M35 22 L40 18 H44 V50 H37 V27 L35 28 Z" fill="${navy}"/>
  <circle cx="49" cy="47" r="8" fill="${mono ? navy : 'url(#ball)'}" stroke="${navy}" stroke-width="2"/>
  ${mono ? '' : `<path d="M44.7 41.9 L54.1 51.3" stroke="#FFE3E3" stroke-width="1.1" stroke-dasharray="1.4 1.2"/>
  <path d="M42.9 43.7 L52.3 53.1" stroke="#FFE3E3" stroke-width="1.1" stroke-dasharray="1.4 1.2"/>`}`;

/** Places the mark at `scale` of a square canvas, optionally on a background. */
const svg = (size, scale, { bg, mono = false } = {}) => {
  const inner = size * scale;
  const offset = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  ${bg ? `<radialGradient id="glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#22E06B" stop-opacity="0.22"/><stop offset="1" stop-color="#22E06B" stop-opacity="0"/></radialGradient><rect width="${size}" height="${size}" fill="url(#glow)"/>` : ''}
  <g transform="translate(${offset} ${offset}) scale(${inner / 64})">${mark(mono ? '#000' : NAVY, mono)}</g>
</svg>`;
};

const targets = [
  ['icon.png', 1024, svg(1024, 0.72, { bg: NAVY })],
  ['splash-icon.png', 512, svg(512, 1)],
  ['favicon.png', 48, svg(48, 1)],
  ['android-icon-foreground.png', 1024, svg(1024, 0.5)],
  ['android-icon-background.png', 1024, svg(1024, 0, { bg: NAVY })],
  ['android-icon-monochrome.png', 1024, svg(1024, 0.5, { mono: true })],
];

await mkdir(brandDir, { recursive: true });
await writeFile(resolve(brandDir, 'logo-mark.svg'), svg(256, 1));
for (const [name, size, source] of targets) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(resolve(out, name));
  console.log(`  ✓ ${name} (${size}px)`);
}
