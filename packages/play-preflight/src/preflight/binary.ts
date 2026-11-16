import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { openZip } from "./zip";
import { PAGE_16KB, readElf } from "./elf";
import { parseBinaryXml } from "./axml";
import { mergeManifests, readManifest, type ManifestInfo } from "./manifest";

export type NativeLib = {
  path: string;
  abi: string;
  /** Smallest PT_LOAD p_align, or 0 when the file couldn't be read as ELF. */
  align: number;
  elfAligned: boolean;
  /** Uncompressed in the APK and its data doesn't start on a 16 KB boundary. */
  zipMisaligned: boolean;
  compressed: boolean;
  error?: string;
};

export type BinaryScan = {
  kind: "apk" | "aab";
  file: string;
  manifest?: ManifestInfo;
  manifestNote?: string;
  nativeLibs: NativeLib[];
};

/** ABIs where Play's 16 KB rule applies (64-bit). */
export const ABIS_64 = new Set(["arm64-v8a", "x86_64"]);

export function scanBinary(path: string, kind: "apk" | "aab"): BinaryScan {
  const buf = readFileSync(path);
  const zip = openZip(buf);
  const out: BinaryScan = { kind, file: basename(path), nativeLibs: [] };

  if (kind === "apk") {
    const m = zip.entries.find((e) => e.name === "AndroidManifest.xml");
    if (m) {
      try {
        out.manifest = mergeManifests([readManifest(parseBinaryXml(zip.read(m)), `${out.file}!/AndroidManifest.xml`)]);
      } catch (e) {
        out.manifestNote = `Couldn't read the APK manifest: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      out.manifestNote = "The APK has no AndroidManifest.xml.";
    }
  } else {
    out.manifestNote = "Reading the AAB manifest (protobuf) comes in a later version. Manifest checks used the project folder if there was one.";
  }

  // APK: lib/<abi>/x.so. AAB: <module>/lib/<abi>/x.so.
  const libRe = kind === "apk" ? /^lib\/([^/]+)\/[^/]+\.so$/ : /^[^/]+\/lib\/([^/]+)\/[^/]+\.so$/;
  for (const e of zip.entries) {
    const m = libRe.exec(e.name);
    if (!m || !ABIS_64.has(m[1])) continue;
    const lib: NativeLib = {
      path: e.name,
      abi: m[1],
      align: 0,
      elfAligned: false,
      zipMisaligned: kind === "apk" && e.method === 0 && e.dataOffset % PAGE_16KB !== 0,
      compressed: e.method !== 0,
    };
    try {
      const elf = readElf(zip.read(e));
      lib.align = elf.minLoadAlign;
      lib.elfAligned = elf.minLoadAlign >= PAGE_16KB;
    } catch (err) {
      lib.error = err instanceof Error ? err.message : String(err);
    }
    out.nativeLibs.push(lib);
  }
  return out;
}
