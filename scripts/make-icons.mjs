#!/usr/bin/env node
/**
 * PWA 아이콘 생성 (의존성 없음)
 *   node scripts/make-icons.mjs
 *
 * 배경 #12694F + 흰색 W. 마스커블 안전 영역(중앙 80%) 안에 들어가도록 그린다.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x12, 0x69, 0x4f];
const FG = [0xff, 0xff, 0xff];

// W 획 (0~1 좌표)
const POINTS = [
  [0.27, 0.34],
  [0.385, 0.67],
  [0.5, 0.47],
  [0.615, 0.67],
  [0.73, 0.34],
];
const THICKNESS = 0.062;

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const half = (THICKNESS * size) / 2;
  const pts = POINTS.map(([x, y]) => [x * size, y * size]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        d = Math.min(d, distToSegment(cx, cy, ax, ay, bx, by));
      }

      // 1px 폭으로 부드럽게
      const a = Math.max(0, Math.min(1, half + 0.5 - d));
      const o = (y * size + x) * 4;
      px[o] = Math.round(BG[0] * (1 - a) + FG[0] * a);
      px[o + 1] = Math.round(BG[1] * (1 - a) + FG[1] * a);
      px[o + 2] = Math.round(BG[2] * (1 - a) + FG[2] * a);
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(`public/icons/${name}`, encodePng(size, render(size)));
  console.log(`public/icons/${name} (${size}×${size})`);
}
