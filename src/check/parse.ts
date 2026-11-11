import type { DeclaredDep, ParseResult, VersionCatalog } from "./types";
import { parseVersionCatalog } from "./toml";
import { parseGradle, mergeVars } from "./gradle";
import { parsePlugins, pluginsFromCatalog } from "./plugins";

export type InputFile = { name: string; text: string };

export function detectKind(name: string, text: string): "toml" | "gradle" | "unknown" {
  const n = name.toLowerCase();
  if (n.endsWith(".toml") || n.endsWith("libs.versions.toml") || n.endsWith("libs.versions.toml.txt")) return "toml";
  if (n.endsWith(".gradle") || n.endsWith(".gradle.kts") || n.endsWith(".kts")) return "gradle";
  const t = text.trim();
  if (/^\s*\[(versions|libraries|plugins|bundles)\]/m.test(t)) return "toml";
  if (/\b(?:implementation|api|compileOnly|kapt|ksp)\s*[\s("']/.test(t) || /\bdependencies\s*\{/.test(t)) return "gradle";
  return "unknown";
}

function keyOf(d: DeclaredDep): string {
  return `${d.group}:${d.artifact}`;
}

function better(a: DeclaredDep, b: DeclaredDep): DeclaredDep {
  // Prefer a resolved version over a missing one; prefer declared over bom-only
  const rank = (d: DeclaredDep) => (d.version ? 2 : 0) + (d.versionSource === "declared" || d.versionSource === "variable" || d.versionSource === "catalog" ? 1 : 0);
  return rank(b) > rank(a) ? b : a;
}

/**
 * Parse one or more version-catalog and Gradle files and return a de-duplicated
 * dependency list. All work is synchronous and has no I/O — safe to run in the browser.
 */
export function parseProjectFiles(files: InputFile[]): ParseResult {
  const issues: ParseResult["issues"] = [];
  const fileInfos: ParseResult["files"] = [];
  const catalogs: VersionCatalog[] = [];
  const gradleFiles: InputFile[] = [];

  for (const f of files) {
    const kind = detectKind(f.name, f.text);
    if (kind === "unknown") {
      fileInfos.push({ name: f.name, kind, depCount: 0 });
      issues.push({ file: f.name, message: "Not recognized as a version catalog (.toml) or a Gradle build file." });
      continue;
    }
    if (kind === "toml") {
      const cat = parseVersionCatalog(f.text);
      catalogs.push(cat);
      fileInfos.push({ name: f.name, kind, depCount: Object.keys(cat.libraries).length });
    } else {
      gradleFiles.push(f);
      fileInfos.push({ name: f.name, kind, depCount: 0 });
    }
  }

  const catalog: VersionCatalog | undefined = catalogs.length
    ? {
        versions: Object.assign({}, ...catalogs.map((c) => c.versions)),
        libraries: Object.assign({}, ...catalogs.map((c) => c.libraries)),
        plugins: Object.assign({}, ...catalogs.map((c) => c.plugins)),
        bundles: Object.assign({}, ...catalogs.map((c) => c.bundles)),
      }
    : undefined;

  const allDeps: DeclaredDep[] = [];
  const allBoms: DeclaredDep[] = [];

  for (const f of gradleFiles) {
    const parsed = parseGradle(f.text, f.name, catalog);
    allDeps.push(...parsed.dependencies);
    allBoms.push(...parsed.boms);
    for (const msg of parsed.issues) issues.push({ file: f.name, message: msg });
    const info = fileInfos.find((x) => x.name === f.name && x.kind === "gradle");
    if (info) info.depCount = parsed.dependencies.length;
  }

  // If the user only uploaded a catalog, treat every library in it as a declared dependency.
  if (gradleFiles.length === 0 && catalog) {
    for (const [alias, lib] of Object.entries(catalog.libraries)) {
      const version = lib.version || (lib.versionRef ? catalog.versions[lib.versionRef] || "" : "");
      const isBom = /(?:-bom|bom)$/i.test(lib.artifact);
      const dep: DeclaredDep = {
        group: lib.group,
        artifact: lib.artifact,
        version,
        versionSource: version ? (lib.versionRef ? "catalog" : "declared") : "missing",
        configuration: "catalog",
        catalogAlias: alias,
        sourceFile: files.find((f) => detectKind(f.name, f.text) === "toml")?.name || "libs.versions.toml",
      };
      if (isBom) {
        allBoms.push(dep);
      } else {
        allDeps.push(dep);
      }
    }
    // Apply BOM marks to same-group catalog libs without versions
    for (const d of allDeps) {
      if (d.version) continue;
      const bom = allBoms.find((b) => b.group === d.group) || allBoms.find((b) => b.artifact === "firebase-bom" && d.group === "com.google.firebase") || allBoms.find((b) => b.artifact === "compose-bom" && d.group.startsWith("androidx.compose"));
      if (bom) {
        d.bom = `${bom.group}:${bom.artifact}${bom.version ? ":" + bom.version : ""}`;
        d.versionSource = "bom";
      }
    }
  }

  // Plugins from Gradle / settings files, and from the catalog when no Gradle file declared them.
  const pluginKeys = new Set<string>();
  for (const f of gradleFiles) {
    const parsedPlugins = parsePlugins(f.text, f.name, catalog);
    for (const msg of parsedPlugins.issues) issues.push({ file: f.name, message: msg });
    for (const plug of parsedPlugins.plugins) {
      allDeps.push(plug);
      pluginKeys.add(`${plug.group}:${plug.artifact}`.toLowerCase());
    }
  }
  if (catalog) {
    const tomlName = files.find((f) => detectKind(f.name, f.text) === "toml")?.name || "libs.versions.toml";
    for (const plug of pluginsFromCatalog(catalog, tomlName)) {
      const k = `${plug.group}:${plug.artifact}`.toLowerCase();
      if (pluginKeys.has(k)) continue;
      // Only add catalog-only plugins when we had no Gradle plugin block at all, or the alias was never applied.
      if (gradleFiles.length === 0) {
        allDeps.push(plug);
        pluginKeys.add(k);
      }
    }
  }

  // De-duplicate by group:artifact
  const merged = new Map<string, DeclaredDep>();
  for (const d of allDeps) {
    const k = keyOf(d);
    const prev = merged.get(k);
    merged.set(k, prev ? better(prev, d) : d);
  }

  void mergeVars;
  return {
    dependencies: [...merged.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
    boms: allBoms,
    files: fileInfos,
    issues,
  };
}
