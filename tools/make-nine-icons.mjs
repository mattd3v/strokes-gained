// Icons for The Nine: a flag inside a pencilled birdie circle on card stock.
//
//   npm run icons:nine

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, hex, roundedRectSd } from './png.mjs';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'nine', 'icons');

const PAPER = hex('#efe7d2');
const RULE = hex('#d9cdb0');
const INK = hex('#25221c');
const RED = hex('#b3362b');
const GREEN = hex('#3d5a3a');

const SAMPLES = 4; // supersampling per axis, for antialiased edges

function draw(size, { padding }) {
  const buf = Buffer.alloc(size * size * 4);
  const inset = padding * size;
  const area = size - inset * 2;
  const cx = size / 2;
  const cy = size / 2;
  const u = area / 100; // design units: the safe area is 100 × 100

  // Returns the colour at a point, or null for transparent.
  const shade = (x, y) => {
    if (padding === 0 && roundedRectSd(x, y, cx, cy, size / 2, size / 2, size * 0.19) > 0) return null;

    let c = PAPER;
    // Faint ruled lines, like the page of a yardage book.
    if (Math.abs(((y - inset) / u) % 12.5) < 0.45) c = RULE;

    const d = Math.hypot(x - cx, y - cy) / u;
    if (d < 38 && d > 32) c = INK;                         // the birdie circle
    const sx = (x - cx) / u;
    const sy = (y - cy) / u;
    if (((sx + 1) / 19) ** 2 + ((sy - 16) / 5.5) ** 2 < 1) c = GREEN; // the green, in perspective
    if (sx > -4 && sx < -1.2 && sy > -22 && sy < 17) c = INK; // flagstick
    // Pennant: a triangle off the top of the stick.
    const tx = sx + 1.2;
    const ty = sy + 22;
    if (tx >= 0 && ty >= 0 && ty <= 16 && tx <= 20 * (1 - Math.abs(ty - 8) / 8)) c = RED;
    return c;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let j = 0; j < SAMPLES; j++) {
        for (let i = 0; i < SAMPLES; i++) {
          const c = shade(x + (i + 0.5) / SAMPLES, y + (j + 0.5) / SAMPLES);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; hits++;
        }
      }
      const o = (y * size + x) * 4;
      if (hits) {
        buf[o] = Math.round(r / hits);
        buf[o + 1] = Math.round(g / hits);
        buf[o + 2] = Math.round(b / hits);
      }
      buf[o + 3] = Math.round((255 * hits) / (SAMPLES * SAMPLES));
    }
  }
  return encodePng(size, size, buf);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, { padding: 0 }],
  ['icon-512.png', 512, { padding: 0 }],
  ['apple-touch-icon.png', 180, { padding: 0.04 }],
  ['maskable-512.png', 512, { padding: 0.14 }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(path.join(OUT_DIR, name), draw(size, opts));
  console.log(`wrote nine/icons/${name} (${size}x${size})`);
}
