import type { CheckResult, CheckStatus } from "./checks";
import { privacyLine, type Privacy } from "../sixteenkb/closing";

export { privacyLine, type Privacy };

export type Header = {
  module?: string;
  binary?: string;
  targetSdk?: number;
  targetFrom?: string;
  minSdk?: number;
  minSdkFrom?: string;
  compileSdk?: number;
  compileSdkFrom?: string;
  formFactor: string;
  manifestKind: string;
};

export type OutputFormat = "text" | "github";

const LABEL: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP", info: "INFO" };
const COLOR: Record<CheckStatus, string> = { pass: "32", warn: "33", fail: "31", skip: "90", info: "36" };

export const SOURCE_MANIFEST_NOTE =
  "Read from source manifests. Permissions and services that libraries add at build time aren't included. Build once (or pass --apk) for the full picture.";

const LARGE_SCREEN_CAP = 5;

function paint(on: boolean, code: string, s: string): string {
  return on ? `\u001b[${code}m${s}\u001b[0m` : s;
}

export function summaryLine(counts: Record<CheckStatus, number>): string {
  return (["pass", "warn", "fail", "skip", "info"] as CheckStatus[])
    .filter((s) => s !== "info" || counts.info)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
}

export function scannedLabel(header: Header): string {
  if (header.binary) {
    return header.module ? `${header.module} + ${header.binary}` : header.binary;
  }
  if (header.manifestKind === "merged") return "merged manifest";
  if (header.manifestKind === "apk") return "APK";
  return "source only";
}

function sdkPart(name: string, value: number | undefined, from: string | undefined, verbose: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (verbose && from) return `${name} ${value}, from ${from}`;
  return `${name} ${value}`;
}

export function headerLine(header: Header, verbose: boolean): string {
  const name = header.module ?? (header.binary ? undefined : "app");
  const left = ["play-preflight check", name, scannedLabel(header)].filter(Boolean).join("  ·  ");
  const tgt =
    header.targetSdk !== undefined
      ? sdkPart("targetSdk", header.targetSdk, header.targetFrom, verbose)
      : "targetSdk not resolved";
  const sdks = [
    tgt,
    sdkPart("minSdk", header.minSdk, header.minSdkFrom, verbose),
    sdkPart("compileSdk", header.compileSdk, header.compileSdkFrom, verbose),
  ].filter(Boolean);
  const ff = header.formFactor !== "phone" ? header.formFactor : undefined;
  return `${left}  ·  ${[...sdks, ff].filter(Boolean).join("  ")}`;
}

function titleWidth(results: CheckResult[]): number {
  return Math.max(...results.map((r) => r.title.length), 10) + 2;
}

function displayItems(r: CheckResult, verbose: boolean): string[] {
  const items = r.items ?? [];
  if (r.id === "large-screens" && !verbose) {
    const locCount = r.locations?.length ?? 0;
    const locks = items.slice(0, locCount);
    const rest = items.slice(locCount);
    if (locks.length > LARGE_SCREEN_CAP) {
      const hidden = locks.length - LARGE_SCREEN_CAP;
      return [...locks.slice(0, LARGE_SCREEN_CAP), `…and ${hidden} more (use --verbose)`, ...rest];
    }
    return items;
  }
  return items;
}

function writeCheck(lines: string[], r: CheckResult, titleW: number, color: boolean, verbose: boolean, showLinks: boolean): void {
  lines.push(`${paint(color, COLOR[r.status], LABEL[r.status])}  ${r.title.padEnd(titleW)}${r.detail}`);
  for (const item of displayItems(r, verbose)) lines.push(`      - ${item}`);
  if (verbose) for (const item of r.verboseItems ?? []) lines.push(`      - ${item}`);
  if (showLinks) {
    lines.push(paint(color, "90", `      Rule: ${r.source}`));
    lines.push(paint(color, "90", `      → ${r.link}`));
  }
}

function skipLabel(r: CheckResult): string {
  const detail = r.detail.trim();
  // "Play Billing Library not used" -> "Play Billing Library (not used)"
  const shortened = detail.replace(new RegExp(`^${r.title}\\s+`, "i"), "").trim() || detail;
  if (shortened === detail && detail.toLowerCase().startsWith(r.title.toLowerCase())) {
    return `${r.title} (${detail.slice(r.title.length).trim()})`;
  }
  if (detail.toLowerCase() === `${r.title.toLowerCase()} not used`) return `${r.title} (not used)`;
  return `${r.title} (${detail})`;
}

