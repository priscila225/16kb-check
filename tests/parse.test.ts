import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverProject } from "../src/discover.ts";
import { parseProjectFiles } from "../src/check/parse.ts";
import { splitPublicDeps } from "../src/privacy.ts";
import { parsePlugins, resolveCatalogPlugin } from "../src/check/plugins.ts";
import { parseVersionCatalog, resolveCatalogBundle } from "../src/check/toml.ts";
import { parseGradle, isTestConfiguration } from "../src/check/gradle.ts";
import { checkAgp } from "../src/check/agp.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/android-app");

test("discover finds settings, module Gradle files, and the version catalog", () => {
  const d = discoverProject(fixture);
  const names = d.files.map((f) => f.name).sort();
  assert.ok(names.includes("settings.gradle.kts"));
  assert.ok(names.includes("app/build.gradle.kts"));
  assert.ok(names.includes("core/build.gradle"));
  assert.ok(names.includes("gradle/libs.versions.toml"));
});

test("fixture project parses public deps, catalog aliases, BOM, and skips project() and files()", () => {
  const d = discoverProject(fixture);
  const parsed = parseProjectFiles(d.files);
  const keys = parsed.dependencies.map((d) => `${d.group}:${d.artifact}`);

  assert.ok(keys.includes("io.sentry:sentry-android"));
  assert.ok(keys.includes("androidx.core:core-ktx"));
  assert.ok(keys.includes("com.squareup.okhttp3:okhttp"));
  assert.ok(keys.includes("com.mapbox.maps:android"));
  assert.ok(keys.includes("com.google.firebase:firebase-analytics"));
  assert.ok(keys.includes("com.squareup.okio:okio"));
  assert.ok(keys.includes("androidx.annotation:annotation"));

  const sentry = parsed.dependencies.find((d) => d.artifact === "sentry-android")!;
  assert.equal(sentry.version, "7.14.0");
  assert.equal(sentry.versionSource, "catalog");

  const analytics = parsed.dependencies.find((d) => d.artifact === "firebase-analytics")!;
  assert.equal(analytics.versionSource, "bom");
  assert.match(analytics.bom || "", /firebase-bom:33.7.0/);

  assert.ok(!keys.includes("junit:junit"), "test dependencies are skipped");
  assert.ok(!keys.some((k) => k.includes("androidx.test")));
  assert.ok(!keys.some((k) => k.startsWith("project:") || k.includes(":core") && k.startsWith(":")));
  // Local files() artifacts should not appear as coordinates
  assert.ok(!keys.some((k) => k.includes("local-sdk")));

  const { publicDeps } = splitPublicDeps(parsed.dependencies);
  const pub = publicDeps.map((d) => `${d.group}:${d.artifact}`);
  assert.ok(pub.includes("io.sentry:sentry-android"));
  assert.ok(!pub.includes("com.github.acme-internal:secret-kit"));
});

test("plugins are parsed from settings, catalog aliases, and id() calls, apart from dependencies", () => {
  const d = discoverProject(fixture);
  const parsed = parseProjectFiles(d.files);
  assert.ok(!parsed.dependencies.some((d) => d.configuration === "plugin"));
  const ids = parsed.plugins.map((p) => p.group);
  assert.ok(ids.includes("com.android.application"));
  assert.ok(ids.includes("com.android.library"));
  assert.ok(ids.includes("org.jetbrains.kotlin.android"));
  const agp = parsed.plugins.find((p) => p.group === "com.android.application")!;
  assert.equal(agp.version, "8.7.3");
});

test("bundles resolve when [bundles] is the last table and a bundle shares a library alias", () => {
  const cat = parseVersionCatalog(`
[versions]
ads = "3.2.1"
consent = "2.0.10"

[libraries]
amazonPubServices = { module = "com.example:ads-sdk", version.ref = "ads" }
iabtcf = { group = "com.example", name = "consent-decoder", version.ref = "consent" }

[bundles]
amazonPubServices = ["amazonPubServices", "iabtcf"]`);
  assert.deepEqual(cat.bundles.amazonPubServices, ["amazonPubServices", "iabtcf"]);
  const gradle = `dependencies {
    implementation(libs.bundles.amazonPubServices)
}`;
  const parsed = parseGradle(gradle, "app/build.gradle.kts", cat);
  assert.deepEqual(parsed.issues, []);
  const keys = parsed.dependencies.map((d) => `${d.group}:${d.artifact}:${d.version}`);
  assert.deepEqual(keys.sort(), ["com.example:ads-sdk:3.2.1", "com.example:consent-decoder:2.0.10"]);
});

