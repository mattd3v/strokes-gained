// Generates the PWA icons with no image dependencies: draws into an RGBA
// buffer and encodes a PNG with node's built-in zlib.
//
//   npm run icons

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, hex, roundedRectSd } from './png.mjs';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = hex('#12261d');      // deep fairway green
const BAR_LOW = hex('#1c5cab');
const BAR_MID = hex('#2a78d6');
const BAR_HIGH = hex('#6da7ec');
const BALL = hex('#fcfcfb');

function draw(size, { padding }) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512; // design is authored at 512
  const inset = padding * size;

  // Three ascending bars plus a ball, centred in the safe area.
  const area = size - inset * 2;
  const barW = area * 0.16;
  const gap = area * 0.075;
  const baseY = inset + area * 0.82;
  const bars = [
    { h: area * 0.22, color: BAR_LOW },
    { h: area * 0.36, color: BAR_MID },
    { h: area * 0.50, color: BAR_HIGH },
  ];
  const groupW = bars.length * barW + (bars.length - 1) * gap;
  const startX = inset + (area - groupW) / 2;

  const ballR = area * 0.10;
  const ballCx = startX + groupW - barW / 2;
  const ballCy = baseY - bars[2].h - ballR - area * 0.06;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];
      let a = 255;

      if (padding === 0) {
        // Non-maskable icon gets a rounded-square silhouette.
        const sd = roundedRectSd(px, py, size / 2, size / 2, size / 2, size / 2, 96 * s);
        a = Math.round(255 * Math.min(1, Math.max(0, 0.5 - sd)));
      }

      const blend = (color, coverage) => {
        if (coverage <= 0) return;
        const t = Math.min(1, coverage);
        r = Math.round(r * (1 - t) + color[0] * t);
        g = Math.round(g * (1 - t) + color[1] * t);
        b = Math.round(b * (1 - t) + color[2] * t);
      };

      bars.forEach((bar, i) => {
        const left = startX + i * (barW + gap);
        const cx = left + barW / 2;
        const cy = baseY - bar.h / 2;
        const sd = roundedRectSd(px, py, cx, cy, barW / 2, bar.h / 2, barW * 0.28);
        blend(bar.color, 0.5 - sd);
      });

      const ballSd = Math.hypot(px - ballCx, py - ballCy) - ballR;
      blend(BALL, 0.5 - ballSd);

      const o = (y * size + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }
  return encodePng(size, size, buf);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, { padding: 0 }],
  ['icon-512.png', 512, { padding: 0 }],
  ['apple-touch-icon.png', 180, { padding: 0 }],
  // Maskable icons are cropped to a circle by some launchers, so keep the
  // artwork inside the 80% safe area.
  ['maskable-512.png', 512, { padding: 0.14 }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(path.join(OUT_DIR, name), draw(size, opts));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
