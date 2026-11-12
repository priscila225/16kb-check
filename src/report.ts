import type { CheckReport, ReportRow } from "./check/types";
import { verdictText } from "./check/match";
import { DEADLINE_NOTE, DEADLINE_SOURCE, SCOPE_NOTE, SETTLING_NOTE, toCliStatus, type CliStatus } from "./status";
import { AGP_MIN_16KB, checkAgp, type AgpCheck } from "./check/agp";
import { isCandidatePublicCoordinate } from "./check/public-coords";

export type CliRow = {
  sdk: string;
  version: string;
  /** Full BOM coordinate when the version is managed by a public BOM. */
  bom?: string;
  status: CliStatus;
  minVersion: string;
  link: string;
  detail: string;
  plugin: boolean;
};

export type CliPlugin = {
  id: string;
  version: string;
  agp: boolean;
};

export type ReportExtras = {
  /** Public build plugins. Private or unrecognized plugin ids are only counted. */
  plugins?: CliPlugin[];
  hiddenPlugins?: number;
  /** Test-only dependencies left out of the readiness counts. */
  testOnlyIgnored?: number;
  /** Build-logic and Gradle plugin artifacts left out of the readiness counts. */
  buildToolingIgnored?: number;
  agp?: AgpCheck;
  checkedAt?: string;
};

export type CliJson = {
  checkedAt: string;
  summary: {
    checked: number;
    ready: number;
    notReady: number;
    partial: number;
    checking: number;
    unknown: number;
    skippedPrivate: number;
    testOnlyIgnored: number;
    buildToolingIgnored: number;
    blocking: number;
  };
  /** True while 16kb.dev is still checking at least one library. Re-run later for final counts. */
  settling: boolean;
  verdict: string;
  deadline: string;
  deadlineSource: string;
  scope: string;
  rows: CliRow[];
  buildPlugins: {
    plugins: CliPlugin[];
    hidden: number;
    agp: { status: AgpCheck["status"]; version: string; minimum: string; message: string };
  };
  notes: string[];
  issues: { file: string; message: string }[];
  files: { name: string; kind: string; depCount: number }[];
};

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export type ColorMode = "auto" | "always" | "never";

export function useColor(mode: ColorMode, stream: { isTTY?: boolean }): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return !!stream.isTTY;
}

function paint(enabled: boolean, color: string, text: string): string {
  if (!enabled) return text;
  return `${color}${text}${ANSI.reset}`;
}

export function displayName(row: ReportRow): string {
  if (row.configuration === "plugin") return row.group;
  return row.coordinate;
}

/** Only show a BOM coordinate when it is a public one. */
function publicBom(bom: string | undefined): string | undefined {
  if (!bom) return undefined;
  const parts = bom.split(":");
  if (parts.length < 2) return undefined;
  return isCandidatePublicCoordinate(`${parts[0]}:${parts[1]}`) ? bom : undefined;
}

export function rowsFromReport(report: CheckReport): CliRow[] {
  return report.rows.map((r) => ({
    sdk: displayName(r),
    version: r.declaredVersion || (r.bom ? "via BOM" : "—"),
    bom: r.declaredVersion ? undefined : publicBom(r.bom),
    status: toCliStatus(r.verdict),
    minVersion: r.entry?.minVersion || "—",
    link: r.entry?.slug ? `https://16kb.dev/sdk/${r.entry.slug}` : "",
    detail: r.detail,
    plugin: r.configuration === "plugin",
  }));
}

export function countStatuses(rows: CliRow[]): Record<CliStatus, number> {
  const counts: Record<CliStatus, number> = {
    ready: 0,
    "not ready": 0,
    partial: 0,
    checking: 0,
    unknown: 0,
  };
  for (const r of rows) counts[r.status]++;
  return counts;
}


