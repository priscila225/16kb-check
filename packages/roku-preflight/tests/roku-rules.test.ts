import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUNDLED_ROKU_RULES,
  bundledRokuRules,
  loadRokuRules,
  parseRokuRules,
  rokuRulesLine,
  ROKU_RULES_SCHEMA_VERSION,
  type RokuRules,
} from "../src/preflight/roku-rules.ts";
import type { ApiClient } from "../src/preflight/api.ts";
import { DATES } from "../src/preflight/rules.ts";
import { fixture, runJson, runText } from "./helpers/run.ts";

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

test("bundled snapshot parses and matches exported dates", () => {
  const parsed = parseRokuRules(BUNDLED_ROKU_RULES);
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, ROKU_RULES_SCHEMA_VERSION);
  assert.equal(parsed.updatedAt, "2026-11-16");
  assert.equal(parsed.checks["rsg-version"].required, "1.3");
  assert.equal(parsed.checks["rsg-version"].requiredSince, DATES.rsgRequiredSince);
  assert.equal(parsed.checks["init-client-certificates"].errorFrom, DATES.initClientCertErrorFrom);
  assert.deepEqual(parsed.checks.artwork.iconFhd, [540, 405]);
  assert.deepEqual(parsed.checks.artwork.iconHd, [290, 218]);
  assert.deepEqual(parsed.checks.artwork.splashFhd, [1920, 1080]);
  assert.deepEqual(parsed.checks.artwork.splashHd, [1280, 720]);
  assert.equal(parsed.checks["package-size"].maxMb, 4);
  assert.equal(parsed.checks.launch.beacon, "AppLaunchComplete");
  assert.equal(parsed.checks.blackouts.length, 2);
});

test("parseRokuRules rejects an unknown schemaVersion and missing dates", () => {
  assert.equal(parseRokuRules({ ...BUNDLED_ROKU_RULES, schemaVersion: 2 }), undefined);
  assert.equal(parseRokuRules({ ...BUNDLED_ROKU_RULES, updatedAt: "soon" }), undefined);
  const bad = structuredClone(BUNDLED_ROKU_RULES) as RokuRules;
  bad.checks["init-client-certificates"].errorFrom = "April 1";
  assert.equal(parseRokuRules(bad), undefined);
  assert.equal(parseRokuRules({ ok: true }), undefined);
});

test("offline and failed or unrecognized responses fall back to the bundled snapshot", async () => {
  const offline = await loadRokuRules({ offline: true, client: client(() => { throw new Error("should not fetch"); }) });
  assert.equal(offline.source, "bundled");
  assert.equal(offline.fallbackReason, "offline");
  assert.equal(offline.rules.updatedAt, BUNDLED_ROKU_RULES.updatedAt);

  const failed = await loadRokuRules({
    offline: false,
    client: client(() => jsonResponse({ error: "nope" }, 500)),
  });
  assert.equal(failed.source, "bundled");
  assert.equal(failed.fallbackReason, "error");

  const unknown = await loadRokuRules({
    offline: false,
    client: client(() => jsonResponse({ ...BUNDLED_ROKU_RULES, schemaVersion: 99 })),
  });
  assert.equal(unknown.source, "bundled");
  assert.equal(unknown.fallbackReason, "unknown-schema");

  const liveBody = structuredClone(BUNDLED_ROKU_RULES) as RokuRules;
  liveBody.updatedAt = "2026-12-01";
  liveBody.checks["package-size"].maxMb = 5;
  const ok = await loadRokuRules({
    offline: false,
    client: client((url) => {
      assert.equal(url, "https://devbooth.dev/api/roku-rules");
      return jsonResponse(liveBody);
    }),
  });
  assert.equal(ok.source, "live");
  assert.equal(ok.rules.updatedAt, "2026-12-01");
  assert.equal(ok.rules.checks["package-size"].maxMb, 5);
  assert.equal(ok.fallbackReason, undefined);
});

test("the live fetch does not include a body or project details", async () => {
  let init: RequestInit | undefined;
  await loadRokuRules({
    offline: false,
    client: client((_url, requestInit) => {
      init = requestInit;
      return jsonResponse(BUNDLED_ROKU_RULES);
    }),
  });
  assert.ok(init);
  assert.equal(init.method ?? "GET", "GET");
  assert.equal(init.body, undefined);
});

test("rokuRulesLine names the source", () => {
  assert.match(rokuRulesLine(bundledRokuRules("offline")), /bundled snapshot from Nov 16, 2026 \(--offline\)/);
  assert.match(rokuRulesLine({ source: "live", rules: BUNDLED_ROKU_RULES }), /live from devbooth.dev, updated Nov 16, 2026/);
});

test("check output includes bundled rokuRules and never sends project data", async () => {
  const { json, exitCode } = await runJson([fixture("ready-channel"), "--offline"]);
  assert.equal(exitCode, 0);
  assert.equal(json.rokuRules?.source, "bundled");
  assert.equal(json.rokuRules?.fallbackReason, "offline");
  assert.equal(json.privacy.offline, true);
});

test("verbose text names the bundled snapshot", async () => {
  const { out } = await runText([fixture("ready-channel"), "--offline", "--no-color", "--verbose"]);
  assert.match(out, /Roku rules: bundled snapshot from Nov 16, 2026 \(--offline\)/);
});
