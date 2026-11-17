import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProjectRoot } from "../sixteenkb/discover";
import { VERSION } from "../version";
import { envNoSubmit, resolveAgainstCatalog } from "../sixteenkb/cli";
import { createClient, type ApiClient } from "../sixteenkb/api";
import { checkAgp, type AgpCheck } from "../sixteenkb/check/agp";
import type { CatalogEntry } from "../sixteenkb/check/types";
import { scanProject, type ProjectScan } from "./project";
import { scanBinary, type BinaryScan } from "./binary";
import { CHECKS, detectFormFactor, type CheckContext, type CheckResult, type CheckStatus, type SdkLookup } from "./checks";
import { CHECK_IDS, PLAY_MIN_TARGET, type CheckId } from "./rules";
import { formatCheckGithub, formatCheckText, SOURCE_MANIFEST_NOTE, toCheckJson, type OutputFormat } from "./output";

export const CHECK_HELP = `play-preflight check — check an Android app against Google Play's current rules.

Usage:
  npx play-preflight check [dir] [options]

Inputs (combine them; the APK wins for the manifest and native libraries):
  [dir], --path <dir>   Android project folder (default: current directory)
  --apk <file>          Read the manifest and .so files straight from an APK
  --aab <file>          Read the .so files straight from an AAB
  --module <name>       App module to check when there are several (default: app)
  --target-sdk <n>      Use this targetSdk when it can't be resolved from Gradle

Output:
  --json                Print JSON
  --format text|github  text (default) or github (::error / ::warning annotations, plus the report)
  --verbose, -v         Show ready SDK rows, side notes, every activity, and links on all checks
  --strict              Exit 1 on WARN too (default: only FAIL)
  --only <ids>          Run only these checks (comma separated)
  --skip <ids>          Skip these checks (comma separated)
  --offline             No network at all. Skips the public SDK lookup
  --no-submit           Download the public SDK list, but never send unknown SDK names
  --no-auto-check       Same as --no-submit
  --no-color            Disable color (also when stdout is not a TTY, or NO_COLOR is set)
  --help                Show this help

Exit codes:
  0  no failures (warnings are ok unless --strict)
  1  at least one FAIL, or a WARN with --strict
  2  bad usage or a runtime error (missing project, unreadable APK, unknown flag)

Check ids:
  ${CHECK_IDS.join(", ")}

Privacy:
  Everything runs on this machine. The only network call is the public SDK
  lookup on devbooth.dev, which sends public Maven group:artifact names after
  private and internal ones (including com.github.* and JitPack) are dropped
  here. Your targetSdk, permissions, package name and files are never sent.
  --no-submit (or PLAY_PREFLIGHT_NO_SUBMIT=1) still downloads the list, but
  never sends unknown SDK names. --offline skips the network completely.

  https://devbooth.dev/cli
`;

export type CheckOptions = {
  path?: string;
  apk?: string;
  aab?: string;
  module?: string;
  targetSdk?: number;
  json: boolean;
  format: OutputFormat;
  verbose: boolean;
  strict: boolean;
  only?: CheckId[];
  skip: CheckId[];
  offline: boolean;
  noSubmit: boolean;
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

export function parseCheckArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): CheckOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      path: { type: "string" },
      apk: { type: "string" },
      aab: { type: "string" },
      module: { type: "string" },
      "target-sdk": { type: "string" },
      json: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      only: { type: "string" },
      skip: { type: "string" },
      offline: { type: "boolean", default: false },
      "no-submit": { type: "boolean", default: false },
      "no-auto-check": { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      format: { type: "string" },
      verbose: { type: "boolean", default: false, short: "v" },
      help: { type: "boolean", default: false, short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) throw new Error(`Expected at most one project folder, got: ${positionals.join(" ")}`);
  let targetSdk: number | undefined;
  if (values["target-sdk"] !== undefined) {
    targetSdk = Number(values["target-sdk"]);
    if (!Number.isInteger(targetSdk) || targetSdk < 1 || targetSdk > 99) throw new Error("--target-sdk must be a number like 36");
  }
  const formatRaw = values.format ?? "text";
  if (formatRaw !== "text" && formatRaw !== "github") {
    throw new Error(`Unknown --format: ${formatRaw}. Use text or github.`);
  }
  return {
    path: values.path ?? positionals[0],
    apk: values.apk,
    aab: values.aab,
    module: values.module,
    targetSdk,
    json: !!values.json,
    format: formatRaw,
    verbose: !!values.verbose,
    strict: !!values.strict,
    only: parseIds(values.only, "--only"),
    skip: parseIds(values.skip, "--skip") ?? [],
    offline: !!values.offline,
    noSubmit: !!values["no-submit"] || !!values["no-auto-check"] || envNoSubmit(env),
    color: values["no-color"] ? false : "auto",
    help: !!values.help,
  };
}

