import assert from "node:assert/strict";
import { test } from "node:test";
import { parseXml } from "../src/preflight/xml.ts";
import { mergeManifests, readManifest } from "../src/preflight/manifest.ts";
import { evaluateTargetExpr, parseProperties, resolveTargetSdk, targetSdkExpressions } from "../src/preflight/targetsdk.ts";

test("XML: comments, CDATA, entities, quotes with > inside, and self-closing tags", () => {
  const doc = parseXml(`\uFEFF<?xml version="1.0"?>
<!-- <manifest android:fake="1"/> -->
<!DOCTYPE x [ <!ENTITY a "b"> ]>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label='A &amp; B' android:note="x > y">
    <activity android:name=".A"/>
    <meta-data android:name="k" android:value="&#x41;&lt;"/>
  </application>
</manifest>`);
  const m = doc.children[0];
  assert.equal(m.name, "manifest");
  const app = m.children[0];
  assert.equal(app.attrs["android:label"], "A & B");
  assert.equal(app.attrs["android:note"], "x > y");
  assert.equal(app.children.length, 2);
  assert.equal(app.children[1].attrs["android:value"], "A<");
});

test("manifest merge: app values win, lists union, tools:node=remove drops library permissions", () => {
  const app = readManifest(
    parseXml(`<manifest xmlns:android="a" xmlns:tools="t"><uses-permission android:name="android.permission.CAMERA" tools:node="remove"/><application android:label="app"/></manifest>`),
    "app",
  );
  const lib = readManifest(
    parseXml(`<manifest xmlns:android="a"><uses-permission android:name="android.permission.CAMERA"/><uses-permission android:name="android.permission.INTERNET"/><application android:label="lib"><service android:name="L"/></application></manifest>`),
    "lib",
  );
  const m = mergeManifests([app, lib]);
  assert.deepEqual(m.permissions.map((p) => p.name), ["android.permission.INTERNET"]);
  assert.equal(m.application["android:label"], "app");
  assert.equal(m.services.length, 1);
});

test("targetSdk expressions: literals, catalogs, ext, extra, properties and constants", () => {
  const ctx = {
    catalogVersions: { "android-targetSdk": "36", compileSdk: "36" },
    gradleProperties: parseProperties("# c\nTARGET_SDK=34\nother = x\n"),
    sharedFiles: [
      { name: "build.gradle", text: "ext {\n  targetSdkVersion = 35\n}\n" },
      { name: "build.gradle.kts", text: 'extra["appTarget"] = 33\nval kotlinTarget by extra(32)\n' },
      { name: "buildSrc/src/main/kotlin/Config.kt", text: "object Config {\n  const val TARGET = 31\n}\n" },
    ],
  };
  const cases: [string, number | undefined][] = [
    ["36", 36],
    ["36)", 36],
    ["libs.versions.android.targetSdk.get().toInt()", 36],
    ["Integer.parseInt(libs.versions.android.targetSdk.get())", 36],
    ["rootProject.ext.targetSdkVersion", 35],
    ["rootProject.extra[\"appTarget\"] as Int", 33],
    ["project.property(\"TARGET_SDK\").toString().toInt()", 34],
    ["(findProperty(\"TARGET_SDK\") as String).toInt()", 34],
    ["kotlinTarget", 32],
    ["Config.TARGET", 31],
    ["libs.versions.missing.get().toInt()", undefined],
    ["computeIt()", undefined],
  ];
  for (const [expr, want] of cases) assert.equal(evaluateTargetExpr(expr, ctx)?.value, want, expr);
});

test("targetSdk lines: Groovy, Kotlin, one-liners; comments and targetSdkPreview are ignored", () => {
  assert.deepEqual(targetSdkExpressions("defaultConfig {\n  // targetSdk = 30\n  targetSdkVersion 34\n}"), ["34"]);
  assert.deepEqual(targetSdkExpressions("android { defaultConfig { targetSdk = 36 } }"), ["36"]);
  assert.deepEqual(targetSdkExpressions('targetSdkPreview = "Baklava"\ntargetSdkVersion(35)'), ["35)"]);
  const r = resolveTargetSdk({ name: "app/build.gradle", text: "targetSdkVersion(35)" }, { catalogVersions: {}, gradleProperties: {}, sharedFiles: [] }, []);
  assert.equal(r.value, 35);
  const conflict = resolveTargetSdk(undefined, { catalogVersions: {}, gradleProperties: {}, sharedFiles: [] }, [
    { name: "a.kt", text: "targetSdk = 35" },
    { name: "b.kt", text: "targetSdk = 36" },
  ]);
  assert.equal(conflict.value, undefined, "two different convention values: don't guess");
});
