import type { DeclaredDep, VersionCatalog } from "./types";
import { isBundleAccessor, resolveCatalogBundle, resolveCatalogLibrary } from "./toml";

/**
 * True if this configuration only feeds tests: test*, androidTest*, testFixtures*,
 * and variant or processor forms like debugTestImplementation, kaptTest, kspAndroidTest.
 */
export function isTestConfiguration(name: string): boolean {
  return /^test(?:[A-Z]|$)/.test(name) || /^androidTest/.test(name) || /^testFixtures/.test(name) || /Test(?:[A-Z]|$)/.test(name) || /TestFixtures/.test(name);
}

/** Annotation processor configurations: kapt, ksp, annotationProcessor and their variant forms. */
export function isProcessorConfiguration(name: string): boolean {
  return /^(?:kapt|ksp|annotationProcessor)/i.test(name) || /(?:Kapt|Ksp|AnnotationProcessor)$/.test(name);
}

/**
 * Well-known test frameworks. They never ship in a release build, so they are treated as
 * test-only even when a module declares them with a non-test configuration
 * (for example a shared test-utils module, or debugImplementation(ui-test-manifest)).
 */
export function isTestFrameworkCoordinate(group: string, artifact: string): boolean {
  const g = group.toLowerCase();
  const a = artifact.toLowerCase();
  if (g === "junit" && a === "junit") return true;
  if (g === "org.junit" || g.startsWith("org.junit.")) return true;
  if (g === "org.mockito" || g.startsWith("org.mockito.")) return true;
  if (g === "io.mockk") return true;
  if (g === "org.robolectric") return true;
  if (g === "org.hamcrest") return true;
  if (g === "com.google.truth" || g.startsWith("com.google.truth.")) return true;
  if (g === "app.cash.turbine") return true;
  if (g === "androidx.test" || g.startsWith("androidx.test.")) return true;
  if (g === "androidx.arch.core" && a === "core-testing") return true;
  if (g === "androidx.compose.ui" && a.startsWith("ui-test")) return true;
  if (g === "androidx.fragment" && a === "fragment-testing") return true;
  if (g === "androidx.room" && a === "room-testing") return true;
  if (g === "androidx.work" && a === "work-testing") return true;
  if (g === "androidx.navigation" && a === "navigation-testing") return true;
  if (g === "org.jetbrains.kotlinx" && a.startsWith("kotlinx-coroutines-test")) return true;
  if (g === "org.jetbrains.kotlin" && (a === "kotlin-test" || a.startsWith("kotlin-test-"))) return true;
  if (g === "com.squareup.okhttp3" && (a === "mockwebserver" || a === "mockwebserver3")) return true;
  if (g === "com.google.dagger" && a === "hilt-android-testing") return true;
  if (g === "androidx.benchmark") return true;
  if (g === "io.kotest" || g.startsWith("io.kotest.")) return true;
  if (g === "org.assertj") return true;
  if (g === "app.cash.paparazzi") return true;
  if (g === "io.github.takahirom.roborazzi") return true;
  if (g === "org.spekframework" || g.startsWith("org.spekframework.")) return true;
  // Generic test artifacts: hilt-android-testing, room-testing, ui-test-junit4, benchmark-macro-junit4, ...
  if (/(?:^|-)(?:testing|test|tests|testutils|test-utils|junit|junit4|junit5)(?:-|$)/.test(a)) return true;
  return false;
}

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "\n");
}

function stripLineComments(text: string): string {
  // Keep strings intact when dropping // comments
  return text
    .split(/\r?\n/)
    .map((line) => {
      let inS = false,
        inD = false,
        inT = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        const n = line[i + 1];
        if (!inS && !inD && !inT && c === "/" && n === "/") return line.slice(0, i);
        if (c === "'" && !inD && !inT) inS = !inS;
        else if (c === '"' && !inS && !inT) inD = !inD;
        else if (c === "`" && !inS && !inD) inT = !inT;
      }
      return line;
    })
    .join("\n");
}

