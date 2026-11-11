import type { CatalogEntry, CheckReport, DeclaredDep, ParseResult, ReportRow, ReportVerdict } from "./types";
import { likelyFineReason } from "./known-jvm";
import { isCandidatePublicCoordinate } from "./public-coords";
import { isMinAny, isMinNone, isMinUnknown, meetsMinimum } from "./versions";

export function coordKey(group: string, artifact: string): string {
  return `${group}:${artifact}`.toLowerCase();
}

export function coordMatches(pattern: string, group: string, artifact: string): boolean {
  const p = pattern.trim();
  const i = p.lastIndexOf(":");
  if (i < 0) return false;
  const g = p.slice(0, i);
  const a = p.slice(i + 1);
  if (g !== group && g !== "*") return false;
  if (a === "*" || a === "") return true;
  if (a.endsWith("*")) return artifact.startsWith(a.slice(0, -1));
  return a === artifact;
}

export function findEntry(entries: CatalogEntry[], group: string, artifact: string): CatalogEntry | undefined {
  // Exact aliases first, then wildcards, longer/more specific first
  const exact: CatalogEntry[] = [];
  const wild: { e: CatalogEntry; pat: string }[] = [];
  for (const e of entries) {
    for (const pat of e.mavenCoords || []) {
      if (pat.includes("*")) {
        if (coordMatches(pat, group, artifact)) wild.push({ e, pat });
      } else if (coordMatches(pat, group, artifact)) {
        exact.push(e);
      }
    }
  }
  if (exact.length) return exact[0];
  wild.sort((a, b) => b.pat.length - a.pat.length);
  return wild[0]?.e;
}

function mapboxNote(artifact: string): string | null {
  if (artifact === "android-ndk27") {
    return "You are on the NDK 27 artifact, which Mapbox documents as the 16 KB build. The database still marks this entry as partial because the private Maven repo could not be unpacked to confirm the binaries.";
  }
  if (artifact === "android" || artifact === "mapbox-android-sdk") {
    return "Mapbox's default artifact is not the 16 KB build. Switch to the -ndk27 artifact (for example com.mapbox.maps:android-ndk27) from 11.7.0 or 10.19.0.";
  }
  return null;
}

function rowFor(dep: DeclaredDep, entries: CatalogEntry[]): ReportRow {
  const coordinate = `${dep.group}:${dep.artifact}`;
  const base = {
    group: dep.group,
    artifact: dep.artifact,
    coordinate,
    declaredVersion: dep.version,
    versionSource: dep.versionSource,
    configuration: dep.configuration,
    sourceFile: dep.sourceFile,
    catalogAlias: dep.catalogAlias,
    bom: dep.bom,
  };

  // Unresolved catalog alias
  if (dep.group === "libs") {
    return {
      ...base,
      verdict: "unknown",
      detail: `Could not resolve catalog alias libs.${dep.artifact}. Upload libs.versions.toml alongside the Gradle file.`,
    };
  }

  const entry = findEntry(entries, dep.group, dep.artifact);
  if (entry) {
    const mb = entry.slug === "mapbox-maps-android" ? mapboxNote(dep.artifact) : null;
    const versionLabel = dep.version || (dep.bom ? `from ${dep.bom}` : "not declared");
    const common = { ...base, entry: { slug: entry.slug, name: entry.name, status: entry.status, minVersion: entry.minVersion, notes: entry.notes } };

    if (entry.status === "checking") {
      return {
        ...common,
        verdict: "checking",
        detail: `${entry.name}: we are checking the published artifact now.`,
      };
    }
    if (entry.status === "needs-review") {
      return {
        ...common,
        verdict: "needs-review",
        detail: `${entry.name} needs a manual review.${entry.notes ? " " + entry.notes : ""} Declared: ${versionLabel}.`,
      };
    }
    if (entry.status === "not-yet") {
      return {
        ...common,
        verdict: "not-yet",
        detail: `${entry.name} is not 16 KB compatible (${entry.minVersion || "no compatible version"}). Declared: ${versionLabel}.`,
      };
    }

    if (entry.status === "unknown") {
      return {
        ...common,
        verdict: "unknown",
        detail: `${entry.name} is in the database but its 16 KB status is still unknown. Declared: ${versionLabel}.`,
      };
    }

    if (isMinAny(entry.minVersion)) {
      return {
        ...common,
        verdict: entry.status === "partial" ? "partial" : "compatible",
        detail:
          entry.status === "partial"
            ? `${entry.name}: this module itself may be fine, but the entry is only partial. ${entry.minVersion}. Declared: ${versionLabel}.`
            : `${entry.name} has no native libraries, so any version is compatible. Declared: ${versionLabel}.`,
      };
    }

    if (isMinUnknown(entry.minVersion) || entry.status === "partial") {
      const meets = dep.version ? meetsMinimum(dep.version, entry.minVersion) : null;
      if (meets === false) {
        return {
          ...common,
          verdict: "update-needed",
          detail: `${entry.name}: declared ${versionLabel} is below the minimum documented version ${entry.minVersion}.${mb ? " " + mb : ""}`,
        };
      }
      return {
        ...common,
        verdict: "partial",
        detail: mb || `${entry.name} is only partly compatible. Minimum documented version: ${entry.minVersion}. Declared: ${versionLabel}.`,
      };
    }

    // compatible with a numeric (or extractable) minimum
    if (!dep.version) {
      return {
        ...common,
        verdict: "unknown",
        detail: `${entry.name} is compatible from ${entry.minVersion}, but no version was declared${dep.bom ? ` (managed by ${dep.bom}; BOM versions are not expanded)` : ""}.`,
      };
    }
    const meets = meetsMinimum(dep.version, entry.minVersion);
    if (meets === false) {
      return {
        ...common,
        verdict: "update-needed",
        detail: `${entry.name}: declared ${dep.version} is below the minimum 16 KB-safe version ${entry.minVersion}.`,
      };
    }
    if (meets === true) {
      return {
        ...common,
        verdict: "compatible",
        detail: `${entry.name}: declared ${dep.version} meets the minimum ${entry.minVersion}.`,
      };
    }
    return {
      ...common,
      verdict: "unknown",
      detail: `${entry.name} is in the database (minimum ${entry.minVersion}) but the declared version ${versionLabel} could not be compared.`,
    };
  }

  const reason = likelyFineReason(dep.group, dep.artifact);
  if (reason) {
    return {
      ...base,
      verdict: "likely-fine",
      detail: reason,
      likelyFineReason: reason,
    };
  }

  return {
    ...base,
    verdict: "unknown",
    detail: isCandidatePublicCoordinate(coordinate)
      ? "We haven't checked this one yet. If it is a public SDK, we will start an automated check."
      : "We haven't checked this one yet. Private and internal SDKs stay on your device and are never sent to us.",
  };
}

