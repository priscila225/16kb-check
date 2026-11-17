import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { discoverProject } from "../sixteenkb/discover";
import { parseProjectFiles } from "../sixteenkb/check/parse";
import { parsePlugins } from "../sixteenkb/check/plugins";
import { parseVersionCatalog } from "../sixteenkb/check/toml";
import { classifyBuildFile, includedBuildDirs } from "../sixteenkb/check/modules";
import type { ParseResult, VersionCatalog } from "../sixteenkb/check/types";
import { parseXml } from "./xml";
import { SOURCE_MANIFEST_NOTE } from "./output";
import { mergeManifests, qualifyName, readManifest, type ManifestInfo } from "./manifest";
import { parseProperties, resolveSdk, resolveTargetSdk, stripComments, type TargetSdkSource, type TextFile } from "./targetsdk";

/** Everything here is read from disk and stays in this process. */
export type ThemeOptOut = { file: string; value: string };

export type ProjectScan = {
  root: string;
  appModule?: string;
  appModules: string[];
  parsed: ParseResult;
  target: TargetSdkSource;
  minSdk: TargetSdkSource;
  compileSdk: TargetSdkSource;
  manifest?: ManifestInfo;
  /**
   * The project's own source manifests (app and in-project modules), with component names
   * qualified where the namespace is known. Used to tell the app's components from ones a
   * dependency adds in the merged manifest or APK.
   */
  ownManifest?: ManifestInfo;
  manifestKind: "merged" | "source" | "none";
  manifestNote?: string;
  edgeToEdgeOptOuts: ThemeOptOut[];
  /** A Gradle or TOML file that mentions the Play Billing Library, even when its version couldn't be parsed. */
  billingMentionedIn?: string;
  themeFilesScanned: number;
  /** Lazily read Kotlin/Java sources of the app and its library modules. */
  sources(): TextFile[];
  issues: string[];
};

const SKIP_DIRS = new Set(["build", ".gradle", ".git", ".idea", "node_modules", ".cxx", "out", "captures", "intermediates", ".next", "dist"]);
const TEST_SOURCE_SETS = /^(test|androidTest|testFixtures|testDebug|testRelease|androidTestDebug|screenshotTest)/;
const MAX_SOURCE_FILES = 6000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function rel(root: string, p: string): string {
  return relative(root, p).split(sep).join("/");
}

function safeRead(p: string): string | undefined {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined;
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

function listDir(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function moduleDirOf(buildFile: string): string {
  const i = buildFile.lastIndexOf("/");
  return i < 0 ? "" : buildFile.slice(0, i);
}

function mergeCatalogs(files: TextFile[]): VersionCatalog | undefined {
  const cats = files.filter((f) => f.name.endsWith(".toml")).map((f) => parseVersionCatalog(f.text));
  if (!cats.length) return undefined;
  return {
    versions: Object.assign({}, ...cats.map((c) => c.versions)),
    libraries: Object.assign({}, ...cats.map((c) => c.libraries)),
    plugins: Object.assign({}, ...cats.map((c) => c.plugins)),
    bundles: Object.assign({}, ...cats.map((c) => c.bundles)),
  };
}

function isBuildFile(name: string): boolean {
  return /(^|\/)build\.gradle(\.kts)?$/.test(name);
}

/** Source sets of a module: src/<set>/ directories that aren't tests. */
function sourceSetDirs(moduleAbs: string): string[] {
  const src = join(moduleAbs, "src");
  return listDir(src)
    .filter((d) => d.isDirectory() && !TEST_SOURCE_SETS.test(d.name))
    .map((d) => join(src, d.name));
}

function walkFiles(dir: string, accept: (name: string) => boolean, out: string[], limit: number, depth = 0): void {
  if (depth > 20 || out.length >= limit) return;
  for (const e of listDir(dir)) {
    if (out.length >= limit) return;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walkFiles(full, accept, out, limit, depth + 1);
    } else if (e.isFile() && accept(e.name)) out.push(full);
  }
}

function newestMtime(paths: string[]): number {
  let t = 0;
  for (const p of paths) {
    try {
      t = Math.max(t, statSync(p).mtimeMs);
    } catch {
      // ignore
    }
  }
  return t;
}

function findMergedManifest(moduleAbs: string): string | undefined {
  const base = join(moduleAbs, "build", "intermediates");
  const found: string[] = [];
  for (const sub of ["merged_manifest", "merged_manifests", "packaged_manifests"]) {
    const stack = [join(base, sub)];
    while (stack.length && found.length < 50) {
      const d = stack.pop()!;
      for (const e of listDir(d)) {
        const full = join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name === "AndroidManifest.xml") found.push(full);
      }
    }
    if (found.length) break;
  }
  if (!found.length) return undefined;
  found.sort((a, b) => Number(/release/i.test(b)) - Number(/release/i.test(a)) || a.localeCompare(b));
  return found[0];
}