export function formatCheckText(input: {
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  color: boolean;
  verbose?: boolean;
  /** When true, the source-manifest caveat is printed once under the header. */
  sourceManifest?: boolean;
}): string {
  const { header, results, counts, notes, privacy, color } = input;
  const verbose = !!input.verbose;
  const lines: string[] = [headerLine(header, verbose), summaryLine(counts)];
  if (input.sourceManifest) lines.push(SOURCE_MANIFEST_NOTE);
  const leftoverNotes = notes.filter((n) => n !== SOURCE_MANIFEST_NOTE);
  for (const n of leftoverNotes) lines.push(`Note: ${n}`);
  lines.push("");

  const titleW = titleWidth(results);
  const fail = results.filter((r) => r.status === "fail");
  const warn = results.filter((r) => r.status === "warn");
  const info = results.filter((r) => r.status === "info");
  const pass = results.filter((r) => r.status === "pass");
  const skip = results.filter((r) => r.status === "skip");

  const linksFor = (status: CheckStatus): boolean =>
    verbose || status === "fail" || status === "warn" || status === "info";

  for (const r of [...fail, ...warn, ...info]) {
    writeCheck(lines, r, titleW, color, verbose, linksFor(r.status));
  }

  // PASS is one line each by default. The 16 KB check stays expanded when it has
  // not-ready, partial, unknown or checking rows, so those aren't hidden.
  const compactPass: CheckResult[] = [];
  const expandedPass: CheckResult[] = [];
  for (const r of pass) {
    if (verbose) expandedPass.push(r);
    else if (r.id === "16kb" && displayItems(r, false).length) expandedPass.push(r);
    else compactPass.push(r);
  }
  for (const r of expandedPass) writeCheck(lines, r, titleW, color, verbose, linksFor("pass"));
  if (verbose) {
    for (const r of compactPass) writeCheck(lines, r, titleW, color, verbose, true);
    for (const r of skip) writeCheck(lines, r, titleW, color, verbose, true);
  } else {
    for (const r of compactPass) {
      lines.push(`${paint(color, COLOR.pass, "PASS")}  ${r.title.padEnd(titleW)}${r.detail}`);
    }
    if (skip.length) {
      lines.push(`${paint(color, COLOR.skip, "SKIP")}  ${skip.map(skipLabel).join(", ")}`);
    }
  }

  lines.push("");
  lines.push(summaryLine(counts));
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
  verbose?: boolean;
  sourceManifest?: boolean;
}): string {
  const lines: string[] = [];
  for (const r of input.results) {
    if (r.status !== "fail" && r.status !== "warn" && r.status !== "info") continue;
    const kind = r.status === "fail" ? "error" : r.status === "warn" ? "warning" : "notice";
    const locs = r.locations?.length ? r.locations : [{ message: r.detail, file: undefined as string | undefined, line: undefined as number | undefined }];
    for (const loc of locs) {
      const params: string[] = [];
      if (loc.file) params.push(`file=${ghEscape(loc.file)}`);
      if (loc.line !== undefined) params.push(`line=${loc.line}`);
      params.push(`title=${ghEscape(r.title)}`);
      const message = loc.message || r.detail;
      lines.push(`::${kind} ${params.join(",")}::${ghEscape(message)}`);
    }
  }
  const text = formatCheckText({ ...input, color: false });
  return (lines.length ? lines.join("\n") + "\n" : "") + text;
}

export function toCheckJson(input: {
  version: string;
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  exitCode: number;
  now: Date;
}) {
  return {
    tool: "play-preflight",
    version: input.version,
    checkedAt: input.now.toISOString(),
    input: input.header,
    checks: input.results.map((r) => ({
      id: r.id,
      status: r.status,
      title: r.title,
      detail: r.detail,
      deadline: r.deadline,
      source: r.source,
      link: r.link,
      items: r.items,
      ...(r.sdk ? { sdk: r.sdk } : {}),
      ...(r.locations?.length ? { locations: r.locations } : {}),
    })),
    summary: input.counts,
    notes: input.notes,
    privacy: input.privacy,
    exitCode: input.exitCode,
  };
}