/** Gradle plugins are not packaged into the APK, so they are not 16KB blockers. */
export function annotateGradlePlugins(report: CheckReport): CheckReport {
  const rows = report.rows.map((r) => {
    if (r.configuration === "plugin" && !r.entry && (r.verdict === "unknown" || r.verdict === "likely-fine")) {
      return {
        ...r,
        verdict: "likely-fine" as const,
        detail: "Gradle plugin. It is not packaged into the APK, so it does not affect 16KB compatibility.",
        likelyFineReason: "Gradle plugin, not packaged into the APK.",
      };
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
  for (const row of rows) counts[row.verdict]++;
  const blocking = counts["not-yet"] + counts["update-needed"] + counts.partial;
  return { ...report, rows, counts, blocking, verdictLine: verdictText(blocking, counts, rows.length) };
}

function agpOf(extras: ReportExtras): AgpCheck {
  return extras.agp || checkAgp([]);
}

export function toJson(report: CheckReport, skippedPrivate: number, extras: ReportExtras = {}): CliJson {
  const rows = rowsFromReport(report);
  const counts = countStatuses(rows);
  const agp = agpOf(extras);
  return {
    checkedAt: extras.checkedAt || new Date().toISOString(),
    summary: {
      checked: rows.length,
      ready: counts.ready,
      notReady: counts["not ready"],
      partial: counts.partial,
      checking: counts.checking,
      unknown: counts.unknown,
      skippedPrivate,
      testOnlyIgnored: extras.testOnlyIgnored || 0,
      buildToolingIgnored: extras.buildToolingIgnored || 0,
      blocking: counts["not ready"] + counts.partial,
    },
    settling: counts.checking > 0,
    verdict: report.verdictLine,
    deadline: DEADLINE_NOTE,
    deadlineSource: DEADLINE_SOURCE,
    scope: SCOPE_NOTE,
    rows,
    buildPlugins: {
      plugins: extras.plugins || [],
      hidden: extras.hiddenPlugins || 0,
      agp: { status: agp.status, version: agp.version, minimum: AGP_MIN_16KB, message: agp.message },
    },
    notes: counts.checking > 0 ? [SETTLING_NOTE, ...report.notes] : report.notes,
    issues: report.issues,
    files: report.files,
  };
}

function pad(text: string, width: number): string {
  const raw = visibleLen(text);
  if (raw >= width) return text;
  return text + " ".repeat(width - raw);
}

function visibleLen(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Text report. Coordinates are never cut: the SDK and Version columns size to their longest
 * value, the link is the last column, and the minimum 16 KB version for rows that need
 * attention goes on an indented second line.
 */
export function formatTable(report: CheckReport, skippedPrivate: number, color: boolean, extras: ReportExtras = {}): string {
  const rows = rowsFromReport(report);
  const counts = countStatuses(rows);
  const lines: string[] = [];

  const sdkW = Math.max(3, ...rows.map((r) => r.sdk.length));
  const verW = Math.max(7, ...rows.map((r) => r.version.length));
  const statusW = 9;

  const header = [pad("SDK", sdkW), pad("Version", verW), pad("Status", statusW), "Link"].join("  ");
  lines.push(paint(color, ANSI.bold, header));
  lines.push(paint(color, ANSI.dim, ["─".repeat(sdkW), "─".repeat(verW), "─".repeat(statusW), "─".repeat(4)].join("  ")));

  const statusColor = (s: CliStatus): string => {
    if (s === "ready") return ANSI.green;
    if (s === "not ready") return ANSI.red;
    if (s === "partial") return ANSI.yellow;
    if (s === "checking") return ANSI.cyan;
    return ANSI.gray;
  };

  for (const r of rows) {
    const cells = [
      pad(r.sdk, sdkW),
      pad(r.version, verW),
      pad(paint(color, statusColor(r.status), r.status), statusW),
      r.link,
    ];
    lines.push(cells.join("  ").trimEnd());
    if ((r.status === "not ready" || r.status === "partial") && r.minVersion && r.minVersion !== "—") {
      lines.push(paint(color, ANSI.dim, `    Min 16 KB version: ${r.minVersion}`));
    }
  }

  if (!rows.length) {
    lines.push(paint(color, ANSI.dim, "No public library coordinates were found in this project."));
  }

  if (rows.some((r) => r.bom)) {
    lines.push("");
    const boms = [...new Set(rows.map((r) => r.bom).filter((b): b is string => !!b))];
    lines.push(`"via BOM" means the version comes from ${boms.length === 1 ? "this BOM" : "one of these BOMs"}: ${boms.join(", ")}`);
  }

  lines.push("");
  const parts = [
    `${counts.ready} ready`,
    `${counts["not ready"]} not ready`,
    `${counts.partial} partial`,
    `${counts.checking} checking`,
    `${counts.unknown} unknown`,
  ];
  lines.push(`${rows.length} public ${rows.length === 1 ? "library" : "libraries"}: ${parts.join(", ")}.`);
  if (skippedPrivate) {
    const n = skippedPrivate;
    lines.push(
      `${n} private or internal ${n === 1 ? "library was" : "libraries were"} skipped on this machine and never sent.`,
    );
  }
  if (extras.testOnlyIgnored) {
    const n = extras.testOnlyIgnored;
    lines.push(`${n} test-only ${n === 1 ? "dependency was" : "dependencies were"} ignored (test, androidTest, testFixtures and test frameworks).`);
  }
  if (extras.buildToolingIgnored) {
    const n = extras.buildToolingIgnored;
    lines.push(`${n} build-time ${n === 1 ? "dependency was" : "dependencies were"} ignored (annotation processors, buildSrc, build-logic, convention plugins, lint checks, Gradle plugin artifacts).`);
  }
  lines.push(report.verdictLine);
  if (counts.checking) {
    lines.push(paint(color, ANSI.cyan, SETTLING_NOTE));
  }

  const plugins = extras.plugins || [];
  const agp = agpOf(extras);
  lines.push("");
  lines.push(paint(color, ANSI.bold, "Build plugins (build-time only, not packaged into your app, not counted above):"));
  if (plugins.length) {
    const idW = Math.max(...plugins.map((p) => p.id.length));
    for (const p of plugins) lines.push(`  ${pad(p.id, idW)}  ${p.version || "—"}`.trimEnd());
  } else {
    lines.push(paint(color, ANSI.dim, "  None found."));
  }
  if (extras.hiddenPlugins) {
    const n = extras.hiddenPlugins;
    lines.push(paint(color, ANSI.dim, `  ${n} private or unrecognized ${n === 1 ? "plugin is" : "plugins are"} not shown.`));
  }
  if (agp.status === "warning") lines.push(paint(color, ANSI.yellow, `Warning: ${agp.message}`));
  else if (agp.status === "ok") lines.push(`AGP check: ${agp.message}`);
  else lines.push(paint(color, ANSI.dim, agp.message));

  if (report.issues.length) {
    lines.push("");
    for (const issue of report.issues) {
      lines.push(`Note (${issue.file}): ${issue.message}`);
    }
  }
  if (report.notes.length) {
    lines.push("");
    for (const n of report.notes) lines.push(`Note: ${n}`);
  }
  lines.push("");
  lines.push(SCOPE_NOTE);
  lines.push(DEADLINE_NOTE);
  return lines.join("\n") + "\n";
}

export function ciShouldFail(report: CheckReport): boolean {
  const rows = rowsFromReport(report);
  return rows.some((r) => r.status === "not ready" || r.status === "partial");
}
