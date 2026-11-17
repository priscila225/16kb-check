import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_IDS } from "../src/preflight/rules.ts";
import { fixture, runJson, runText } from "./helpers/run.ts";

function statusLines(out: string): string[] {
  return out.split("\n").filter((l) => /^(PASS|WARN|FAIL|SKIP|INFO)  /.test(l));
}

function linkCount(out: string): { rules: number; site: number } {
  return {
    rules: out.split("\n").filter((l) => l.startsWith("      Rule: https://")).length,
    site: out.split("\n").filter((l) => l.startsWith("      → https://devbooth.dev/")).length,
  };
}

test("ready-channel default output: compact PASS, one SKIP line each, no pass links, summary repeated", async () => {
  const { out, exitCode } = await runText([fixture("ready-channel"), "--offline", "--no-color"]);
  assert.equal(exitCode, 0);
  const lines = out.split("\n");
  assert.match(lines[0]!, /roku-preflight check {2}· {2}Example Channel {2}· {2}project {2}· {2}version 1\.2\.3 {2}rsg 1\.3/);
  assert.match(lines[1]!, /^\d+ pass · 0 warn · 0 fail · \d+ skip/);
  assert.match(out, /official Static Analysis is still required when you submit/);
  assert.doesNotMatch(out, /launch time is \d/);
  assert.equal(linkCount(out).rules, 0);
  assert.equal(linkCount(out).site, 0);

  const skips = statusLines(out).filter((l) => l.startsWith("SKIP  "));
  assert.equal(skips.length, 3, out);
  assert.ok(skips.every((l) => /SKIP  \S.*  \S/.test(l)), skips.join("\n"));
  assert.ok(skips.some((l) => /Roku Advertising Framework\s+not used/.test(l)), out);
  assert.ok(skips.some((l) => /Roku Pay\s+not used/.test(l)), out);
  assert.ok(skips.some((l) => /Screensaver manifest\s+Not a standalone screensaver/.test(l)), out);
  for (const s of skips) {
    const idx = lines.indexOf(s);
    const next = lines[idx + 1] ?? "";
    assert.ok(!next.startsWith("      -"), `SKIP should have no sub-bullets by default: ${s}\n${next}`);
  }

  const passes = statusLines(out).filter((l) => l.startsWith("PASS  "));
  assert.ok(passes.length >= 8);
  for (const p of passes) {
    const idx = lines.indexOf(p);
    const next = lines[idx + 1] ?? "";
    assert.ok(!next.startsWith("      -"), `PASS should have no sub-bullets by default: ${p}\n${next}`);
  }

  const summary = lines[1];
  assert.equal(lines.filter((l) => l === summary).length, 2);
  assert.match(out, /Checked fully offline/);
});

test("ready-channel --verbose shows links on every check and the rules snapshot line", async () => {
  const { out, exitCode } = await runText([fixture("ready-channel"), "--offline", "--no-color", "--verbose"]);
  assert.equal(exitCode, 0);
  assert.match(out, /Roku rules: bundled snapshot from Nov 16, 2026 \(--offline\)/);
  const links = linkCount(out);
  const checks = statusLines(out).length;
  assert.equal(links.rules, checks);
  assert.equal(links.site, checks);
  assert.ok(checks >= CHECK_IDS.length);
  const skips = statusLines(out).filter((l) => l.startsWith("SKIP  "));
  assert.ok(skips.length >= 3, out);
});

test("problem-channel lists FAIL then WARN, with links only on those", async () => {
  const { out, exitCode } = await runText([fixture("problem-channel"), "--offline", "--no-color"]);
  assert.equal(exitCode, 1);
  const statuses = statusLines(out).map((l) => l.slice(0, 4));
  const failAt = statuses.indexOf("FAIL");
  const warnAt = statuses.indexOf("WARN");
  const passAt = statuses.indexOf("PASS");
  assert.ok(failAt >= 0 && warnAt > failAt);
  if (passAt >= 0) assert.ok(passAt > warnAt);
  assert.ok(linkCount(out).rules > 0);
  const lines = out.split("\n");
  for (const p of statusLines(out).filter((l) => l.startsWith("PASS  "))) {
    const idx = lines.indexOf(p);
    const nearby = lines.slice(idx, idx + 4).join("\n");
    assert.doesNotMatch(nearby, /Rule: https:\/\//);
  }
  assert.match(out, /official Static Analysis is still required/);
});

test("github format emits annotations then the text report", async () => {
  const { out, exitCode } = await runText([fixture("problem-channel"), "--offline", "--no-color", "--format", "github"]);
  assert.equal(exitCode, 1);
  assert.match(out, /^::error /m);
  assert.match(out, /^::warning /m);
  assert.match(out, /roku-preflight check/);
  const summary = out.split("\n").find((l) => /pass · .* fail/.test(l));
  assert.ok(summary);
  assert.equal(out.split("\n").filter((l) => l === summary).length, 2);
});

test("json includes locations, notes, and exitCode", async () => {
  const { json, exitCode } = await runJson([fixture("problem-channel"), "--offline"]);
  assert.equal(exitCode, 1);
  assert.equal(json.exitCode, 1);
  assert.ok(json.notes.some((n) => /Static Analysis/.test(n)));
  const legacy = json.checks.find((c) => c.id === "deprecated-legacy-screens")!;
  assert.ok(legacy.locations && legacy.locations.length >= 1);
  assert.ok(legacy.locations[0]!.file.endsWith("main.brs"));
});

test("a single finding does not repeat the headline as a bullet, and locations are one per line", async () => {
  const { out, exitCode } = await runText([fixture("problem-channel"), "--offline", "--no-color", "--only", "deprecated-apis"]);
  assert.equal(exitCode, 0);
  const lines = out.split("\n");
  const warn = statusLines(out).find((l) => l.startsWith("WARN  "));
  assert.ok(warn, out);
  assert.match(warn!, /InitClientCertificates/);
  const idx = lines.indexOf(warn!);
  const following = lines.slice(idx + 1);
  assert.ok(!following[0]!.startsWith("      -"), `did not expect a repeated bullet: ${following[0]}`);
  const loc = following.find((l) => /^      \S/.test(l) && !l.startsWith("      Rule:") && !l.startsWith("      →"));
  assert.ok(loc, out);
  assert.match(loc!, /source\/main\.brs:\d+$/);
  assert.doesNotMatch(warn!, /source\/main\.brs/);
});

test("hd-icons-vendored reports the missing FHD icon and vendored API once each, with indented locations", async () => {
  const { out, exitCode } = await runText([fixture("hd-icons-vendored"), "--offline", "--no-color"]);
  assert.equal(exitCode, 0);
  const warns = statusLines(out).filter((l) => l.startsWith("WARN  "));
  assert.equal(warns.length, 2, out);
  assert.ok(warns.some((l) => /Icons and splash screens/.test(l) && /recommended/.test(l)), out);
  assert.ok(warns.some((l) => /Deprecated APIs/.test(l) && /vendored code/.test(l)), out);
  assert.equal(statusLines(out).filter((l) => /FHD icon|mm_icon_focus_fhd/.test(l)).length, 1, out);
  const lines = out.split("\n");
  const vendored = warns.find((l) => /vendored code/.test(l))!;
  const idx = lines.indexOf(vendored);
  const loc = lines.slice(idx + 1).find((l) => /vendor\/example-sdk\/http\.brs:\d+/.test(l));
  assert.ok(loc, out);
  assert.match(loc!, /^      vendor\/example-sdk\/http\.brs:\d+$/);
});

