import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../src/sixteenkb/api.ts";
import { run as run16kb } from "../src/sixteenkb/cli.ts";
import { main, HELP } from "../src/cli.ts";
import { VERSION } from "../src/version.ts";
import { CHECK_IDS } from "../src/preflight/rules.ts";
import { parseCheckArgv } from "../src/preflight/run.ts";
import { NO_SUBMIT_LINE } from "../src/sixteenkb/cli.ts";
import { privacyLine } from "../src/sixteenkb/closing.ts";
import type { CatalogEntry } from "../src/sixteenkb/check/types.ts";
import { CATALOG, byId, fixture, runJson, runText } from "./helpers/run.ts";

type Call = { url: string; method: string; body: string };

function spyClient(calls: Call[], entries = CATALOG) {
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

/** Empty catalog so public deps like io.sentry:sentry-android are treated as unknown. */
const UNKNOWN_PUBLIC_CATALOG: typeof CATALOG = [];

test("ready app: everything passes or doesn't apply, exit 0", async () => {
  const { exitCode, json } = await runJson([fixture("ready-app")], { catalog: CATALOG, enqueue: false });
  assert.equal(exitCode, 0);
  assert.equal(json.tool, "play-preflight");
  assert.equal(json.input.targetSdk, 36);
  assert.equal(json.input.module, "app");
  const c = byId(json);
  assert.deepEqual(
    json.checks.map((x) => x.id),
    [...CHECK_IDS],
  );
  for (const id of ["target-api", "16kb", "play-billing", "foreground-services", "edge-to-edge", "large-screens", "predictive-back", "photo-video", "exact-alarms", "restricted-permissions"]) {
    assert.equal(c[id].status, "pass", `${id}: ${c[id].detail}`);
  }
  assert.equal(c["account-deletion"].status, "skip");
  assert.equal(json.summary.fail, 0);
  assert.equal(json.summary.warn, 0);
});

test("legacy app: fails exit 1, and every check line carries a Google source and a devbooth.dev link", async () => {
  const { exitCode, json } = await runJson([fixture("legacy-app")], { catalog: CATALOG, enqueue: false });
  assert.equal(exitCode, 1);
  const c = byId(json);
  assert.equal(c["target-api"].status, "fail");
  assert.equal(c["play-billing"].status, "fail");
  assert.equal(c["foreground-services"].status, "fail");
  assert.equal(c["16kb"].status, "warn");
  assert.match(c["16kb"].detail, /1 SDK not ready/);
  assert.ok(c["16kb"].items.some((i) => i.startsWith("io.sentry:sentry-android 7.14.0")));
  assert.equal(c["edge-to-edge"].status, "warn");
  assert.equal(c["large-screens"].status, "warn");
  assert.equal(c["predictive-back"].status, "warn");
  assert.equal(c["photo-video"].status, "warn");
  assert.equal(c["exact-alarms"].status, "warn");
  assert.equal(c["restricted-permissions"].status, "warn");
  assert.ok(c["restricted-permissions"].items.some((i) => i.startsWith("ACCESS_BACKGROUND_LOCATION")), "library module manifests are merged");
  assert.equal(c["account-deletion"].status, "info");
  for (const r of json.checks) {
    assert.match(r.source, /^https:\/\/(developer\.android\.com|support\.google\.com)\//, r.id);
    assert.match(r.link, /^https:\/\/devbooth\.dev\//, r.id);
  }
});

test("text output: one status line per check, source and link under each, summary and privacy line", async () => {
  const { out, exitCode } = await runText([fixture("legacy-app"), "--no-color"], { catalog: CATALOG, enqueue: false });
  assert.equal(exitCode, 1);
  const statusLines = out.split("\n").filter((l) => /^(PASS|WARN|FAIL|SKIP|INFO)  /.test(l));
  assert.equal(statusLines.length, CHECK_IDS.length);
  assert.equal(out.split("\n").filter((l) => l.startsWith("      Rule: https://")).length, CHECK_IDS.length);
  assert.equal(out.split("\n").filter((l) => l.startsWith("      → https://devbooth.dev/")).length, CHECK_IDS.length);
  assert.match(out, /^play-preflight check {2}· {2}app \(targetSdk 35, from app\/build\.gradle/m);
  assert.match(out, /0 pass · 7 warn · 3 fail · 0 skip · 1 info/);
  assert.doesNotMatch(out, /\u001b\[/);
});

test("--strict fails on warnings; --only and --skip pick checks; unknown ids are rejected", async () => {
  const warnOnly = ["--offline", "--only", "photo-video"];
  assert.equal((await runJson([fixture("checks/photo-media"), ...warnOnly])).exitCode, 0);
  assert.equal((await runJson([fixture("checks/photo-media"), ...warnOnly, "--strict"])).exitCode, 1);
  const info = await runJson([fixture("checks/back-optout"), "--offline", "--only", "predictive-back", "--strict"]);
  assert.equal(info.exitCode, 0, "info never fails, even with --strict");

  const skipped = await runJson([fixture("legacy-app"), "--offline", "--skip", "target-api,play-billing,foreground-services"]);
  assert.equal(skipped.exitCode, 0);
  assert.ok(!skipped.json.checks.some((x) => ["target-api", "play-billing", "foreground-services"].includes(x.id)));

  const bad = await runText([fixture("legacy-app"), "--only", "nope"]);
  assert.equal(bad.exitCode, 2);
  assert.match(bad.err, /Unknown check id for --only: nope/);
});

test("--offline makes no network calls at all", async () => {
  const calls: Call[] = [];
  const { json } = await runJson([fixture("legacy-app"), "--offline"], { api: spyClient(calls) });
  assert.equal(calls.length, 0);
  assert.equal(json.privacy.offline, true);
  assert.ok(byId(json)["16kb"].items.includes("SDK lookup skipped (--offline)."));
});

test("parseCheckArgv: --no-submit, --no-auto-check, and PLAY_PREFLIGHT_NO_SUBMIT", () => {
  assert.equal(parseCheckArgv([], {}).noSubmit, false);
  assert.equal(parseCheckArgv(["--no-submit"], {}).noSubmit, true);
  assert.equal(parseCheckArgv(["--no-auto-check"], {}).noSubmit, true);
  assert.equal(parseCheckArgv([], { PLAY_PREFLIGHT_NO_SUBMIT: "1" }).noSubmit, true);
  assert.equal(parseCheckArgv([], { PLAY_PREFLIGHT_NO_SUBMIT: "true" }).noSubmit, true);
  assert.equal(parseCheckArgv([], { PLAY_PREFLIGHT_NO_SUBMIT: "0" }).noSubmit, false);
  assert.equal(parseCheckArgv(["--offline", "--no-submit"]).offline, true);
  assert.equal(parseCheckArgv(["--offline", "--no-submit"]).noSubmit, true);
});

test("without --no-submit, unknown public SDKs are POSTed to check-demand", async () => {
  const calls: Call[] = [];
  await runJson([fixture("legacy-app")], { api: spyClient(calls, UNKNOWN_PUBLIC_CATALOG), env: {} });
  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://devbooth.test/api/check-demand");
  assert.match(posts[0].body, /io\.sentry:sentry-android/);
  assert.doesNotMatch(posts[0].body, /acme-internal|secret-kit|com\.github/);
  assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/api/catalog")));
});

async function assertNoSubmit(args: string[], extra: Parameters<typeof runJson>[1] = {}) {
  const calls: Call[] = [];
  const { json, exitCode } = await runJson([fixture("legacy-app"), ...args], {
    api: spyClient(calls, UNKNOWN_PUBLIC_CATALOG),
    ...extra,
  });
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.equal(calls[0].method, "GET");
  assert.ok(calls[0].url.startsWith("https://devbooth.test/api/catalog"), calls[0].url);
  assert.ok(!calls.some((c) => c.method === "POST" || c.url.includes("check-demand")));
  assert.equal(json.privacy.noSubmit, true);
  assert.equal(json.privacy.offline, false);
  assert.equal(json.privacy.lookedUp, true);
  const text = await runText([fixture("legacy-app"), "--no-color", ...args], {
    api: spyClient([], UNKNOWN_PUBLIC_CATALOG),
    ...extra,
  });
  assert.ok(text.out.trimEnd().endsWith(NO_SUBMIT_LINE), text.out);
  return { json, calls };
}

test("--no-submit downloads the catalog and never POSTs, even with unknown public SDKs", async () => {
  await assertNoSubmit(["--no-submit"]);
});

test("--no-auto-check is an alias of --no-submit", async () => {
  await assertNoSubmit(["--no-auto-check"]);
});

test("PLAY_PREFLIGHT_NO_SUBMIT=1 is the same as --no-submit", async () => {
  await assertNoSubmit([], { env: { PLAY_PREFLIGHT_NO_SUBMIT: "1" } });
});

test("privacy: only public SDK names leave the machine; never targetSdk, permissions, package or private coordinates", async () => {
  const calls: Call[] = [];
  const { json, exitCode } = await runJson([fixture("legacy-app")], { api: spyClient(calls) });
  assert.equal(exitCode, 1);
  assert.ok(calls.length >= 1);
  for (const c of calls) {
    assert.ok(c.url.startsWith("https://devbooth.test/api/catalog") || c.url === "https://devbooth.test/api/check-demand", c.url);
    const blob = c.url + c.body;
    for (const secret of [
      "acme-internal",
      "secret-kit",
      "com.github",
      "dev.example",
      "targetSdk",
      "\"35\"",
      "permission",
      "READ_MEDIA",
      "QUERY_ALL_PACKAGES",
      "PlayerActivity",
      "themes.xml",
    ]) {
      assert.ok(!blob.includes(secret), `${secret} leaked in ${c.method} ${c.url}`);
    }
  }
  const out = JSON.stringify(json);
  assert.doesNotMatch(out, /acme-internal|secret-kit/);
  assert.equal(json.privacy.skippedPrivate, 1);
  assert.equal(json.privacy.lookedUp, true);
});

test("the SDK lookup is skipped when the 16kb check is not selected", async () => {
  const calls: Call[] = [];
  await runJson([fixture("legacy-app"), "--only", "target-api"], { api: spyClient(calls) });
  assert.equal(calls.length, 0);
});

test("a failed catalog download doesn't stop the other checks", async () => {
  const client = createClient({
    baseUrl: "https://devbooth.test",
    fetch: (async () => new Response("nope", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch,
  });
  const { json, exitCode } = await runJson([fixture("ready-app")], { api: client });
  assert.equal(exitCode, 0);
  const c = byId(json)["16kb"];
  assert.equal(c.status, "skip");
  assert.ok(c.items.some((i) => /SDK lookup failed/.test(i)));
});

test("no project and no binary exits 2 with a clear message", async () => {
  const empty = await mkdtemp(join(tmpdir(), "play-preflight-empty-"));
  try {
    const r = await runText([empty]);
    assert.equal(r.exitCode, 2);
    assert.match(r.err, /No Android project files found/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("several app modules: picks app, says so, and --module switches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "play-preflight-multi-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await writeFile(join(dir, "settings.gradle.kts"), 'include(":app", ":wear")\n');
    for (const [m, t] of [
      ["app", 36],
      ["wear", 33],
    ] as const) {
      await mkdir(join(dir, m), { recursive: true });
      await writeFile(join(dir, m, "build.gradle.kts"), `plugins { id("com.android.application") }\nandroid { defaultConfig { targetSdk = ${t} } }\n`);
    }
    const a = await runJson([dir, "--offline", "--only", "target-api"]);
    assert.equal(a.json.input.module, "app");
    assert.equal(a.json.input.targetSdk, 36);
    assert.ok(a.json.notes.some((n) => /Several app modules/.test(n)));
    const w = await runJson([dir, "--offline", "--only", "target-api", "--module", ":wear"]);
    assert.equal(w.json.input.targetSdk, 33);
    assert.equal(w.exitCode, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function capture() {
  let out = "";
  let err = "";
  return {
    io: { stdout: { write: (s: string) => void (out += s) }, stderr: { write: (s: string) => void (err += s) } },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

test("`play-preflight 16kb` prints exactly what the 16kb engine prints", async () => {
  const a = capture();
  const b = capture();
  const args = [ "--path", fixture("legacy-app"), "--json"];
  const codeA = await main(["16kb", ...args], { ...a.io, catalog: CATALOG, enqueue: false });
  const r = await run16kb(args, { ...b.io, catalog: CATALOG, enqueue: false });
  assert.equal(codeA, r.exitCode);
  const strip = (s: string) => s.replace(/"checkedAt": "[^"]+"/, "");
  assert.equal(strip(a.out), strip(b.out));
  assert.doesNotMatch(a.out, /acme-internal|secret-kit/);
  const ci = capture();
  assert.equal(await main(["16kb", "--path", fixture("legacy-app"), "--ci"], { ...ci.io, catalog: CATALOG, enqueue: false }), 1);
});

test("dispatcher: default command is check, --version, help, unknown command", async () => {
  const v = capture();
  assert.equal(await main(["--version"], v.io), 0);
  assert.equal(v.out, `${VERSION}\n`);
  const h = capture();
  assert.equal(await main(["--help"], h.io), 0);
  assert.equal(h.out, HELP);
  const d = capture();
  assert.equal(await main([fixture("checks/billing-7"), "--offline", "--only", "play-billing"], d.io), 1);
  assert.match(d.out, /^FAIL {2}Play Billing Library/m);
  const u = capture();
  assert.equal(await main(["deploy"], u.io), 2);
  assert.match(u.err, /Unknown command: deploy/);
  const ch = capture();
  assert.equal(await main(["check", "--help"], ch.io), 0);
  assert.match(ch.out, /--offline/);
  assert.match(ch.out, /--no-submit/);
  assert.match(ch.out, /--no-auto-check/);
  assert.match(ch.out, /PLAY_PREFLIGHT_NO_SUBMIT/);
});

const READY_CATALOG: CatalogEntry[] = [
  {
    slug: "androidx-core",
    name: "AndroidX Core",
    status: "compatible",
    minVersion: "any",
    notes: "",
    mavenCoords: ["androidx.core:*"],
  },
  {
    slug: "play-billing",
    name: "Play Billing",
    status: "compatible",
    minVersion: "any",
    notes: "",
    mavenCoords: ["com.android.billingclient:*"],
  },
];

const ANDROID_APP = join(dirname(fileURLToPath(import.meta.url)), "16kb/fixtures/android-app");

const ANDROID_APP_CATALOG: CatalogEntry[] = [
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

test("online with no unknown SDKs: closing line says nothing was sent", async () => {
  const text = await runText([fixture("ready-app"), "--no-color"], { api: spyClient([], READY_CATALOG), env: {} });
  assert.equal(text.exitCode, 0);
  assert.ok(text.out.trimEnd().endsWith("Downloaded the public SDK list. No unknown SDKs, so nothing was sent."), text.out);
  const { json } = await runJson([fixture("ready-app")], { api: spyClient([], READY_CATALOG), env: {} });
  assert.equal(json.privacy.lookedUp, true);
  assert.equal(json.privacy.submitted, 0);
  assert.equal(json.privacy.pendingUnknown, 0);
  assert.equal(json.privacy.noSubmit, false);
});

test("online with unknown public SDKs: closing line says how many names were sent", async () => {
  const text = await runText([fixture("legacy-app"), "--no-color"], { api: spyClient([], UNKNOWN_PUBLIC_CATALOG), env: {} });
  assert.equal(text.exitCode, 1);
  const expected = privacyLine({
    offline: false,
    lookedUp: true,
    skippedPrivate: 1,
    submitted: 3,
    pendingUnknown: 3,
  });
  assert.ok(text.out.trimEnd().endsWith(expected), text.out);
  assert.equal(expected, "Downloaded the public SDK list. Sent 3 unknown public SDK names to be checked. 1 private or internal library was skipped and never sent.");
  const calls: Call[] = [];
  const { json } = await runJson([fixture("legacy-app")], { api: spyClient(calls, UNKNOWN_PUBLIC_CATALOG), env: {} });
  assert.equal(json.privacy.submitted, 3);
  assert.equal(json.privacy.pendingUnknown, 3);
  assert.equal(json.privacy.skippedPrivate, 1);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("check --json includes numeric 16kb SDK breakdown counts, not names", async () => {
  const { json, exitCode } = await runJson([ANDROID_APP], { catalog: ANDROID_APP_CATALOG, enqueue: false });
  assert.equal(exitCode, 0);
  const kb = byId(json)["16kb"];
  assert.ok(kb.sdk, JSON.stringify(kb));
  assert.equal(kb.sdk.checked, 7);
  assert.equal(kb.sdk.ready, 5);
  assert.equal(kb.sdk.notReady, 1);
  assert.equal(kb.sdk.partial, 1);
  assert.equal(kb.sdk.unknown, 0);
  assert.equal(kb.sdk.checking, 0);
  assert.equal(kb.sdk.skippedPrivate, 2);
  assert.equal(kb.sdk.testOnlyIgnored, 2);
  assert.equal(kb.sdk.buildToolingIgnored, 0);
  const encoded = JSON.stringify(kb.sdk);
  assert.doesNotMatch(encoded, /io\.sentry|com\.mapbox|com\.github|secret-kit|junit|okhttp|firebase/);
  for (const n of Object.values(kb.sdk)) assert.equal(typeof n, "number");
});
