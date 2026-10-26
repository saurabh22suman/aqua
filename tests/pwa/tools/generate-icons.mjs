// Generates the PWA icon set from the Aqua brand mark (app/icon.svg).
//
// Run: node tests/pwa/tools/generate-icons.mjs
//
// No dependencies: the PNG encoder is a few dozen lines of Node built-ins
// (zlib for the IDAT stream, a hand-rolled CRC32 for the chunks). The
// artwork mirrors app/icon.svg — a #B84E00 rounded square, two white
// waves and a white dot — so the installed app looks like the app the
// staff already recognise.
//
// The maskable and apple-touch variants use a full-bleed background and
// scale the white artwork to 60%, which keeps every white pixel inside
// the maskable safe zone (the inner 80% circle) and inside iOS's own
// home-screen rounding.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../../public/icons");

const ORANGE = [184, 78, 0];
const WHITE = [255, 255, 255];

// ---- brand geometry (64x64 viewBox, same numbers as app/icon.svg) ----
const VIEW = 64;
const CORNER_RADIUS = 14;
const WAVE_X0 = 10;
const WAVE_X1 = 54;
const WAVE_PERIOD = 24;
const WAVE_AMPLITUDE = 3;
const WAVE_STROKE = 5;
const DOT = { x: 45, y: 21, r: 7 };

const waveY = (centre, x) =>
  centre + WAVE_AMPLITUDE * Math.cos((2 * Math.PI * (x - WAVE_X0)) / WAVE_PERIOD);
const waveSlope = (centre, x) =>
  (-WAVE_AMPLITUDE * 2 * Math.PI * Math.sin((2 * Math.PI * (x - WAVE_X0)) / WAVE_PERIOD)) /
  WAVE_PERIOD;

/** Signed distance to a rounded rectangle centred on the origin. */
function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * One supersample: returns [r, g, b, a] with straight (not
 * premultiplied) alpha.
 */
function sample(px, py, mode) {
  let colour = [0, 0, 0];
  let alpha = 0;

  const over = (src, srcAlpha) => {
    colour = [
      src[0] * srcAlpha + colour[0] * (1 - srcAlpha),
      src[1] * srcAlpha + colour[1] * (1 - srcAlpha),
      src[2] * srcAlpha + colour[2] * (1 - srcAlpha),
    ];
    alpha = srcAlpha + alpha * (1 - srcAlpha);
  };

  if (mode === "any") {
    const distance = roundedRectDistance(
      px - VIEW / 2,
      py - VIEW / 2,
      VIEW / 2,
      VIEW / 2,
      CORNER_RADIUS,
    );
    if (distance <= 0) over(ORANGE, 1);
  } else {
    over(ORANGE, 1);
  }

  // The white artwork is drawn at 60% around the canvas centre for the
  // masked variants so it stays inside the safe zone.
  const scale = mode === "any" ? 1 : 0.6;
  const ax = (px - VIEW / 2) / scale + VIEW / 2;
  const ay = (py - VIEW / 2) / scale + VIEW / 2;

  if (ax >= WAVE_X0 - WAVE_STROKE && ax <= WAVE_X1 + WAVE_STROKE) {
    for (const [centre, opacity] of [[35, 1], [45, 0.7]]) {
      const vertical = Math.abs(ay - waveY(centre, ax));
      const slope = waveSlope(centre, ax);
      const perpendicular = vertical / Math.sqrt(1 + slope * slope);
      if (perpendicular <= WAVE_STROKE / 2) over(WHITE, opacity);
    }
  }

  const dotDistance = Math.hypot(ax - DOT.x, ay - DOT.y);
  if (dotDistance <= DOT.r) over(WHITE, 1);

  return [colour[0], colour[1], colour[2], alpha];
}

// ---- PNG encoding -----------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- rendering ---------------------------------------------------------
const SUPERSAMPLE = 4;

function render(size, mode) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = VIEW / (size * SUPERSAMPLE);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = (x * SUPERSAMPLE + sx + 0.5) * step;
          const py = (y * SUPERSAMPLE + sy + 0.5) * step;
          const [cr, cg, cb, ca] = sample(px, py, mode);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const count = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / count;
      const offset = (y * size + x) * 4;
      // Un-premultiply so the PNG carries straight alpha.
      pixels[offset] = alpha > 0 ? Math.round(r / a) : 0;
      pixels[offset + 1] = alpha > 0 ? Math.round(g / a) : 0;
      pixels[offset + 2] = alpha > 0 ? Math.round(b / a) : 0;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, pixels);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ["aqua-192.png", 192, "any"],
  ["aqua-512.png", 512, "any"],
  ["aqua-maskable-512.png", 512, "maskable"],
  ["aqua-apple-touch-icon.png", 180, "apple"],
];
for (const [name, size, mode] of files) {
  writeFileSync(resolve(OUT, name), render(size, mode));
  console.log(`wrote public/icons/${name} (${size}x${size}, ${mode})`);
}
