import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverProject } from "../src/discover.ts";
import { parseProjectFiles } from "../src/check/parse.ts";
import { splitPublicDeps } from "../src/privacy.ts";
import { parsePlugins, resolveCatalogPlugin } from "../src/check/plugins.ts";
import { parseVersionCatalog } from "../src/check/toml.ts";

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

test("plugins are parsed from settings, catalog aliases, and id() calls", () => {
  const d = discoverProject(fixture);
  const parsed = parseProjectFiles(d.files);
  const plugins = parsed.dependencies.filter((d) => d.configuration === "plugin");
  const ids = plugins.map((p) => p.group);
  assert.ok(ids.includes("com.android.application"));
  assert.ok(ids.includes("org.jetbrains.kotlin.android"));
  const agp = plugins.find((p) => p.group === "com.android.application")!;
  assert.ok(agp.version === "8.7.3" || agp.version === "");
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
