import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverProject } from "../src/discover.ts";
import { parseProjectFiles } from "../src/check/parse.ts";
import { splitPublicDeps } from "../src/privacy.ts";
import { publicDemandCoordinates, isCandidatePublicCoordinate } from "../src/check/public-coords.ts";
import { buildReport } from "../src/check/match.ts";
import { toJson, formatTable } from "../src/report.ts";
import { run } from "../src/cli.ts";
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
    notes: "Switch to the -ndk27 artifact.",
    mavenCoords: ["com.mapbox.maps:android", "com.mapbox.maps:android-ndk27"],
  },
];

function collect(): ReturnType<typeof splitPublicDeps> & { parsed: ReturnType<typeof parseProjectFiles> } {
  const discovered = discoverProject(fixture);
  const parsed = parseProjectFiles(discovered.files);
  return { parsed, ...splitPublicDeps(parsed.dependencies) };
}

test("private com.github and JitPack coordinates are parsed but dropped before any network use", () => {
  const { parsed, publicDeps, skippedPrivate } = collect();
  const keys = parsed.dependencies.map((d) => `${d.group}:${d.artifact}`);
  assert.ok(keys.includes("com.github.acme-internal:secret-kit"), "parser should still see the declared private coordinate locally");
  assert.ok(keys.includes("io.jitpack.sample:helper"));
  assert.ok(skippedPrivate >= 2);

  const publicKeys = publicDeps.map((d) => `${d.group}:${d.artifact}`);
  assert.ok(!publicKeys.includes("com.github.acme-internal:secret-kit"));
  assert.ok(!publicKeys.includes("io.jitpack.sample:helper"));
  assert.ok(!publicKeys.some((k) => k.includes("hearst") || k.includes("magnum") || k.includes("HUB-Android")));
  assert.equal(isCandidatePublicCoordinate("com.github.acme-internal:secret-kit"), false);
  assert.equal(isCandidatePublicCoordinate("io.jitpack.sample:helper"), false);

  const demand = publicDemandCoordinates(parsed.dependencies.map((d) => `${d.group}:${d.artifact}`));
  assert.ok(!demand.includes("com.github.acme-internal:secret-kit"));
  assert.ok(!demand.includes("io.jitpack.sample:helper"));
  assert.ok(!demand.some((c) => c.startsWith("com.github.")));
});

test("table and JSON output never mention private coordinates", () => {
  const { parsed, publicDeps, skippedPrivate } = collect();
  const report = buildReport({ ...parsed, dependencies: publicDeps }, catalog);
  const json = JSON.stringify(toJson(report, skippedPrivate));
  const table = formatTable(report, skippedPrivate, false);
  for (const blob of [json, table]) {
    assert.doesNotMatch(blob, /acme-internal/);
    assert.doesNotMatch(blob, /secret-kit/);
    assert.doesNotMatch(blob, /jitpack\.sample/);
    assert.doesNotMatch(blob, /hearst/i);
    assert.doesNotMatch(blob, /magnumapi/i);
    assert.doesNotMatch(blob, /HUB-Android/);
  }
  assert.match(json, /skippedPrivate/);
  assert.match(table, /private or internal/);
});

test("CLI JSON run on the fixture never prints private coordinates", async () => {
  let out = "";
  let err = "";
  const result = await run(["--path", fixture, "--json", "--no-color"], {
    stdout: { write: (s) => { out += s; }, isTTY: false },
    stderr: { write: (s) => { err += s; }, isTTY: false },
    catalog,
    enqueue: false,
  });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(out, /acme-internal|secret-kit|jitpack\.sample|hearst|magnumapi|HUB-Android/i);
  assert.doesNotMatch(err, /acme-internal|secret-kit|jitpack\.sample|hearst|magnumapi|HUB-Android/i);
  const body = JSON.parse(out);
  assert.ok(body.summary.skippedPrivate >= 2);
  const sdks = body.rows.map((r: { sdk: string }) => r.sdk);
  assert.ok(sdks.includes("io.sentry:sentry-android"));
  assert.ok(!sdks.some((s: string) => s.includes("github")));
});

test("bundles fixture: private bundle members, test deps, and convention plugins never appear", async () => {
  const bundles = join(dirname(fileURLToPath(import.meta.url)), "fixtures/bundles-app");
  for (const argv of [["--path", bundles, "--no-color"], ["--path", bundles, "--json"]]) {
    let out = "";
    let err = "";
    await run(argv, {
      stdout: { write: (s) => { out += s; }, isTTY: false },
      stderr: { write: (s) => { err += s; }, isTTY: false },
      catalog,
      enqueue: false,
    });
    for (const blob of [out, err]) {
      assert.doesNotMatch(blob, /com\.example|ads-sdk|consent-decoder|acme/);
    }
  }
});

test("demand requests never include private bundle members", async () => {
  const bundles = join(dirname(fileURLToPath(import.meta.url)), "fixtures/bundles-app");
  const bodies: string[] = [];
  const fakeFetch = (async (url: string, init?: { body?: string }) => {
    if (init?.body) bodies.push(init.body);
    const payload = String(url).endsWith("/api/catalog") ? { ok: true, count: 0, entries: [] } : { ok: true, accepted: 0, jobs: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  await run(["--path", bundles, "--json"], {
    stdout: { write: () => {}, isTTY: false },
    stderr: { write: () => {}, isTTY: false },
    api: { baseUrl: "https://example.invalid", fetch: fakeFetch },
  });
  assert.ok(bodies.length >= 1, "unknown public libraries are sent as a demand signal");
  for (const b of bodies) {
    assert.doesNotMatch(b, /com\.example|ads-sdk|consent-decoder|acme|junit|mockito|gradle\.plugin|com\.android\.tools/);
  }
});
