import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
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
  assert.match(out, /SDK\s+Version\s+Status\s+Min 16KB\s+Link/);
  assert.match(out, /io\.sentry:sentry-android/);
  assert.match(out, /7\.14\.0/);
  assert.match(out, /not ready/);
  assert.match(out, /7\.18\.0/);
  assert.match(out, /https:\/\/16kb\.dev\/sdk\/sentry-android/);
  assert.match(out, /com\.mapbox\.maps:android/);
  assert.match(out, /partial/);
  assert.match(out, /okhttp/);
  assert.match(out, /ready/);
  assert.match(out, /com\.android\.application/);
  const agp = result.report!.rows.find((r) => r.group === "com.android.application");
  assert.equal(agp?.verdict, "likely-fine");
  assert.equal(agp?.configuration, "plugin");
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
