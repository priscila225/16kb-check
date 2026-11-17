import { childrenNamed, firstChild, type XmlElement } from "./xml";

export type ManifestComponent = {
  name: string;
  attrs: Record<string, string>;
  /** <property android:name android:value> children. */
  properties: Record<string, string>;
  /** <meta-data android:name android:value> children. */
  metaData: Record<string, string>;
  /** Intent filter actions. */
  actions: string[];
  file: string;
  /** 1-based line of the component tag in `file`, when known. */
  line?: number;
  /** 1-based line of each attribute name, when known. */
  attrLines?: Record<string, number>;
};

export type ManifestPermission = { name: string; maxSdk?: number; file: string; line?: number };

export type ManifestInfo = {
  /** The manifest's package attribute, when it has one. */
  package?: string;
  targetSdk?: number;
  minSdk?: number;
  /** android:compileSdkVersion (or platformBuildVersionCode) that the build tools stamp on <manifest>. */
  compileSdk?: number;
  permissions: ManifestPermission[];
  features: string[];
  application: Record<string, string>;
  appProperties: Record<string, string>;
  appMetaData: Record<string, string>;
  activities: ManifestComponent[];
  services: ManifestComponent[];
  receivers: ManifestComponent[];
  files: string[];
  /** File and line of the <application> tag that won the merge, when known. */
  applicationFile?: string;
  applicationLine?: number;
  applicationAttrLines?: Record<string, number>;
};

export function emptyManifest(): ManifestInfo {
  return {
    permissions: [],
    features: [],
    application: {},
    appProperties: {},
    appMetaData: {},
    activities: [],
    services: [],
    receivers: [],
    files: [],
  };
}

function toInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v.trim(), v.trim().startsWith("0x") ? 16 : 10);
  return Number.isFinite(n) ? n : undefined;
}

function nameValue(els: XmlElement[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of els) {
    const n = e.attrs["android:name"];
    if (!n || e.attrs["tools:node"] === "remove") continue;
    out[n] = e.attrs["android:value"] ?? e.attrs["android:resource"] ?? "";
  }
  return out;
}

function component(el: XmlElement, file: string): ManifestComponent {
  const actions: string[] = [];
  for (const f of childrenNamed(el, "intent-filter")) {
    for (const a of childrenNamed(f, "action")) if (a.attrs["android:name"]) actions.push(a.attrs["android:name"]);
  }
  return {
    name: el.attrs["android:name"] || "(unnamed)",
    attrs: el.attrs,
    properties: nameValue(childrenNamed(el, "property")),
    metaData: nameValue(childrenNamed(el, "meta-data")),
    actions,
    file,
    line: el.line,
    attrLines: el.attrLines,
  };
}

const PERMISSION_TAGS = ["uses-permission", "uses-permission-sdk-23", "uses-permission-sdk-m"];

