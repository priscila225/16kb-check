#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { VERSION } from "./version";
import { discoverProject } from "./discover";
import { parseProjectFiles } from "./check/parse";
import { buildReport, markPublicChecking } from "./check/match";
import type { CatalogEntry, CheckReport, DeclaredDep } from "./check/types";
import { splitPublicDeps } from "./privacy";
import { createClient, enqueuePublicUnknown, fetchCatalog, type ApiClient } from "./api";
import { annotateGradlePlugins, ciShouldFail, formatTable, toJson, useColor, type ColorMode, type ReportExtras } from "./report";
import { checkAgp, isAgpPlugin } from "./check/agp";
import { catalogGroupsFrom, isCandidatePublicCoordinate, isPrivateOrInternalGroup } from "./check/public-coords";

export const HELP = `16kb-check — check an Android project for Google Play 16KB page-size compatibility.

Usage:
  npx 16kb-check [options]

Options:
  --path <dir>   Project root (default: current directory)
  --json         Print JSON instead of a table
  --ci           Exit 1 if any library is not ready or only partially ready
  --no-color     Disable color
  --help         Show this help
  --version      Print the version

Privacy:
  Your Gradle and TOML files stay on this machine. Private and internal
  libraries (including com.github.* and JitPack) are filtered out locally
  and are never sent to 16kb.dev. Only public Maven coordinates are looked
  up, and only public version strings are sent when a public SDK is not
  in the database yet.

  https://16kb.dev
`;

export type CliOptions = {
  path: string;
  json: boolean;
  ci: boolean;
  color: ColorMode;
  help: boolean;
  version: boolean;
  deep: boolean;
};

export function parseArgv(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      path: { type: "string" },
      json: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", default: false, short: "h" },
      version: { type: "boolean", default: false, short: "v" },
      deep: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    path: values.path || process.cwd(),
    json: !!values.json,
    ci: !!values.ci,
    color: values["no-color"] ? "never" : "auto",
    help: !!values.help,
    version: !!values.version,
    deep: !!values.deep,
  };
}

export type RunIo = {
  stdout: { write: (s: string) => void; isTTY?: boolean };
  stderr: { write: (s: string) => void; isTTY?: boolean };
  api?: ApiClient;
  catalog?: CatalogEntry[];
  enqueue?: boolean;
};

export type RunResult = {
  exitCode: number;
  report?: CheckReport;
  skippedPrivate: number;
};

