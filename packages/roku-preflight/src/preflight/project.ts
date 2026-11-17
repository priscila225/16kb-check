import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { isStandaloneScreensaver, parseManifest, type ManifestInfo } from "./manifest";
import { isSourcePath, type TextFile } from "./source";
import { buildZip, openZip } from "./zip";

const EXCLUDE_DIRS = new Set([".git", "node_modules", ".idea", ".vscode", ".github", "__macosx", "dist", "coverage"]);
const EXCLUDE_FILES = new Set([".ds_store", "thumbs.db", ".gitignore", ".gitattributes", ".npmrc"]);
const EXCLUDE_EXT = new Set([".md", ".markdown"]);

export type ProjectFile = {
  path: string;
  size: number;
};

export type ProjectScan = {
  root: string;
  kind: "project" | "zip";
  displayName: string;
  manifest: ManifestInfo;
  files: ProjectFile[];
  /** Measured package size in bytes: the zip on disk, or a zip built from the project. */
  packageBytes: number;
  sources: TextFile[];
  screensaver: boolean;
  readFile(path: string): Buffer | undefined;
};

export type ScanError = { error: string };

function posixPath(p: string): string {
  return p.split(sep).join("/");
}

function shouldExclude(rel: string, isDir: boolean): boolean {
  const parts = posixPath(rel).split("/");
  const base = parts[parts.length - 1] ?? "";
  if (parts.some((p) => EXCLUDE_DIRS.has(p.toLowerCase()))) return true;
  if (isDir) return false;
  if (EXCLUDE_FILES.has(base.toLowerCase())) return true;
  if (EXCLUDE_EXT.has(extname(base).toLowerCase())) return true;
  return false;
}

function findManifestDir(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "manifest")) && statSync(join(dir, "manifest")).isFile()) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // One level down from the original start (e.g. monorepos with channel/ or roku/).
  if (existsSync(start) && statSync(start).isDirectory()) {
    for (const name of readdirSync(start)) {
      if (EXCLUDE_DIRS.has(name.toLowerCase()) || name.startsWith(".")) continue;
      const child = join(start, name);
      try {
        if (statSync(child).isDirectory() && existsSync(join(child, "manifest"))) return child;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function walkDir(dir: string, root: string, out: { path: string; abs: string; size: number }[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    const rel = relative(root, abs);
    if (shouldExclude(rel, ent.isDirectory())) continue;
    if (ent.isDirectory()) walkDir(abs, root, out);
    else if (ent.isFile()) {
      try {
        out.push({ path: posixPath(rel), abs, size: statSync(abs).size });
      } catch {
        // skip unreadable
      }
    }
  }
}

function loadProjectDir(root: string): ProjectScan {
  const collected: { path: string; abs: string; size: number }[] = [];
  walkDir(root, root, collected);
  const manifestEnt = collected.find((f) => f.path === "manifest");
  if (!manifestEnt) throw new Error("No manifest file found in this folder.");
  const raw = readFileSync(manifestEnt.abs);
  const manifest = parseManifest(raw.toString("utf8"), "manifest");
  const buffers = new Map<string, Buffer>();
  const zipFiles = collected.map((f) => {
    const data = readFileSync(f.abs);
    buffers.set(f.path, data);
    return { name: f.path, data };
  });
  const sources: TextFile[] = collected
    .filter((f) => isSourcePath(f.path))
    .map((f) => ({ path: f.path, content: (buffers.get(f.path) ?? readFileSync(f.abs)).toString("utf8") }));
  return {
    root,
    kind: "project",
    displayName: basename(root),
    manifest,
    files: collected.map((f) => ({ path: f.path, size: f.size })),
    packageBytes: buildZip(zipFiles).length,
    sources,
    screensaver: isStandaloneScreensaver(manifest),
    readFile(path: string) {
      return buffers.get(posixPath(path));
    },
  };
}

function loadZip(file: string): ProjectScan {
  const buf = readFileSync(file);
  const zip = openZip(buf);
  const files: ProjectFile[] = zip.entries
    .filter((e) => !e.name.endsWith("/") && !shouldExclude(e.name, false))
    .map((e) => ({ path: e.name.replace(/^\/+/, ""), size: e.size }));
  const manifestEnt = zip.entries.find((e) => {
    const n = e.name.replace(/^\/+/, "");
    return n === "manifest" || n.endsWith("/manifest");
  });
  if (!manifestEnt) throw new Error("No manifest file found in this zip.");
  const prefix = manifestEnt.name === "manifest" || manifestEnt.name === "/manifest" ? "" : dirname(manifestEnt.name).replace(/\\/g, "/");
  const strip = (name: string) => {
    const n = name.replace(/^\/+/, "");
    if (!prefix) return n;
    const p = prefix.endsWith("/") ? prefix : prefix + "/";
    return n.startsWith(p) ? n.slice(p.length) : n;
  };
  const manifestRaw = zip.read(manifestEnt).toString("utf8");
  const manifest = parseManifest(manifestRaw, "manifest");
  const buffers = new Map<string, Buffer>();
  const sources: TextFile[] = [];
  for (const entry of zip.entries) {
    if (entry.name.endsWith("/")) continue;
    const rel = strip(entry.name);
    if (shouldExclude(rel, false)) continue;
    const data = zip.read(entry);
    buffers.set(rel, data);
    if (isSourcePath(rel)) sources.push({ path: rel, content: data.toString("utf8") });
  }
  return {
    root: resolve(file),
    kind: "zip",
    displayName: basename(file),
    manifest,
    files: [...buffers.entries()].map(([path, data]) => ({ path, size: data.length })),
    packageBytes: buf.length,
    sources,
    screensaver: isStandaloneScreensaver(manifest),
    readFile(path: string) {
      return buffers.get(posixPath(path));
    },
  };
}

export function looksLikeZip(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".zip")) return true;
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  try {
    const fd = readFileSync(path, { encoding: null }).subarray(0, 4);
    // PK\x03\x04 or PK\x05\x06
    return fd.length >= 2 && fd[0] === 0x50 && fd[1] === 0x4b;
  } catch {
    return false;
  }
}

export function scanInput(path: string): ProjectScan | ScanError {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return { error: `Path not found: ${path}` };
  try {
    const st = statSync(resolved);
    if (st.isFile() || looksLikeZip(resolved)) return loadZip(resolved);
    const root = findManifestDir(resolved);
    if (!root) {
      return { error: `No Roku manifest found in ${path}. Run this in a channel folder (the one with a manifest file), or pass a .zip package.` };
    }
    return loadProjectDir(root);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

