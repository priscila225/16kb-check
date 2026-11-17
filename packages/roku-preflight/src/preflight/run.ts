import { parseArgs } from "node:util";
import { VERSION } from "../version";
import { createClient, type ApiClient } from "./api";
import { loadRokuRules, currentOrUpcomingBlackout, fmtDateRange, type ResolvedRokuRules } from "./roku-rules";
import { CHECKS, type CheckResult, type CheckStatus } from "./checks";
import { CHECK_IDS, type CheckId } from "./rules";
import { formatVersion, manifestGet } from "./manifest";
import { scanInput } from "./project";
import { formatCheckGithub, formatCheckText, toCheckJson, type OutputFormat } from "./output";

export const CHECK_HELP = `roku-preflight check — check a Roku app against current certification rules.

Usage:
  npx roku-preflight check [path|zip] [options]

Inputs:
  [path], --path <path>  Channel folder or .zip package (default: current directory)

Output:
  --json                Print JSON
  --format text|github  text (default) or github (::error / ::warning annotations, plus the report)
  --verbose, -v         Show links on every check, and which rules snapshot was used
  --strict              Exit 1 on WARN too (default: only FAIL)
  --only <ids>          Run only these checks (comma separated)
  --skip <ids>          Skip these checks (comma separated)
  --offline             No network. Uses the Roku dates bundled in this release
  --no-color            Disable color (also when stdout is not a TTY, or NO_COLOR is set)
  --help                Show this help

Exit codes:
  0  no failures (warnings are ok unless --strict)
  1  at least one FAIL, or a WARN with --strict
  2  bad usage or a runtime error (missing project, unreadable zip, unknown flag)

Check ids:
  ${CHECK_IDS.join(", ")}

This is a static check of a project folder or zip. It does not measure launch time,
playback, memory use, or the Dashboard minimum firmware setting, and it does not
replace Roku's official Static Analysis, which is still required when you submit.

Privacy:
  Everything runs on this machine. The only network call is a GET on
  https://devbooth.dev/api/roku-rules for current dates and sizes. That request
  sends nothing about your project. --offline skips the network and uses the
  snapshot bundled in this release.

  https://devbooth.dev
`;

export type CheckOptions = {
  path?: string;
  json: boolean;
  format: OutputFormat;
  verbose: boolean;
  strict: boolean;
  only?: CheckId[];
  skip: CheckId[];
  offline: boolean;
  color: boolean | "auto";
  help: boolean;
};

function parseIds(v: string | undefined, flag: string): CheckId[] | undefined {
  if (v === undefined) return undefined;
  const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((i) => !(CHECK_IDS as readonly string[]).includes(i));
  if (bad.length) throw new Error(`Unknown check id for ${flag}: ${bad.join(", ")}. Valid ids: ${CHECK_IDS.join(", ")}`);
  return ids as CheckId[];
}

export function parseCheckArgv(argv: string[]): CheckOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      path: { type: "string" },
      json: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      only: { type: "string" },
      skip: { type: "string" },
      offline: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      format: { type: "string" },
      verbose: { type: "boolean", default: false, short: "v" },
      help: { type: "boolean", default: false, short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) throw new Error(`Expected at most one path or zip, got: ${positionals.join(" ")}`);
  const formatRaw = values.format ?? "text";
  if (formatRaw !== "text" && formatRaw !== "github") {
    throw new Error(`Unknown --format: ${formatRaw}. Use text or github.`);
  }
  return {
    path: values.path ?? positionals[0],
    json: !!values.json,
    format: formatRaw,
    verbose: !!values.verbose,
    strict: !!values.strict,
    only: parseIds(values.only, "--only"),
    skip: parseIds(values.skip, "--skip") ?? [],
    offline: !!values.offline,
    color: values["no-color"] ? false : "auto",
    help: !!values.help,
  };
}

export type CheckIo = {
  stdout: { write: (s: string) => void; isTTY?: boolean };
  stderr: { write: (s: string) => void; isTTY?: boolean };
  api?: ApiClient;
  /** Tests: use these Roku rules instead of downloading them. */
  rokuRules?: ResolvedRokuRules;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

export type CheckRunResult = {
  exitCode: number;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
};

export function exitCodeFor(results: CheckResult[], strict: boolean): number {
  if (results.some((r) => r.status === "fail")) return 1;
  if (strict && results.some((r) => r.status === "warn")) return 1;
  return 0;
}

function countStatuses(results: CheckResult[]): Record<CheckStatus, number> {
  const c: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0, info: 0 };
  for (const r of results) c[r.status]++;
  return c;
}

export async function runCheck(argv: string[], io: CheckIo = { stdout: process.stdout, stderr: process.stderr }): Promise<CheckRunResult> {
  const empty = { results: [], counts: countStatuses([]) };
  let opts: CheckOptions;
  try {
    opts = parseCheckArgv(argv);
  } catch (e) {
    io.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${CHECK_HELP}`);
    return { exitCode: 2, ...empty };
  }
  if (opts.help) {
    io.stdout.write(CHECK_HELP);
    return { exitCode: 0, ...empty };
  }

  const selected = CHECK_IDS.filter((id) => (!opts.only || opts.only.includes(id)) && !opts.skip.includes(id));
  const start = opts.path ?? process.cwd();
  const scanned = scanInput(start);
  if ("error" in scanned) {
    io.stderr.write(`${scanned.error}\n`);
    return { exitCode: 2, ...empty };
  }

  const now = io.now ?? new Date();
  const rokuRules = io.rokuRules ?? (await loadRokuRules({ offline: opts.offline, client: io.api ?? createClient() }));
  const results = selected.map((id) => CHECKS[id]({ project: scanned, rokuRules, now }));
  const counts = countStatuses(results);
  const exitCode = exitCodeFor(results, opts.strict);

  const notes: string[] = [];
  const blackout = currentOrUpcomingBlackout(rokuRules.rules.checks.blackouts, isoDayLocal(now));
  if (blackout) {
    const range = fmtDateRange(blackout.start, blackout.end);
    notes.push(
      blackout.current
        ? `Roku publishing blackout is in effect ${range}. Submissions are still reviewed, then published after it ends`
        : `Roku publishing blackout ${range}. Official guidance: certification typically takes at least five business days`,
    );
  }

  const header = {
    title: scanned.screensaver ? manifestGet(scanned.manifest, "screensaver_title") : manifestGet(scanned.manifest, "title"),
    kind: scanned.kind,
    input: scanned.displayName,
    version: formatVersion(scanned.manifest),
    rsgVersion: manifestGet(scanned.manifest, "rsg_version"),
    screensaver: scanned.screensaver,
  };
  const privacy = { offline: opts.offline };

  if (opts.json) {
    const body = toCheckJson({ version: VERSION, header, results, counts, notes, privacy, rokuRules, exitCode, now });
    io.stdout.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    const env = io.env ?? process.env;
    const color = opts.color === "auto" ? !!io.stdout.isTTY && !env.NO_COLOR && env.FORCE_COLOR !== "0" : opts.color;
    const payload = {
      header,
      results,
      counts,
      notes,
      privacy,
      rokuRules,
      verbose: opts.verbose,
      repeatSummary: opts.format === "github" || !io.stdout.isTTY,
    };
    if (opts.format === "github") io.stdout.write(formatCheckGithub(payload));
    else io.stdout.write(formatCheckText({ ...payload, color }));
  }
  return { exitCode, results, counts };
}

function isoDayLocal(d: Date): string {
  // Use the same calendar day the user would see in America/Los_Angeles when possible,
  // but a plain YYYY-MM-DD from the provided Date's UTC date is stable in tests.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

