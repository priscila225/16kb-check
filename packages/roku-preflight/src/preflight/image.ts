export type ImageInfo = {
  format: "png" | "jpeg" | "gif" | "unknown";
  width?: number;
  height?: number;
  /** True when the file has an alpha channel or a tRNS transparency chunk. JPEG is never transparent. */
  transparent?: boolean;
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8]);
const GIF87 = Buffer.from("GIF87a");
const GIF89 = Buffer.from("GIF89a");

function startsWith(buf: Buffer, sig: Buffer): boolean {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

function readPng(buf: Buffer): ImageInfo {
  // IHDR starts at offset 8: length(4) type(4) then 13 bytes of data
  if (buf.length < 33) return { format: "png" };
  const type = buf.toString("ascii", 12, 16);
  if (type !== "IHDR") return { format: "png" };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  let transparent = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const chunk = buf.toString("ascii", offset + 4, offset + 8);
    if (chunk === "tRNS") transparent = true;
    if (chunk === "IEND") break;
    offset += 12 + len;
  }
  return { format: "png", width, height, transparent };
}

function readJpeg(buf: Buffer): ImageInfo {
  let i = 2;
  while (i + 9 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0x00 || marker === 0xff) {
      i++;
      continue;
    }
    const size = buf.readUInt16BE(i + 2);
    // SOF0, SOF1, SOF2, SOF3
    if (marker >= 0xc0 && marker <= 0xc3 && i + 9 <= buf.length) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { format: "jpeg", width, height, transparent: false };
    }
    if (size < 2) break;
    i += 2 + size;
  }
  return { format: "jpeg" };
}

function readGif(buf: Buffer): ImageInfo {
  if (buf.length < 10) return { format: "gif" };
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  // GIF may be transparent via a graphic control extension; we don't parse that deeply.
  return { format: "gif", width, height };
}

export function readImage(buf: Buffer): ImageInfo {
  if (startsWith(buf, PNG)) return readPng(buf);
  if (startsWith(buf, JPEG)) return readJpeg(buf);
  if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) return readGif(buf);
  return { format: "unknown" };
}

export function formatSize(width?: number, height?: number): string {
  if (width === undefined || height === undefined) return "unknown size";
  return `${width}x${height}`;
}
