import type { CheckResult, CheckStatus } from "./checks";
import { fmtDateRange, rokuRulesJson, rokuRulesLine, type ResolvedRokuRules } from "./roku-rules";

export type Privacy = { offline: boolean };

export function privacyLine(p: Privacy): string {
  if (p.offline) return "Checked fully offline. Nothing left this machine.";
  return "Checked locally. Nothing about your project was uploaded.";
}

export const STATIC_ANALYSIS_NOTE =
  "This is a static preflight check. Roku's official Static Analysis is still required when you submit.";

export type Header = {
  title?: string;
  kind: "project" | "zip";
  input: string;
  version?: string;
  rsgVersion?: string;
  screensaver?: boolean;
};

export type OutputFormat = "text" | "github";

const LABEL: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP", info: "INFO" };
const COLOR: Record<CheckStatus, string> = { pass: "32", warn: "33", fail: "31", skip: "90", info: "36" };

function paint(on: boolean, code: string, s: string): string {
  return on ? `\u001b[${code}m${s}\u001b[0m` : s;
}

export function summaryLine(counts: Record<CheckStatus, number>): string {
  return (["pass", "warn", "fail", "skip", "info"] as CheckStatus[])
    .filter((s) => s !== "info" || counts.info)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
}

export function headerLine(header: Header): string {
  const kind = header.screensaver ? "screensaver" : header.kind === "zip" ? header.input : "project";
  const name = header.title;
  const left = ["roku-preflight check", name, kind].filter(Boolean).join("  ·  ");
  const bits = [
    header.version ? `version ${header.version}` : undefined,
    header.rsgVersion ? `rsg ${header.rsgVersion}` : "rsg not set",
  ].filter(Boolean);
  return `${left}  ·  ${bits.join("  ")}`;
}

function titleWidth(results: CheckResult[]): number {
  return Math.max(...results.map((r) => r.title.length), 10) + 2;
}

export function formatLocation(loc: { file: string; line?: number }): string {
  return loc.line !== undefined ? `${loc.file}:${loc.line}` : loc.file;
}

function sameFinding(detail: string, item: string): boolean {
  const a = detail.trim();
  const b = item.trim();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function displayItems(r: CheckResult, verbose: boolean): string[] {
  const items = r.items ?? [];
  const extra = verbose ? (r.verboseItems ?? []) : [];
  if (items.length === 1 && !extra.length && sameFinding(r.detail, items[0]!)) return [];
  return extra.length ? [...items, ...extra] : items;
}

function writeCheck(lines: string[], r: CheckResult, titleW: number, color: boolean, verbose: boolean, showLinks: boolean): void {
  lines.push(`${paint(color, COLOR[r.status], LABEL[r.status])}  ${r.title.padEnd(titleW)}${r.detail}`);
  for (const item of displayItems(r, verbose)) lines.push(`      - ${item}`);
  if (r.locations?.length) {
    for (const loc of r.locations) lines.push(`      ${formatLocation(loc)}`);
  }
  if (showLinks) {
    lines.push(paint(color, "90", `      Rule: ${r.source}`));
    lines.push(paint(color, "90", `      → ${r.link}`));
  }
}

export function formatCheckText(input: {
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  rokuRules?: ResolvedRokuRules;
  color: boolean;
  verbose?: boolean;
  repeatSummary?: boolean;
}): string {
  const { header, results, counts, notes, privacy, color } = input;
  const verbose = !!input.verbose;
  const repeatSummary = input.repeatSummary ?? true;
  const lines: string[] = [headerLine(header), summaryLine(counts)];
  if (verbose && input.rokuRules) lines.push(rokuRulesLine(input.rokuRules));
  lines.push(STATIC_ANALYSIS_NOTE);
  for (const n of notes) lines.push(`Note: ${n}`);
  lines.push("");

  const titleW = titleWidth(results);
  const fail = results.filter((r) => r.status === "fail");
  const warn = results.filter((r) => r.status === "warn");
  const info = results.filter((r) => r.status === "info");
  const pass = results.filter((r) => r.status === "pass");
  const skip = results.filter((r) => r.status === "skip");

  const linksFor = (status: CheckStatus): boolean => verbose || status === "fail" || status === "warn" || status === "info";

  for (const r of [...fail, ...warn, ...info]) {
    writeCheck(lines, r, titleW, color, verbose, linksFor(r.status));
  }

  if (verbose) {
    for (const r of pass) writeCheck(lines, r, titleW, color, verbose, true);
    for (const r of skip) writeCheck(lines, r, titleW, color, verbose, true);
  } else {
    for (const r of pass) {
      lines.push(`${paint(color, COLOR.pass, "PASS")}  ${r.title.padEnd(titleW)}${r.detail}`);
    }
    for (const r of skip) {
      lines.push(`${paint(color, COLOR.skip, "SKIP")}  ${r.title.padEnd(titleW)}${r.detail}`);
    }
  }

  lines.push("");
  if (repeatSummary) lines.push(summaryLine(counts));
  lines.push(privacyLine(privacy));
  return lines.join("\n") + "\n";
}

function ghEscape(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function formatCheckGithub(input: {
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  rokuRules?: ResolvedRokuRules;
  verbose?: boolean;
}): string {
  const lines: string[] = [];
  for (const r of input.results) {
    if (r.status !== "fail" && r.status !== "warn" && r.status !== "info") continue;
    const kind = r.status === "fail" ? "error" : r.status === "warn" ? "warning" : "notice";
    const locs = r.locations?.length
      ? r.locations
      : [{ message: r.detail, file: undefined as string | undefined, line: undefined as number | undefined }];
    for (const loc of locs) {
      const params: string[] = [];
      if (loc.file) params.push(`file=${ghEscape(loc.file)}`);
      if (loc.line !== undefined) params.push(`line=${loc.line}`);
      params.push(`title=${ghEscape(r.title)}`);
      const message = loc.message || r.detail;
      lines.push(`::${kind} ${params.join(",")}::${ghEscape(message)}`);
    }
  }
  const text = formatCheckText({ ...input, color: false, repeatSummary: true });
  return (lines.length ? lines.join("\n") + "\n" : "") + text;
}

export function toCheckJson(input: {
  version: string;
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  rokuRules?: ResolvedRokuRules;
  exitCode: number;
  now: Date;
}) {
  return {
    tool: "roku-preflight",
    version: input.version,
    checkedAt: input.now.toISOString(),
    input: input.header,
    ...(input.rokuRules ? { rokuRules: rokuRulesJson(input.rokuRules) } : {}),
    checks: input.results.map((r) => ({
      id: r.id,
      status: r.status,
      title: r.title,
      detail: r.detail,
      deadline: r.deadline,
      source: r.source,
      link: r.link,
      items: r.items,
      ...(r.locations?.length ? { locations: r.locations } : {}),
    })),
    summary: input.counts,
    notes: [STATIC_ANALYSIS_NOTE, ...input.notes],
    privacy: input.privacy,
    exitCode: input.exitCode,
  };
}

export { fmtDateRange };
