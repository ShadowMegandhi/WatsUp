/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark is a checkmark on a rounded dark tile: a checkmark because the
 * product is about ticking work off, dark because it has to stay legible on
 * both light and dark Chrome toolbars.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [24, 27, 34];
const FG = [227, 179, 65];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Signed distance from point p to segment ab, for anti-aliased strokes. */
const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
};

const makePng = (size) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = size * 0.22;
  const stroke = Math.max(1.05, size * 0.085);

  // Checkmark geometry in unit space, scaled to the tile.
  const p = (x, y) => [x * size, y * size];
  const [ax, ay] = p(0.26, 0.52);
  const [bx, by] = p(0.44, 0.69);
  const [cx, cy] = p(0.76, 0.32);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none

    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Rounded-rect coverage.
      const qx = Math.max(radius - px, px - (size - radius), 0);
      const qy = Math.max(radius - py, py - (size - radius), 0);
      const outside = Math.hypot(qx, qy) - radius;
      const tileA = Math.max(0, Math.min(1, 0.5 - outside));

      // Checkmark coverage.
      const d = Math.min(
        distToSegment(px, py, ax, ay, bx, by),
        distToSegment(px, py, bx, by, cx, cy),
      );
      const markA = Math.max(0, Math.min(1, stroke / 2 - d + 0.5));

      const r = Math.round(BG[0] + (FG[0] - BG[0]) * markA);
      const g = Math.round(BG[1] + (FG[1] - BG[1]) * markA);
      const b = Math.round(BG[2] + (FG[2] - BG[2]) * markA);

      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = Math.round(tileA * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, makePng(size));
  console.log(`  icon${size}.png`);
}
