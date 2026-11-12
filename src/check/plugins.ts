import type { DeclaredDep, VersionCatalog } from "./types";
import { collectVariables, substituteVars } from "./gradle";
import { resolveCatalogLibrary } from "./toml";

/** Turn a Gradle accessor like `android.application` into possible catalog plugin aliases. */
export function pluginAliasCandidates(accessor: string): string[] {
  const a = accessor.replace(/^libs\.plugins\./, "").replace(/^plugins\./, "");
  return [...new Set([a, a.replace(/\./g, "-"), a.replace(/\./g, "_")])];
}

export function resolveCatalogPlugin(
  catalog: VersionCatalog,
  accessor: string,
): { id: string; version: string; alias: string } | null {
  const path = accessor.replace(/^libs\.plugins\./, "").replace(/^plugins\./, "");
  const candidates = pluginAliasCandidates(path);
  let alias = "";
  let plugin: VersionCatalog["plugins"][string] | undefined;
  for (const c of candidates) {
    if (catalog.plugins[c]) {
      plugin = catalog.plugins[c];
      alias = c;
      break;
    }
  }
  if (!plugin) {
    for (const [k, v] of Object.entries(catalog.plugins)) {
      if (k.replace(/[-_]/g, ".") === path) {
        plugin = v;
        alias = k;
        break;
      }
    }
  }
  if (!plugin) return null;
  let version = plugin.version || "";
  if (!version && plugin.versionRef) version = catalog.versions[plugin.versionRef] || "";
  return { id: plugin.id, version, alias };
}

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "\n");
}

function stripLineComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let inS = false,
        inD = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        const n = line[i + 1];
        if (!inS && !inD && c === "/" && n === "/") return line.slice(0, i);
        if (c === "'" && !inD) inS = !inS;
        else if (c === '"' && !inS) inD = !inD;
      }
      return line;
    })
    .join("\n");
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Official Gradle plugin marker published to the Plugin Portal. */
export function pluginMarkerCoordinate(pluginId: string): { group: string; artifact: string } {
  return { group: pluginId, artifact: `${pluginId}.gradle.plugin` };
}

function toDep(opts: { id: string; version: string; file: string; alias?: string; versionSource: DeclaredDep["versionSource"] }): DeclaredDep {
  const { group, artifact } = pluginMarkerCoordinate(opts.id);
  return {
    group,
    artifact,
    version: opts.version,
    versionSource: opts.versionSource,
    configuration: "plugin",
    catalogAlias: opts.alias,
    sourceFile: opts.file,
  };
}

/**
 * Parse plugins {} blocks and apply plugin: statements from a Gradle or settings file.
 * project() / local script plugins are skipped.
 */
