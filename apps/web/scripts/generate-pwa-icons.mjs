/**
 * يولّد أيقونات PWA بدون أي تبعية خارجية (PNG مرسوم برمجيًا).
 * التشغيل: node scripts/generate-pwa-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundedRectDistance(px, py, cx, cy, halfWidth, halfHeight, radius) {
  const qx = Math.abs(px - cx) - halfWidth + radius;
  const qy = Math.abs(py - cy) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function drawIcon(size, { maskable = false } = {}) {
  const scale = 4;
  const width = size * scale;
  const height = size * scale;
  const contentScale = maskable ? 0.78 : 1;
  const center = width / 2;

  const bgRadius = maskable ? 0 : width * 0.22;
  const bgHalf = width / 2;
  const phoneHalfWidth = width * 0.155 * contentScale;
  const phoneHalfHeight = width * 0.255 * contentScale;
  const phoneRadius = width * 0.06 * contentScale;
  const borderWidth = width * 0.026 * contentScale;
  const screenCheckWidth = width * 0.026 * contentScale;

  const checkA = [width * 0.43, height * 0.51];
  const checkB = [width * 0.49, height * 0.57];
  const checkC = [width * 0.59, height * 0.44];
  const homeY = center + phoneHalfHeight * 0.72;

  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const insideBackground =
        maskable || roundedRectDistance(px, py, center, center, bgHalf, bgHalf, bgRadius) <= 0;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (insideBackground) {
        const t = py / height;
        r = Math.round(15 + (17 - 15) * t);
        g = Math.round(118 + (94 - 118) * t);
        b = Math.round(110 + (89 - 110) * t);
        a = 255;

        const phoneDistance = roundedRectDistance(
          px,
          py,
          center,
          center,
          phoneHalfWidth,
          phoneHalfHeight,
          phoneRadius,
        );
        const onPhoneBorder = Math.abs(phoneDistance) <= borderWidth / 2;
        const onCheck =
          segmentDistance(px, py, checkA[0], checkA[1], checkB[0], checkB[1]) <= screenCheckWidth / 2 ||
          segmentDistance(px, py, checkB[0], checkB[1], checkC[0], checkC[1]) <= screenCheckWidth / 2;
        const onHomeButton = Math.hypot(px - center, py - homeY) <= width * 0.016 * contentScale;

        if (onPhoneBorder || onCheck || onHomeButton) {
          r = 255;
          g = 255;
          b = 255;
        }
      }

      const index = (y * width + x) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * width + (x * scale + sx)) * 4;
          const alpha = pixels[index + 3] / 255;
          r += pixels[index] * alpha;
          g += pixels[index + 1] * alpha;
          b += pixels[index + 2] * alpha;
          a += pixels[index + 3];
        }
      }
      const samples = scale * scale;
      const alphaAverage = a / samples;
      const outIndex = (y * size + x) * 4;
      if (alphaAverage > 0) {
        const weight = a / 255 || 1;
        out[outIndex] = Math.round(r / weight);
        out[outIndex + 1] = Math.round(g / weight);
        out[outIndex + 2] = Math.round(b / weight);
      }
      out[outIndex + 3] = Math.round(alphaAverage);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(OUT_DIR, { recursive: true });
const icons = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [filename, size, options] of icons) {
  const png = drawIcon(size, options);
  writeFileSync(path.join(OUT_DIR, filename), png);
  console.log(`generated ${filename} (${png.length} bytes)`);
}
