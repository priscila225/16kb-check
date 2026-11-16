"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const cli = join(__dirname, "..", "cli.js");
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

test("prints the move notice on stderr and runs play-preflight 16kb", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /16kb-check moved to play-preflight/);
  assert.match(r.stdout, /play-preflight 16kb/);
  assert.match(r.stdout, /--ci/);
});

test("passes arguments through and keeps exit codes", () => {
  const empty = mkdtempSync(join(tmpdir(), "16kb-wrapper-"));
  try {
    const r = run(["--path", empty, "--json"]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "", "nothing on stdout, so --json consumers don't get the notice");
    assert.match(r.stderr, /No Android project files found/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("--version prints the wrapper version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${require("../package.json").version}\n`);
});
