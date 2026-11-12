import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { HELP, parseArgv, run } from "../src/cli.ts";
import { VERSION } from "../src/version.ts";
import { ciShouldFail } from "../src/report.ts";
import { DEADLINE_NOTE } from "../src/status.ts";
import type { CatalogEntry } from "../src/check/types.ts";

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
  const o = parseArgv(["--path", "/tmp/app", "--json", "--ci", "--no-color"]);
  assert.equal(o.path, "/tmp/app");
  assert.equal(o.json, true);
  assert.equal(o.ci, true);
  assert.equal(o.color, "never");
});

test("--help and --version", async () => {
  const help = await capture(["--help"]);
  assert.equal(help.result.exitCode, 0);
  assert.equal(help.out, HELP);
  const ver = await capture(["--version"]);
  assert.equal(ver.result.exitCode, 0);
  assert.equal(ver.out, `${VERSION}\n`);
});

test("table output on the fixture includes expected statuses, links, and the deadline", async () => {
  const { result, out } = await capture(["--path", fixture, "--no-color"]);
  assert.equal(result.exitCode, 0);
  assert.match(out, /SDK\s+Version\s+Status\s+Link/);
  assert.match(out, /io\.sentry:sentry-android/);
  assert.match(out, /7\.14\.0/);
  assert.match(out, /not ready/);
  assert.match(out, /Min 16 KB version: 7\.18\.0/);
  assert.match(out, /https:\/\/16kb\.dev\/sdk\/sentry-android/);
  assert.match(out, /com\.mapbox\.maps:android/);
  assert.match(out, /partial/);
  assert.match(out, /okhttp/);
  assert.match(out, /ready/);
  // Plugins live in their own section, not in the library rows or counts.
  assert.ok(!result.report!.rows.some((r) => r.configuration === "plugin"));
  assert.match(out, /Build plugins \(build-time only/);
  assert.match(out, /com\.android\.application\s+8\.7\.3/);
  assert.match(out, /AGP check: Android Gradle Plugin 8\.7\.3 is 8\.5\.1 or newer/);
  assert.match(out, /7 public libraries: 5 ready, 1 not ready, 1 partial/);
  assert.match(out, /2 test-only dependencies were ignored/);
  assert.match(out, /dependency-level check/);
  assert.ok(out.includes("zipalign -c -P 16 -v 4 app.apk"));
  assert.ok(out.includes("via BOM"));
  assert.ok(!out.includes("…"), "nothing is truncated");
  assert.match(out, /private or internal/);
  assert.ok(out.includes(DEADLINE_NOTE));
  assert.ok(result.report);
  assert.equal(ciShouldFail(result.report!), true);
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
  assert.equal(sentry.link, "https://16kb.dev/sdk/sentry-android");
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
  for (const c of ["com.squareup.moshi:moshi", "com.squareup.retrofit2:retrofit", "androidx.appcompat:appcompat", "androidx.compose.material3:material3-adaptive-navigation-suite"]) {
    assert.ok(out.includes(c), `${c} is shown in full`);
  }
  assert.match(out, /Warning: Android Gradle Plugin 8\.3\.2 is below 8\.5\.1/);
  assert.match(out, /com\.android\.tools\.build:gradle\s+8\.3\.2/);
  assert.match(out, /org\.jetbrains\.kotlin\.plugin\.compose\s+2\.0\.21/);
  assert.match(out, /1 private or unrecognized plugin is not shown/);
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
  assert.match(out, /Results are still settling/);
  assert.match(out, /Re-run in a few minutes/);
  out = "";
  await run(["--path", fixture, "--json"], io);
  const body = JSON.parse(out);
  assert.equal(body.settling, true);
  assert.match(body.notes[0], /still settling/);
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
