import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProjectFiles } from "../src/check/parse.ts";
import { parseGradle } from "../src/check/gradle.ts";
import { checkAgp } from "../src/check/agp.ts";
import { createClient, enqueuePublicUnknown } from "../src/api.ts";
import type { DeclaredDep } from "../src/check/types.ts";

const key = (d: { group: string; artifact: string }) => `${d.group}:${d.artifact}`;

test("AGP resolves when the buildscript has several classpath lines and AGP is not the first", () => {
  const parsed = parseProjectFiles([
    { name: "settings.gradle", text: `include ':app'` },
    {
      name: "gradle/libs.versions.toml",
      text: `[versions]
kotlin = "2.2.0"
agp = "9.3.1"
[libraries]
pluginKotlinGradle = { module = "org.jetbrains.kotlin:kotlin-gradle-plugin", version.ref = "kotlin" }
pluginAndroidGradle = { module = "com.android.tools.build:gradle", version.ref = "agp" }
`,
    },
    {
      name: "build.gradle",
      text: `buildscript {
  dependencies {
    classpath libs.pluginKotlinGradle
    classpath libs.pluginAndroidGradle
  }
}`,
    },
    { name: "app/build.gradle", text: `apply plugin: 'com.android.application'\ndependencies { implementation 'androidx.core:core-ktx:1.15.0' }` },
  ]);
  const agp = checkAgp(parsed.plugins);
  assert.equal(agp.status, "ok");
  assert.equal(agp.version, "9.3.1");
});

test("AGP resolves from a string classpath that follows another classpath line", () => {
  const parsed = parseProjectFiles([
    {
      name: "build.gradle",
      text: `buildscript { dependencies {
  classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.0"
  classpath "com.google.gms:google-services:4.4.2"
  classpath "com.android.tools.build:gradle:8.4.0"
} }`,
    },
  ]);
  const agp = checkAgp(parsed.plugins);
  assert.equal(agp.status, "warning");
  assert.equal(agp.version, "8.4.0");
});

test("implementation deps in a com.android.test module are test-only, also via a catalog plugin alias", () => {
  const parsed = parseProjectFiles([
    { name: "settings.gradle", text: `include ':app', ':ui-checks', ':e2e'` },
    {
      name: "gradle/libs.versions.toml",
      text: `[versions]
agp = "8.7.0"
[libraries]
barista = { module = "com.adevinta.android:barista", version = "4.3.0" }
[plugins]
androidTest = { id = "com.android.test", version.ref = "agp" }
`,
    },
    { name: "app/build.gradle", text: `plugins { id 'com.android.application' }\ndependencies { implementation 'io.sentry:sentry-android:7.0.0' }` },
    { name: "ui-checks/build.gradle", text: `plugins { alias(libs.plugins.androidTest) }\ndependencies { implementation libs.barista }` },
    { name: "e2e/build.gradle.kts", text: `plugins { id("com.android.test") }\ndependencies { implementation("com.squareup.okhttp3:mockwebserver:4.12.0") }` },
  ]);
  const release = parsed.dependencies.map(key);
  assert.ok(release.includes("io.sentry:sentry-android"));
  assert.ok(!release.includes("com.adevinta.android:barista"));
  assert.ok(!release.includes("com.squareup.okhttp3:mockwebserver"));
  const tests = parsed.testDependencies.map(key);
  assert.ok(tests.includes("com.adevinta.android:barista"));
  assert.ok(tests.includes("com.squareup.okhttp3:mockwebserver"));
});

test("kapt, ksp and annotationProcessor dependencies are build-time only", () => {
  const g = parseGradle(
    `dependencies {
  implementation "androidx.room:room-runtime:2.6.1"
  ksp "androidx.room:room-compiler:2.6.1"
  kapt "androidx.lifecycle:lifecycle-compiler:2.8.0"
  annotationProcessor "com.github.bumptech.glide:compiler:4.16.0"
  kaptRelease "com.google.dagger:hilt-compiler:2.52"
  kspTest "com.google.dagger:hilt-android-compiler:2.52"
}`,
    {},
    "app/build.gradle",
  );
  assert.deepEqual(g.dependencies.map(key), ["androidx.room:room-runtime"]);
  assert.deepEqual(g.processorDependencies.map(key).sort(), [
    "androidx.lifecycle:lifecycle-compiler",
    "androidx.room:room-compiler",
    "com.github.bumptech.glide:compiler",
    "com.google.dagger:hilt-compiler",
  ]);
  assert.deepEqual(g.testDependencies.map(key), ["com.google.dagger:hilt-android-compiler"]);

  const parsed = parseProjectFiles([{ name: "app/build.gradle", text: `dependencies {\n  implementation "androidx.room:room-runtime:2.6.1"\n  ksp "androidx.room:room-compiler:2.6.1"\n}` }]);
  assert.deepEqual(parsed.dependencies.map(key), ["androidx.room:room-runtime"]);
  assert.ok(parsed.buildToolingDependencies.map(key).includes("androidx.room:room-compiler"));
});

