import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createClient } from "../../src/sixteenkb/api.ts";
import { HELP, NO_SUBMIT_LINE, parseArgv, run } from "../../src/sixteenkb/cli.ts";
import { privacyLine } from "../../src/sixteenkb/closing.ts";
import { VERSION } from "../../src/sixteenkb/version.ts";
import { ciShouldFail } from "../../src/sixteenkb/report.ts";
import { DEADLINE_NOTE } from "../../src/sixteenkb/status.ts";
import type { CatalogEntry } from "../../src/sixteenkb/check/types.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/android-app");

const catalog: CatalogEntry[] = [
  {
    slug: "sentry-android",
    name: "Sentry Android",
    status: "compatible",
    minVersion: "7.18.0",
    notes: "",
    mavenCoords: ["io.sentry:sentry-android", "io.sentry:sentry-android-*"],
  },
  {
    slug: "mapbox-maps-android",
    name: "Mapbox Maps SDK",
    status: "partial",
    minVersion: "11.7.0 (-ndk27 artifacts)",
    notes: "",
    mavenCoords: ["com.mapbox.maps:android", "com.mapbox.maps:android-ndk27"],
  },
  {
    slug: "firebase-android",
    name: "Firebase Android",
    status: "compatible",
    minVersion: "any (no native libraries in most modules)",
    notes: "",
    mavenCoords: ["com.google.firebase:*"],
  },
];

async function capture(argv: string[]) {
  let out = "";
  let err = "";
  const result = await run(argv, {
    stdout: { write: (s) => { out += s; }, isTTY: false },
    stderr: { write: (s) => { err += s; }, isTTY: false },
    catalog,
    enqueue: false,
  });
  return { result, out, err };
}

test("parseArgv reads flags", () => {
  const o = parseArgv(["--path", "/tmp/app", "--json", "--ci", "--no-color"], {});
  assert.equal(o.path, "/tmp/app");
  assert.equal(o.json, true);
  assert.equal(o.ci, true);
  assert.equal(o.color, "never");
  assert.equal(o.noSubmit, false);
  assert.equal(parseArgv(["--no-submit"], {}).noSubmit, true);
  assert.equal(parseArgv(["--no-auto-check"], {}).noSubmit, true);
  assert.equal(parseArgv([], { PLAY_PREFLIGHT_NO_SUBMIT: "1" }).noSubmit, true);
  assert.equal(parseArgv([], { PLAY_PREFLIGHT_NO_SUBMIT: "0" }).noSubmit, false);
});

test("--help and --version", async () => {
  const help = await capture(["--help"]);
  assert.equal(help.result.exitCode, 0);
  assert.equal(help.out, HELP);
  assert.match(HELP, /--verbose/);
  assert.match(HELP, /Exit codes:/);
  const ver = await capture(["--version"]);
  assert.equal(ver.result.exitCode, 0);
  assert.equal(ver.out, `${VERSION}\n`);
});

