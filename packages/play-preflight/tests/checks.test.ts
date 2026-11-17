import assert from "node:assert/strict";
import { test } from "node:test";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { fixture, one, runJson, runText, byId } from "./helpers/run.ts";

test("target-api: phone app below 36 fails, and below 35 says it's hidden from new users", async () => {
  const c = await one("target-phone-34", "target-api");
  assert.equal(c.status, "fail");
  assert.match(c.detail, /targets 34, Play needs 36/);
  assert.match(c.detail, /Aug 31, 2026/);
  assert.ok(c.items.some((i) => /Below API 35/.test(i)));
  assert.equal(c.deadline, "2026-08-31");
  assert.equal(c.source, "https://support.google.com/googleplay/android-developer/answer/11926878");
  assert.match(c.link, /^https:\/\/devbooth\.dev\//);
});

test("target-api: TV apps (leanback required) need 34; optional leanback is still a phone app", async () => {
  const tv = await runJson([fixture("checks/target-tv-34"), "--offline", "--only", "target-api"]);
  assert.equal(tv.json.input.formFactor, "tv");
  assert.equal(byId(tv.json)["target-api"].status, "pass");
  const optional = await one("target-tv-optional", "target-api");
  assert.equal(optional.status, "fail");
});

test("target-api: resolves from gradle.properties, convention plugins and Groovy, and never guesses", async () => {
  const props = await runJson([fixture("checks/target-gradle-properties"), "--offline", "--only", "target-api"]);
  assert.equal(props.json.input.targetSdk, 36);
  assert.match(props.json.input.targetFrom ?? "", /gradle\.properties/);
  const conv = await runJson([fixture("checks/target-convention"), "--offline", "--only", "target-api"]);
  assert.equal(conv.json.input.targetSdk, 36, "commented-out 30 must be ignored");
  assert.match(conv.json.input.targetFrom ?? "", /build-logic/);
  const groovy = await one("target-groovy", "target-api");
  assert.match(groovy.detail, /targets 33/);
  const unresolved = await one("target-unresolved", "target-api");
  assert.equal(unresolved.status, "skip");
  assert.match(unresolved.detail, /couldn't resolve targetSdk/);
  assert.match(unresolved.detail, /AppConfig\.computeTarget\(\)/);
  const forced = await one("target-unresolved", "target-api", ["--target-sdk", "35"]);
  assert.equal(forced.status, "fail");
});

test("target-api: no API 37 date is ever printed", async () => {
  for (const name of ["target-phone-34", "target-tv-34", "restricted-api37"]) {
    const c = await one(name, "target-api");
    assert.doesNotMatch(JSON.stringify(c), /2027|2028/);
  }
});

test("play-billing: 7 fails, 8 warns with the Aug 31, 2027 date, 9 passes, unresolved warns, absent skips", async () => {
  const v7 = await one("billing-7", "play-billing");
  assert.equal(v7.status, "fail");
  assert.match(v7.detail, /Aug 31, 2026/);
  const v8 = await one("billing-8", "play-billing");
  assert.equal(v8.status, "warn");
  assert.equal(v8.deadline, "2027-08-31");
  assert.match(v8.detail, /Nov 1, 2027/);
  const v9 = await one("billing-9", "play-billing");
  assert.equal(v9.status, "pass");
  assert.match(v9.detail, /Aug 31, 2028/);
  assert.equal((await one("billing-unresolved", "play-billing")).status, "warn");
  assert.equal((await one("target-phone-34", "play-billing")).status, "skip");
});

test("foreground-services: missing type, missing type permission and specialUse property fail", async () => {
  const noType = await one("fgs-no-type", "foreground-services");
  assert.equal(noType.status, "fail");
  assert.match(noType.detail, /no <service> has android:foregroundServiceType/);
  const perm = await one("fgs-missing-type-permission", "foreground-services");
  assert.equal(perm.status, "fail");
  const all = [perm.detail, ...perm.items].join("\n");
  assert.match(all, /FOREGROUND_SERVICE_LOCATION/);
  assert.match(all, /FOREGROUND_SERVICE_CAMERA/);
  assert.match(all, /1 other service has no type/);
  const special = await one("fgs-special-use", "foreground-services");
  assert.equal(special.status, "fail");
  assert.match(special.detail, /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
});

test("foreground-services: dataSync warns about the timeout, a complete setup passes, none declared skips", async () => {
  const ds = await one("fgs-data-sync", "foreground-services");
  assert.equal(ds.status, "warn");
  assert.match(ds.detail, /6 h per 24 h/);
  const ok = await one("fgs-ok", "foreground-services");
  assert.equal(ok.status, "pass");
  assert.ok(ok.items.some((i) => /Play Console/.test(i) && /specialUse/.test(i)));
  const none = await one("target-phone-34", "foreground-services");
  assert.equal(none.status, "skip");
  assert.equal(none.detail, "none declared");
});

test("edge-to-edge: opt-out fails at 36, warns at 35; false or missing passes", async () => {
  assert.equal((await one("e2e-optout-36", "edge-to-edge")).status, "fail");
  const w = await one("e2e-optout-35", "edge-to-edge");
  assert.equal(w.status, "warn");
  assert.deepEqual(w.items, ["app/src/main/res/values-v35/themes.xml"]);
  assert.equal((await one("e2e-optout-false", "edge-to-edge")).status, "pass");
  assert.equal((await one("target-phone-34", "edge-to-edge")).status, "pass");
});

test("large-screens: locked activities warn, free ones don't, games skip, opt-out is temporary", async () => {
  const locked = await one("large-locked", "large-screens");
  assert.equal(locked.status, "warn");
  assert.match(locked.detail, /^2 activities/);
  assert.ok(locked.items.some((i) => i === "CameraActivity  app/src/main/AndroidManifest.xml:11  sensorPortrait, resizeableActivity=false"), locked.items.join("\n"));
  assert.ok(locked.items.some((i) => i === "Wide  app/src/main/AndroidManifest.xml:12  maxAspectRatio=2.1"), locked.items.join("\n"));
  assert.ok(locked.items.some((i) => i.startsWith("Fix:")));
  assert.ok(!locked.items.some((i) => /Free/.test(i)));
  assert.ok(locked.locations?.some((l) => l.file === "app/src/main/AndroidManifest.xml" && l.line === 11 && /CameraActivity/.test(l.message)));
  assert.ok(locked.locations?.some((l) => l.file === "app/src/main/AndroidManifest.xml" && l.line === 12 && /Wide/.test(l.message)));
  assert.equal((await one("large-game", "large-screens")).status, "skip");
  const opt = await one("large-optout", "large-screens");
  assert.equal(opt.status, "warn");
  assert.ok(opt.items.some((i) => /stops working at API 37/.test(i)));
  assert.equal((await one("target-phone-34", "large-screens")).status, "pass");
});

test("predictive-back: KEYCODE_BACK in Java warns, test sources are ignored, opt-out is info", async () => {
  const k = await one("back-keycode-java", "predictive-back");
  assert.equal(k.status, "warn");
  assert.ok(k.items.some((i) => i.includes("OldActivity.java") && i.includes("KEYCODE_BACK")));
  assert.ok(!k.items.some((i) => i.includes("IgnoredTest")));
  assert.equal((await one("back-optout", "predictive-back")).status, "info");
  assert.equal((await one("target-phone-34", "predictive-back")).status, "pass");
});

test("photo-video: media permissions warn; tools:node=remove and maxSdkVersion=32 pass", async () => {
  const media = await one("photo-media", "photo-video");
  assert.equal(media.status, "warn");
  assert.match(media.detail, /READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_EXTERNAL_STORAGE/);
  assert.equal((await one("photo-removed", "photo-video")).status, "pass");
  const all = await one("photo-manage-storage", "photo-video");
  assert.equal(all.status, "warn");
  assert.ok(all.items.some((i) => /All files access/.test(i)));
});

test("exact-alarms: USE_EXACT_ALARM warns, SCHEDULE_EXACT_ALARM depends on canScheduleExactAlarms()", async () => {
  assert.equal((await one("alarm-use-exact", "exact-alarms")).status, "warn");
  assert.equal((await one("alarm-schedule-unchecked", "exact-alarms")).status, "warn");
  assert.equal((await one("alarm-schedule-checked", "exact-alarms")).status, "pass");
});

test("restricted-permissions: always warn, and API 37 rules only apply when targeting 37", async () => {
  const sms = await one("restricted-sms-fsi", "restricted-permissions");
  assert.equal(sms.status, "warn");
  const text = sms.items.join("\n");
  for (const p of ["READ_SMS", "READ_CALL_LOG", "USE_FULL_SCREEN_INTENT", "REQUEST_INSTALL_PACKAGES"]) assert.match(text, new RegExp(p));
  const api37 = await one("restricted-api37", "restricted-permissions");
  assert.equal(api37.status, "warn");
  assert.equal(api37.deadline, "2027-01-27");
  assert.match(api37.items.join("\n"), /Aug 25, 2027/);
  assert.equal((await one("restricted-api36-location", "restricted-permissions")).status, "pass");
});

test("account-deletion: sign-in SDKs give an info reminder, never a fail", async () => {
  const c = await one("auth-supabase", "account-deletion");
  assert.equal(c.status, "info");
  assert.match(c.detail, /Supabase Auth/);
  assert.equal((await one("billing-9", "account-deletion")).status, "skip");
});

test("16kb: pageSizeCompat warns that it hides the problem", async () => {
  const c = await one("16kb-page-size-compat", "16kb");
  assert.equal(c.status, "warn");
  assert.match(c.items.join("\n"), /doesn't make the libraries 16 KB ready/);
});

test("a fresh merged manifest wins: library-added permissions and the built targetSdk show up", async () => {
  const merged = fixture("checks/merged-manifest/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml");
  const now = new Date();
  utimesSync(merged, now, now);
  const { json } = await runJson([fixture("checks/merged-manifest"), "--offline", "--only", "target-api,photo-video"]);
  assert.equal(json.input.manifestKind, "merged");
  assert.equal(json.input.targetSdk, 36);
  assert.equal(byId(json)["photo-video"].status, "warn");
  // An old merged manifest is ignored.
  const old = new Date("2001-01-01T00:00:00Z");
  utimesSync(merged, old, old);
  const stale = await runJson([fixture("checks/merged-manifest"), "--offline", "--only", "target-api,photo-video"]);
  assert.equal(stale.json.input.manifestKind, "source");
  assert.equal(stale.json.input.targetSdk, 35);
  assert.equal(byId(stale.json)["photo-video"].status, "pass");
  assert.ok(stale.json.notes.some((n) => /older than your sources/.test(n)));
  utimesSync(merged, now, now);
  void join;
});

test("predictive-back: an activity-level opt-out only excuses that activity's file", async () => {
  const c = await one("back-activity-optout", "predictive-back");
  assert.equal(c.status, "warn");
  assert.match(c.detail, /^1 file uses the old back APIs/);
  assert.ok(c.items.some((i) => i.includes("MainActivity.kt") && i.includes("onBackPressed")));
  assert.ok(!c.items.some((i) => /SettingsActivity\.kt: overrides/.test(i)), "the opted-out activity isn't counted");
  assert.ok(c.items.some((i) => /1 activity opts out .*com\.example\.app\.SettingsActivity.*only covers that activity/.test(i)));
});

test("foreground-services: an untyped service in the app's own source manifest still fails", async () => {
  const c = await one("fgs-no-type", "foreground-services");
  assert.equal(c.status, "fail");
  assert.match(c.detail, /1 is in your own manifest/);
  assert.match(c.detail, /throws MissingForegroundServiceTypeException/);
  assert.ok(c.items.some((i) => i.startsWith("dev.example.fixture.UploadService") && i.includes("app/src/main/AndroidManifest.xml")));
});

test("foreground-services: FOREGROUND_SERVICE with no services at all is a warn, not a fail", async () => {
  const c = await one("fgs-library-service", "foreground-services");
  assert.equal(c.status, "warn");
  assert.match(c.detail, /can crash at runtime/);
});

test("header: minSdk and compileSdk come from buildSrc constants and the version catalog", async () => {
  const bs = await runJson([fixture("checks/sdk-buildsrc"), "--offline", "--only", "target-api"]);
  assert.equal(bs.json.input.targetSdk, 36);
  assert.equal(bs.json.input.minSdk, 26);
  assert.equal(bs.json.input.compileSdk, 36);
  assert.match(bs.json.input.minSdkFrom ?? "", /buildSrc/);
  const cat = await runJson([fixture("checks/sdk-catalog"), "--offline", "--only", "target-api"]);
  assert.equal(cat.json.input.minSdk, 23);
  assert.equal(cat.json.input.compileSdk, 36);
  assert.equal(cat.json.input.targetSdk, 35);
  assert.match(cat.json.input.compileSdkFrom ?? "", /version catalog/);
  const text = await runText([fixture("checks/sdk-catalog"), "--offline", "--only", "target-api"]);
  assert.match(text.out.split("\n")[0], /source only  ·  targetSdk 35  minSdk 23  compileSdk 36/);
  const verbose = await runText([fixture("checks/sdk-catalog"), "--offline", "--only", "target-api", "--verbose"]);
  assert.match(verbose.out.split("\n")[0], /targetSdk 35, from /);
  assert.match(verbose.out.split("\n")[0], /compileSdk 36, from /);
  const plain = await runJson([fixture("checks/fgs-ok"), "--offline", "--only", "target-api"]);
  assert.equal(plain.json.input.minSdk, 24);
  assert.equal(plain.json.input.compileSdk, 36);
});