test("two catalogs with the same version key keep their own versions", () => {
  const parsed = parseProjectFiles([
    {
      name: "gradle/libs.versions.toml",
      text: `[versions]
tracker = "5.7.0"
[libraries]
kochava-events = { module = "com.kochava.tracker:events", version.ref = "tracker" }
`,
    },
    {
      name: "gradle/other.versions.toml",
      text: `[versions]
tracker = "6.0.3"
[libraries]
analytics = { module = "com.segment.analytics.kotlin:android", version.ref = "tracker" }
`,
    },
    { name: "app/build.gradle", text: `dependencies {\n  implementation libs.kochava.events\n  implementation libs.analytics\n}` },
  ]);
  const byKey = new Map(parsed.dependencies.map((d) => [key(d), d.version]));
  assert.equal(byKey.get("com.kochava.tracker:events"), "5.7.0");
  assert.equal(byKey.get("com.segment.analytics.kotlin:android"), "6.0.3");
});

test("check-demand sends each coordinate with its own version", async () => {
  let body = "";
  const fakeFetch = (async (_url: string, init?: { body?: string }) => {
    body = init?.body || "";
    return new Response(JSON.stringify({ ok: true, accepted: 0, jobs: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const dep = (group: string, artifact: string, version: string): DeclaredDep => ({
    group, artifact, version, versionSource: "declared", configuration: "implementation", sourceFile: "app/build.gradle",
  });
  await enqueuePublicUnknown(createClient({ baseUrl: "https://example.invalid", fetch: fakeFetch }), [
    dep("com.kochava.tracker", "events", "5.7.0"),
    dep("com.squareup.okhttp3", "okhttp", "4.12.0"),
    dep("io.sentry", "sentry-android", "7.14.0"),
  ]);
  const sent = JSON.parse(body) as { coordinates: string[]; versions: Record<string, string> };
  assert.equal(sent.versions["com.kochava.tracker:events"], "5.7.0");
  assert.equal(sent.versions["com.squareup.okhttp3:okhttp"], "4.12.0");
  assert.equal(sent.versions["io.sentry:sentry-android"], "7.14.0");
});

import { isCandidatePublicCoordinate, catalogGroupsFrom } from "../src/check/public-coords.ts";

test("groups listed in the 16kb.dev catalog are public; unknown and private groups stay private", () => {
  for (const c of ["org.pytorch:pytorch_android_lite", "org.tensorflow:tensorflow-lite", "com.arthenica:ffmpeg-kit-full"]) {
    assert.ok(isCandidatePublicCoordinate(c), c);
  }
  for (const c of ["com.mycompany.internal:sdk", "com.github.someone:thing", "com.example:app"]) {
    assert.ok(!isCandidatePublicCoordinate(c), c);
  }
  const live = catalogGroupsFrom([{ mavenCoords: ["io.newvendor:native-sdk"] }]);
  assert.ok(!isCandidatePublicCoordinate("io.newvendor:native-sdk"));
  assert.ok(isCandidatePublicCoordinate("io.newvendor:native-sdk", live));
});

test("build-logic, buildSrc and convention plugin modules are tooling, not app libraries", () => {
  const parsed = parseProjectFiles([
    { name: "settings.gradle.kts", text: `pluginManagement { includeBuild("build-logic") }\ninclude(":app", ":lint", ":core:testing")` },
    { name: "build-logic/convention/build.gradle.kts", text: `plugins { \`kotlin-dsl\` }\ndependencies { compileOnly("com.android.tools.build:gradle:8.7.0"); implementation("com.squareup:javapoet:1.13.0") }` },
    { name: "buildSrc/build.gradle.kts", text: `dependencies { implementation("com.squareup.okio:okio:3.9.0") }` },
    { name: "lint/build.gradle.kts", text: `plugins { id("com.android.lint") }\ndependencies { compileOnly("com.android.tools.lint:lint-api:31.7.0") }` },
    { name: "core/testing/build.gradle.kts", text: `dependencies { api("com.google.dagger:hilt-android-testing:2.52") }` },
    { name: "app/build.gradle.kts", text: `dependencies { implementation("io.sentry:sentry-android:7.14.0") }` },
  ]);
  assert.deepEqual(parsed.dependencies.map(key), ["io.sentry:sentry-android"]);
  const tooling = parsed.buildToolingDependencies.map(key);
  for (const k of ["com.squareup:javapoet", "com.squareup.okio:okio", "com.android.tools.lint:lint-api"]) assert.ok(tooling.includes(k), k);
  assert.ok(parsed.testDependencies.map(key).includes("com.google.dagger:hilt-android-testing"));
});
