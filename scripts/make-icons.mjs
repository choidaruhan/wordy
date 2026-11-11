#!/usr/bin/env node
/**
 * PWA 아이콘 생성 (의존성 없음)
 *   node scripts/make-icons.mjs
 *
 * 배경 #5F2EEA + 흰색 W.
 * - PWA/OS 아이콘은 꽉 찬 배경(마스커블 안전 영역 중앙 80%).
 * - favicon은 헤더 로고와 같은 둥근 사각형.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x5f, 0x2e, 0xea];
const FG = [0xff, 0xff, 0xff];
const RADIUS_RATIO = 0.22;

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

/** 둥근 사각형 안쪽이면 1, 바깥이면 0, 경계는 0~1로 부드럽게. */
function roundedRectAlpha(px, py, size, radius) {
  const half = size / 2;
  const inner = half - radius;
  const qx = Math.abs(px - half) - inner;
  const qy = Math.abs(py - half) - inner;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const d = outside + inside - radius;
  return Math.max(0, Math.min(1, 0.5 - d));
}

function render(size, rounded = false) {
  const px = Buffer.alloc(size * size * 4);
  const half = (THICKNESS * size) / 2;
  const radius = size * RADIUS_RATIO;
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
      const alpha = rounded ? roundedRectAlpha(cx, cy, size, radius) : 1;
      const o = (y * size + x) * 4;
      px[o] = Math.round(BG[0] * (1 - a) + FG[0] * a);
      px[o + 1] = Math.round(BG[1] * (1 - a) + FG[1] * a);
      px[o + 2] = Math.round(BG[2] * (1 - a) + FG[2] * a);
      px[o + 3] = Math.round(255 * alpha);
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

const W_PATH = 'M27 34L38.5 67L50 47L61.5 67L73 34';
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Wordy">
  <rect width="100" height="100" rx="22" fill="#5F2EEA"/>
  <path d="${W_PATH}" fill="none" stroke="#FFFFFF" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

mkdirSync('public/icons', { recursive: true });
mkdirSync('brand', { recursive: true });

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(`public/icons/${name}`, encodePng(size, render(size)));
  console.log(`public/icons/${name} (${size}×${size})`);
}

for (const [name, size] of [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
]) {
  writeFileSync(`public/${name}`, encodePng(size, render(size, true)));
  console.log(`public/${name} (${size}×${size})`);
}

writeFileSync('public/favicon.svg', FAVICON_SVG);
console.log('public/favicon.svg');

// Google OAuth 동의 화면 로고: 120×120, 1MB 이하
writeFileSync('brand/oauth-logo-120.png', encodePng(120, render(120)));
console.log('brand/oauth-logo-120.png (120×120)');