export type ScanOptions = { module?: string };

export function scanProject(start: string, opts: ScanOptions = {}): ProjectScan | { error: string } {
  const discovered = discoverProject(start);
  if (!discovered.files.length) return { error: discovered.issues.join("\n") };
  const root = discovered.root;
  const files: TextFile[] = discovered.files.map((f) => ({ name: f.name, text: f.text }));
  const parsed = parseProjectFiles(discovered.files);
  const catalog = mergeCatalogs(files);
  const buildFiles = files.filter((f) => isBuildFile(f.name));
  const included = includedBuildDirs(files);

  const appModules: string[] = [];
  const libraryModules: string[] = [];
  const moduleBuild = new Map<string, TextFile>();
  const buildLogic: TextFile[] = [];
  for (const f of buildFiles) {
    const dir = moduleDirOf(f.name);
    const kind = classifyBuildFile(f.name, f.text, included);
    if (kind === "tooling") {
      buildLogic.push(f);
      continue;
    }
    if (kind === "test") continue;
    moduleBuild.set(dir, f);
    // `id("com.android.application") version "x" apply false` in the root file doesn't make it an app.
    const applied = f.text
      .split("\n")
      .filter((l) => !/\bapply\s*\(?\s*false\b/.test(l))
      .join("\n");
    const plugins = parsePlugins(applied, f.name, catalog).plugins;
    const isApp =
      plugins.some((p) => p.group === "com.android.application") || /\bapplicationId\s*(=|\s)\s*["']/.test(f.text);
    if (isApp) appModules.push(dir);
    else if (dir) libraryModules.push(dir);
  }
  // Kotlin/Groovy build logic outside build files (convention plugins, buildSrc constants).
  for (const dirName of ["buildSrc", "build-logic", ...included]) {
    const paths: string[] = [];
    walkFiles(join(root, dirName), (n) => /\.(kt|kts|groovy|gradle)$/.test(n), paths, 400);
    for (const p of paths) {
      const text = safeRead(p);
      if (text !== undefined) buildLogic.push({ name: rel(root, p), text });
    }
  }

  const issues: string[] = [];
  let appModule: string | undefined;
  if (opts.module) {
    const want = opts.module.replace(/^:/, "").replace(/:/g, "/");
    appModule = [...moduleBuild.keys()].find((m) => m === want);
    if (appModule === undefined) issues.push(`Module "${opts.module}" wasn't found. App modules here: ${appModules.join(", ") || "none"}.`);
  } else if (appModules.length) {
    appModule = appModules.includes("app") ? "app" : [...appModules].sort()[0];
    if (appModules.length > 1) issues.push(`Several app modules found (${appModules.join(", ")}). Checked "${appModule}". Use --module to pick another.`);
  }

  const gradleProperties = parseProperties(safeRead(join(root, "gradle.properties")) ?? "");
  const shared = [
    ...files.filter((f) => isBuildFile(f.name) && !f.name.includes("/")),
    ...files.filter((f) => /(^|\/)settings\.gradle(\.kts)?$/.test(f.name)),
    ...buildLogic,
  ];
  const ctx = { catalogVersions: catalog?.versions ?? {}, gradleProperties, sharedFiles: shared };
  const target = appModule !== undefined ? resolveTargetSdk(moduleBuild.get(appModule), ctx, buildLogic) : {};
  const minSdk = appModule !== undefined ? resolveSdk("min", moduleBuild.get(appModule), ctx, buildLogic) : {};
  const compileSdk = appModule !== undefined ? resolveSdk("compile", moduleBuild.get(appModule), ctx, buildLogic) : {};

  // Manifest: a fresh merged manifest from a previous build wins; otherwise source manifests.
  const manifestModules = appModule !== undefined ? [appModule, ...libraryModules.filter((m) => m !== appModule)] : libraryModules;
  let manifest: ManifestInfo | undefined;
  let manifestKind: ProjectScan["manifestKind"] = "none";
  let manifestNote: string | undefined;
  const sourceManifestPaths: string[] = [];
  for (const m of manifestModules) {
    for (const set of sourceSetDirs(join(root, m))) {
      const p = join(set, "AndroidManifest.xml");
      if (safeRead(p) !== undefined) sourceManifestPaths.push(p);
    }
  }
  // Main source sets first so the app module's main manifest takes priority.
  sourceManifestPaths.sort((a, b) => {
    const ma = manifestModules.findIndex((m) => a.startsWith(join(root, m) + sep) || m === "");
    const mb = manifestModules.findIndex((m) => b.startsWith(join(root, m) + sep) || m === "");
    return ma - mb || Number(!a.includes(`${sep}main${sep}`)) - Number(!b.includes(`${sep}main${sep}`));
  });
  const namespaceOf = (p: string): string | undefined => {
    const m = manifestModules
      .filter((mod) => mod === "" || p.startsWith(join(root, mod) + sep))
      .sort((a, b) => b.length - a.length)[0];
    const build = m !== undefined ? moduleBuild.get(m) : undefined;
    return build ? /\bnamespace\s*=?\s*["']([\w.]+)["']/.exec(stripComments(build.text))?.[1] : undefined;
  };
  const sourceParts = sourceManifestPaths.map((p) => {
    const part = readManifest(parseXml(safeRead(p) ?? ""), rel(root, p));
    const pkg = namespaceOf(p) ?? part.package;
    const qualify = (c: ManifestInfo["activities"][number]) => ({ ...c, name: qualifyName(c.name, pkg) });
    return { ...part, activities: part.activities.map(qualify), services: part.services.map(qualify), receivers: part.receivers.map(qualify) };
  });
  const ownManifest = sourceParts.length ? mergeManifests(sourceParts) : undefined;
  const merged = appModule !== undefined ? findMergedManifest(join(root, appModule)) : undefined;
  if (merged) {
    const appInputs = [...sourceManifestPaths, ...(moduleBuild.get(appModule!) ? [join(root, moduleBuild.get(appModule!)!.name)] : [])];
    if (newestMtime([merged]) >= newestMtime(appInputs)) {
      const text = safeRead(merged);
      if (text !== undefined) {
        manifest = mergeManifests([readManifest(parseXml(text), rel(root, merged))]);
        manifestKind = "merged";
      }
    } else {
      manifestNote = "The merged manifest in build/ is older than your sources, so it was ignored. Rebuild for library-added permissions.";
    }
  }
  if (!manifest && ownManifest) {
    manifest = ownManifest;
    manifestKind = "source";
    manifestNote =
      manifestNote ??
      SOURCE_MANIFEST_NOTE;
  }
  if (manifest && target.value === undefined && manifest.targetSdk !== undefined) {
    Object.assign(target, { value: manifest.targetSdk, from: manifest.files[0] });
  } else if (manifest && manifestKind === "merged" && manifest.targetSdk !== undefined) {
    Object.assign(target, { value: manifest.targetSdk, from: manifest.files[0] });
  }
  if (manifest?.minSdk !== undefined && (minSdk.value === undefined || manifestKind === "merged")) {
    Object.assign(minSdk, { value: manifest.minSdk, from: manifest.files[0] });
  }

  // Theme flags: res/values*/ XML in the app and its library modules.
  const themePaths: string[] = [];
  for (const m of manifestModules) {
    for (const set of sourceSetDirs(join(root, m))) {
      for (const d of listDir(join(set, "res"))) {
        if (!d.isDirectory() || !d.name.startsWith("values")) continue;
        for (const f of listDir(join(set, "res", d.name))) if (f.isFile() && f.name.endsWith(".xml")) themePaths.push(join(set, "res", d.name, f.name));
      }
    }
  }
  const edgeToEdgeOptOuts: ThemeOptOut[] = [];
  for (const p of themePaths) {
    const text = safeRead(p);
    if (!text || !text.includes("windowOptOutEdgeToEdgeEnforcement")) continue;
    for (const m of text.matchAll(/<item\b[^>]*name\s*=\s*["'](?:android:)?windowOptOutEdgeToEdgeEnforcement["'][^>]*>\s*([^<]*?)\s*<\/item>/g)) {
      edgeToEdgeOptOuts.push({ file: rel(root, p), value: m[1] });
    }
  }

  let cachedSources: TextFile[] | undefined;
  const sources = (): TextFile[] => {
    if (cachedSources) return cachedSources;
    const paths: string[] = [];
    for (const m of manifestModules) {
      for (const set of sourceSetDirs(join(root, m))) walkFiles(set, (n) => n.endsWith(".kt") || n.endsWith(".java"), paths, MAX_SOURCE_FILES);
    }
    cachedSources = [];
    for (const p of paths) {
      const text = safeRead(p);
      if (text !== undefined) cachedSources.push({ name: rel(root, p), text });
    }
    return cachedSources;
  };

  return {
    root,
    appModule,
    appModules,
    parsed,
    target,
    minSdk,
    compileSdk,
    manifest,
    ownManifest,
    manifestKind,
    manifestNote,
    edgeToEdgeOptOuts,
    billingMentionedIn: files.find((f) => /com\.android\.billingclient/.test(stripComments(f.text)))?.name,
    themeFilesScanned: themePaths.length,
    sources,
    issues,
  };
}
