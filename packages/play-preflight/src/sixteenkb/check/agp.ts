import type { DeclaredDep } from "./types";
import { compareVersions, extractVersionToken } from "./versions";

/** AGP 8.5.1+ zip-aligns uncompressed .so files on 16 KB boundaries. */
export const AGP_MIN_16KB = "8.5.1";

/** Plugin ids that are the Android Gradle Plugin. */
const AGP_PLUGIN_IDS = new Set([
  "com.android.application",
  "com.android.library",
  "com.android.dynamic-feature",
  "com.android.test",
  "com.android.asset-pack",
  "com.android.kotlin.multiplatform.library",
]);

export function isAgpPlugin(dep: Pick<DeclaredDep, "group" | "artifact">): boolean {
  if (dep.group === "com.android.tools.build" && dep.artifact === "gradle") return true;
  return AGP_PLUGIN_IDS.has(dep.group) && dep.artifact === `${dep.group}.gradle.plugin`;
}

export type AgpCheck =
  | { status: "ok"; version: string; from: string; message: string }
  | { status: "warning"; version: string; from: string; message: string }
  | { status: "not-checked"; version: ""; from: ""; message: string };

/**
 * Find the Android Gradle Plugin version among the parsed plugins and compare it with 8.5.1.
 * When several declarations carry a version, the lowest one is used (worst case).
 */
export function checkAgp(plugins: DeclaredDep[]): AgpCheck {
  const agp = plugins.filter(isAgpPlugin);
  const versioned = agp
    .map((p) => ({ p, v: extractVersionToken(p.version || "") }))
    .filter((x): x is { p: DeclaredDep; v: string } => !!x.v);
  if (!versioned.length) {
    return {
      status: "not-checked",
      version: "",
      from: "",
      message: agp.length
        ? "Android Gradle Plugin version not checked: it could not be resolved from the plugins block, the version catalog, or the buildscript classpath."
        : "Android Gradle Plugin version not checked: no Android Gradle Plugin declaration was found.",
    };
  }
  versioned.sort((a, b) => compareVersions(a.v, b.v));
  const lowest = versioned[0];
  const from = lowest.p.sourceFile;
  if (compareVersions(lowest.v, AGP_MIN_16KB) < 0) {
    return {
      status: "warning",
      version: lowest.p.version,
      from,
      message: `Android Gradle Plugin ${lowest.p.version} is below ${AGP_MIN_16KB}. Upgrade to AGP ${AGP_MIN_16KB} or newer so uncompressed .so files are zip-aligned to 16 KB (or set jniLibs.useLegacyPackaging = true).`,
    };
  }
  return {
    status: "ok",
    version: lowest.p.version,
    from,
    message: `Android Gradle Plugin ${lowest.p.version} is ${AGP_MIN_16KB} or newer, so uncompressed .so files are zip-aligned to 16 KB.`,
  };
}
