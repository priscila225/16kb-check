import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUNDLED_PLAY_RULES,
  bundledPlayRules,
  loadPlayRules,
  parsePlayRules,
  playRulesLine,
  PLAY_RULES_SCHEMA_VERSION,
  type PlayRules,
} from "../src/preflight/play-rules.ts";
import type { ApiClient } from "../src/sixteenkb/api.ts";
import { DATES, PLAY_MIN_TARGET } from "../src/preflight/rules.ts";
import { CATALOG, fixture, runJson, runText } from "./helpers/run.ts";

function client(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): ApiClient {
  return {
    baseUrl: "https://devbooth.dev",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return handler(url, init);
    }) as typeof fetch,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const live = (): PlayRules => {
  const copy = structuredClone(BUNDLED_PLAY_RULES) as PlayRules;
  copy.updatedAt = "2026-12-01";
  copy.checks["play-billing"].v8SupportedUntil = "2029-08-31";
  copy.checks["target-api"].since = "2026-09-15";
  return copy;
};

test("bundled snapshot parses and matches the exported dates", () => {
  const parsed = parsePlayRules(BUNDLED_PLAY_RULES);
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, PLAY_RULES_SCHEMA_VERSION);
  assert.equal(parsed.updatedAt, "2026-11-16");
  assert.deepEqual(parsed.checks["target-api"].minTargetSdk, PLAY_MIN_TARGET);
  assert.equal(parsed.checks["target-api"].since, DATES.targetApi36);
  assert.equal(parsed.checks["16kb"].blockFrom, DATES.sixteenKbBlock);
  assert.equal(parsed.checks["play-billing"].v8SupportedUntil, DATES.billing8Cutoff);
  assert.equal(parsed.checks["restricted-permissions"].fineLocationAndContactsFrom, DATES.permissionsApi37);
});

test("parsePlayRules rejects an unknown schemaVersion and missing dates", () => {
  assert.equal(parsePlayRules({ ...BUNDLED_PLAY_RULES, schemaVersion: 2 }), undefined);
  assert.equal(parsePlayRules({ ...BUNDLED_PLAY_RULES, updatedAt: "soon" }), undefined);
  const bad = structuredClone(BUNDLED_PLAY_RULES) as PlayRules;
  bad.checks["16kb"].blockFrom = "February 1";
  assert.equal(parsePlayRules(bad), undefined);
  assert.equal(parsePlayRules({ ok: true }), undefined);
});

test("offline and failed or unrecognized responses fall back to the bundled snapshot", async () => {
  const offline = await loadPlayRules({ offline: true, client: client(() => { throw new Error("should not fetch"); }) });
  assert.equal(offline.source, "bundled");
  assert.equal(offline.fallbackReason, "offline");
  assert.equal(offline.rules.updatedAt, BUNDLED_PLAY_RULES.updatedAt);

  const failed = await loadPlayRules({
    offline: false,
    client: client(() => jsonResponse({ error: "nope" }, 500)),
  });
  assert.equal(failed.source, "bundled");
  assert.equal(failed.fallbackReason, "error");

  const unknown = await loadPlayRules({
    offline: false,
    client: client(() => jsonResponse({ ...BUNDLED_PLAY_RULES, schemaVersion: 99 })),
  });
  assert.equal(unknown.source, "bundled");
  assert.equal(unknown.fallbackReason, "unknown-schema");

  const ok = await loadPlayRules({
    offline: false,
    client: client((url) => {
      assert.equal(url, "https://devbooth.dev/api/play-rules");
      return jsonResponse(live());
    }),
  });
  assert.equal(ok.source, "live");
  assert.equal(ok.fallbackReason, undefined);
  assert.equal(ok.rules.updatedAt, "2026-12-01");
  assert.equal(ok.rules.checks["play-billing"].v8SupportedUntil, "2029-08-31");
});

test("check --offline uses bundled dates, makes no request, and mentions the snapshot in --verbose", async () => {
  const requests: string[] = [];
  const { json, exitCode } = await runJson([fixture("ready-app"), "--offline"], {
    api: client((url) => {
      requests.push(url);
      throw new Error("no network");
    }),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(requests, []);
  assert.equal(json.playRules?.source, "bundled");
  assert.equal(json.playRules?.fallbackReason, "offline");
  assert.equal(json.playRules?.updatedAt, "2026-11-16");
  const c = Object.fromEntries(json.checks.map((x) => [x.id, x]));
  assert.match(c["target-api"].detail, /Aug 31, 2026/);
  assert.match(c["play-billing"].detail, /Aug 31, 2028/);

  const { out } = await runText([fixture("ready-app"), "--offline", "--no-color", "--verbose"], {
    api: client(() => { throw new Error("no network"); }),
  });
  assert.match(out, /Play rules: bundled snapshot from Nov 16, 2026 \(--offline\)/);
  assert.doesNotMatch(out.split("\n").filter((l) => !l.startsWith("Play rules:")) .join("\n"), /Play rules:/);
});

test("online check uses live dates, including --no-submit, and only GETs play-rules and the catalog", async () => {
  const requests: { url: string; method: string }[] = [];
  const api = client((url, init) => {
    requests.push({ url, method: (init?.method || "GET").toUpperCase() });
    if (url.endsWith("/api/play-rules")) return jsonResponse(live());
    if (url.includes("/api/catalog")) {
      return jsonResponse({ ok: true, count: CATALOG.length, entries: CATALOG });
    }
    throw new Error(`unexpected url ${url}`);
  });

  const { json, exitCode } = await runJson([fixture("checks/billing-8"), "--only", "play-billing,target-api", "--no-submit"], { api });
  assert.equal(exitCode, 0);
  assert.equal(json.playRules?.source, "live");
  assert.equal(json.playRules?.updatedAt, "2026-12-01");
  assert.equal(json.playRules?.fallbackReason, undefined);
  const c = Object.fromEntries(json.checks.map((x) => [x.id, x]));
  assert.equal(c["play-billing"].deadline, "2029-08-31");
  assert.match(c["play-billing"].detail, /Aug 31, 2029/);
  assert.match(c["target-api"].detail, /Sep 15, 2026/);
  assert.ok(requests.some((r) => r.url === "https://devbooth.dev/api/play-rules" && r.method === "GET"));
  assert.ok(!requests.some((r) => r.method !== "GET"));
  assert.ok(!requests.some((r) => r.url.includes("check-demand")));

  const { out } = await runText([fixture("checks/billing-8"), "--only", "play-billing", "--no-color", "--verbose", "--no-submit"], { api });
  assert.match(out, /Play rules: live from devbooth\.dev, updated Dec 1, 2026/);
});

test("playRulesLine wording covers each fallback", () => {
  assert.equal(playRulesLine({ source: "live", rules: BUNDLED_PLAY_RULES }), "Play rules: live from devbooth.dev, updated Nov 16, 2026");
  assert.equal(playRulesLine(bundledPlayRules("offline")), "Play rules: bundled snapshot from Nov 16, 2026 (--offline)");
  assert.equal(playRulesLine(bundledPlayRules("error")), "Play rules: bundled snapshot from Nov 16, 2026 (site didn't respond)");
  assert.equal(playRulesLine(bundledPlayRules("unknown-schema")), "Play rules: bundled snapshot from Nov 16, 2026 (unrecognized data)");
});
