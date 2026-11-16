/**
 * Builders for tiny synthetic APK/AAB parts used as test fixtures: ELF shared objects,
 * Android binary XML manifests and ZIP files. No real apps are used.
 */
import { deflateRawSync } from "node:zlib";

export function makeElf(opts: { bits?: 32 | 64; align: number; loads?: number; machine?: number }): Buffer {
  const bits = opts.bits ?? 64;
  const loads = opts.loads ?? 2;
  const ehsize = bits === 64 ? 64 : 52;
  const phentsize = bits === 64 ? 56 : 32;
  const buf = Buffer.alloc(ehsize + phentsize * (loads + 1) + 16);
  buf.set([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, 1, 1], 0);
  buf.writeUInt16LE(3, 16); // ET_DYN
  buf.writeUInt16LE(opts.machine ?? (bits === 64 ? 0xb7 : 0x28), 18);
  if (bits === 64) {
    buf.writeBigUInt64LE(BigInt(ehsize), 32);
    buf.writeUInt16LE(phentsize, 54);
    buf.writeUInt16LE(loads + 1, 56);
  } else {
    buf.writeUInt32LE(ehsize, 28);
    buf.writeUInt16LE(phentsize, 42);
    buf.writeUInt16LE(loads + 1, 44);
  }
  // One PT_DYNAMIC (ignored) then the PT_LOAD segments.
  for (let i = 0; i <= loads; i++) {
    const ph = ehsize + i * phentsize;
    buf.writeUInt32LE(i === 0 ? 2 : 1, ph);
    if (bits === 64) buf.writeBigUInt64LE(BigInt(i === 0 ? 8 : opts.align), ph + 48);
    else buf.writeUInt32LE(i === 0 ? 4 : opts.align, ph + 28);
  }
  return buf;
}

export type AxmlAttr = { name: string; android?: boolean; value: string | number | boolean; type?: "string" | "int" | "hex" | "bool" };
export type AxmlNode = { name: string; attrs?: AxmlAttr[]; children?: AxmlNode[] };

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

export function makeAxml(root: AxmlNode): Buffer {
  const strings: string[] = [];
  const idx = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) {
      strings.push(s);
      i = strings.length - 1;
    }
    return i;
  };
  idx("android");
  idx(ANDROID_NS);
  const chunks: Buffer[] = [];
  const node = (type: number, ext: Buffer) => {
    const h = Buffer.alloc(16);
    h.writeUInt16LE(type, 0);
    h.writeUInt16LE(16, 2);
    h.writeUInt32LE(16 + ext.length, 4);
    h.writeUInt32LE(1, 8);
    h.writeUInt32LE(0xffffffff, 12);
    chunks.push(Buffer.concat([h, ext]));
  };
  const ns = Buffer.alloc(8);
  ns.writeUInt32LE(idx("android"), 0);
  ns.writeUInt32LE(idx(ANDROID_NS), 4);
  node(0x0100, ns);
  const walk = (n: AxmlNode) => {
    const attrs = n.attrs ?? [];
    const ext = Buffer.alloc(20 + attrs.length * 20);
    ext.writeUInt32LE(0xffffffff, 0);
    ext.writeUInt32LE(idx(n.name), 4);
    ext.writeUInt16LE(20, 8);
    ext.writeUInt16LE(20, 10);
    ext.writeUInt16LE(attrs.length, 12);
    attrs.forEach((a, i) => {
      const p = 20 + i * 20;
      ext.writeUInt32LE(a.android === false ? 0xffffffff : idx(ANDROID_NS), p);
      ext.writeUInt32LE(idx(a.name), p + 4);
      const type = a.type ?? (typeof a.value === "boolean" ? "bool" : typeof a.value === "number" ? "int" : "string");
      ext.writeUInt16LE(8, p + 12);
      if (type === "string") {
        const si = idx(String(a.value));
        ext.writeUInt32LE(si, p + 8);
        ext[p + 15] = 0x03;
        ext.writeUInt32LE(si, p + 16);
      } else {
        ext.writeUInt32LE(0xffffffff, p + 8);
        ext[p + 15] = type === "bool" ? 0x12 : type === "hex" ? 0x11 : 0x10;
        const v = type === "bool" ? (a.value ? 0xffffffff : 0) : Number(a.value) >>> 0;
        ext.writeUInt32LE(v, p + 16);
      }
    });
    node(0x0102, ext);
    for (const c of n.children ?? []) walk(c);
    const end = Buffer.alloc(8);
    end.writeUInt32LE(0xffffffff, 0);
    end.writeUInt32LE(idx(n.name), 4);
    node(0x0103, end);
  };
  walk(root);
  // String pool (UTF-16)
  const bodies = strings.map((s) => {
    const b = Buffer.alloc(2 + s.length * 2 + 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, "utf16le");
    return b;
  });
  const offsets = Buffer.alloc(strings.length * 4);
  let o = 0;
  bodies.forEach((b, i) => {
    offsets.writeUInt32LE(o, i * 4);
    o += b.length;
  });
  let data = Buffer.concat(bodies);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const sp = Buffer.alloc(28);
  sp.writeUInt16LE(0x0001, 0);
  sp.writeUInt16LE(28, 2);
  sp.writeUInt32LE(28 + offsets.length + data.length, 4);
  sp.writeUInt32LE(strings.length, 8);
  sp.writeUInt32LE(0, 12);
  sp.writeUInt32LE(0, 16);
  sp.writeUInt32LE(28 + offsets.length, 20);
  sp.writeUInt32LE(0, 24);
  const pool = Buffer.concat([sp, offsets, data]);
  const body = Buffer.concat([pool, ...chunks]);
  const head = Buffer.alloc(8);
  head.writeUInt16LE(0x0003, 0);
  head.writeUInt16LE(8, 2);
  head.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

export type ZipInput = { name: string; data: Buffer; store?: boolean; align?: number };

export function makeZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = e.store ? e.data : deflateRawSync(e.data);
    const headerLen = 30 + name.length;
    let pad = 0;
    if (e.store && e.align) pad = (e.align - ((offset + headerLen) % e.align)) % e.align;
    const extra = Buffer.alloc(pad);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.store ? 0 : 8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(e.store ? 0 : 8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(lh, name, extra, comp);
    central.push(cd, name);
    offset += 30 + name.length + extra.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/** A small manifest tree for synthetic APKs. */
export function manifestTree(opts: {
  targetSdk: number;
  permissions?: string[];
  features?: string[];
  application?: AxmlAttr[];
  activities?: AxmlNode[];
  services?: AxmlNode[];
  metaData?: Record<string, string>;
}): AxmlNode {
  return {
    name: "manifest",
    attrs: [{ name: "package", android: false, value: "dev.example.binary" }],
    children: [
      { name: "uses-sdk", attrs: [{ name: "minSdkVersion", value: 24 }, { name: "targetSdkVersion", value: opts.targetSdk }] },
      ...(opts.permissions ?? []).map((p) => ({ name: "uses-permission", attrs: [{ name: "name", value: `android.permission.${p}` }] })),
      ...(opts.features ?? []).map((f) => ({ name: "uses-feature", attrs: [{ name: "name", value: f }] })),
      {
        name: "application",
        attrs: opts.application ?? [],
        children: [
          ...(opts.activities ?? []),
          ...(opts.services ?? []),
          ...Object.entries(opts.metaData ?? {}).map(([k, v]) => ({
            name: "meta-data",
            attrs: [
              { name: "name", value: k },
              { name: "value", value: v },
            ],
          })),
        ],
      },
    ],
  };
}