test("default 16kb output is the counts, skipped line, AGP verdict and deadline", async () => {
  const { result, out } = await capture(["--path", fixture, "--no-color"]);
  assert.equal(result.exitCode, 0);
  assert.match(out, /7 public libraries: 5 ready, 1 not ready, 1 partial, 0 checking, 0 unknown\. \(use --verbose to list\)/);
  assert.doesNotMatch(out, /ready libraries are hidden/);
  assert.doesNotMatch(out, /okhttp/);
  assert.doesNotMatch(out, /io\.sentry:sentry-android/);
  assert.doesNotMatch(out, /SDK\s+Version\s+Status\s+Link/);
  assert.doesNotMatch(out, /Build plugins \(build-time only/);
  assert.doesNotMatch(out, /dependency-level check/);
  assert.doesNotMatch(out, /zipalign/);
  assert.doesNotMatch(out, /via BOM/);
  assert.match(out, /2 private or internal libraries were skipped and never sent, 2 test-only dependencies were ignored\./);
  assert.match(out, /AGP check: Android Gradle Plugin 8\.7\.3 is 8\.5\.1 or newer/);
  assert.ok(out.includes(DEADLINE_NOTE));
  assert.ok(!result.report!.rows.some((r) => r.configuration === "plugin"));
  assert.ok(result.report);
  assert.equal(ciShouldFail(result.report!), true);

  const verbose = await capture(["--path", fixture, "--no-color", "--verbose"]);
  assert.match(verbose.out, /SDK\s+Version\s+Status\s+Link/);
  assert.match(verbose.out, /io\.sentry:sentry-android/);
  assert.match(verbose.out, /7\.14\.0/);
  assert.match(verbose.out, /not ready/);
  assert.match(verbose.out, /Min 16 KB version: 7\.18\.0/);
  assert.match(verbose.out, /https:\/\/devbooth\.dev\/16kb\/sdk\/sentry-android/);
  assert.match(verbose.out, /com\.mapbox\.maps:android/);
  assert.match(verbose.out, /partial/);
  assert.match(verbose.out, /okhttp/);
  assert.doesNotMatch(verbose.out, /use --verbose to list/);
  assert.match(verbose.out, /Build plugins \(build-time only/);
  assert.match(verbose.out, /com\.android\.application\s+8\.7\.3/);
  assert.match(verbose.out, /dependency-level check/);
  assert.ok(verbose.out.includes("zipalign -c -P 16 -v 4 app.apk"));
  assert.ok(verbose.out.includes("via BOM"));
  assert.ok(!verbose.out.includes("…"), "nothing is truncated");
  assert.ok(verbose.out.includes(DEADLINE_NOTE));
});

test("--ci exits 1 when a library is not ready or partial", async () => {
  const { result } = await capture(["--path", fixture, "--ci", "--no-color"]);
  assert.equal(result.exitCode, 1);
});

test("--json includes summary counts and no private names", async () => {
  const { result, out } = await capture(["--path", fixture, "--json"]);
  assert.equal(result.exitCode, 0);
  const body = JSON.parse(out);
  assert.equal(body.deadline, DEADLINE_NOTE);
  assert.ok(body.summary.notReady >= 1);
  assert.ok(body.summary.partial >= 1);
  assert.ok(body.summary.ready >= 1);
  assert.ok(body.summary.skippedPrivate >= 2);
  const sentry = body.rows.find((r: { sdk: string }) => r.sdk === "io.sentry:sentry-android");
  assert.equal(sentry.status, "not ready");
  assert.equal(sentry.minVersion, "7.18.0");
  assert.equal(sentry.link, "https://devbooth.dev/16kb/sdk/sentry-android");
  assert.ok(!Number.isNaN(Date.parse(body.checkedAt)));
  assert.equal(body.settling, false);
  assert.equal(body.summary.testOnlyIgnored, 2);
  assert.ok(!body.rows.some((r: { sdk: string }) => r.sdk.startsWith("com.android.application")));
  assert.equal(body.buildPlugins.agp.status, "ok");
  assert.equal(body.buildPlugins.agp.version, "8.7.3");
  const analytics = body.rows.find((r: { sdk: string }) => r.sdk === "com.google.firebase:firebase-analytics");
  assert.equal(analytics.version, "via BOM");
  assert.equal(analytics.bom, "com.google.firebase:firebase-bom:33.7.0");
});

const bundlesFixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/bundles-app");

test("bundles fixture: bundles resolve, plugins are separate, AGP below 8.5.1 warns, tests ignored", async () => {
  const { result, out } = await capture(["--path", bundlesFixture, "--no-color"]);
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(out, /Could not resolve/);
  assert.match(out, /use --verbose to list/);
  assert.doesNotMatch(out, /ready libraries are hidden/);
  assert.doesNotMatch(out, /com\.squareup\.moshi:moshi/);
  assert.match(out, /Warning: Android Gradle Plugin 8\.3\.2 is below 8\.5\.1/);
  assert.doesNotMatch(out, /com\.android\.tools\.build:gradle/);
  const verbose = await capture(["--path", bundlesFixture, "--no-color", "--verbose"]);
  for (const c of ["com.squareup.moshi:moshi", "com.squareup.retrofit2:retrofit", "androidx.appcompat:appcompat", "androidx.compose.material3:material3-adaptive-navigation-suite"]) {
    assert.ok(verbose.out.includes(c), `${c} is shown in full`);
  }
  assert.match(verbose.out, /com\.android\.tools\.build:gradle\s+8\.3\.2/);
  assert.match(verbose.out, /org\.jetbrains\.kotlin\.plugin\.compose\s+2\.0\.21/);
  assert.match(verbose.out, /1 private or unrecognized plugin is not shown/);
  assert.doesNotMatch(out, /acme/);
  assert.match(out, /5 test-only dependencies were ignored/);
  assert.doesNotMatch(out, /junit|mockito|hilt-compiler|androidx\.test|ui-test-manifest/);
  // com.example is not on the public list, so the made-up ads SDK is only counted.
  assert.match(out, /2 private or internal libraries were skipped/);
  assert.doesNotMatch(out, /com\.example/);
});

test("AGP that cannot be resolved is reported as not checked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "16kb-check-agp-"));
  try {
    await writeFile(join(dir, "settings.gradle"), "rootProject.name = 'x'\n");
    await writeFile(join(dir, "build.gradle"), "plugins { id 'com.android.application' }\ndependencies { implementation 'com.squareup.okio:okio:3.9.0' }\n");
    const { out } = await capture(["--path", dir, "--no-color"]);
    assert.match(out, /Android Gradle Plugin version not checked/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a still-checking library shows the settling note in text and JSON", async () => {
  let out = "";
  const checkingCatalog: CatalogEntry[] = [
    ...catalog,
    { slug: "okhttp", name: "OkHttp", status: "checking", minVersion: "", notes: "", mavenCoords: ["com.squareup.okhttp3:okhttp"] },
  ];
  const io = {
    stdout: { write: (s: string) => { out += s; }, isTTY: false },
    stderr: { write: () => {}, isTTY: false },
    catalog: checkingCatalog,
    enqueue: false,
  };
  await run(["--path", fixture, "--no-color"], io);
  assert.match(out, /checking/);
  assert.doesNotMatch(out, /Results are still settling/);
  out = "";
  await run(["--path", fixture, "--no-color", "--verbose"], io);
  assert.match(out, /Results are still settling/);
  assert.match(out, /Re-run in a few minutes/);
  out = "";
  await run(["--path", fixture, "--json"], io);
  const body = JSON.parse(out);
  assert.equal(body.settling, true);
  assert.match(body.notes[0], /still settling/);
});

type Call = { url: string; method: string; body: string };

function spyClient(calls: Call[], entries: CatalogEntry[] = []) {
  return createClient({
    baseUrl: "https://devbooth.test",
    fetch: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (String(url).includes("/api/catalog")) {
        return new Response(JSON.stringify({ ok: true, count: entries.length, entries }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, accepted: 0, jobs: [] }), { status: 200 });
    }) as typeof fetch,
  });
}

async function runWithSpy(argv: string[], extra: { env?: NodeJS.ProcessEnv; catalog?: CatalogEntry[] } = {}) {
  const calls: Call[] = [];
  let out = "";
  let err = "";
  const result = await run(argv, {
    stdout: { write: (s) => { out += s; }, isTTY: false },
    stderr: { write: (s) => { err += s; }, isTTY: false },
    api: spyClient(calls, extra.catalog ?? []),
    env: extra.env ?? {},
  });
  return { result, out, err, calls };
}

test("16kb without --no-submit POSTs unknown public SDKs to check-demand", async () => {
  const { calls } = await runWithSpy(["--path", fixture, "--json"]);
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://devbooth.test/api/check-demand");
  assert.match(posts[0].body, /io\.sentry:sentry-android/);
  assert.doesNotMatch(posts[0].body, /acme-internal|secret-kit|com\.github/);
  assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/api/catalog")));
});

test("16kb --no-submit downloads the catalog and never POSTs, even with unknown public SDKs", async () => {
  const { result, out, calls } = await runWithSpy(["--path", fixture, "--no-color", "--no-submit"]);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(calls[0].method, "GET");
  assert.ok(calls[0].url.startsWith("https://devbooth.test/api/catalog"), calls[0].url);
  assert.ok(!calls.some((c) => c.method === "POST" || c.url.includes("check-demand")));
  assert.ok(out.trimEnd().endsWith(NO_SUBMIT_LINE), out);
});

test("16kb --no-auto-check and PLAY_PREFLIGHT_NO_SUBMIT=1 also skip the POST", async () => {
  const alias = await runWithSpy(["--path", fixture, "--json", "--no-auto-check"]);
  assert.equal(alias.calls.length, 1);
  assert.equal(alias.calls[0].method, "GET");
  assert.ok(!alias.calls.some((c) => c.method === "POST"));
  const env = await runWithSpy(["--path", fixture, "--no-color"], { env: { PLAY_PREFLIGHT_NO_SUBMIT: "1" } });
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].method, "GET");
  assert.ok(!env.calls.some((c) => c.method === "POST"));
  assert.ok(env.out.trimEnd().endsWith(NO_SUBMIT_LINE), env.out);
});

