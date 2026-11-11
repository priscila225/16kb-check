import type { CheckReport, ReportRow } from "./check/types";
import { verdictText } from "./check/match";
import { DEADLINE_NOTE, toCliStatus, type CliStatus } from "./status";

export type CliRow = {
  sdk: string;
  version: string;
  status: CliStatus;
  minVersion: string;
  link: string;
  detail: string;
  plugin: boolean;
};

export type CliJson = {
  summary: {
    checked: number;
    ready: number;
    notReady: number;
    partial: number;
    checking: number;
    unknown: number;
    skippedPrivate: number;
    blocking: number;
  };
  verdict: string;
  deadline: string;
  rows: CliRow[];
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

export function rowsFromReport(report: CheckReport): CliRow[] {
  return report.rows.map((r) => ({
    sdk: displayName(r),
    version: r.declaredVersion || (r.bom ? `BOM ${r.bom}` : "—"),
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

export function toJson(report: CheckReport, skippedPrivate: number): CliJson {
  const rows = rowsFromReport(report);
  const counts = countStatuses(rows);
  return {
    summary: {
      checked: rows.length,
      ready: counts.ready,
      notReady: counts["not ready"],
      partial: counts.partial,
      checking: counts.checking,
      unknown: counts.unknown,
      skippedPrivate,
      blocking: counts["not ready"] + counts.partial,
    },
    verdict: report.verdictLine,
    deadline: DEADLINE_NOTE,
    rows,
    notes: report.notes,
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

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return text.slice(0, width - 1) + "…";
}

const COLS = [
  { key: "sdk" as const, head: "SDK", width: 42 },
  { key: "version" as const, head: "Version", width: 18 },
  { key: "status" as const, head: "Status", width: 10 },
  { key: "minVersion" as const, head: "Min 16KB", width: 16 },
  { key: "link" as const, head: "Link", width: 48 },
];

export function formatTable(report: CheckReport, skippedPrivate: number, color: boolean): string {
  const rows = rowsFromReport(report);
  const counts = countStatuses(rows);
  const lines: string[] = [];

  const header = COLS.map((c) => pad(c.head, c.width)).join("  ");
  lines.push(paint(color, ANSI.bold, header));
  lines.push(paint(color, ANSI.dim, COLS.map((c) => "─".repeat(c.width)).join("  ")));

  const statusColor = (s: CliStatus): string => {
    if (s === "ready") return ANSI.green;
    if (s === "not ready") return ANSI.red;
    if (s === "partial") return ANSI.yellow;
    if (s === "checking") return ANSI.cyan;
    return ANSI.gray;
  };

  for (const r of rows) {
    const cells = [
      pad(truncate(r.sdk, COLS[0].width), COLS[0].width),
      pad(truncate(r.version, COLS[1].width), COLS[1].width),
      pad(paint(color, statusColor(r.status), truncate(r.status, COLS[2].width)), COLS[2].width),
      pad(truncate(r.minVersion, COLS[3].width), COLS[3].width),
      pad(truncate(r.link, COLS[4].width), COLS[4].width),
    ];
    lines.push(cells.join("  "));
  }

  if (!rows.length) {
    lines.push(paint(color, ANSI.dim, "No public library coordinates were found in this project."));
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
  lines.push(report.verdictLine);
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
  lines.push(DEADLINE_NOTE);
  return lines.join("\n") + "\n";
}

export function ciShouldFail(report: CheckReport): boolean {
  const rows = rowsFromReport(report);
  return rows.some((r) => r.status === "not ready" || r.status === "partial");
}