/** Collect simple version assignments from ext {}, extra[], val x =, def x =. */
export function collectVariables(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const assign = (name: string, value: string) => {
    const v = unquote(value.trim());
    if (v && !/[${}]/.test(v)) vars[name] = v;
  };

  // ext.foo = '1.2.3' / extra["foo"] = "1.2.3" / extra["foo"] = '1.2.3'
  const extDot = /(?:ext|project\.ext)\.([A-Za-z_]\w*)\s*=\s*(["'][^"']+["']|\d+\.\d[\w.\-]*)/g;
  for (const m of text.matchAll(extDot)) assign(m[1], m[2]);

  const extraBracket = /extra\s*\[\s*["']([^"']+)["']\s*]\s*=\s*(["'][^"']+["'])/g;
  for (const m of text.matchAll(extraBracket)) assign(m[1], m[2]);

  // val foo = "1.2.3" / def foo = '1.2.3' / val foo by extra("1.2.3")
  const valDef = /(?:val|def|const val)\s+([A-Za-z_]\w*)\s*(?:by\s+extra\s*\()?=\s*(?:extra\s*\()?["']([^"']+)["']/g;
  for (const m of text.matchAll(valDef)) assign(m[1], m[2]);

  // Inside ext { foo = '1' } / ext { foo = "1" }
  const extBlock = /(?:^|\s)ext\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(extBlock)) {
    const inner = m[1];
    const pair = /([A-Za-z_]\w*)\s*=\s*(["'][^"']+["']|\d+\.\d[\w.\-]*)/g;
    for (const p of inner.matchAll(pair)) assign(p[1], p[2]);
  }
  return vars;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function substituteVars(value: string, vars: Record<string, string>): { value: string; usedVar: boolean } {
  let usedVar = false;
  let out = value;
  // ${foo} or $foo
  out = out.replace(/\$\{([A-Za-z_]\w*)\}/g, (_, n) => {
    if (vars[n] != null) {
      usedVar = true;
      return vars[n];
    }
    return _;
  });
  out = out.replace(/\$([A-Za-z_]\w*)/g, (all, n) => {
    if (vars[n] != null) {
      usedVar = true;
      return vars[n];
    }
    return all;
  });
  return { value: out, usedVar };
}

const COORD_RE = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([^:{}$\s]+))?$/;

export function parseCoordinate(raw: string): { group: string; artifact: string; version: string } | null {
  const s = raw.trim();
  const m = COORD_RE.exec(s);
  if (!m) {
    // group:artifact with empty version after trailing colon
    const m2 = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):$/.exec(s);
    if (m2) return { group: m2[1], artifact: m2[2], version: "" };
    return null;
  }
  return { group: m[1], artifact: m[2], version: m[3] && m[3] !== "+" ? m[3] : "" };
}

type PushOpts = {
  file: string;
  configuration: string;
  catalog?: VersionCatalog;
  vars: Record<string, string>;
  boms: DeclaredDep[];
};

function pushDep(deps: DeclaredDep[], opts: PushOpts, raw: { group: string; artifact: string; version: string; catalogAlias?: string; versionSource?: DeclaredDep["versionSource"]; isBom?: boolean }): void {
  const { group, artifact } = raw;
  if (!group || !artifact) return;
  let version = raw.version || "";
  let versionSource: DeclaredDep["versionSource"] = raw.versionSource || (version ? "declared" : "missing");
  if (version) {
    const sub = substituteVars(version, opts.vars);
    if (sub.usedVar) {
      version = sub.value;
      versionSource = /\$/.test(raw.version) && opts.vars[raw.version.replace(/^\$\{?|\}$/g, "")] ? "variable" : sub.usedVar ? "variable" : "declared";
      // If substitution didn't finish (still has $), mark missing
      if (/\$/.test(version)) {
        version = "";
        versionSource = "missing";
      }
    }
  }
  let bom: string | undefined;
  if (!version) {
    const matchBom = opts.boms.find((b) => b.group === group) || opts.boms.find((b) => relatedBom(b, group, artifact));
    if (matchBom) {
      bom = `${matchBom.group}:${matchBom.artifact}${matchBom.version ? ":" + matchBom.version : ""}`;
      versionSource = "bom";
    }
  }
  const dep: DeclaredDep = {
    group,
    artifact,
    version,
    versionSource,
    configuration: opts.configuration,
    catalogAlias: raw.catalogAlias,
    bom,
    sourceFile: opts.file,
  };
  if (raw.isBom) {
    opts.boms.push(dep);
    return;
  }
  deps.push(dep);
}

function relatedBom(bom: DeclaredDep, group: string, artifact: string): boolean {
  if (bom.group === group) return true;
  // Firebase BOM covers com.google.firebase:*
  if (bom.artifact === "firebase-bom" && group === "com.google.firebase") return true;
  // Compose BOM covers androidx.compose.*
  if (bom.artifact === "compose-bom" && (group.startsWith("androidx.compose") || artifact.startsWith("compose-"))) return true;
  return false;
}

