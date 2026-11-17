import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readElf } from "../src/preflight/elf.ts";
import { openZip } from "../src/preflight/zip.ts";
import { parseBinaryXml } from "../src/preflight/axml.ts";
import { readManifest } from "../src/preflight/manifest.ts";
import { scanBinary } from "../src/preflight/binary.ts";
import { makeAxml, makeElf, makeZip, manifestTree } from "./helpers/android-binaries.ts";
import { byId, fixture, runJson } from "./helpers/run.ts";

const dir = mkdtempSync(join(tmpdir(), "play-preflight-bin-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, buf: Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
}

const goodManifest = makeAxml(
  manifestTree({
    targetSdk: 36,
    permissions: ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MEDIA_PLAYBACK", "READ_MEDIA_IMAGES"],
    application: [{ name: "enableOnBackInvokedCallback", value: true }],
    activities: [
      { name: "activity", attrs: [{ name: "name", value: "dev.example.binary.Main" }, { name: "screenOrientation", value: 4 }] },
      { name: "activity", attrs: [{ name: "name", value: "dev.example.binary.Camera" }, { name: "screenOrientation", value: 1 }] },
    ],
    services: [
      {
        name: "service",
        attrs: [
          { name: "name", value: "dev.example.binary.Player" },
          { name: "foregroundServiceType", value: 2, type: "hex" },
        ],
      },
    ],
    metaData: { "com.google.android.play.billingclient.version": "8.0.0" },
  }),
);

test("ELF: reads 64-bit and 32-bit PT_LOAD alignment and ignores non-LOAD segments", () => {
  assert.equal(readElf(makeElf({ align: 0x4000 })).minLoadAlign, 0x4000);
  assert.equal(readElf(makeElf({ align: 0x1000 })).minLoadAlign, 0x1000);
  const e32 = readElf(makeElf({ bits: 32, align: 0x10000 }));
  assert.equal(e32.bits, 32);
  assert.equal(e32.minLoadAlign, 0x10000);
  assert.equal(e32.loadSegments, 2);
  assert.throws(() => readElf(Buffer.from("not an elf at all, just text padding here.........")), /not an ELF/);
});

test("ZIP: reads stored and deflated entries and reports data offsets", () => {
  const zip = openZip(
    makeZip([
      { name: "a.txt", data: Buffer.from("hello hello hello") },
      { name: "lib/arm64-v8a/x.so", data: makeElf({ align: 0x4000 }), store: true, align: 16384 },
    ]),
  );
  assert.deepEqual(zip.entries.map((e) => e.name), ["a.txt", "lib/arm64-v8a/x.so"]);
  assert.equal(zip.read(zip.entries[0]).toString(), "hello hello hello");
  assert.equal(zip.entries[1].dataOffset % 16384, 0);
  assert.equal(readElf(zip.read(zip.entries[1])).minLoadAlign, 0x4000);
});

test("binary XML: decodes attributes, enum and flag values back to source names", () => {
  const m = readManifest(parseBinaryXml(goodManifest), "test");
  assert.equal(m.targetSdk, 36);
  assert.equal(m.minSdk, 24);
  assert.ok(m.permissions.some((p) => p.name === "android.permission.READ_MEDIA_IMAGES"));
  assert.equal(m.activities[0].attrs["android:screenOrientation"], "sensor");
  assert.equal(m.activities[1].attrs["android:screenOrientation"], "portrait");
  assert.equal(m.services[0].attrs["android:foregroundServiceType"], "mediaPlayback");
  assert.equal(m.application["android:enableOnBackInvokedCallback"], "true");
  assert.equal(m.appMetaData["com.google.android.play.billingclient.version"], "8.0.0");
  const flags = readManifest(
    parseBinaryXml(
      makeAxml(
        manifestTree({
          targetSdk: 35,
          services: [{ name: "service", attrs: [{ name: "name", value: "S" }, { name: "foregroundServiceType", value: (1 << 30) | 1 | 8, type: "hex" }] }],
        }),
      ),
    ),
    "t",
  );
  assert.equal(flags.services[0].attrs["android:foregroundServiceType"], "dataSync|location|specialUse");
});

test("APK: manifest checks and 16 KB ELF + zip alignment run straight from the file", async () => {
  const apk = write(
    "good.apk",
    makeZip([
      { name: "AndroidManifest.xml", data: goodManifest },
      { name: "lib/arm64-v8a/libgood.so", data: makeElf({ align: 0x4000 }), store: true, align: 16384 },
      { name: "lib/x86_64/libgood.so", data: makeElf({ align: 0x4000 }) },
      { name: "lib/armeabi-v7a/libold.so", data: makeElf({ bits: 32, align: 0x1000 }), store: true },
    ]),
  );
  const scan = scanBinary(apk, "apk");
  assert.equal(scan.nativeLibs.length, 2, "32-bit ABIs are out of scope");
  const { json, exitCode } = await runJson(["--apk", apk, "--offline"]);
  assert.equal(json.input.manifestKind, "apk");
  assert.equal(json.input.targetSdk, 36);
  const c = byId(json);
  assert.equal(c["16kb"].status, "pass");
  assert.match(c["16kb"].detail, /all 2 64-bit native libraries are 16 KB aligned/);
  assert.equal(c["target-api"].status, "pass");
  assert.equal(c["play-billing"].status, "warn");
  assert.equal(c["foreground-services"].status, "pass");
  assert.equal(c["large-screens"].status, "warn");
  assert.ok(c["large-screens"].items.some((i) => i.includes("Camera") && i.includes("portrait")));
  assert.equal(c["photo-video"].status, "warn");
  assert.equal(c["edge-to-edge"].status, "skip");
  assert.equal(c["predictive-back"].status, "skip");
  assert.equal(c["account-deletion"].status, "skip");
  assert.equal(exitCode, 0);
});

test("APK: misaligned ELF and an unaligned stored .so both fail", async () => {
  const apk = write(
    "bad.apk",
    makeZip([
      { name: "AndroidManifest.xml", data: makeAxml(manifestTree({ targetSdk: 36 })) },
      { name: "lib/arm64-v8a/libold.so", data: makeElf({ align: 0x1000 }) },
      { name: "lib/x86_64/libgood.so", data: makeElf({ align: 0x4000 }), store: true, align: 4 },
    ]),
  );
  const { json, exitCode } = await runJson(["--apk", apk, "--offline", "--only", "16kb"]);
  assert.equal(exitCode, 1);
  const c = byId(json)["16kb"];
  assert.equal(c.status, "fail");
  assert.match(c.detail, /1 native library isn't 16 KB aligned; 1 uncompressed \.so isn't zip-aligned/);
  assert.match(c.detail, /Feb 1, 2027/);
  assert.ok(c.items.some((i) => i.startsWith("lib/arm64-v8a/libold.so: LOAD alignment 0x1000")));
});

test("AAB: native libraries in every module are checked; the manifest comes from the project", async () => {
  const aab = write(
    "app.aab",
    makeZip([
      { name: "base/manifest/AndroidManifest.xml", data: Buffer.from([0x0a, 0x00]) },
      { name: "base/lib/arm64-v8a/libgood.so", data: makeElf({ align: 0x4000 }) },
      { name: "feature/lib/x86_64/libold.so", data: makeElf({ align: 0x1000 }) },
    ]),
  );
  const { json, exitCode } = await runJson([fixture("checks/billing-9"), "--aab", aab, "--offline", "--only", "16kb,target-api,play-billing"]);
  assert.equal(exitCode, 1);
  const c = byId(json);
  assert.equal(c["16kb"].status, "fail");
  assert.ok(c["16kb"].items.some((i) => i.startsWith("feature/lib/x86_64/libold.so")));
  assert.equal(c["target-api"].status, "pass", "targetSdk falls back to the project");
  assert.equal(c["play-billing"].status, "pass");
  assert.ok(json.notes.some((n) => /AAB manifest/.test(n)));
});

test("broken or missing binaries exit 2", async () => {
  const notZip = write("broken.apk", Buffer.from("definitely not a zip"));
  assert.equal((await runJson(["--apk", notZip]).catch(() => ({ exitCode: 2 }))).exitCode, 2);
  const { runText } = await import("./helpers/run.ts");
  const missing = await runText(["--apk", join(dir, "nope.apk")]);
  assert.equal(missing.exitCode, 2);
  assert.match(missing.err, /File not found/);
  const both = await runText(["--apk", notZip, "--aab", notZip]);
  assert.equal(both.exitCode, 2);
});

const act = (name: string, extra: { name: string; value: boolean }[] = []) => ({ name: "activity", attrs: [{ name: "name", value: name }, ...extra] });
const svc = (name: string) => ({ name: "service", attrs: [{ name: "name", value: name }] });
const apkWith = (name: string, tree: Parameters<typeof manifestTree>[0]) => write(name, makeZip([{ name: "AndroidManifest.xml", data: makeAxml(manifestTree(tree)) }]));

test("APK predictive-back: a library activity's opt-out doesn't hide the app's own old back API uses", async () => {
  const apk = apkWith("back-lib.apk", {
    targetSdk: 36,
    activities: [
      act("com.example.app.MainActivity"),
      act("com.example.app.SettingsActivity"),
      act("com.example.internallib.ui.LibraryActivity", [{ name: "enableOnBackInvokedCallback", value: false }]),
    ],
  });
  const { json } = await runJson([fixture("checks/back-library-optout"), "--apk", apk, "--offline", "--only", "predictive-back"]);
  const c = byId(json)["predictive-back"];
  assert.equal(c.status, "warn");
  assert.match(c.detail, /^2 files use the old back APIs/);
  assert.ok(c.items.some((i) => i.includes("MainActivity.kt")));
  assert.ok(c.items.some((i) => i.includes("SettingsActivity.kt")));
  assert.ok(c.items.some((i) => i.includes("com.example.internallib.ui.LibraryActivity") && /only covers that activity/.test(i)));
});

test("APK predictive-back: an <application> opt-out still covers the whole app", async () => {
  const apk = apkWith("back-app.apk", {
    targetSdk: 36,
    application: [{ name: "enableOnBackInvokedCallback", value: false }],
    activities: [act("com.example.app.MainActivity"), act("com.example.app.SettingsActivity")],
  });
  const { json } = await runJson([fixture("checks/back-library-optout"), "--apk", apk, "--offline", "--only", "predictive-back"]);
  const c = byId(json)["predictive-back"];
  assert.equal(c.status, "info");
  assert.match(c.detail, /on <application>/);
});

test("APK predictive-back: opting one activity back in keeps its file counted under an app-wide opt-out", async () => {
  const apk = apkWith("back-optin.apk", {
    targetSdk: 36,
    application: [{ name: "enableOnBackInvokedCallback", value: false }],
    activities: [act("com.example.app.MainActivity", [{ name: "enableOnBackInvokedCallback", value: true }]), act("com.example.app.SettingsActivity")],
  });
  const { json } = await runJson([fixture("checks/back-library-optout"), "--apk", apk, "--offline", "--only", "predictive-back"]);
  const c = byId(json)["predictive-back"];
  assert.equal(c.status, "warn");
  assert.ok(c.items.some((i) => i.includes("MainActivity.kt")));
  assert.ok(!c.items.some((i) => /SettingsActivity\.kt: overrides/.test(i)));
});

test("APK foreground-services: an untyped service from a dependency warns as a risk, with or without the project", async () => {
  const apk = apkWith("fgs-lib.apk", { targetSdk: 36, permissions: ["FOREGROUND_SERVICE"], services: [svc("com.example.internallib.sync.SyncService")] });
  const withProject = await runJson([fixture("checks/fgs-library-service"), "--apk", apk, "--offline", "--only", "foreground-services"]);
  const c = byId(withProject.json)["foreground-services"];
  assert.equal(withProject.exitCode, 0);
  assert.equal(c.status, "warn");
  assert.match(c.detail, /comes from dependencies/);
  assert.match(c.detail, /can crash at runtime .*if startForeground\(\) is called on it/);
  assert.doesNotMatch(c.detail, /throws/);
  assert.ok(c.items.some((i) => i.startsWith("com.example.internallib.sync.SyncService")));
  const apkOnly = await runJson(["--apk", apk, "--offline", "--only", "foreground-services"]);
  const a = byId(apkOnly.json)["foreground-services"];
  assert.equal(a.status, "warn", "APK only: can't tell whose it is");
  assert.match(a.detail, /unclear whether it's yours/);
});

test("APK foreground-services: an untyped service declared in the app's own manifest fails", async () => {
  const apk = apkWith("fgs-own.apk", {
    targetSdk: 36,
    permissions: ["FOREGROUND_SERVICE"],
    services: [svc("dev.example.fixture.UploadService"), svc("com.example.internallib.sync.SyncService")],
  });
  const { json, exitCode } = await runJson([fixture("checks/fgs-no-type"), "--apk", apk, "--offline", "--only", "foreground-services"]);
  const c = byId(json)["foreground-services"];
  assert.equal(exitCode, 1);
  assert.equal(c.status, "fail");
  assert.match(c.detail, /1 is in your own manifest/);
  assert.ok(c.items.some((i) => i.startsWith("dev.example.fixture.UploadService") && i.includes("app/src/main/AndroidManifest.xml")));
  assert.ok(!c.items.some((i) => i.startsWith("com.example.internallib")), "only the app's own service is listed as the cause");
});

test("APK header: minSdk comes from the APK manifest; compileSdk from the project", async () => {
  const apk = apkWith("sdk.apk", { targetSdk: 36 });
  const apkOnly = await runJson(["--apk", apk, "--offline", "--only", "target-api"]);
  assert.equal(apkOnly.json.input.minSdk, 24);
  assert.equal(apkOnly.json.input.compileSdk, undefined, "not stamped in this APK, so not reported");
  const both = await runJson([fixture("checks/sdk-buildsrc"), "--apk", apk, "--offline", "--only", "target-api"]);
  assert.equal(both.json.input.minSdk, 24, "the APK wins for minSdk, like targetSdk");
  assert.equal(both.json.input.compileSdk, 36);
});
