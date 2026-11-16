import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { InputFile } from "./check/parse";

const SKIP_DIRS = new Set([
  "build",
  ".gradle",
  ".git",
  ".idea",
  ".svn",
  "node_modules",
  "out",
  "captures",
  "intermediates",
  ".next",
  "dist",
  "__pycache__",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_WALK_UP = 6;

export type DiscoveredFile = InputFile & { path: string };

export type DiscoverResult = {
  root: string;
  files: DiscoveredFile[];
  issues: string[];
};

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function isSettings(name: string): boolean {
  return name === "settings.gradle" || name === "settings.gradle.kts";
}

function isBuild(name: string): boolean {
  return name === "build.gradle" || name === "build.gradle.kts";
}

function isCatalog(name: string, rel: string): boolean {
  if (name.endsWith(".versions.toml")) return true;
  if (name === "libs.versions.toml") return true;
  // Default Gradle catalog location: gradle/libs.versions.toml
  return name.endsWith(".toml") && rel.split(sep)[0] === "gradle";
}

/** Walk up from `start` looking for an Android project root. */
export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i <= MAX_WALK_UP; i++) {
    if (exists(join(dir, "settings.gradle")) || exists(join(dir, "settings.gradle.kts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = resolve(start);
  if (
    exists(join(dir, "build.gradle")) ||
    exists(join(dir, "build.gradle.kts")) ||
    exists(join(dir, "gradle", "libs.versions.toml"))
  ) {
    return dir;
  }
  return resolve(start);
}

function walk(dir: string, root: string, depth: number, out: string[], issues: string[]): void {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    issues.push(`Could not read ${relative(root, dir) || "."}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".gradle") continue;
      walk(full, root, depth + 1, out, issues);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(root, full);
    if (isSettings(entry.name) || isBuild(entry.name) || isCatalog(entry.name, rel)) out.push(full);
  }
}

export function discoverProject(start: string): DiscoverResult {
  const root = findProjectRoot(start);
  const issues: string[] = [];
  const paths: string[] = [];
  walk(root, root, 0, paths, issues);

  const files: DiscoveredFile[] = [];
  for (const path of paths.sort()) {
    let st;
    try {
      st = statSync(path);
    } catch (e) {
      issues.push(`Could not stat ${relative(root, path)}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (st.size > MAX_FILE_BYTES) {
      issues.push(`Skipped ${relative(root, path)} because it is larger than 2 MB.`);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      issues.push(`Could not read ${relative(root, path)}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    files.push({ path, name: relative(root, path).split(sep).join("/"), text });
  }

  if (!files.length) {
    issues.push(
      "No Android project files found. Looked for settings.gradle, settings.gradle.kts, build.gradle, build.gradle.kts, and gradle/libs.versions.toml.",
    );
  }
  void basename;
  return { root, files, issues };
}
