import type { VersionCatalog, CatalogLibrary } from "./types";

/** Strip # comments that are not inside quotes. */
function stripComment(line: string): string {
  let inS = false;
  let inD = false;
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\" && inD) {
      esc = true;
      continue;
    }
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD) return line.slice(0, i).trimEnd();
  }
  return line;
}

function unquote(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    if (s.startsWith('"')) return inner.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    return inner;
  }
  return s;
}

function parseInlineTable(raw: string): Record<string, string> {
  const s = raw.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return {};
  const body = s.slice(1, -1);
  const out: Record<string, string> = {};
  let buf = "";
  let inS = false;
  let inD = false;
  let esc = false;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (esc) {
      buf += c;
      esc = false;
      continue;
    }
    if (c === "\\" && inD) {
      buf += c;
      esc = true;
      continue;
    }
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "," && !inS && !inD) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = unquote(p.slice(0, eq).trim());
    const v = unquote(p.slice(eq + 1).trim());
    out[k] = v;
  }
  return out;
}

function parseArray(raw: string): string[] {
  const s = raw.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return [];
  const body = s.slice(1, -1);
  const parts: string[] = [];
  let buf = "";
  let inS = false;
  let inD = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "," && !inS && !inD) {
      if (buf.trim()) parts.push(unquote(buf.trim()));
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(unquote(buf.trim()));
  return parts;
}

/** True when every [ opened outside quotes is closed. */
function bracketsBalanced(text: string): boolean {
  let depth = 0;
  let inS = false;
  let inD = false;
  for (const c of text) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === "[") depth++;
      else if (c === "]") depth--;
    }
  }
  return depth <= 0;
}

function libraryFromFields(alias: string, fields: Record<string, string>): CatalogLibrary | null {
  let group = fields.group || "";
  let artifact = fields.name || "";
  const module = fields.module || "";
  if (module) {
    const i = module.indexOf(":");
    if (i < 0) return null;
    group = module.slice(0, i);
    artifact = module.slice(i + 1);
  }
  if (!group || !artifact) return null;
  const lib: CatalogLibrary = { alias, group, artifact };
  if (fields["version.ref"]) lib.versionRef = fields["version.ref"];
  else if (fields.version) lib.version = fields.version;
  return lib;
}

/**
 * Parse a Gradle version catalog TOML file (`libs.versions.toml` and the same shape).
 * Understands [versions], [libraries] (module= and group/name, version.ref), [plugins], [bundles],
 * dotted table headers like [libraries.foo], and inline tables.
 */
