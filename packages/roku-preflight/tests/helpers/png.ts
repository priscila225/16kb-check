import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** A tiny valid PNG of the given size. Pass alpha 0 for a transparent image (fails criterion 6.4). */
export function makePng(width: number, height: number, opts: { alpha?: number } = {}): Buffer {
  const hasAlpha = opts.alpha !== undefined;
  const colorType = hasAlpha ? 6 : 2;
  const bpp = hasAlpha ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(colorType, 9);
  const row = Buffer.alloc(1 + width * bpp);
  if (hasAlpha) {
    const a = opts.alpha ?? 0;
    for (let x = 0; x < width; x++) {
      row[1 + x * 4] = 0x20;
      row[1 + x * 4 + 1] = 0x40;
      row[1 + x * 4 + 2] = 0x80;
      row[1 + x * 4 + 3] = a;
    }
  } else {
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = 0x20;
      row[1 + x * 3 + 1] = 0x40;
      row[1 + x * 3 + 2] = 0x80;
    }
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
