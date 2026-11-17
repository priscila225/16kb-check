import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildZip } from "../src/preflight/zip.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fixture, one, runJson, byId } from "./helpers/run.ts";
import { CHECK_IDS } from "../src/preflight/rules.ts";

test("ready-channel passes the required checks and skips unused ones", async () => {
  const { json, exitCode } = await runJson([fixture("ready-channel"), "--offline"]);
  assert.equal(exitCode, 0);
  assert.equal(json.tool, "roku-preflight");
  assert.equal(json.input.title, "Example Channel");
  assert.equal(json.input.version, "1.2.3");
  assert.equal(json.input.rsgVersion, "1.3");
  const checks = byId(json);
  for (const id of CHECK_IDS) assert.ok(checks[id], `missing ${id}`);
  for (const id of ["manifest-required", "version", "rsg-version", "artwork", "package-size", "deep-linking", "deprecated-legacy-screens", "deprecated-apis", "launch-beacon", "memory-monitor"]) {
    assert.equal(checks[id]!.status, "pass", `${id}: ${checks[id]!.detail}`);
  }
  assert.equal(checks.raf!.status, "skip");
  assert.equal(checks["roku-pay"]!.status, "skip");
  assert.equal(checks["screensaver-manifest"]!.status, "skip");
  assert.match(json.notes[0]!, /official Static Analysis is still required/);
});

test("problem-channel fails manifest, version, rsg, artwork, deep linking, legacy screens, APIs, beacon and memory", async () => {
  const { json, exitCode } = await runJson([fixture("problem-channel"), "--offline"]);
  assert.equal(exitCode, 1);
  const checks = byId(json);
  assert.equal(checks["manifest-required"]!.status, "fail");
  assert.match(checks["manifest-required"]!.detail, /newline/i);
  assert.equal(checks.version!.status, "fail");
  assert.match(checks.version!.detail, /zeros/);
  assert.equal(checks["rsg-version"]!.status, "fail");
  assert.match(checks["rsg-version"]!.detail, /1\.2/);
  assert.equal(checks.artwork!.status, "fail");
  assert.ok(checks.artwork!.items.some((i) => /540x405/.test(i) || /100x100/.test(i)));
  assert.ok(checks.artwork!.items.some((i) => /transparent/.test(i)));
  assert.equal(checks["deep-linking"]!.status, "fail");
  assert.equal(checks["deprecated-legacy-screens"]!.status, "fail");
  assert.match(checks["deprecated-legacy-screens"]!.detail, /roVideoScreen|roPosterScreen/);
  assert.equal(checks["deprecated-apis"]!.status, "warn");
  assert.match(checks["deprecated-apis"]!.detail, /InitClientCertificates|file:\/\//);
  assert.equal(checks["launch-beacon"]!.status, "fail");
  assert.equal(checks["memory-monitor"]!.status, "fail");
});

test("InitClientCertificates is a failure on and after Apr 1, 2027", async () => {
  const { json } = await runJson([fixture("problem-channel"), "--offline", "--only", "deprecated-apis"], {
    now: new Date("2027-04-01T00:00:00Z"),
  });
  const check = byId(json)["deprecated-apis"]!;
  assert.equal(check.status, "fail");
  assert.equal(check.deadline, "2027-04-01");
  assert.match(check.detail, /InitClientCertificates|blocking|file:\/\//);
});

test("InitClientCertificates is a warning before Apr 1, 2027", async () => {
  const check = await one("problem-channel", "deprecated-apis");
  assert.equal(check.status, "warn");
  assert.equal(check.deadline, "2027-04-01");
  assert.match(check.detail, /InitClientCertificates/);
});

test("comments are not treated as API usage", async () => {
  const check = await one("ready-channel", "deprecated-legacy-screens");
  assert.equal(check.status, "pass");
});

test("screensaver-ok skips app-only checks and passes the screensaver manifest", async () => {
  const { json, exitCode } = await runJson([fixture("screensaver-ok"), "--offline"]);
  assert.equal(exitCode, 0);
  const checks = byId(json);
  assert.equal(checks["screensaver-manifest"]!.status, "pass");
  assert.equal(checks["deep-linking"]!.status, "skip");
  assert.equal(checks.artwork!.status, "skip");
  assert.equal(checks["launch-beacon"]!.status, "skip");
  assert.equal(checks["memory-monitor"]!.status, "pass");
  assert.equal(json.input.title, "Example Screensaver");
  assert.equal(json.input.screensaver, true);
});

test("a screensaver with title fails criterion 4.5", async () => {
  const check = await one("screensaver-with-title", "screensaver-manifest");
  assert.equal(check.status, "fail");
  assert.match(check.detail, /title/);
});

test("incomplete RAF setup fails, and enableAdMeasurements is a warning when missing", async () => {
  const check = await one("ads-incomplete", "raf");
  assert.equal(check.status, "fail");
  assert.ok(check.items.some((i) => /Roku_Ads\.brs|roku_ads_lib|StitchedAdHandledEvent/.test(i)));
});

test("subscription hints without ChannelStore fail Roku Pay; doRecovery is enough to pass", async () => {
  const incomplete = await one("pay-incomplete", "roku-pay");
  assert.equal(incomplete.status, "fail");
  const ready = await one("pay-ready", "roku-pay");
  assert.equal(ready.status, "pass", ready.detail);
});

function collect(dir: string, prefix = ""): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...collect(abs, rel));
    else out.push({ name: rel, data: readFileSync(abs) });
  }
  return out;
}

test("a zip of the ready channel is accepted and passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roku-preflight-"));
  const zipPath = join(dir, "example-channel.zip");
  try {
    await writeFile(zipPath, buildZip(collect(fixture("ready-channel"))));
    const { json, exitCode } = await runJson([zipPath, "--offline"]);
    assert.equal(exitCode, 0, JSON.stringify(json.checks, null, 2));
    assert.equal(json.input.kind, "zip");
    assert.equal(json.input.title, "Example Channel");
    assert.match(byId(json)["package-size"]!.detail, /zip file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a project over the 4 MB cap fails package-size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roku-preflight-big-"));
  try {
    await cp(fixture("ready-channel"), dir, { recursive: true });
    await writeFile(join(dir, "assets.bin"), randomBytes(5 * 1024 * 1024));
    const { json, exitCode } = await runJson([dir, "--offline", "--only", "package-size"]);
    assert.equal(exitCode, 1);
    const check = byId(json)["package-size"]!;
    assert.equal(check.status, "fail");
    assert.match(check.detail, /4 MB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