export type CheckIo = {
  stdout: { write: (s: string) => void; isTTY?: boolean };
  stderr: { write: (s: string) => void; isTTY?: boolean };
  api?: ApiClient;
  /** Tests: use this catalog instead of downloading one. */
  catalog?: CatalogEntry[];
  enqueue?: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

export type CheckRunResult = {
  exitCode: number;
  results: CheckResult[];
  counts: Record<CheckStatus, number>;
};

function looksLikeProject(dir: string): boolean {
  const root = findProjectRoot(dir);
  return ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"].some((f) => existsSync(join(root, f)));
}

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
    opts = parseCheckArgv(argv, io.env);
  } catch (e) {
    io.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${CHECK_HELP}`);
    return { exitCode: 2, ...empty };
  }
  if (opts.help) {
    io.stdout.write(CHECK_HELP);
    return { exitCode: 0, ...empty };
  }

  const selected = CHECK_IDS.filter((id) => (!opts.only || opts.only.includes(id)) && !opts.skip.includes(id));

  // Binary input
  let binary: BinaryScan | undefined;
  const binPath = opts.apk ?? opts.aab;
  if (opts.apk && opts.aab) {
    io.stderr.write("Pass either --apk or --aab, not both.\n");
    return { exitCode: 2, ...empty };
  }
  if (binPath) {
    if (!existsSync(binPath)) {
      io.stderr.write(`File not found: ${binPath}\n`);
      return { exitCode: 2, ...empty };
    }
    try {
      binary = scanBinary(resolve(binPath), opts.apk ? "apk" : "aab");
    } catch (e) {
      io.stderr.write(`Couldn't read ${binPath}: ${e instanceof Error ? e.message : String(e)}\n`);
      return { exitCode: 2, ...empty };
    }
  }

  // Project input. Required unless a binary was given; optional (cwd) alongside one.
  let project: ProjectScan | undefined;
  const start = resolve(opts.path ?? process.cwd());
  // With only a binary, use the current folder only if it really is a Gradle project, so an APK
  // checked from some other folder never picks up unrelated nested projects.
  const useProject = !binary || !!opts.path || looksLikeProject(start);
  const scanned = useProject ? scanProject(start, { module: opts.module }) : { error: "no project" };
  if ("error" in scanned) {
    if (!binary || opts.path) {
      io.stderr.write(`${scanned.error}\nRun this in an Android project folder, or pass --apk / --aab.\n`);
      return { exitCode: 2, ...empty };
    }
  } else {
    project = scanned;
  }

  const manifest = binary?.manifest ?? project?.manifest;
  const manifestKind: CheckContext["manifestKind"] = binary?.manifest ? "apk" : project?.manifest ? project.manifestKind : "none";

  // targetSdk: --target-sdk > APK > project (merged manifest or Gradle)
  const formFactor = detectFormFactor(manifest);
  const required = PLAY_MIN_TARGET[formFactor];
  let target: { value?: number; from?: string; expr?: string };
  if (opts.targetSdk !== undefined) target = { value: opts.targetSdk, from: "--target-sdk" };
  else if (binary?.manifest?.targetSdk !== undefined) target = { value: binary.manifest.targetSdk, from: binary.file };
  else target = { ...(project?.target ?? {}) };
  const effective = target.value ?? required;
  // minSdk and compileSdk are only reported, never checked. Same order as targetSdk.
  const minSdk =
    binary?.manifest?.minSdk !== undefined ? { value: binary.manifest.minSdk, from: binary.file } : { ...(project?.minSdk ?? {}) };
  const compileSdk =
    project?.compileSdk.value !== undefined
      ? { ...project.compileSdk }
      : binary?.manifest?.compileSdk !== undefined
        ? { value: binary.manifest.compileSdk, from: binary.file }
        : manifest?.compileSdk !== undefined
          ? { value: manifest.compileSdk, from: manifest.files[0] }
          : {};

  // The only network step, and only when the 16 KB check runs on a project.
  let sdk: SdkLookup = { status: "none" };
  let submitted = 0;
  let pendingUnknown = 0;
  if (project && selected.includes("16kb") && project.parsed.dependencies.length) {
    if (opts.offline) sdk = { status: "offline" };
    else {
      const errors: string[] = [];
      const res = await resolveAgainstCatalog(project.parsed, {
        client: io.api ?? createClient(),
        catalog: io.catalog,
        enqueue: opts.noSubmit ? false : io.enqueue,
        stderr: { write: (s: string) => void errors.push(s.trim()) },
      });
      sdk = res.ok
        ? {
            status: "ok",
            report: res.report,
            skippedPrivate: res.skippedPrivate,
            testOnlyIgnored: project.parsed.testDependencies.length,
            buildToolingIgnored: project.parsed.buildToolingDependencies.length,
          }
        : { status: "error", message: errors[0] ?? "unknown error" };
      if (res.ok) {
        submitted = res.submitted;
        pendingUnknown = res.pendingUnknown;
      }
      // Non-fatal notices (like a failed auto-check request) go to stderr.
      if (res.ok) for (const e of errors) io.stderr.write(`${e}\n`);
    }
  } else if (project && opts.offline) sdk = { status: "offline" };

  const agp: AgpCheck | undefined = project ? checkAgp(project.parsed.plugins) : undefined;

  const ctx: CheckContext = {
    target: { ...target, effective, assumed: target.value === undefined, formFactor, required },
    manifest,
    manifestKind,
    ownManifest: project?.ownManifest,
    dependencies: project?.parsed.dependencies,
    billingMentionedIn: project?.billingMentionedIn,
    edgeToEdgeOptOuts: project?.edgeToEdgeOptOuts,
    sources: project?.sources,
    binary,
    sdk,
    agp,
  };

  const results = selected.map((id) => CHECKS[id](ctx));
  const exitCode = exitCodeFor(results, opts.strict);
  const counts = countStatuses(results);
  const notes = [...(project?.issues ?? [])];
  const manifestNote = binary?.manifest ? undefined : (binary?.manifestNote ?? project?.manifestNote);
  const sourceManifest = !binary && (manifestNote === SOURCE_MANIFEST_NOTE || (!!manifestNote && manifestKind === "source"));
  if (manifestNote && manifestNote !== SOURCE_MANIFEST_NOTE) notes.push(manifestNote);
  const header = {
    module: project?.appModule === "" ? "(root)" : project?.appModule,
    binary: binary ? `${binary.kind.toUpperCase()} ${binary.file}` : undefined,
    targetSdk: target.value,
    targetFrom: target.from,
    minSdk: minSdk.value,
    minSdkFrom: minSdk.from,
    compileSdk: compileSdk.value,
    compileSdkFrom: compileSdk.from,
    formFactor,
    manifestKind,
  };
  const privacy = {
    offline: opts.offline,
    noSubmit: opts.noSubmit && !opts.offline,
    lookedUp: sdk.status === "ok",
    skippedPrivate: sdk.status === "ok" ? sdk.skippedPrivate : 0,
    submitted,
    pendingUnknown,
  };

  if (opts.json) {
    const jsonNotes = sourceManifest ? [SOURCE_MANIFEST_NOTE, ...notes] : notes;
    const body = toCheckJson({ version: VERSION, header, results, counts, notes: jsonNotes, privacy, exitCode, now: io.now ?? new Date() });
    io.stdout.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    const env = io.env ?? process.env;
    const color =
      opts.color === "auto" ? !!io.stdout.isTTY && !env.NO_COLOR && env.FORCE_COLOR !== "0" : opts.color;
    const payload = {
      header,
      results,
      counts,
      notes,
      privacy,
      verbose: opts.verbose,
      sourceManifest,
      repeatSummary: opts.format === "github" || !io.stdout.isTTY,
    };
    if (opts.format === "github") io.stdout.write(formatCheckGithub(payload));
    else io.stdout.write(formatCheckText({ ...payload, color }));
  }
  return { exitCode, results, counts };
}
