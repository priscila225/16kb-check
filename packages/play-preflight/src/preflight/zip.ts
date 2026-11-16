import { inflateRawSync } from "node:zlib";

/** Minimal read-only ZIP reader for APK and AAB files. Everything stays in memory on this machine. */
export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  /** Offset of the entry's data in the file (after the local header). */
  dataOffset: number;
};

export type ZipFile = {
  entries: ZipEntry[];
  read(entry: ZipEntry): Buffer;
};

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;

export function openZip(buf: Buffer): ZipFile {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory record)");
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z64) !== ZIP64_EOCD) throw new Error("broken zip64 record");
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) throw new Error("broken zip central directory");
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // zip64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(buf.readBigUInt64LE(q));
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + len;
    }
    if (buf.readUInt32LE(localHeaderOffset) !== LOC) throw new Error(`broken local header for ${name}`);
    const dataOffset = localHeaderOffset + 30 + buf.readUInt16LE(localHeaderOffset + 26) + buf.readUInt16LE(localHeaderOffset + 28);
    entries.push({ name, method, compressedSize, size, localHeaderOffset, dataOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    entries,
    read(entry: ZipEntry): Buffer {
      const raw = buf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflateRawSync(raw);
      throw new Error(`unsupported zip compression method ${entry.method} for ${entry.name}`);
    },
  };
}
