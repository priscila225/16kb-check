import { posix } from "node:path";

/**
 * Pure string helpers (no fs) to classify Gradle build files by the module they belong to.
 * - "tooling": build logic that never ships in the app: buildSrc, included builds such as
 *   build-logic, convention-plugin modules (java-gradle-plugin / kotlin-dsl / gradlePlugin {}),
 *   and Android lint-check modules (com.android.lint).
 * - "test": test-only modules (com.android.test, or names like testing, data-test, benchmarks).
 * - "app": everything else.
 */
export type ModuleKind = "app" | "test" | "tooling";

function dirOf(file: string): string {
  const d = posix.dirname(file.replace(/\\/g, "/"));
  return d === "." ? "" : d;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/** Directories of included builds named in settings files, relative to the project root. */
export function includedBuildDirs(files: { name: string; text: string }[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const base = posix.basename(f.name);
    if (base !== "settings.gradle" && base !== "settings.gradle.kts") continue;
    const dir = dirOf(f.name);
    for (const m of stripComments(f.text).matchAll(/\bincludeBuild\s*\(?\s*["']([^"']+)["']/g)) {
      const p = posix.normalize(posix.join(dir, m[1].replace(/\\/g, "/"))).replace(/\/$/, "");
      if (p && !p.startsWith("..")) out.add(p === "." ? "" : p);
    }
  }
  return [...out];
}

const TOOLING_PLUGIN = /`kotlin-dsl`|\bid\s*\(?\s*["'](?:java-gradle-plugin|kotlin-dsl|org\.gradle\.kotlin\.kotlin-dsl|com\.android\.lint)["']|\bapply\s+plugin\s*:\s*["'](?:java-gradle-plugin|com\.android\.lint)["']|(?:^|\s)gradlePlugin\s*\{|(?:^|\s)java-gradle-plugin(?:\s|$)/m;
const TEST_PLUGIN = /\bid\s*\(?\s*["']com\.android\.test["']|\bapply\s+plugin\s*:\s*["']com\.android\.test["']|libs\.plugins\.android\.test\b/;
const TEST_MODULE_NAME = /(?:^|[-_])(?:testing|test|tests|testutils|test-utils|testfixtures|benchmark|benchmarks|baselineprofile|macrobenchmark)(?:$|[-_])/i;

export function classifyBuildFile(file: string, text: string, includedBuilds: string[]): ModuleKind {
  const name = file.replace(/\\/g, "/");
  const dir = dirOf(name);
  const segments = dir.split("/").filter(Boolean);
  if (segments.includes("buildSrc")) return "tooling";
  for (const inc of includedBuilds) {
    if (inc === "") continue;
    if (dir === inc || dir.startsWith(inc + "/")) return "tooling";
  }
  const base = posix.basename(name);
  if (base === "settings.gradle" || base === "settings.gradle.kts") return "app";
  const code = stripComments(text);
  if (TOOLING_PLUGIN.test(code)) return "tooling";
  if (TEST_PLUGIN.test(code)) return "test";
  const last = segments[segments.length - 1] || "";
  if (last && TEST_MODULE_NAME.test(last)) return "test";
  return "app";
}

/**
 * Build-time artifacts that never ship in an app even when declared in an app module:
 * Gradle plugin markers and Gradle/lint APIs.
 */
export function isBuildToolingCoordinate(group: string, artifact: string): boolean {
  const g = group.toLowerCase();
  const a = artifact.toLowerCase();
  if (a.endsWith(".gradle.plugin")) return true;
  if (a.endsWith("-gradle-plugin") || a.endsWith("-gradle-plugin-api") || a.endsWith("-gradle")) return true;
  if (g === "com.android.tools.lint") return true;
  if (g === "com.android.tools.build" && a !== "gradle") return true;
  if (g === "com.android.tools" && !a.startsWith("desugar_jdk_libs")) return true;
  if (g === "com.google.firebase" && a === "perf-plugin") return true;
  if (g === "com.google.gms" && a === "google-services") return true;
  if (g === "com.google.android.gms" && a === "oss-licenses-plugin") return true;
  if (g === "org.jetbrains.kotlin" && (a === "kotlin-gradle-plugin" || a.startsWith("kotlin-gradle-plugin-") || a === "kotlin-compiler-embeddable")) return true;
  return false;
}
