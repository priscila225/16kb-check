export type ManifestEntry = {
  key: string;
  value: string;
  line: number;
};

export type ManifestInfo = {
  raw: string;
  file: string;
  /** True when the file ends with a newline, as Roku requires. */
  trailingNewline: boolean;
  entries: ManifestEntry[];
  values: Record<string, string>;
  lines: Record<string, number>;
};

/**
 * Parse a Roku manifest: name=value lines, # comments, empty lines ignored.
 * Keys are case-sensitive per the official docs.
 */
export function parseManifest(raw: string, file = "manifest"): ManifestInfo {
  const trailingNewline = raw.length > 0 && (raw.endsWith("\n") || raw.endsWith("\r\n"));
  const entries: ManifestEntry[] = [];
  const values: Record<string, string> = {};
  const lines: Record<string, number> = {};
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = text.split("\n");
  // split leaves a trailing empty element when the file ends with a newline
  rawLines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    entries.push({ key, value, line: lineNo });
    values[key] = value;
    lines[key] = lineNo;
  });
  return { raw, file, trailingNewline, entries, values, lines };
}

export function manifestGet(m: ManifestInfo, key: string): string | undefined {
  return m.values[key];
}

export function pkgPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v.toLowerCase().startsWith("pkg:/")) return v.slice("pkg:/".length);
  return undefined;
}

export function isStandaloneScreensaver(m: ManifestInfo): boolean {
  return manifestGet(m, "screensaver_title") !== undefined;
}

export function versionTriple(m: ManifestInfo): { major: string; minor: string; build: string } {
  return {
    major: manifestGet(m, "major_version") ?? "",
    minor: manifestGet(m, "minor_version") ?? "",
    build: manifestGet(m, "build_version") ?? "",
  };
}

export function formatVersion(m: ManifestInfo): string | undefined {
  const v = versionTriple(m);
  if (!v.major && !v.minor && !v.build) return undefined;
  const build = v.build.replace(/^0+(?=\d)/, "") || v.build;
  return [v.major || "0", v.minor || "0", build || "0"].join(".");
}

export function isAllZeroVersion(m: ManifestInfo): boolean {
  const v = versionTriple(m);
  const n = (s: string) => Number.parseInt(s.replace(/^0+(?=\d)/, "") || "0", 10);
  if (!v.major && !v.minor && !v.build) return false;
  return n(v.major) === 0 && n(v.minor) === 0 && n(v.build) === 0;
}
