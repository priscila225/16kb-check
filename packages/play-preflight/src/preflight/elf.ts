/** Read the PT_LOAD alignment of an ELF shared library (.so). Pure local parsing. */
export type ElfInfo = {
  bits: 32 | 64;
  machine: number;
  /** Smallest p_align across PT_LOAD segments. */
  minLoadAlign: number;
  loadSegments: number;
};

export const PAGE_16KB = 0x4000;

export function readElf(buf: Buffer): ElfInfo {
  if (buf.length < 52 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    throw new Error("not an ELF file");
  }
  const bits = buf[4] === 2 ? 64 : buf[4] === 1 ? 32 : 0;
  if (!bits) throw new Error("unknown ELF class");
  const le = buf[5] !== 2;
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = (o: number) => Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o));
  const machine = u16(18);
  const phoff = bits === 64 ? u64(32) : u32(28);
  const phentsize = bits === 64 ? u16(54) : u16(42);
  const phnum = bits === 64 ? u16(56) : u16(44);
  let minLoadAlign = Number.POSITIVE_INFINITY;
  let loadSegments = 0;
  for (let i = 0; i < phnum; i++) {
    const ph = phoff + i * phentsize;
    if (ph + phentsize > buf.length) throw new Error("ELF program headers are truncated");
    if (u32(ph) !== 1) continue; // PT_LOAD
    const align = bits === 64 ? u64(ph + 48) : u32(ph + 28);
    loadSegments++;
    if (align < minLoadAlign) minLoadAlign = align;
  }
  return { bits: bits as 32 | 64, machine, minLoadAlign: loadSegments ? minLoadAlign : 0, loadSegments };
}