export function parseVersionCatalog(text: string): VersionCatalog {
  const versions: Record<string, string> = {};
  const libraries: Record<string, CatalogLibrary> = {};
  const plugins: Record<string, { id: string; version?: string; versionRef?: string }> = {};
  const bundles: Record<string, string[]> = {};

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let section: "versions" | "libraries" | "plugins" | "bundles" | "" = "";
  let subKey = "";
  let subFields: Record<string, string> = {};

  const flushSub = () => {
    if (!subKey) return;
    if (section === "libraries") {
      const lib = libraryFromFields(subKey, subFields);
      if (lib) libraries[subKey] = lib;
    } else if (section === "plugins" && subFields.id) {
      plugins[subKey] = {
        id: subFields.id,
        version: subFields.version,
        versionRef: subFields["version.ref"],
      };
    } else if (section === "versions" && subFields.strictly) {
      versions[subKey] = subFields.strictly;
    } else if (section === "versions" && (subFields.require || subFields.prefer)) {
      versions[subKey] = subFields.require || subFields.prefer;
    }
    subKey = "";
    subFields = {};
  };

  const headerRe = /^\[([^\]]+)\]\s*$/;

  for (let li = 0; li < lines.length; li++) {
    let line = stripComment(lines[li]).trim();
    // Multi-line arrays, e.g. a bundle spread over several lines:
    //   name = [
    //     "a",
    //     "b",
    //   ]
    if (/^[^=\[]+=\s*\[/.test(line) && !bracketsBalanced(line)) {
      while (li + 1 < lines.length && !bracketsBalanced(line)) {
        li++;
        line += " " + stripComment(lines[li]).trim();
      }
    }
    if (!line) continue;
    const h = headerRe.exec(line);
    if (h) {
      flushSub();
      const path = h[1].trim();
      const parts = path.split(".");
      const root = parts[0];
      if (root === "versions" || root === "libraries" || root === "plugins" || root === "bundles") {
        section = root;
        if (parts.length > 1) {
          subKey = parts.slice(1).join(".");
          subFields = {};
        } else {
          subKey = "";
        }
      } else {
        section = "";
        subKey = "";
      }
      continue;
    }
    if (!section) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = unquote(line.slice(0, eq).trim());
    const value = line.slice(eq + 1).trim();

    if (subKey) {
      subFields[key] = unquote(value);
      continue;
    }

    if (section === "versions") {
      if (value.startsWith("{")) {
        const f = parseInlineTable(value);
        versions[key] = f.strictly || f.require || f.prefer || "";
      } else {
        versions[key] = unquote(value);
      }
    } else if (section === "libraries") {
      if (value.startsWith("{")) {
        const lib = libraryFromFields(key, parseInlineTable(value));
        if (lib) libraries[key] = lib;
      } else {
        // Bare string is treated as module:version or module
        const u = unquote(value);
        const bits = u.split(":");
        if (bits.length >= 2) {
          libraries[key] = { alias: key, group: bits[0], artifact: bits[1], version: bits[2] };
        }
      }
    } else if (section === "plugins") {
      if (value.startsWith("{")) {
        const f = parseInlineTable(value);
        if (f.id) plugins[key] = { id: f.id, version: f.version, versionRef: f["version.ref"] };
      }
    } else if (section === "bundles") {
      bundles[key] = parseArray(value);
    }
  }
  flushSub();

  // Resolve version.ref against this file's own [versions] now, so that merging several
  // catalogs later can never make one catalog's alias pick up another catalog's version.
  for (const lib of Object.values(libraries)) {
    if (!lib.version && lib.versionRef && versions[lib.versionRef]) lib.version = versions[lib.versionRef];
  }
  for (const plugin of Object.values(plugins)) {
    if (!plugin.version && plugin.versionRef && versions[plugin.versionRef]) plugin.version = versions[plugin.versionRef];
  }

  return { versions, libraries, plugins, bundles };
}

/** Turn a Gradle accessor like `androidx.core.ktx` into possible catalog aliases. */
export function aliasCandidates(accessor: string): string[] {
  const a = accessor.replace(/^libs\./, "");
  const out = new Set<string>([a, a.replace(/\./g, "-"), a.replace(/\./g, "_")]);
  return [...out];
}

/**
 * Gradle turns `-`, `_` and `.` in catalog aliases into `.` for the generated accessor.
 * Compare in that normalized form, case-insensitively, so camelCase, dot and dash
 * variants of the same alias all match.
 */
export function normalizeAlias(alias: string): string {
  return alias.replace(/^libs\./, "").replace(/[-_.]+/g, ".").toLowerCase();
}

function findByAlias<T>(table: Record<string, T>, accessor: string): { key: string; value: T } | null {
  for (const c of aliasCandidates(accessor)) {
    if (Object.prototype.hasOwnProperty.call(table, c)) return { key: c, value: table[c] };
  }
  const want = normalizeAlias(accessor);
  for (const [k, v] of Object.entries(table)) {
    if (normalizeAlias(k) === want) return { key: k, value: v };
  }
  return null;
}

export type ResolvedCatalogLibrary = { group: string; artifact: string; version: string; alias: string };

function resolvedFrom(catalog: VersionCatalog, alias: string, lib: CatalogLibrary): ResolvedCatalogLibrary {
  let version = lib.version || "";
  if (!version && lib.versionRef) version = catalog.versions[lib.versionRef] || "";
  return { group: lib.group, artifact: lib.artifact, version, alias };
}

export function resolveCatalogLibrary(catalog: VersionCatalog, accessor: string): ResolvedCatalogLibrary | null {
  const path = accessor.replace(/^libs\./, "");
  const hit = findByAlias(catalog.libraries, path);
  if (!hit) return null;
  return resolvedFrom(catalog, hit.key, hit.value);
}

/** True when a `libs.*` accessor points at a bundle (`libs.bundles.x`). */
export function isBundleAccessor(accessor: string): boolean {
  return /^(?:libs\.)?bundles\./.test(accessor);
}

/**
 * Resolve `libs.bundles.<name>` to its libraries. Returns null when the bundle is unknown.
 * Bundle members that are not in [libraries] are reported in `missing`.
 */
export function resolveCatalogBundle(
  catalog: VersionCatalog,
  accessor: string,
): { bundle: string; libraries: ResolvedCatalogLibrary[]; missing: string[] } | null {
  const name = accessor.replace(/^libs\./, "").replace(/^bundles\./, "");
  if (!name) return null;
  const hit = findByAlias(catalog.bundles, name);
  if (!hit) return null;
  const libraries: ResolvedCatalogLibrary[] = [];
  const missing: string[] = [];
  for (const member of hit.value) {
    const lib = findByAlias(catalog.libraries, member);
    if (lib) libraries.push(resolvedFrom(catalog, lib.key, lib.value));
    else missing.push(member);
  }
  return { bundle: hit.key, libraries, missing };
}