export async function run(argv: string[], io: RunIo = { stdout: process.stdout, stderr: process.stderr }): Promise<RunResult> {
  let opts: CliOptions;
  try {
    opts = parseArgv(argv);
  } catch (e) {
    io.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    return { exitCode: 2, skippedPrivate: 0 };
  }

  if (opts.help) {
    io.stdout.write(HELP);
    return { exitCode: 0, skippedPrivate: 0 };
  }
  if (opts.version) {
    io.stdout.write(`${VERSION}\n`);
    return { exitCode: 0, skippedPrivate: 0 };
  }
  if (opts.deep) {
    io.stderr.write("--deep is not implemented yet. Checking against the 16kb.dev catalog instead.\n");
  }

  const discovered = discoverProject(resolve(opts.path));
  if (!discovered.files.length) {
    io.stderr.write(discovered.issues.join("\n") + "\n");
    return { exitCode: 2, skippedPrivate: 0 };
  }

  const parsed = parseProjectFiles(discovered.files);

  // Download the public catalog before deciding what is public. This request sends nothing
  // about the project. Groups the catalog itself lists (for example org.pytorch) can then be
  // treated as public; everything else is still filtered on this machine.
  const client = io.api || createClient();
  let catalog: CatalogEntry[] = io.catalog || [];
  if (!io.catalog) {
    try {
      catalog = await fetchCatalog(client);
    } catch (e) {
      io.stderr.write(
        `Could not load the 16kb.dev catalog: ${e instanceof Error ? e.message : String(e)}\n` +
          "Check your network and try again.\n",
      );
      return { exitCode: 2, skippedPrivate: 0 };
    }
  }
  const catalogGroups = catalogGroupsFrom(catalog);

  const { publicDeps, skippedPrivate } = splitPublicDeps(parsed.dependencies, catalogGroups);
  const publicParsed = { ...parsed, dependencies: publicDeps };
  const extras = buildExtras(parsed.plugins, parsed.testDependencies.length, parsed.buildToolingDependencies.length, catalogGroups);

  let report = annotateGradlePlugins(buildReport(publicParsed, catalog));
  const unknownPublic: DeclaredDep[] = [];
  for (const row of report.rows) {
    if (row.verdict === "unknown" && !row.entry && row.group !== "libs" && row.configuration !== "plugin") {
      const dep = publicDeps.find((d) => d.group === row.group && d.artifact === row.artifact);
      if (dep) unknownPublic.push(dep);
    }
  }

  const shouldEnqueue = io.enqueue !== false && unknownPublic.length > 0 && !io.catalog;
  if (shouldEnqueue) {
    try {
      const demand = await enqueuePublicUnknown(client, unknownPublic, catalogGroups);
      if (demand.jobs.length) {
        const next = [...catalog];
        const accepted: string[] = [];
        for (const job of demand.jobs) {
          if (!job?.slug) continue;
          const item: CatalogEntry = {
            slug: job.slug,
            name: job.coordinate || job.slug,
            status: (job.status as CatalogEntry["status"]) || "checking",
            minVersion: "",
            notes: "",
            mavenCoords: job.coordinate ? [job.coordinate] : [],
            autoChecked: true,
          };
          const i = next.findIndex((e) => e.slug === job.slug);
          if (i >= 0) next[i] = { ...next[i], ...item };
          else next.push(item);
          if (job.coordinate) accepted.push(job.coordinate);
        }
        catalog = next;
        // An "exists" job means the entry is already in the database but our catalog copy was
        // stale. Its status may be final, so reload a fresh catalog to get its minimum version.
        if (demand.jobs.some((j) => j?.reason === "exists" && j.status && j.status !== "checking")) {
          try {
            const fresh = await fetchCatalog(client, { fresh: true });
            const freshSlugs = new Set(fresh.map((e) => e.slug));
            catalog = [...fresh, ...catalog.filter((e) => !freshSlugs.has(e.slug))];
          } catch {
            // Keep what we have.
          }
        }
        const stillChecking = accepted.filter((c) => {
          const e = catalog.find((x) => x.mavenCoords.some((m) => m.toLowerCase() === c.toLowerCase()));
          return !e || e.status === "checking";
        });
        report = annotateGradlePlugins(markPublicChecking(buildReport(publicParsed, catalog), stillChecking));
      } else if (demand.accepted === 0 && unknownPublic.length) {
        // Rate limited or not published; leave as unknown.
      }
    } catch (e) {
      io.stderr.write(
        `Could not start an automatic check for new public SDKs: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  extras.checkedAt = new Date().toISOString();
  const color = useColor(opts.color, io.stdout);
  if (opts.json) {
    io.stdout.write(JSON.stringify(toJson(report, skippedPrivate, extras), null, 2) + "\n");
  } else {
    io.stdout.write(formatTable(report, skippedPrivate, color, extras));
  }

  const exitCode = opts.ci && ciShouldFail(report) ? 1 : 0;
  return { exitCode, report, skippedPrivate };
}

/**
 * Build plugins never leave this machine. Only public plugin ids are printed;
 * private or unrecognized ones (for example convention plugins) are only counted.
 */
export function buildExtras(
  plugins: DeclaredDep[],
  testOnlyIgnored: number,
  buildToolingIgnored = 0,
  catalogGroups?: ReadonlySet<string>,
): ReportExtras {
  const shown: NonNullable<ReportExtras["plugins"]> = [];
  let hidden = 0;
  for (const p of plugins) {
    const isClasspathAgp = p.group === "com.android.tools.build" && p.artifact === "gradle";
    const id = isClasspathAgp ? "com.android.tools.build:gradle" : p.group;
    const publicId =
      isCandidatePublicCoordinate(`${p.group}:${p.artifact}`, catalogGroups) && !isPrivateOrInternalGroup(p.group, catalogGroups);
    if (!publicId) {
      hidden++;
      continue;
    }
    shown.push({ id, version: p.version, agp: isAgpPlugin(p) });
  }
  return { plugins: shown, hiddenPlugins: hidden, testOnlyIgnored, buildToolingIgnored, agp: checkAgp(plugins) };
}

async function main(): Promise<void> {
  const result = await run(process.argv.slice(2));
  process.exit(result.exitCode);
}

const entry = process.argv[1] || "";
if (entry.endsWith("cli.js") || entry.endsWith("cli.ts") || entry.endsWith("16kb-check")) {
  main().catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.stack || e.message : String(e)}\n`);
    process.exit(2);
  });
}
