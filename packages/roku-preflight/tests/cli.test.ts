import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import { runCheck } from "../src/preflight/run.ts";
import { CHECK_IDS } from "../src/preflight/rules.ts";
import { VERSION } from "../src/version.ts";
import { fixture, runText } from "./helpers/run.ts";

async function runMain(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
  });
  return { code, out, err };
}

test("help and version", async () => {
  const help = await runMain(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /npx roku-preflight/);
  assert.match(help.out, /official Static Analysis/);
  const ver = await runMain(["--version"]);
  assert.equal(ver.code, 0);
  assert.equal(ver.out.trim(), VERSION);
});

test("check --help lists every check id and exit codes", async () => {
  let out = "";
  const res = await runCheck(["--help"], {
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: () => {} },
  });
  assert.equal(res.exitCode, 0);
  for (const id of CHECK_IDS) assert.match(out, new RegExp(id));
  assert.match(out, /Exit codes/);
  assert.match(out, /sends nothing about your project/);
});

test("unknown flag and unknown check id exit 2", async () => {
  const flag = await runText([fixture("ready-channel"), "--offline", "--nope"]);
  assert.equal(flag.exitCode, 2);
  assert.match(flag.err, /Unknown option|unknown/i);
  const id = await runText([fixture("ready-channel"), "--offline", "--only", "nope"]);
  assert.equal(id.exitCode, 2);
  assert.match(id.err, /Unknown check id/);
});

test("missing path exits 2", async () => {
  const { exitCode, err } = await runText(["/tmp/roku-preflight-does-not-exist-example", "--offline"]);
  assert.equal(exitCode, 2);
  assert.match(err, /not found/i);
});

test("unknown command exits 2", async () => {
  const res = await runMain(["frobnicate"]);
  assert.equal(res.code, 2);
  assert.match(res.err, /Unknown command/);
});

test("--strict exits 1 on WARN", async () => {
  const { exitCode } = await runText([fixture("problem-channel"), "--offline", "--only", "deprecated-apis"]);
  assert.equal(exitCode, 0); // warning only, before Apr 1, 2027
  const strict = await runText([fixture("problem-channel"), "--offline", "--only", "deprecated-apis", "--strict"]);
  assert.equal(strict.exitCode, 1);
});

test("default command runs check", async () => {
  const res = await runMain([fixture("ready-channel"), "--offline", "--no-color"]);
  assert.equal(res.code, 0);
  assert.match(res.out, /roku-preflight check/);
});