const VERDICT_ORDER: ReportVerdict[] = ["not-yet", "update-needed", "partial", "needs-review", "checking", "unknown", "likely-fine", "compatible"];

export function buildReport(parsed: ParseResult, entries: CatalogEntry[]): CheckReport {
  const rows = parsed.dependencies.map((d) => rowFor(d, entries));
  rows.sort((a, b) => {
    const d = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
    return d || a.coordinate.localeCompare(b.coordinate);
  });

  const counts: CheckReport["counts"] = {
    compatible: 0,
    "update-needed": 0,
    "not-yet": 0,
    partial: 0,
    checking: 0,
    "needs-review": 0,
    unknown: 0,
    "likely-fine": 0,
  };
  for (const r of rows) counts[r.verdict]++;

  const blocking = counts["not-yet"] + counts["update-needed"] + counts.partial;
  const unmatchedCoordinates = rows.filter((r) => r.verdict === "unknown" && !r.entry && r.group !== "libs").map((r) => r.coordinate);

  const notes: string[] = [];
  const hasCompose = rows.some((r) => r.group.startsWith("androidx.compose"));
  const hasGraphicsPath = rows.some((r) => r.group === "androidx.graphics" && r.artifact === "graphics-path");
  if (hasCompose && !hasGraphicsPath) {
    notes.push("Jetpack Compose transitively pulls in androidx.graphics:graphics-path, which has native code. It is in this database and is compatible from version 1.0.0.");
  }
  notes.push("This report only sees dependencies you declared, not every transitive library Gradle would resolve.");
  if (parsed.boms.length) {
    notes.push("BOM / platform versions are recorded but not expanded to a concrete module version, except when the SDK is compatible at any version.");
  }

  const verdictLine = verdictText(blocking, counts, rows.length);

  return { rows, counts, blocking, verdictLine, notes, files: parsed.files, issues: parsed.issues, unmatchedCoordinates };
}

export function verdictText(blocking: number, counts: CheckReport["counts"], total: number): string {
  if (total === 0) return "No library coordinates were found in the files you provided.";
  if (blocking === 0) {
    const unknown = counts.unknown;
    if (counts.checking) return `No known blockers for the Feb 1, 2027 deadline among the libraries we could already match. We are automatically checking ${counts.checking} more.`;
    if (unknown) return `No known blockers for the Feb 1, 2027 deadline among the libraries we could match. ${unknown} ${unknown === 1 ? "library is" : "libraries are"} not in the database yet.`;
    return "No known blockers for the Feb 1, 2027 deadline in the libraries we could check.";
  }
  const n = blocking;
  const noun = n === 1 ? "library" : "libraries";
  const verb = n === 1 ? "may block" : "may block";
  return `${n} ${noun} ${verb} your Feb 1, 2027 release.`;
}


