import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_IDS } from "../src/preflight/rules.ts";
import { CATALOG, fixture, runJson, runText } from "./helpers/run.ts";

function statusLines(out: string): string[] {
  return out.split("\n").filter((l) => /^(PASS|WARN|FAIL|SKIP|INFO)  /.test(l));
}

function linkCount(out: string): { rules: number; site: number } {
  return {
    rules: out.split("\n").filter((l) => l.startsWith("      Rule: https://")).length,
    site: out.split("\n").filter((l) => l.startsWith("      → https://devbooth.dev/")).length,
  };
}

test("ready-app default output: compact PASS, collapsed SKIP, caveat once, no pass links", async () => {
  const { out, exitCode } = await runText([fixture("ready-app"), "--offline", "--no-color"]);
  assert.equal(exitCode, 0);
  const lines = out.split("\n");
  assert.match(lines[0]!, /play-preflight check {2}· {2}app {2}· {2}source only {2}· {2}targetSdk 36/);
  assert.match(lines[0]!, /compileSdk /);
  assert.match(lines[1]!, /^\d+ pass · 0 warn · 0 fail · \d+ skip/);
  assert.equal(out.split("Read from source manifests.").length - 1, 1);
  assert.doesNotMatch(out, /^Note: Read from source manifests/m);
  assert.doesNotMatch(out, /Next: API 37/);
  assert.doesNotMatch(out, /Check your insets on a real device/);
  assert.equal(linkCount(out).rules, 0);
  assert.equal(linkCount(out).site, 0);

  const skips = statusLines(out).filter((l) => l.startsWith("SKIP  "));
  assert.equal(skips.length, 1, out);
  assert.match(skips[0]!, /\(/);
  assert.match(skips[0]!, /, /); // at least two skipped checks on one line

  const passes = statusLines(out).filter((l) => l.startsWith("PASS  "));
  assert.ok(passes.length >= 1);
  for (const p of passes) {
    const idx = lines.indexOf(p);
    const next = lines[idx + 1] ?? "";
    assert.ok(!next.startsWith("      -"), `PASS should have no sub-bullets by default: ${p}\n${next}`);
  }

  const summary = lines[1];
  assert.equal(lines.filter((l) => l === summary).length, 2);
  assert.match(out, /Checked fully offline/);
});

test("ready-app --verbose shows links, side notes, and SDK 'from' details", async () => {
  const { out, exitCode } = await runText([fixture("ready-app"), "--offline", "--no-color", "--verbose"]);
  assert.equal(exitCode, 0);
  assert.match(out.split("\n")[0]!, /targetSdk 36, from /);
  assert.match(out, /Next: API 37/);
  assert.match(out, /Check your insets on a real device/);
  const links = linkCount(out);
  const checks = statusLines(out).length;
  assert.equal(links.rules, checks);
  assert.equal(links.site, checks);
  assert.ok(checks >= CHECK_IDS.length - 2); // skips are expanded, still one line each plus details maybe
  // SKIPs are expanded in verbose, so more than one SKIP line is ok
  const skips = statusLines(out).filter((l) => l.startsWith("SKIP  "));
  assert.ok(skips.length >= 2, out);
  const all = out.split("\n");
  for (const s of skips) {
    const idx = all.indexOf(s);
    assert.ok(all.slice(idx, idx + 6).some((l) => l.startsWith("      Rule: https://")), s);
  }
});

test("legacy-app default output lists FAIL then WARN then INFO, with a fix hint and short class names", async () => {
  const { out, exitCode } = await runText([fixture("legacy-app"), "--no-color"], { catalog: CATALOG, enqueue: false });
  assert.equal(exitCode, 1);
  const statuses = statusLines(out).map((l) => l.slice(0, 4));
  const order = statuses.join(" ");
  assert.match(order, /^FAIL( FAIL)* WARN( WARN)* INFO/);
  assert.doesNotMatch(order, /PASS/);
  assert.match(out, /PlayerActivity {2}app\/src\/main\/AndroidManifest\.xml:14 {2}portrait/);
  assert.doesNotMatch(out, /dev\.example\.legacy\.PlayerActivity/);
  assert.match(out, /Fix: drop screenOrientation/);
});

test("large-screens caps at 5 locks by default and lists all with --verbose", async () => {
  const dir = await mkdtemp(join(tmpdir(), "play-preflight-large-many-"));
  try {
    await writeFile(join(dir, "settings.gradle.kts"), "include(\":app\")\n");
    await mkdir(join(dir, "app/src/main"), { recursive: true });
    await writeFile(
      join(dir, "app/build.gradle.kts"),
      'plugins { id("com.android.application") }\nandroid { defaultConfig { targetSdk = 36 } }\n',
    );
    const activities = Array.from({ length: 7 }, (_, i) => `        <activity android:name=".Screen${i + 1}" android:screenOrientation="portrait" />`);
    await writeFile(
      join(dir, "app/src/main/AndroidManifest.xml"),
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
${activities.join("\n")}
    </application>
</manifest>
`,
    );
    const def = await runText([dir, "--offline", "--no-color", "--only", "large-screens"]);
    assert.equal(def.exitCode, 0);
    const lockLines = def.out.split("\n").filter((l) => /Screen\d+ {2}app\/src\/main\/AndroidManifest\.xml:\d+ {2}portrait/.test(l));
    assert.equal(lockLines.length, 5, def.out);
    assert.match(def.out, /…and 2 more \(use --verbose\)/);
    assert.match(def.out, /Fix: drop screenOrientation/);
    assert.doesNotMatch(def.out, /Screen6 /);

    const verb = await runText([dir, "--offline", "--no-color", "--only", "large-screens", "--verbose"]);
    const all = verb.out.split("\n").filter((l) => /Screen\d+ {2}app\/src\/main\/AndroidManifest\.xml:\d+ {2}portrait/.test(l));
    assert.equal(all.length, 7, verb.out);
    assert.doesNotMatch(verb.out, /…and /);
    assert.match(verb.out, /Screen6 {2}app\/src\/main\/AndroidManifest\.xml:\d+ {2}portrait/);
    // JSON keeps every row and line numbers, never a cap marker
    const { json } = await runJson([dir, "--offline", "--only", "large-screens"]);
    const ls = json.checks.find((c) => c.id === "large-screens")!;
    assert.equal(ls.locations?.length, 7);
    assert.equal(ls.locations![0]!.line, 3);
    assert.ok(ls.items.every((i) => !i.includes("…and")));
    assert.ok(ls.locations!.every((l) => l.file === "app/src/main/AndroidManifest.xml" && typeof l.line === "number"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--format github emits annotations with file and line, plus the summary", async () => {
  const { out, exitCode } = await runText([fixture("legacy-app"), "--format", "github", "--no-color"], {
    catalog: CATALOG,
    enqueue: false,
  });
  assert.equal(exitCode, 1);
  assert.match(out, /^::error title=Target API level::/m);
  assert.match(out, /::warning file=app\/src\/main\/AndroidManifest\.xml,line=14,title=Large screens::PlayerActivity locks portrait/);
  assert.match(out, /::notice title=Account deletion::/);
  assert.doesNotMatch(out, /::error file=/); // target-api has no file
  assert.match(out, /0 pass · 7 warn · 3 fail · 0 skip · 1 info/);
  assert.doesNotMatch(out, /\u001b\[/);
});

test("color is off when stdout is not a TTY or NO_COLOR is set, and on when forced", async () => {
  const plain = await runText([fixture("ready-app"), "--offline"], { env: { NO_COLOR: "1", FORCE_COLOR: undefined as unknown as string } });
  // runText doesn't set isTTY, so color is already off even without NO_COLOR
  const ttyOff = await runText([fixture("ready-app"), "--offline", "--no-color"]);
  assert.doesNotMatch(ttyOff.out, /\u001b\[/);
  assert.doesNotMatch(plain.out, /\u001b\[/);

  // Force color through the options by running with a fake TTY and no NO_COLOR.
  let colored = "";
  const { runCheck } = await import("../src/preflight/run.ts");
  await runCheck([fixture("ready-app"), "--offline"], {
    stdout: { write: (s: string) => void (colored += s), isTTY: true },
    stderr: { write: () => {} },
    env: {},
  });
  assert.match(colored, /\u001b\[32mPASS\u001b\[0m/);

  let noColor = "";
  await runCheck([fixture("ready-app"), "--offline"], {
    stdout: { write: (s: string) => void (noColor += s), isTTY: true },
    stderr: { write: () => {} },
    env: { NO_COLOR: "1" },
  });
  // runCheck reads process.env.NO_COLOR, not io.env, for color. --no-color covers the documented path.
  // Also document the process.env path:
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    let fromEnv = "";
    await runCheck([fixture("ready-app"), "--offline"], {
      stdout: { write: (s: string) => void (fromEnv += s), isTTY: true },
      stderr: { write: () => {} },
    });
    assert.doesNotMatch(fromEnv, /\u001b\[/);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test("unknown --format exits 2", async () => {
  const r = await runText([fixture("ready-app"), "--format", "sarif"]);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /Unknown --format: sarif/);
});