/** Read one manifest document (text or binary) into the model. `file` is a display name, never sent anywhere. */
export function readManifest(doc: XmlElement, file: string): ManifestInfo & { removedPermissions: string[] } {
  const m = { ...emptyManifest(), removedPermissions: [] as string[] };
  m.files.push(file);
  const manifest = firstChild(doc, "manifest") ?? (doc.name === "manifest" ? doc : undefined);
  if (!manifest) return m;
  if (manifest.attrs["package"]) m.package = manifest.attrs["package"];
  m.compileSdk = toInt(manifest.attrs["android:compileSdkVersion"] ?? manifest.attrs["platformBuildVersionCode"]);
  const sdk = firstChild(manifest, "uses-sdk");
  if (sdk) {
    m.targetSdk = toInt(sdk.attrs["android:targetSdkVersion"]);
    m.minSdk = toInt(sdk.attrs["android:minSdkVersion"]);
  }
  for (const tag of PERMISSION_TAGS) {
    for (const p of childrenNamed(manifest, tag)) {
      const name = p.attrs["android:name"];
      if (!name) continue;
      if (p.attrs["tools:node"] === "remove") {
        m.removedPermissions.push(name);
        continue;
      }
      m.permissions.push({ name, maxSdk: toInt(p.attrs["android:maxSdkVersion"]), file, line: p.line });
    }
  }
  for (const f of childrenNamed(manifest, "uses-feature")) {
    // Optional features (required="false") don't make the app TV-only or watch-only.
    if (f.attrs["android:name"] && !isFalse(f.attrs["android:required"])) m.features.push(f.attrs["android:name"]);
  }
  const app = firstChild(manifest, "application");
  if (app) {
    m.application = { ...app.attrs };
    m.applicationFile = file;
    m.applicationLine = app.line;
    m.applicationAttrLines = app.attrLines;
    m.appProperties = nameValue(childrenNamed(app, "property"));
    m.appMetaData = nameValue(childrenNamed(app, "meta-data"));
    for (const a of childrenNamed(app, "activity")) if (a.attrs["tools:node"] !== "remove") m.activities.push(component(a, file));
    for (const s of childrenNamed(app, "service")) if (s.attrs["tools:node"] !== "remove") m.services.push(component(s, file));
    for (const r of childrenNamed(app, "receiver")) if (r.attrs["tools:node"] !== "remove") m.receivers.push(component(r, file));
  }
  return m;
}

/**
 * Combine source manifests the way the manifest merger roughly would: the app module wins for
 * <application> attributes and uses-sdk, lists are unioned, and tools:node="remove" drops permissions.
 */
export function mergeManifests(parts: (ManifestInfo & { removedPermissions?: string[] })[]): ManifestInfo {
  const out = emptyManifest();
  const removed = new Set<string>();
  for (const p of parts) for (const r of p.removedPermissions ?? []) removed.add(r);
  const seenPerm = new Set<string>();
  // Later parts are libraries; the first part (the app module) takes priority for single values.
  for (const p of [...parts].reverse()) {
    if (p.targetSdk !== undefined) out.targetSdk = p.targetSdk;
    if (p.minSdk !== undefined) out.minSdk = p.minSdk;
    if (p.compileSdk !== undefined) out.compileSdk = p.compileSdk;
    Object.assign(out.application, p.application);
    if (p.applicationFile || p.applicationLine !== undefined || p.applicationAttrLines) {
      out.applicationFile = p.applicationFile ?? p.files[0];
      out.applicationLine = p.applicationLine;
      out.applicationAttrLines = p.applicationAttrLines;
    }
    Object.assign(out.appProperties, p.appProperties);
    Object.assign(out.appMetaData, p.appMetaData);
  }
  for (const p of parts) {
    for (const perm of p.permissions) {
      if (removed.has(perm.name) || seenPerm.has(perm.name)) continue;
      seenPerm.add(perm.name);
      out.permissions.push(perm);
    }
    out.features.push(...p.features.filter((f) => !out.features.includes(f)));
    out.activities.push(...p.activities);
    out.services.push(...p.services);
    out.receivers.push(...p.receivers);
    out.files.push(...p.files);
  }
  return out;
}

/** Resolve a component name like ".Foo" or "Foo" against a package. Leaves it as is when there's no package. */
export function qualifyName(name: string, pkg: string | undefined): string {
  if (!pkg) return name;
  if (name.startsWith(".")) return pkg + name;
  if (!name.includes(".")) return `${pkg}.${name}`;
  return name;
}

/**
 * Does a component name from a merged or APK manifest (fully qualified) match one from a source
 * manifest? Unresolved relative source names (".Foo") match on the trailing class name.
 */
export function sameComponent(full: string, source: string): boolean {
  if (full === source) return true;
  if (source.startsWith(".")) return full.endsWith(source);
  return false;
}

export function hasPermission(m: ManifestInfo, name: string): ManifestPermission | undefined {
  const full = name.includes(".") ? name : `android.permission.${name}`;
  return m.permissions.find((p) => p.name === full);
}

export function isTrue(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "true";
}

export function isFalse(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "false";
}