test("unknown flags and a missing project fail with exit 2", async () => {
  const badFlag = await capture(["--wat"]);
  assert.equal(badFlag.result.exitCode, 2);

  const empty = await mkdtemp(join(tmpdir(), "16kb-check-empty-"));
  try {
    const { result, err } = await capture(["--path", empty]);
    assert.equal(result.exitCode, 2);
    assert.match(err, /No Android project files found/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

const COVERING_CATALOG: CatalogEntry[] = [
  ...catalog,
  { slug: "okhttp", name: "OkHttp", status: "compatible", minVersion: "any", notes: "", mavenCoords: ["com.squareup.okhttp3:okhttp"] },
  { slug: "okio", name: "Okio", status: "compatible", minVersion: "any", notes: "", mavenCoords: ["com.squareup.okio:okio"] },
  { slug: "androidx-core", name: "AndroidX Core", status: "compatible", minVersion: "any", notes: "", mavenCoords: ["androidx.core:*"] },
  { slug: "androidx-annotation", name: "AndroidX Annotation", status: "compatible", minVersion: "any", notes: "", mavenCoords: ["androidx.annotation:*"] },
];

test("16kb online with no unknown SDKs: closing line says nothing was sent", async () => {
  const { result, out, calls } = await runWithSpy(["--path", fixture, "--no-color"], { catalog: COVERING_CATALOG });
  assert.equal(result.exitCode, 0);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  const expected = privacyLine({
    offline: false,
    lookedUp: true,
    skippedPrivate: 2,
    submitted: 0,
    pendingUnknown: 0,
  });
  assert.ok(out.trimEnd().endsWith(expected), out);
  assert.match(expected, /No unknown SDKs, so nothing was sent/);
  const jsonRun = await runWithSpy(["--path", fixture, "--json"], { catalog: COVERING_CATALOG });
  assert.ok(jsonRun.err.trimEnd().endsWith(expected), jsonRun.err);
  JSON.parse(jsonRun.out);
});

test("16kb online with unknown public SDKs: closing line says how many names were sent", async () => {
  const { result, out, calls } = await runWithSpy(["--path", fixture, "--no-color"]);
  assert.equal(result.exitCode, 0);
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  const sent = (JSON.parse(posts[0].body) as { coordinates: string[] }).coordinates.length;
  assert.ok(sent > 0, posts[0].body);
  const expected = privacyLine({
    offline: false,
    lookedUp: true,
    skippedPrivate: 2,
    submitted: sent,
    pendingUnknown: sent,
  });
  assert.ok(out.trimEnd().endsWith(expected), out);
  assert.match(expected, new RegExp(`Sent ${sent} unknown public SDK names to be checked`));
  const jsonRun = await runWithSpy(["--path", fixture, "--json"]);
  assert.ok(jsonRun.err.trimEnd().endsWith(expected), jsonRun.err);
  JSON.parse(jsonRun.out);
});
