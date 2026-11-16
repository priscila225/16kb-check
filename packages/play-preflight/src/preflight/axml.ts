import type { XmlElement } from "./xml";

/**
 * Decoder for Android binary XML (the AndroidManifest.xml inside an APK).
 * Produces the same element shape as the text XML reader, with "android:" prefixes and enum or
 * flag values turned back into the names used in source manifests, so every check reads one model.
 */

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const RES_STRING_POOL = 0x0001;
const RES_XML = 0x0003;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;
const RES_XML_RESOURCE_MAP = 0x0180;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

/** Framework attribute ids, used when a shrinker has blanked the attribute name in the pool. */
const ATTR_BY_ID: Record<number, string> = {
  0x01010003: "name",
  0x01010024: "value",
  0x0101001e: "screenOrientation",
  0x0101020c: "minSdkVersion",
  0x01010270: "targetSdkVersion",
  0x01010271: "maxSdkVersion",
};

const SCREEN_ORIENTATION: Record<number, string> = {
  [-1]: "unspecified",
  0: "landscape",
  1: "portrait",
  2: "user",
  3: "behind",
  4: "sensor",
  5: "nosensor",
  6: "sensorLandscape",
  7: "sensorPortrait",
  8: "reverseLandscape",
  9: "reversePortrait",
  10: "fullSensor",
  11: "userLandscape",
  12: "userPortrait",
  13: "fullUser",
  14: "locked",
};

const FGS_TYPE_FLAGS: [number, string][] = [
  [1 << 0, "dataSync"],
  [1 << 1, "mediaPlayback"],
  [1 << 2, "phoneCall"],
  [1 << 3, "location"],
  [1 << 4, "connectedDevice"],
  [1 << 5, "mediaProjection"],
  [1 << 6, "camera"],
  [1 << 7, "microphone"],
  [1 << 8, "health"],
  [1 << 9, "remoteMessaging"],
  [1 << 10, "systemExempted"],
  [1 << 11, "shortService"],
  [1 << 12, "fileManagement"],
  [1 << 13, "mediaProcessing"],
  [1 << 30, "specialUse"],
];

const APP_CATEGORY: Record<number, string> = {
  0: "game",
  1: "audio",
  2: "video",
  3: "image",
  4: "social",
  5: "news",
  6: "maps",
  7: "productivity",
  8: "accessibility",
};

function readStringPool(buf: Buffer, off: number): string[] {
  const headerSize = buf.readUInt16LE(off + 2);
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const stringsStart = buf.readUInt32LE(off + 20);
  const utf8 = (flags & (1 << 8)) !== 0;
  const out: string[] = [];
  const base = off + stringsStart;
  for (let i = 0; i < count; i++) {
    let p = base + buf.readUInt32LE(off + headerSize + i * 4);
    if (utf8) {
      // utf16 length, then utf8 byte length, each 1 or 2 bytes.
      let n = buf[p++];
      if (n & 0x80) p++;
      let len = buf[p++];
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf[p++];
      out.push(buf.toString("utf8", p, p + len));
    } else {
      let len = buf.readUInt16LE(p);
      p += 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      out.push(buf.toString("utf16le", p, p + len * 2));
    }
  }
  return out;
}

function fgsFlagsToNames(v: number): string {
  if (v === -1 || v >>> 0 === 0xffffffff) return "manifest";
  const names: string[] = [];
  for (const [bit, name] of FGS_TYPE_FLAGS) if ((v & bit) !== 0) names.push(name);
  return names.join("|") || "none";
}

function typedToString(attrName: string, dataType: number, data: number, raw: string | undefined, strings: string[]): string {
  if (raw !== undefined) return raw;
  switch (dataType) {
    case TYPE_STRING:
      return strings[data >>> 0] ?? "";
    case TYPE_INT_BOOLEAN:
      return data !== 0 ? "true" : "false";
    case TYPE_INT_DEC:
    case TYPE_INT_HEX: {
      const v = data | 0;
      if (attrName === "screenOrientation") return SCREEN_ORIENTATION[v] ?? String(v);
      if (attrName === "foregroundServiceType") return fgsFlagsToNames(v);
      if (attrName === "appCategory") return APP_CATEGORY[v] ?? String(v);
      return dataType === TYPE_INT_HEX ? `0x${(data >>> 0).toString(16)}` : String(v);
    }
    case TYPE_FLOAT: {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(data >>> 0);
      return String(Math.round(b.readFloatLE(0) * 1000) / 1000);
    }
    case TYPE_REFERENCE:
      return `@0x${(data >>> 0).toString(16).padStart(8, "0")}`;
    default:
      return String(data >>> 0);
  }
}

export function isBinaryXml(buf: Buffer): boolean {
  return buf.length >= 8 && buf.readUInt16LE(0) === RES_XML;
}

export function parseBinaryXml(buf: Buffer): XmlElement {
  if (!isBinaryXml(buf)) throw new Error("not Android binary XML");
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let strings: string[] = [];
  let resMap: number[] = [];
  let off = buf.readUInt16LE(2);
  const end = Math.min(buf.length, buf.readUInt32LE(4));
  while (off + 8 <= end) {
    const type = buf.readUInt16LE(off);
    const headerSize = buf.readUInt16LE(off + 2);
    const size = buf.readUInt32LE(off + 4);
    if (size < 8 || off + size > end) break;
    if (type === RES_STRING_POOL) {
      strings = readStringPool(buf, off);
    } else if (type === RES_XML_RESOURCE_MAP) {
      resMap = [];
      for (let p = off + headerSize; p + 4 <= off + size; p += 4) resMap.push(buf.readUInt32LE(p));
    } else if (type === RES_XML_START_ELEMENT) {
      const ext = off + headerSize;
      const nameIdx = buf.readUInt32LE(ext + 4);
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      const el: XmlElement = { name: strings[nameIdx] ?? "", attrs: {}, children: [], text: "" };
      for (let a = 0; a < attrCount; a++) {
        const p = ext + attrStart + a * attrSize;
        const nsIdx = buf.readUInt32LE(p);
        const nIdx = buf.readUInt32LE(p + 4);
        const rawIdx = buf.readUInt32LE(p + 8);
        const dataType = buf[p + 15];
        const data = buf.readUInt32LE(p + 16);
        let local = strings[nIdx] ?? "";
        if (!local && nIdx < resMap.length) local = ATTR_BY_ID[resMap[nIdx]] ?? "";
        if (!local) continue;
        const ns = nsIdx === 0xffffffff ? "" : strings[nsIdx] ?? "";
        const key = ns === ANDROID_NS ? `android:${local}` : local;
        const raw = rawIdx === 0xffffffff ? undefined : strings[rawIdx];
        el.attrs[key] = typedToString(local, dataType, data, raw, strings);
      }
      stack[stack.length - 1].children.push(el);
      stack.push(el);
    } else if (type === RES_XML_END_ELEMENT) {
      if (stack.length > 1) stack.pop();
    }
    off += size;
  }
  return root;
}