export function markPublicChecking(report: CheckReport, coordinates: string[]): CheckReport {
  const set = new Set(coordinates.map((c) => c.toLowerCase()));
  if (!set.size) return report;
  const rows = report.rows.map((r) => {
    if (r.verdict === "unknown" && !r.entry && set.has(r.coordinate.toLowerCase())) {
      return { ...r, verdict: "checking" as const, detail: "We are checking the published artifact now." };
    }
    return r;
  });
  const counts: CheckReport["counts"] = {
    compatible: 0,
    "update-needed": 0,
    "not-yet": 0,
    partial: 0,
    checking: 0,
    "needs-review": 0,
    unknown: 0,
    "likely-fine": 0,
  };
  for (const r of rows) counts[r.verdict]++;
  const blocking = counts["not-yet"] + counts["update-needed"] + counts.partial;
  return { ...report, rows, counts, blocking, verdictLine: verdictText(blocking, counts, rows.length) };
}

export function reportToMarkdown(report: CheckReport): string {
  const lines: string[] = [];
  lines.push("# 16 KB project check");
  lines.push("");
  lines.push(report.verdictLine);
  lines.push("");
  lines.push(
    `Compatible: ${report.counts.compatible} · Update needed: ${report.counts["update-needed"]} · Not yet: ${report.counts["not-yet"]} · Partial: ${report.counts.partial} · Checking: ${report.counts.checking} · Needs review: ${report.counts["needs-review"]} · Unknown: ${report.counts.unknown} · Likely fine: ${report.counts["likely-fine"]}`,
  );
  lines.push("");
  if (report.files.length) {
    lines.push("Files: " + report.files.map((f) => `${f.name} (${f.kind})`).join(", "));
    lines.push("");
  }
  lines.push("| Library | Declared | Status | Notes |");
  lines.push("|---|---|---|---|");
  for (const r of report.rows) {
    const name = r.entry ? `[${r.entry.name}](https://16kb.dev/sdk/${r.entry.slug})` : r.coordinate;
    const declared = r.declaredVersion || (r.bom ? `BOM ${r.bom}` : "—");
    const status =
      r.verdict === "update-needed" && r.entry
        ? `Update needed (min ${r.entry.minVersion})`
        : r.verdict === "likely-fine"
          ? "Likely fine (no native code known)"
          : r.verdict === "not-yet"
            ? "Not yet"
            : r.verdict === "compatible"
              ? "Compatible"
              : r.verdict === "partial"
                ? "Partial"
                : "Unknown";
    const note = r.detail.replace(/\|/g, "/");
    lines.push(`| ${name} (\`${r.coordinate}\`) | ${declared} | ${status} | ${note} |`);
  }
  if (report.notes.length) {
    lines.push("");
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push("Generated by https://16kb.dev/check — files are read in your browser and never uploaded.");
  return lines.join("\n");
}

export type SharePayload = {
  v: 1;
  files: string[];
  deps: { g: string; a: string; ver: string; vs?: string; bom?: string; cfg?: string }[];
};

export function toSharePayload(parsed: ParseResult): SharePayload {
  return {
    v: 1,
    files: parsed.files.map((f) => f.name),
    deps: parsed.dependencies.map((d) => ({
      g: d.group,
      a: d.artifact,
      ver: d.version,
      vs: d.versionSource === "declared" ? undefined : d.versionSource,
      bom: d.bom,
      cfg: d.configuration === "implementation" ? undefined : d.configuration,
    })),
  };
}

export function fromSharePayload(payload: SharePayload): ParseResult {
  const dependencies: DeclaredDep[] = (payload.deps || []).map((d) => ({
    group: d.g,
    artifact: d.a,
    version: d.ver || "",
    versionSource: (d.vs as DeclaredDep["versionSource"]) || (d.ver ? "declared" : d.bom ? "bom" : "missing"),
    configuration: d.cfg || "implementation",
    bom: d.bom,
    sourceFile: payload.files[0] || "shared",
  }));
  return {
    dependencies,
    boms: [],
    files: (payload.files || []).map((name) => ({ name, kind: "unknown" as const, depCount: 0 })),
    issues: [],
  };
}

export function encodeShare(parsed: ParseResult): string {
  const json = JSON.stringify(toSharePayload(parsed));
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeShare(hash: string): SharePayload | null {
  try {
    const raw = hash.replace(/^#?r=/, "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(pad))) : Buffer.from(pad, "base64").toString("utf8");
    const p = JSON.parse(json) as SharePayload;
    if (p && p.v === 1 && Array.isArray(p.deps)) return p;
    return null;
  } catch {
    return null;
  }
}
