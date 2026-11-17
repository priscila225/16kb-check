/**
 * Resolve targetSdk from Gradle files on this machine. Never guesses: if the value comes from a
 * place we can't read, the result says so and the caller reports "couldn't resolve".
 */
export type TargetSdkSource = { value?: number; from?: string; expr?: string };

export type TextFile = { name: string; text: string };

export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
}

export type SdkKind = "target" | "min" | "compile";

const SDK_LINE: Record<SdkKind, RegExp> = {
  target: /\btargetSdk(?:Version)?\b(?!Preview)\s*(?:=|\(|:)?\s*([^\n;}]+)/g,
  min: /\bminSdk(?:Version)?\b(?!Preview)\s*(?:=|\(|:)?\s*([^\n;}]+)/g,
  // compileSdk = 36, compileSdkVersion 36, compileSdkVersion("android-36"), compileSdk { version = release(36) }
  compile: /\bcompileSdk(?:Version)?\b(?!Preview|Extension|Minor)\s*(?:=|\(|:|\{\s*version\s*=)?\s*([^\n;}]+)/g,
};

/** Expression strings for targetSdk, minSdk or compileSdk declared in a build file, in source order. */
export function sdkExpressions(text: string, kind: SdkKind): string[] {
  const out: string[] = [];
  for (const m of stripComments(text).matchAll(SDK_LINE[kind])) {
    const expr = m[1].trim();
    if (!expr || expr.startsWith("{")) continue;
    out.push(expr);
  }
  return out;
}

/** Expression strings for targetSdk declared in a build file, in source order. */
export function targetSdkExpressions(text: string): string[] {
  return sdkExpressions(text, "target");
}

function count(s: string, c: string): number {
  return s.split(c).length - 1;
}

function dropUnbalanced(e: string): string {
  let out = e.trim();
  while (out.endsWith(")") && count(out, ")") > count(out, "(")) out = out.slice(0, -1).trim();
  return out;
}

function cleanExpr(expr: string): string {
  let e = dropUnbalanced(expr.replace(/,\s*$/, ""));
  for (;;) {
    const before = e;
    e = e.replace(/^(?:Integer\.parseInt|Integer\.valueOf|java\.lang\.Integer\.parseInt)\((.*)\)$/, "$1").trim();
    e = e.replace(/\.(?:get|toInt|toInteger|toString|orNull|asInt)\(\)$/, "").replace(/\.(?:get|toInt|toInteger)$/, "");
    e = e.replace(/\s+as\s+(?:int|Integer|String|Int)$/, "").trim();
    if (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1).trim();
    e = e.replace(/^["']|["']$/g, "").trim();
    e = e.replace(/^release\((.*)\)$/, "$1").replace(/^android-(\d{1,3})$/, "$1").trim();
    if (e === before) return e;
  }
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[-_.]/g, ".");
}

export type ResolveContext = {
  catalogVersions: Record<string, string>;
  gradleProperties: Record<string, string>;
  /** Root build files and build logic (buildSrc, build-logic) Kotlin/Groovy files. */
  sharedFiles: TextFile[];
};

function lookupName(name: string, ctx: ResolveContext): { value: number; from: string } | undefined {
  const prop = ctx.gradleProperties[name];
  if (prop !== undefined && /^\d+$/.test(prop.trim())) return { value: Number(prop.trim()), from: "gradle.properties" };
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|[\\s,{(])(?:const\\s+)?(?:val|var|def|int)?\\s*${esc}\\s*(?::\\s*Int\\s*)?[=:]\\s*(\\d{2})\\b`, "m"),
    new RegExp(`\\[\\s*["']${esc}["']\\s*\\]\\s*=\\s*(\\d{2})\\b`),
    new RegExp(`set\\(\\s*["']${esc}["']\\s*,\\s*(\\d{2})\\s*\\)`),
    new RegExp(`\\b${esc}\\s+by\\s+extra\\(\\s*(\\d{2})\\s*\\)`),
  ];
  for (const f of ctx.sharedFiles) {
    const code = stripComments(f.text);
    for (const re of patterns) {
      const m = re.exec(code);
      if (m) return { value: Number(m[1]), from: f.name };
    }
  }
  return undefined;
}

export function evaluateTargetExpr(expr: string, ctx: ResolveContext): { value: number; from?: string } | undefined {
  const e = cleanExpr(expr);
  if (/^\d{1,3}$/.test(e)) return { value: Number(e) };
  const cat = /^libs\.versions\.([\w.]+)$/.exec(e);
  if (cat) {
    const want = normKey(cat[1]);
    for (const [k, v] of Object.entries(ctx.catalogVersions)) {
      if (normKey(k) === want && /^\d{1,3}$/.test(v.trim())) return { value: Number(v.trim()), from: "version catalog" };
    }
    return undefined;
  }
  const named =
    /^(?:rootProject\.|project\.)?(?:ext|extra|extensions\.extraProperties)\s*\[\s*["']([\w.-]+)["']\s*\]$/.exec(e) ||
    /^(?:rootProject\.|project\.)?(?:ext|extra)\.([\w]+)$/.exec(e) ||
    /^(?:project\.|rootProject\.)?(?:findProperty|property|providers\.gradleProperty)\(\s*["']([\w.-]+)["']\s*\)$/.exec(e) ||
    /^(?:project\.|rootProject\.)?properties\s*\[\s*["']([\w.-]+)["']\s*\]$/.exec(e) ||
    /^(?:[A-Z]\w*\.)*([a-zA-Z_]\w*)$/.exec(e);
  if (named) return lookupName(named[1], ctx);
  return undefined;
}

/**
 * Resolve the app module's targetSdk. Order: the module's own build file, then build logic
 * (convention plugins) when exactly one literal value is set there.
 */
export function resolveTargetSdk(moduleBuild: TextFile | undefined, ctx: ResolveContext, buildLogic: TextFile[]): TargetSdkSource {
  return resolveSdk("target", moduleBuild, ctx, buildLogic);
}

/** Same rules as resolveTargetSdk, for targetSdk, minSdk or compileSdk. */
export function resolveSdk(kind: SdkKind, moduleBuild: TextFile | undefined, ctx: ResolveContext, buildLogic: TextFile[]): TargetSdkSource {
  if (moduleBuild) {
    const exprs = sdkExpressions(moduleBuild.text, kind);
    for (const expr of exprs) {
      const r = evaluateTargetExpr(expr, ctx);
      if (r) return { value: r.value, from: r.from ? `${moduleBuild.name} via ${r.from}` : moduleBuild.name, expr };
    }
    if (exprs.length) return { from: moduleBuild.name, expr: exprs[0] };
  }
  const literal = new Map<number, string>();
  for (const f of buildLogic) {
    for (const expr of sdkExpressions(f.text, kind)) {
      const r = evaluateTargetExpr(expr, ctx);
      if (r) literal.set(r.value, f.name);
    }
  }
  if (literal.size === 1) {
    const [[value, from]] = [...literal.entries()];
    return { value, from };
  }
  return {};
}

export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) continue;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(t);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
