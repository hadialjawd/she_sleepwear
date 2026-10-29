// Draws the PNG app icons in code (same shape as public/icon.svg),
// so the repo has no image files. Phones that can't use SVG icons use these.

const BRAND = [0xa8, 0x47, 0x6a];
const SHIRT = [[176, 120], [336, 120], [408, 184], [364, 236], [336, 214], [336, 392], [176, 392], [176, 214], [148, 236], [104, 184]];
const BUTTONS = [[256, 250], [256, 290], [256, 330]];

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y) {
  const r = 112;
  const cx = Math.min(Math.max(x, r), 512 - r);
  const cy = Math.min(Math.max(y, r), 512 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Color of one point on the 512x512 design: null = transparent
function sample(x, y) {
  if (!inRoundedSquare(x, y)) return null;
  if (BUTTONS.some(([bx, by]) => (x - bx) ** 2 + (y - by) ** 2 <= 81)) return BRAND;
  if (inPolygon(x, y, SHIRT)) return [255, 255, 255];
  return BRAND;
}

function draw(size) {
  const scale = 512 / size;
  const rows = new Uint8Array(size * (size * 4 + 1));
  const sub = [0.25, 0.75]; // 2x2 samples per pixel for smooth edges
  let o = 0;
  for (let py = 0; py < size; py++) {
    rows[o++] = 0; // PNG filter type: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const sy of sub) {
        for (const sx of sub) {
          const c = sample((px + sx) * scale, (py + sy) * scale);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      rows[o++] = a ? Math.round(r / a) : 0;
      rows[o++] = a ? Math.round(g / a) : 0;
      rows[o++] = a ? Math.round(b / a) : 0;
      rows[o++] = Math.round((a / 4) * 255);
    }
  }
  return rows;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function png(size) {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(draw(size))),
    chunk('IEND', new Uint8Array()),
  ];
  return new Blob(parts).arrayBuffer();
}

const cache = new Map();
const SIZES = { '/icon-192.png': 192, '/icon-512.png': 512 };

export function isIcon(path) {
  return path in SIZES;
}

export async function iconResponse(path) {
  if (!cache.has(path)) cache.set(path, await png(SIZES[path]));
  return new Response(cache.get(path), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' },
  });
}