test("bundle accessors match camelCase, dot, dash, underscore and bracket forms", () => {
  const cat = parseVersionCatalog(`
[libraries]
moshi = { module = "com.squareup.moshi:moshi", version = "1.15.1" }
retrofit = { module = "com.squareup.retrofit2:retrofit", version = "2.11.0" }

[bundles]
net-stack = [
  "moshi",   # trailing comment
  "retrofit",
]
ui_kit = ["moshi"]
adsSdk = ["retrofit"]
`);
  assert.deepEqual(cat.bundles["net-stack"], ["moshi", "retrofit"]);
  assert.equal(resolveCatalogBundle(cat, "bundles.net.stack")?.libraries.length, 2);
  assert.equal(resolveCatalogBundle(cat, "libs.bundles.ui.kit")?.libraries.length, 1);
  assert.equal(resolveCatalogBundle(cat, "bundles.adsSdk")?.libraries.length, 1);
  assert.equal(resolveCatalogBundle(cat, "bundles.adssdk")?.libraries.length, 1);
  const groovy = `dependencies {
    implementation libs.bundles.net.stack
    api(libs.bundles["ui-kit"])
}`;
  const parsed = parseGradle(groovy, "build.gradle", cat);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.dependencies.length, 3);
});

test("test-only configurations and test frameworks are kept out of release dependencies", () => {
  const gradle = `dependencies {
    implementation("com.squareup.okio:okio:3.9.0")
    testImplementation("org.junit.jupiter:junit-jupiter-api:5.11.3")
    "testImplementation"("io.mockk:mockk:1.13.13")
    androidTestImplementation("androidx.test:runner:1.6.2")
    testFixturesImplementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugTestImplementation("com.squareup.retrofit2:retrofit:2.11.0")
    kspAndroidTest("com.google.dagger:hilt-compiler:2.52")
    implementation("org.junit.jupiter:junit-jupiter-api:5.11.3")
}`;
  const parsed = parseGradle(gradle, "build.gradle.kts");
  assert.deepEqual(parsed.dependencies.map((d) => d.artifact), ["okio"]);
  assert.equal(parsed.testDependencies.length, 7);
  assert.ok(parsed.testDependencies.every((d) => d.testOnly));
  for (const c of ["testImplementation", "androidTestImplementation", "testFixturesImplementation", "debugTestImplementation", "kaptTest", "kspAndroidTest"]) {
    assert.equal(isTestConfiguration(c), true, c);
  }
  for (const c of ["implementation", "api", "debugImplementation", "latestImplementation", "kapt"]) {
    assert.equal(isTestConfiguration(c), false, c);
  }
});

test("AGP version resolves from the plugins block, the catalog, and the buildscript classpath", () => {
  const fromBlock = parseProjectFiles([{ name: "build.gradle.kts", text: `plugins { id("com.android.application") version "8.5.0" apply false }` }]);
  assert.equal(checkAgp(fromBlock.plugins).status, "warning");

  const fromCatalog = parseProjectFiles([
    { name: "gradle/libs.versions.toml", text: `[versions]\nagp = "8.7.3"\n[plugins]\nandroid-library = { id = "com.android.library", version.ref = "agp" }\n` },
    { name: "lib/build.gradle.kts", text: `plugins { alias(libs.plugins.android.library) }` },
  ]);
  const ok = checkAgp(fromCatalog.plugins);
  assert.equal(ok.status, "ok");
  assert.equal(ok.version, "8.7.3");

  const fromClasspath = parseProjectFiles([
    { name: "build.gradle", text: `buildscript {\n ext { agp = '8.5.1' }\n dependencies { classpath "com.android.tools.build:gradle:\${agp}" }\n}` },
  ]);
  const cp = checkAgp(fromClasspath.plugins);
  assert.equal(cp.status, "ok");
  assert.equal(cp.version, "8.5.1");

  const fromBuildSrc = parseProjectFiles([
    { name: "buildSrc/build.gradle.kts", text: `dependencies { implementation("com.android.tools.build:gradle:8.4.2") }` },
  ]);
  assert.equal(fromBuildSrc.dependencies.length, 0);
  assert.equal(checkAgp(fromBuildSrc.plugins).status, "warning");

  const none = parseProjectFiles([{ name: "build.gradle", text: `plugins { id 'com.android.application' }` }]);
  assert.equal(checkAgp(none.plugins).status, "not-checked");
});

test("resolveCatalogPlugin maps dotted accessors to aliases", () => {
  const cat = parseVersionCatalog(`
[versions]
agp = "8.7.3"
[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
`);
  const resolved = resolveCatalogPlugin(cat, "android.application");
  assert.equal(resolved?.id, "com.android.application");
  assert.equal(resolved?.version, "8.7.3");
});

test("parsePlugins skips local script plugins", () => {
  const text = `
plugins {
    id("com.android.application") version "8.7.3"
    id("my-local.gradle.kts")
}
apply plugin: 'org.jetbrains.kotlin.android'
`;
  const { plugins } = parsePlugins(text, "build.gradle.kts");
  const ids = plugins.map((p) => p.group);
  assert.ok(ids.includes("com.android.application"));
  assert.ok(ids.includes("org.jetbrains.kotlin.android"));
  assert.ok(!ids.some((id) => id.includes("my-local")));
});
