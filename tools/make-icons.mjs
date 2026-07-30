// Generates the PWA icons with no image dependencies: draws into an RGBA
// buffer and encodes a PNG with node's built-in zlib.
//
//   npm run icons

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const BG = hex('#12261d');      // deep fairway green
const BAR_LOW = hex('#1c5cab');
const BAR_MID = hex('#2a78d6');
const BAR_HIGH = hex('#6da7ec');
const BALL = hex('#fcfcfb');

/** Signed distance to a rounded rectangle, for cheap antialiasing. */
function roundedRectSd(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

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
