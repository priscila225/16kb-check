/**
 * Compare dotted Android / Maven version strings. Returns negative if `declared` is lower
 * than `minimum`, 0 if equal (ignoring pre-release vs its own pre-release), positive if higher.
 * Pre-release tags (alpha, beta, rc, snapshot) are lower than the same numeric version without one.
 */
export function extractVersionToken(raw: string): string | null {
  const m = String(raw || "").match(/(\d+(?:\.\d+)*(?:[-.][A-Za-z0-9]+)?)/);
  return m ? m[1] : null;
}

export function isMinAny(minVersion: string): boolean {
  return /^any\b/i.test(minVersion.trim());
}

export function isMinNone(minVersion: string): boolean {
  return /^none\b/i.test(minVersion.trim());
}

export function isMinUnknown(minVersion: string): boolean {
  return /^unknown\b/i.test(minVersion.trim());
}

type Part = { n: number; pre: string };

function split(v: string): Part[] {
  const token = extractVersionToken(v) || v;
  // Turn 6000.0.38f1 into 6000.0.38 + pre f1; 1.7.0-rc02 into 1.7.0 + pre rc02
  const [core, ...rest] = token.split(/[-+]/);
  const coreParts = core.split(".");
  const parts: Part[] = coreParts.map((p, i) => {
    const m = p.match(/^(\d+)(.*)$/);
    if (!m) return { n: 0, pre: p.toLowerCase() };
    const preFromCore = m[2] ? m[2].toLowerCase() : "";
    // Pre-release on the last numeric segment (38f1) or from the -rc02 suffix
    const pre = i === coreParts.length - 1 ? (preFromCore || rest.join("-").toLowerCase()) : preFromCore;
    return { n: Number(m[1]), pre };
  });
  if (rest.length && parts.length && !parts[parts.length - 1].pre) {
    parts[parts.length - 1].pre = rest.join("-").toLowerCase();
  }
  return parts;
}

const PRE_RANK: Record<string, number> = {
  snapshot: 0,
  dev: 1,
  alpha: 2,
  a: 2,
  beta: 3,
  b: 3,
  rc: 4,
  cr: 4,
  preview: 4,
};

function preRank(pre: string): [number, number] {
  if (!pre) return [100, 0];
  const m = pre.match(/^([a-z]+)(\d*)$/);
  const tag = m ? m[1] : pre;
  const num = m && m[2] ? Number(m[2]) : 0;
  return [PRE_RANK[tag] ?? 50, num];
}

/** Negative if a < b, 0 if a == b, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = split(a);
  const pb = split(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i] ?? { n: 0, pre: pa[i - 1]?.pre ? "" : "" };
    const xb = pb[i] ?? { n: 0, pre: pb[i - 1]?.pre ? "" : "" };
    // Missing trailing numeric parts count as 0
    const na = pa[i]?.n ?? 0;
    const nb = pb[i]?.n ?? 0;
    if (na !== nb) return na - nb;
  }
  // Compare pre-release on the last defined segment
  const la = pa[pa.length - 1] ?? { n: 0, pre: "" };
  const lb = pb[pb.length - 1] ?? { n: 0, pre: "" };
  // If one side is a prefix of the other with no pre (1.4 vs 1.4.0), treat as equal so far;
  // then compare pre of the longer last part: 1.4 vs 1.4.0-rc is 1.4.0 vs 1.4.0-rc
  const lastA = pa.length >= pb.length ? la : { n: 0, pre: "" };
  const lastB = pb.length >= pa.length ? lb : { n: 0, pre: "" };
  // Use pre from the last component that actually exists on each side
  const [ra, na] = preRank(la.pre);
  const [rb, nb] = preRank(lb.pre);
  if (ra !== rb) return ra - rb;
  if (na !== nb) return na - nb;
  void lastA;
  void lastB;
  return 0;
}

/** True if the declared version meets or exceeds the minimum (when both can be parsed). */
export function meetsMinimum(declared: string, minVersion: string): boolean | null {
  if (isMinAny(minVersion)) return true;
  if (isMinNone(minVersion)) return false;
  if (isMinUnknown(minVersion)) return null;
  const d = extractVersionToken(declared);
  const m = extractVersionToken(minVersion);
  if (!d || !m) return null;
  return compareVersions(d, m) >= 0;
}
