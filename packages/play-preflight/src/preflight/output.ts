import type { CheckResult, CheckStatus } from "./checks";

export type Header = {
  module?: string;
  binary?: string;
  targetSdk?: number;
  targetFrom?: string;
  formFactor: string;
  manifestKind: string;
};

export type Privacy = { offline: boolean; lookedUp: boolean; skippedPrivate: number };

const LABEL: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP", info: "INFO" };
const COLOR: Record<CheckStatus, string> = { pass: "32", warn: "33", fail: "31", skip: "90", info: "36" };

function paint(on: boolean, code: string, s: string): string {
  return on ? `\u001b[${code}m${s}\u001b[0m` : s;
}

export function privacyLine(p: Privacy): string {
  if (p.offline) return "Checked fully offline. Nothing left this machine.";
  const base = p.lookedUp
    ? "Checked locally. Only public SDK names were looked up on devbooth.dev."
    : "Checked locally. Nothing about your project was uploaded.";
  return p.skippedPrivate ? `${base} ${p.skippedPrivate} private or internal ${p.skippedPrivate === 1 ? "library was" : "libraries were"} skipped and never sent.` : base;
}

export function formatCheckText(input: {
  header: Header;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
  notes: string[];
  privacy: Privacy;
  color: boolean;
}): string {
  const { header, results, counts, notes, privacy, color } = input;
  const what = [header.module !== undefined ? header.module : undefined, header.binary].filter(Boolean).join(" + ") || "app";
  const tgt =
    header.targetSdk !== undefined ? `targetSdk ${header.targetSdk}${header.targetFrom ? `, from ${header.targetFrom}` : ""}` : "targetSdk not resolved";
  const ff = header.formFactor !== "phone" ? `, ${header.formFactor}` : "";
  const lines: string[] = [`play-preflight check  ·  ${what} (${tgt}${ff})`, ""];
  const titleW = Math.max(...results.map((r) => r.title.length), 10) + 2;
  for (const r of results) {
    lines.push(`${paint(color, COLOR[r.status], LABEL[r.status])}  ${r.title.padEnd(titleW)}${r.detail}`);
    for (const item of r.items) lines.push(`      - ${item}`);
    lines.push(paint(color, "90", `      Rule: ${r.source}`));
    lines.push(paint(color, "90", `      → ${r.link}`));
  }
  if (notes.length) {
    lines.push("");
    for (const n of notes) lines.push(`Note: ${n}`);
  }
  lines.push("");
  const summary = (["pass", "warn", "fail", "skip", "info"] as CheckStatus[])
    .filter((s) => s !== "info" || counts.info)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
  lines.push(summary);
  lines.push(privacyLine(privacy));
  return lines.join("\n") + "\n";
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
    })),
    summary: input.counts,
    notes: input.notes,
    privacy: input.privacy,
    exitCode: input.exitCode,
  };
}