function lookAroundCall(text: string, index: number): { config: string; call: string } | null {
  // Walk left to find the configuration identifier
  let i = index;
  while (i > 0 && /[\s(]/.test(text[i - 1])) i--;
  const left = text.slice(Math.max(0, i - 80), i);
  const cm = /([A-Za-z][\w]*)$/.exec(left);
  if (!cm) return null;
  const config = cm[1];
  return { config, call: "" };
}

/**
 * Parse a build.gradle or build.gradle.kts (and similarly named files) for dependency declarations.
 * Best-effort: string coordinates, group:/name:/version: maps, platform/BOM, libs.* catalog aliases,
 * and simple ${var} / $var substitution.
 */
export function parseGradle(
  text: string,
  file: string,
  catalog?: VersionCatalog,
  extraVars: Record<string, string> = {},
): {
  dependencies: DeclaredDep[];
  boms: DeclaredDep[];
  testDependencies: DeclaredDep[];
  /** kapt / ksp / annotationProcessor dependencies: run at compile time, never packaged. */
  processorDependencies: DeclaredDep[];
  issues: string[];
} {
  const cleaned = stripLineComments(stripBlockComments(text));
  const vars = { ...collectVariables(cleaned), ...extraVars };
  const mainDeps: DeclaredDep[] = [];
  const testDeps: DeclaredDep[] = [];
  const processorDeps: DeclaredDep[] = [];
  const boms: DeclaredDep[] = [];
  const testBoms: DeclaredDep[] = [];
  const issues: string[] = [];

  const isKts = /\.kts$/i.test(file) || /implementation\(/.test(cleaned);

  // Walk dependency-like function calls. We scan for configuration names then parse the argument.
  // Also matches the Kotlin DSL string form: "testImplementation"("...")
  const ident = /(?:^|[\s,{;"'])((?:[A-Za-z][\w]*)?(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly(?:Api)?|[Rr]untimeOnly|[Cc]ompile|[Pp]rovided|[Kk]apt|[Kk]sp|[Aa]nnotationProcessor)(?:AndroidTest|Test|Debug|Release)?)["']?\s*(\(|(?:\s+(?=["'lpg])))/g;

  let m: RegExpExecArray | null;
  while ((m = ident.exec(cleaned))) {
    const configuration = m[1];
    const isTest = isTestConfiguration(configuration);
    const deps = isTest ? testDeps : isProcessorConfiguration(configuration) ? processorDeps : mainDeps;
    const start = m.index + m[0].length - (m[2].startsWith("(") ? 1 : 0);
    // Grab a window of the argument
    const window = readArg(cleaned, start);
    if (!window) continue;
    const arg = window.text.trim();
    if (!arg) continue;

    const opts: PushOpts = { file, configuration, catalog, vars, boms: isTest ? testBoms : boms };
    const isBom = /\b(?:enforcedP|p)latform\s*\(/.test(arg);

    // project( / files( / fileTree( / name: 'local' ext: 'aar'
    if (/\bproject\s*\(/.test(arg) || /\bfiles?\s*\(/.test(arg) || /\bfileTree\s*\(/.test(arg)) continue;
    if (/\bext\s*[:=]\s*['"]aar['"]/.test(arg) && !/:/.test(arg.replace(/ext\s*[:=].*/, ""))) continue;

    // Catalog: libs.foo.bar or libs.foo.bar.get() or libs.foo.asProvider()
    // libs.foo.bar, libs["foo-bar"], libs.bundles["foo-bar"], optionally followed by .get()
    const catRaw = arg.match(/\blibs((?:\.[A-Za-z][\w]*)*)(?:\[\s*["']([^"']+)["']\s*\])?(?:\s*\.get\(\))?/);
    const cat =
      catRaw && (catRaw[1] || catRaw[2])
        ? [catRaw[0], [catRaw[1].replace(/^\./, "").replace(/\.get$/, ""), catRaw[2] || ""].filter(Boolean).join("."), ""]
        : null;
    if (cat && catalog) {
      const accessor = (cat[1] || cat[2] || "").replace(/\.+$/, "");
      if (isBundleAccessor(accessor)) {
        const bundle = resolveCatalogBundle(catalog, accessor);
        if (bundle) {
          for (const lib of bundle.libraries) {
            pushDep(deps, opts, {
              group: lib.group,
              artifact: lib.artifact,
              version: lib.version,
              catalogAlias: lib.alias,
              versionSource: lib.version ? "catalog" : "missing",
            });
          }
          for (const missing of bundle.missing) {
            issues.push(`Bundle libs.${accessor} lists "${missing}", which is not in [libraries] (${file})`);
          }
          continue;
        }
        issues.push(`Could not resolve catalog bundle libs.${accessor} in ${file}`);
        pushDep(deps, opts, { group: "libs", artifact: accessor, version: "", catalogAlias: accessor, versionSource: "missing" });
        continue;
      }
      const resolved = resolveCatalogLibrary(catalog, accessor);
      if (resolved) {
        pushDep(deps, opts, {
          group: resolved.group,
          artifact: resolved.artifact,
          version: resolved.version,
          catalogAlias: resolved.alias,
          versionSource: resolved.version ? "catalog" : "missing",
          isBom,
        });
        continue;
      }
      issues.push(`Could not resolve catalog alias libs.${accessor} in ${file}`);
      pushDep(deps, opts, { group: "libs", artifact: accessor, version: "", catalogAlias: accessor, versionSource: "missing", isBom: false });
      continue;
    }
    if (cat && !catalog) {
      const accessor = cat[1] || cat[2] || "";
      issues.push(`libs.${accessor} needs the version catalog (libs.versions.toml) to resolve`);
      pushDep(deps, opts, { group: "libs", artifact: accessor, version: "", catalogAlias: accessor, versionSource: "missing" });
      continue;
    }

    // Map form: group: 'g', name: 'n', version: 'v'  OR group = "g", name = "n", version = "v"
    const map = parseMapForm(arg, vars);
    if (map) {
      pushDep(deps, opts, { ...map, isBom });
      continue;
    }

    // String coordinate in quotes, possibly nested in platform("...")
    const str = arg.match(/["']([^"']+)["']/);
    if (str) {
      const sub = substituteVars(str[1], vars);
      const coord = parseCoordinate(sub.value);
      if (coord) {
        // If substitution left $ or the original had a var, mark source
        const versionSource: DeclaredDep["versionSource"] = sub.usedVar && coord.version ? "variable" : coord.version ? "declared" : "missing";
        if (!/\$/.test(coord.group + coord.artifact)) {
          pushDep(deps, opts, { ...coord, version: /\$/.test(coord.version) ? "" : coord.version, versionSource: /\$/.test(coord.version) ? "missing" : versionSource, isBom });
          continue;
        }
      }
    }
  }

  void lookAroundCall;
  void isKts;
  // Well-known test frameworks declared with a non-test configuration are still test-only.
  const dependencies: DeclaredDep[] = [];
  for (const d of mainDeps) {
    if (isTestFrameworkCoordinate(d.group, d.artifact)) testDeps.push({ ...d, testOnly: true });
    else dependencies.push(d);
  }
  for (const d of testDeps) d.testOnly = true;
  return { dependencies, boms, testDependencies: testDeps, processorDependencies: processorDeps, issues };
}

function parseMapForm(arg: string, vars: Record<string, string>): { group: string; artifact: string; version: string; versionSource: DeclaredDep["versionSource"] } | null {
  const group = pickMap(arg, "group");
  const name = pickMap(arg, "name");
  if (!group || !name) return null;
  const verRaw = pickMap(arg, "version") || "";
  const gs = substituteVars(group, vars);
  const ns = substituteVars(name, vars);
  const vs = substituteVars(verRaw, vars);
  return {
    group: gs.value,
    artifact: ns.value,
    version: /\$/.test(vs.value) ? "" : vs.value,
    versionSource: vs.usedVar && vs.value && !/\$/.test(vs.value) ? "variable" : vs.value && !/\$/.test(vs.value) ? "declared" : "missing",
  };
}

function pickMap(arg: string, key: string): string | null {
  const re = new RegExp(`(?:^|[,\\s(])${key}\\s*[:=]\\s*(?:["']([^"']*)["']|([A-Za-z_$][\\w.]*))`);
  const m = re.exec(arg);
  if (!m) return null;
  return m[1] != null ? m[1] : m[2] ? `$${m[2]}` : null;
}

/** Read a call argument starting at `(` or at the first token after a Groovy space-call. */
function readArg(text: string, start: number): { text: string } | null {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return null;
  if (text[i] === "(") {
    let depth = 0;
    let inS = false,
      inD = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      else if (!inS && !inD) {
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) return { text: text.slice(i + 1, j) };
        }
      }
      if (j - i > 800) break;
    }
    return { text: text.slice(i + 1, Math.min(text.length, i + 400)) };
  }
  // Groovy space-call: implementation 'foo:bar:1'
  const slice = text.slice(i, i + 400);
  const eol = slice.search(/\n/);
  const line = eol >= 0 ? slice.slice(0, eol) : slice;
  // Stop at a trailing comment already stripped; cut at a comma that's not in quotes only if next ident looks like another config — keep the whole line for simple cases
  return { text: line.replace(/,?\s*$/, "") };
}

/** Merge catalogs + gradle files' ext vars so later files can use earlier versions. */
export function mergeVars(...maps: Record<string, string>[]): Record<string, string> {
  return Object.assign({}, ...maps);
}