export function parsePlugins(text: string, file: string, catalog?: VersionCatalog): { plugins: DeclaredDep[]; issues: string[] } {
  const cleaned = stripLineComments(stripBlockComments(text));
  const plugins: DeclaredDep[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  const add = (dep: DeclaredDep) => {
    const key = `${dep.group}:${dep.artifact}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    plugins.push(dep);
  };

  // plugins { id("com.android.application") version "8.7.3" apply false }
  // plugins { id 'com.android.application' version '8.7.3' }
  const idCall = /\bid\s*(?:\(|\s+)["']([^"']+)["']\s*\)?((?:[^}\n]{0,200}))/g;
  for (const m of cleaned.matchAll(idCall)) {
    const id = m[1].trim();
    const rest = m[2] || "";
    if (!id) continue;
    // Local script plugins: id("my.plugin") apply from, or id with a path
    if (/\bfrom\b/.test(rest) || /[\\/]/.test(id) || id.endsWith(".gradle") || id.endsWith(".gradle.kts")) continue;
    const ver = /version\s*(?:\(|\s+)["']([^"']+)["']/.exec(rest);
    add(
      toDep({
        id,
        version: ver ? ver[1] : "",
        file,
        versionSource: ver ? "declared" : "missing",
      }),
    );
  }

  // alias(libs.plugins.android.application) or alias(libs.plugins["android-application"])
  const aliasCall = /\balias\s*\(\s*libs\.plugins(?:\.([A-Za-z][\w.]*)|\[(?:["'])([^"']+)["']\])\s*\)/g;
  for (const m of cleaned.matchAll(aliasCall)) {
    const accessor = (m[1] || m[2] || "").replace(/\.+$/, "");
    if (!accessor) continue;
    if (catalog) {
      const resolved = resolveCatalogPlugin(catalog, accessor);
      if (resolved) {
        add(
          toDep({
            id: resolved.id,
            version: resolved.version,
            file,
            alias: resolved.alias,
            versionSource: resolved.version ? "catalog" : "missing",
          }),
        );
        continue;
      }
      issues.push(`Could not resolve catalog plugin alias libs.plugins.${accessor} in ${file}`);
    } else {
      issues.push(`libs.plugins.${accessor} needs the version catalog (libs.versions.toml) to resolve`);
    }
  }

  // Legacy: apply plugin: 'com.android.application'  / apply plugin: "com.android.application"
  const apply = /\bapply\s+plugin\s*:\s*["']([^"']+)["']/g;
  for (const m of cleaned.matchAll(apply)) {
    const id = m[1].trim();
    if (!id || /[\\/]/.test(id) || id.endsWith(".gradle") || id.endsWith(".gradle.kts")) continue;
    add(toDep({ id, version: "", file, versionSource: "missing" }));
  }

  return { plugins, issues };
}

/** Treat every catalog plugin as declared when no Gradle file mentioned it. */
export function pluginsFromCatalog(catalog: VersionCatalog, sourceFile: string): DeclaredDep[] {
  const out: DeclaredDep[] = [];
  for (const [alias, plugin] of Object.entries(catalog.plugins)) {
    const version = plugin.version || (plugin.versionRef ? catalog.versions[plugin.versionRef] || "" : "");
    out.push(
      toDep({
        id: plugin.id,
        version,
        file: sourceFile,
        alias,
        versionSource: version ? (plugin.versionRef ? "catalog" : "declared") : "missing",
      }),
    );
  }
  return out;
}

/** com.android.tools.build:gradle is the Maven coordinate of the Android Gradle Plugin. */
export function isAgpLibraryCoordinate(group: string, artifact: string): boolean {
  return group === "com.android.tools.build" && artifact === "gradle";
}

export function agpPluginFromLibrary(dep: DeclaredDep): DeclaredDep {
  return { ...dep, group: "com.android.tools.build", artifact: "gradle", configuration: "plugin" };
}

/**
 * buildscript { dependencies { classpath "com.android.tools.build:gradle:8.7.3" } }
 * Also handles ${var} versions and classpath(libs.android.gradle.plugin).
 */
export function parseBuildscriptAgp(text: string, file: string, catalog?: VersionCatalog): DeclaredDep | null {
  const cleaned = stripLineComments(stripBlockComments(text));
  const vars = collectVariables(cleaned);
  const str = /\bclasspath\s*\(?\s*["']com\.android\.tools\.build:gradle:([^"']+)["']/.exec(cleaned);
  if (str) {
    const sub = substituteVars(str[1], vars);
    const version = /\$/.test(sub.value) ? "" : sub.value.trim();
    return agpPluginFromLibrary({
      group: "com.android.tools.build",
      artifact: "gradle",
      version,
      versionSource: version ? (sub.usedVar ? "variable" : "declared") : "missing",
      configuration: "plugin",
      sourceFile: file,
    });
  }
  const cat = /\bclasspath\s*\(?\s*libs\.([A-Za-z][\w.]*)/.exec(cleaned);
  if (cat && catalog) {
    const resolved = resolveCatalogLibrary(catalog, cat[1].replace(/\.get\(\)$/, "").replace(/\.+$/, ""));
    if (resolved && isAgpLibraryCoordinate(resolved.group, resolved.artifact)) {
      return {
        group: "com.android.tools.build",
        artifact: "gradle",
        version: resolved.version,
        versionSource: resolved.version ? "catalog" : "missing",
        configuration: "plugin",
        catalogAlias: resolved.alias,
        sourceFile: file,
      };
    }
  }
  return null;
}
