import type { CheckReport, DeclaredDep } from "../sixteenkb/check/types";
import type { AgpCheck } from "../sixteenkb/check/agp";
import { countStatuses, rowsFromReport } from "../sixteenkb/report";
import type { BinaryScan } from "./binary";
import { hasPermission, isFalse, isTrue, sameComponent, type ManifestComponent, type ManifestInfo } from "./manifest";
import type { TextFile } from "./targetsdk";
import { PLAY_MIN_TARGET, RULES, fmtDate, type CheckId, type FormFactor } from "./rules";
import { fmtMonth, type PlayRulesChecks, type ResolvedPlayRules } from "./play-rules";

export type CheckStatus = "pass" | "warn" | "fail" | "skip" | "info";

/** Numeric SDK breakdown for the 16kb check. Counts only, never coordinates. */
export type SdkCounts = {
  checked: number;
  ready: number;
  notReady: number;
  partial: number;
  unknown: number;
  checking: number;
  skippedPrivate: number;
  testOnlyIgnored: number;
  buildToolingIgnored: number;
};

/** A file location for text output, JSON, and GitHub workflow annotations. */
export type CheckLocation = {
  file: string;
  line?: number;
  message: string;
};

export type CheckResult = {
  id: CheckId;
  status: CheckStatus;
  title: string;
  detail: string;
  /** ISO date of the relevant Play deadline, when there is one. */
  deadline: string | null;
  source: string;
  link: string;
  items: string[];
  /** Extra lines shown only with --verbose (side notes, ready SDK rows). */
  verboseItems?: string[];
  /** File/line locations when known. Included in JSON and GitHub annotations. */
  locations?: CheckLocation[];
  /** Set on the 16kb check after a catalog lookup. */
  sdk?: SdkCounts;
};

export type SdkLookup =
  | { status: "ok"; report: CheckReport; skippedPrivate: number; testOnlyIgnored: number; buildToolingIgnored: number }
  | { status: "offline" }
  | { status: "error"; message: string }
  | { status: "none" };

export type CheckContext = {
  target: {
    value?: number;
    from?: string;
    expr?: string;
    /** The level other checks evaluate against: the real one, or Play's minimum when unknown. */
    effective: number;
    assumed: boolean;
    formFactor: FormFactor;
    required: number;
  };
  manifest?: ManifestInfo;
  manifestKind: "apk" | "merged" | "source" | "none";
  /** The project's own source manifests, to tell app components from ones dependencies add. */
  ownManifest?: ManifestInfo;
  dependencies?: DeclaredDep[];
  billingMentionedIn?: string;
  edgeToEdgeOptOuts?: { file: string; value: string }[];
  sources?: () => TextFile[];
  binary?: BinaryScan;
  sdk: SdkLookup;
  agp?: AgpCheck;
  playRules: ResolvedPlayRules;
};

function play(ctx: CheckContext): PlayRulesChecks {
  return ctx.playRules.rules.checks;
}

type ResultExtra = Pick<CheckResult, "verboseItems" | "locations">;

function result(
  id: CheckId,
  status: CheckStatus,
  detail: string,
  items: string[] = [],
  deadline: string | null = null,
  extra: ResultExtra = {},
): CheckResult {
  const r = RULES[id];
  return { id, status, title: r.title, detail, deadline, source: r.source, link: r.link, items, ...extra };
}

function shortClass(name: string): string {
  const trimmed = name.replace(/^\./, "");
  const i = trimmed.lastIndexOf(".");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed || name;
}

function at(file: string, line?: number): string {
  return line !== undefined ? `${file}:${line}` : file;
}

/** Earliest line among the attributes that triggered a finding, else the tag line. */
function triggerLine(attrLines: Record<string, number> | undefined, names: string[], fallback?: number): number | undefined {
  const lines = names.map((n) => attrLines?.[n]).filter((n): n is number => n !== undefined);
  return lines.length ? Math.min(...lines) : fallback;
}

const RANK: Record<CheckStatus, number> = { skip: 0, info: 1, pass: 2, warn: 3, fail: 4 };

function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>((a, b) => (RANK[b] > RANK[a] ? b : a), "skip");
}

function short(name: string): string {
  return name.replace(/^android\.permission\./, "");
}

function cap(list: string[], n = 8): string[] {
  return list.length > n ? [...list.slice(0, n), `…and ${list.length - n} more`] : list;
}

function assumedNote(ctx: CheckContext): string {
  return ctx.target.assumed ? ` (targetSdk unknown, assumed ${ctx.target.effective})` : "";
}

const NO_MANIFEST = "no AndroidManifest.xml found (pass --apk, or run in the project folder)";

export function detectFormFactor(m?: ManifestInfo): FormFactor {
  const f = new Set(m?.features ?? []);
  if (f.has("android.hardware.type.watch")) return "wear";
  if (f.has("android.hardware.type.automotive")) return "automotive";
  if (f.has("android.software.leanback")) return "tv";
  return "phone";
}

// A. Target API level
export function checkTargetApi(ctx: CheckContext): CheckResult {
  const { value, required, formFactor, from, expr } = ctx.target;
  const kind = formFactor === "phone" ? "" : ` for ${formFactor === "tv" ? "TV" : formFactor === "wear" ? "Wear OS" : "Automotive"} apps`;
  if (value === undefined) {
    const where = expr ? ` (set as \`${expr}\` in ${from})` : "";
    return result("target-api", "skip", `couldn't resolve targetSdk${where}. Pass --target-sdk <n>, build once, or use --apk`, [], play(ctx)["target-api"].since);
  }
  const announced = play(ctx)["target-api"].next;
  const next =
    announced && value < announced.targetSdk
      ? [`Next: API ${announced.targetSdk} for new apps and updates from ${fmtMonth(announced.month)}. Google hasn't named a day.`]
      : !announced && value < 37
        ? ["Next: API 37. Google hasn't announced that date yet."]
        : [];
  if (value >= required) {
    return result(
      "target-api",
      "pass",
      `targets ${value}. Play needs ${required}${kind} for new apps and updates since ${fmtDate(play(ctx)["target-api"].since)}`,
      [],
      play(ctx)["target-api"].since,
      next.length ? { verboseItems: next } : {},
    );
  }
  const items: string[] = [];
  const hiddenBelow = play(ctx)["target-api"].existingAppsHiddenBelow;
  if (formFactor === "phone" && value < hiddenBelow) items.push(`Below API ${hiddenBelow}, existing apps stop showing to new users on newer Android versions.`);
  items.push(`The extension ran until ${fmtDate(play(ctx)["target-api"].extensionEnded)}, so the rule is fully in force.`);
  return result(
    "target-api",
    "fail",
    `targets ${value}, Play needs ${required}${kind} for new apps and updates since ${fmtDate(play(ctx)["target-api"].since)}`,
    items,
    play(ctx)["target-api"].since,
  );
}

const BLOCKING = new Set(["not-yet", "partial", "update-needed"]);

function sdkCounts(sdk: SdkLookup): SdkCounts | undefined {
  if (sdk.status !== "ok") return undefined;
  const rows = rowsFromReport(sdk.report).filter((r) => !r.plugin);
  const counts = countStatuses(rows);
  return {
    checked: rows.length,
    ready: counts.ready,
    notReady: counts["not ready"],
    partial: counts.partial,
    unknown: counts.unknown,
    checking: counts.checking,
    skippedPrivate: sdk.skippedPrivate,
    testOnlyIgnored: sdk.testOnlyIgnored,
    buildToolingIgnored: sdk.buildToolingIgnored,
  };
}

function withSdk(r: CheckResult, ctx: CheckContext): CheckResult {
  const sdk = sdkCounts(ctx.sdk);
  return sdk ? { ...r, sdk } : r;
}

// B. 16 KB page size
export function check16kb(ctx: CheckContext): CheckResult {
  const parts: { status: CheckStatus; text: string }[] = [];
  const items: string[] = [];
  const when = `Play blocks updates that aren't ready from ${fmtDate(play(ctx)["16kb"].blockFrom)}`;
  const say = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (ctx.binary) {
    const libs = ctx.binary.nativeLibs;
    const bad = libs.filter((l) => !l.error && !l.elfAligned);
    const zipBad = libs.filter((l) => l.zipMisaligned);
    const unreadable = libs.filter((l) => l.error);
    if (!libs.length) parts.push({ status: "pass", text: `no 64-bit native libraries in the ${ctx.binary.kind.toUpperCase()}` });
    if (bad.length) {
      parts.push({ status: "fail", text: `${say(bad.length, "native library isn't", "native libraries aren't")} 16 KB aligned` });
      for (const l of bad) items.push(`${l.path}: LOAD alignment 0x${l.align.toString(16)} (needs 0x4000)`);
    }
    if (zipBad.length) {
      parts.push({ status: "fail", text: `${say(zipBad.length, "uncompressed .so isn't", "uncompressed .so files aren't")} zip-aligned to 16 KB` });
      for (const l of zipBad) items.push(`${l.path}: not on a 16 KB boundary in the APK (use AGP 8.5.1+ or zipalign -P 16)`);
    }
    if (unreadable.length) {
      parts.push({ status: "warn", text: `${unreadable.length} .so ${unreadable.length === 1 ? "file" : "files"} couldn't be read` });
      for (const l of unreadable) items.push(`${l.path}: ${l.error}`);
    }
    if (libs.length && !bad.length && !zipBad.length && !unreadable.length) {
      parts.push({ status: "pass", text: `all ${libs.length} 64-bit native libraries are 16 KB aligned` });
    }
  }

  if (ctx.manifest && ctx.manifest.application["android:pageSizeCompat"] !== undefined) {
    parts.push({ status: "warn", text: "android:pageSizeCompat is set" });
    items.push("pageSizeCompat only turns on compatibility mode. It hides the warning but doesn't make the libraries 16 KB ready.");
  }

  const sdk = ctx.sdk;
  let readyItems: string[] = [];
  if (sdk.status === "ok") {
    const rows = sdk.report.rows.filter((r) => r.configuration !== "plugin");
    const blocking = rows.filter((r) => BLOCKING.has(r.verdict));
    const unknown = rows.filter((r) => r.verdict === "unknown" || r.verdict === "checking").length;
    const attention = rows.filter((r) => BLOCKING.has(r.verdict) || r.verdict === "unknown" || r.verdict === "checking");
    const rowLine = (r: (typeof rows)[number]): string => {
      const min = r.entry?.minVersion && BLOCKING.has(r.verdict) ? `, 16 KB from ${r.entry.minVersion}` : "";
      return `${r.coordinate} ${r.declaredVersion || "(version not resolved)"}${min}`;
    };
    readyItems = rows.filter((r) => !attention.includes(r)).map(rowLine);
    if (blocking.length) {
      parts.push({ status: "warn", text: `${say(blocking.length, "SDK", "SDKs")} not ready` });
      for (const r of attention) items.push(rowLine(r));
      items.push("Run `npx play-preflight 16kb` for the full SDK table.");
    } else if (rows.length) {
      parts.push({ status: "pass", text: `${rows.length} public SDKs checked, none blocking${unknown ? ` (${unknown} unknown)` : ""}` });
      for (const r of attention) items.push(rowLine(r));
    }
  } else if (sdk.status === "offline") {
    items.push("SDK lookup skipped (--offline).");
  } else if (sdk.status === "error") {
    items.push(`SDK lookup failed: ${sdk.message}`);
  }

  if (ctx.agp?.status === "warning" && !ctx.binary) {
    parts.push({ status: "warn", text: `AGP ${ctx.agp.version} is below 8.5.1` });
    items.push(ctx.agp.message);
  }

  if (!parts.length) {
    const why =
      sdk.status === "offline"
        ? "offline and no APK/AAB given, so nothing to check. Pass --apk or --aab to check the native libraries"
        : sdk.status === "error"
          ? "couldn't reach the SDK catalog and no APK/AAB given"
          : "no dependencies or native libraries found";
    return withSdk(result("16kb", "skip", why, items, play(ctx)["16kb"].blockFrom, readyItems.length ? { verboseItems: readyItems } : {}), ctx);
  }
  const status = worst(parts.map((p) => p.status));
  const lead = parts.filter((p) => p.status === status).map((p) => p.text);
  const rest = parts.filter((p) => p.status !== status).map((p) => p.text);
  const detail = lead.join("; ") + (status === "fail" || status === "warn" ? `. ${when}` : "");
  return withSdk(
    result("16kb", status, detail, [...rest, ...items], play(ctx)["16kb"].blockFrom, readyItems.length ? { verboseItems: readyItems } : {}),
    ctx,
  );
}

// J. Play Billing Library
const BILLING_ARTIFACTS = new Set(["billing", "billing-ktx"]);

export function checkBilling(ctx: CheckContext): CheckResult {
  let version: string | undefined;
  let from = "";
  let found = false;
  const dep = (ctx.dependencies ?? []).find((d) => d.group === "com.android.billingclient" && BILLING_ARTIFACTS.has(d.artifact));
  const meta = ctx.manifest?.appMetaData["com.google.android.play.billingclient.version"];
  if (meta) {
    found = true;
    version = meta;
    from = "APK manifest";
  } else if (dep) {
    found = true;
    version = dep.version || undefined;
    from = `${dep.group}:${dep.artifact}`;
  }
  if (!found && ctx.billingMentionedIn) {
    return result("play-billing", "warn", `${ctx.billingMentionedIn} mentions the Play Billing Library, but its version couldn't be resolved`, [
      `Make sure it's ${play(ctx)["play-billing"].currentMajorRequired} or later. Version ${play(ctx)["play-billing"].currentMajorRequired} is supported until ${fmtDate(play(ctx)["play-billing"].v8SupportedUntil)}.`,
    ]);
  }
  if (!found) return result("play-billing", "skip", "Play Billing Library not used");
  const major = version ? Number.parseInt(/^\s*(\d+)/.exec(version)?.[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(major)) {
    return result("play-billing", "warn", `found ${from}, but couldn't resolve its version${version ? ` ("${version}")` : ""}`, [
      `Make sure it's ${play(ctx)["play-billing"].currentMajorRequired} or later. Version ${play(ctx)["play-billing"].currentMajorRequired} is supported until ${fmtDate(play(ctx)["play-billing"].v8SupportedUntil)}.`,
    ]);
  }
  const billing = play(ctx)["play-billing"];
  if (major < billing.currentMajorRequired) {
    return result(
      "play-billing",
      "fail",
      `${version}: the cutoff for version ${billing.currentMajorRequired - 1} and older was ${fmtDate(billing.v7Cutoff)} (extension ${fmtDate(billing.v7Extension)}). Update to ${billing.currentMajorRequired} or later`,
      [`From ${from}.`],
      billing.v7Cutoff,
    );
  }
  if (major === billing.currentMajorRequired) {
    return result(
      "play-billing",
      "warn",
      `${version} is supported until ${fmtDate(billing.v8SupportedUntil)} (extension to ${fmtDate(billing.v8Extension)}). Plan the move to ${billing.nextMajor}`,
      [`From ${from}.`],
      billing.v8SupportedUntil,
    );
  }
  const until = major === billing.nextMajor ? ` (supported until ${fmtDate(billing.v9SupportedUntil)})` : "";
  return result("play-billing", "pass", `${version}${until}`, [], major === billing.nextMajor ? billing.v9SupportedUntil : null);
}

// F. Foreground service types
const FGS_TYPE_PERMISSION: Record<string, string | null> = {
  camera: "FOREGROUND_SERVICE_CAMERA",
  connectedDevice: "FOREGROUND_SERVICE_CONNECTED_DEVICE",
  dataSync: "FOREGROUND_SERVICE_DATA_SYNC",
  health: "FOREGROUND_SERVICE_HEALTH",
  location: "FOREGROUND_SERVICE_LOCATION",
  mediaPlayback: "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  mediaProcessing: "FOREGROUND_SERVICE_MEDIA_PROCESSING",
  mediaProjection: "FOREGROUND_SERVICE_MEDIA_PROJECTION",
  microphone: "FOREGROUND_SERVICE_MICROPHONE",
  phoneCall: "FOREGROUND_SERVICE_PHONE_CALL",
  remoteMessaging: "FOREGROUND_SERVICE_REMOTE_MESSAGING",
  specialUse: "FOREGROUND_SERVICE_SPECIAL_USE",
  systemExempted: "FOREGROUND_SERVICE_SYSTEM_EXEMPTED",
  shortService: null,
  fileManagement: null,
  manifest: null,
  none: null,
};

/**
 * Is a component from the checked manifest declared in the project's own source manifests?
 * true or false when we can tell, undefined when we can't (APK only, or no source manifests).
 */
export function isOwnComponent(ctx: CheckContext, c: ManifestComponent, kind: "services" | "activities"): boolean | undefined {
  // Source manifests are the app's own by definition.
  if (ctx.manifestKind === "source") return true;
  if (!ctx.ownManifest) return undefined;
  return ctx.ownManifest[kind].some((o) => sameComponent(c.name, o.name));
}

export function checkForegroundServices(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  if (!m) return result("foreground-services", "skip", NO_MANIFEST);
  const fgsPerm = !!hasPermission(m, "FOREGROUND_SERVICE");
  const typed = m.services.filter((s) => (s.attrs["android:foregroundServiceType"] ?? "").trim());
  const untyped = m.services.filter((s) => !(s.attrs["android:foregroundServiceType"] ?? "").trim());
  if (!fgsPerm && !typed.length) return result("foreground-services", "skip", "none declared");
  const t = ctx.target.effective;
  const fgsFrom = play(ctx)["foreground-services"].requiredFromTargetSdk;
  if (t < fgsFrom) {
    return result("foreground-services", "pass", `types are required once you target ${fgsFrom} (you target ${t})`, typed.map((s) => `${s.name}: ${s.attrs["android:foregroundServiceType"]}`));
  }

  const fails: string[] = [];
  const warns: string[] = [];
  const info: string[] = [];
  const allTypes = new Set<string>();
  if (fgsPerm && !typed.length) {
    const own = untyped.filter((s) => isOwnComponent(ctx, s, "services") === true);
    if (own.length) {
      fails.push(
        `FOREGROUND_SERVICE is declared but no <service> has android:foregroundServiceType (${own.length === 1 ? "1 is" : `${own.length} are`} in your own manifest). startForeground() on ${own.length === 1 ? "it" : "them"} throws MissingForegroundServiceTypeException`,
      );
      const declaredIn = (s: ManifestComponent) =>
        ctx.manifestKind === "source" ? s.file : (ctx.ownManifest?.services.find((o) => sameComponent(s.name, o.name))?.file ?? s.file);
      info.push(...cap(own.map((s) => `${s.name}: no foregroundServiceType (declared in ${declaredIn(s)})`)));
    } else if (untyped.length) {
      const known = untyped.every((s) => isOwnComponent(ctx, s, "services") === false);
      const where = known
        ? `${untyped.length === 1 ? "1 untyped service comes" : `${untyped.length} untyped services come`} from dependencies`
        : untyped.length === 1
          ? "1 service has no type, and it's unclear whether it's yours or a library's"
          : `${untyped.length} services have no type, and it's unclear which are yours`;
      warns.push(
        `FOREGROUND_SERVICE is declared but no <service> has android:foregroundServiceType. ${where}. A service without a type can crash at runtime (MissingForegroundServiceTypeException) if startForeground() is called on it`,
      );
      info.push(...cap(untyped.map((s) => `${s.name}: no foregroundServiceType`)));
      if (!known) info.push("Pass the project folder with --apk to tell your own services from library ones.");
    } else {
      warns.push(
        "FOREGROUND_SERVICE is declared but no <service> is. If a library adds a service at build time and calls startForeground() on it, it can crash at runtime without a foregroundServiceType",
      );
    }
  }
  if (!fgsPerm && typed.length) fails.push("services declare a foregroundServiceType but FOREGROUND_SERVICE isn't declared");
  for (const s of typed) {
    const types = s.attrs["android:foregroundServiceType"].split("|").map((x) => x.trim()).filter(Boolean);
    for (const type of types) {
      allTypes.add(type);
      const perm = FGS_TYPE_PERMISSION[type];
      if (perm === undefined) {
        warns.push(`${s.name}: unknown type "${type}"`);
        continue;
      }
      if (perm && !hasPermission(m, perm)) fails.push(`${s.name}: type ${type} needs ${perm}, which isn't declared (SecurityException at runtime)`);
      if (type === "specialUse" && !s.properties["android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"]) {
        fails.push(`${s.name}: specialUse needs a <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE">`);
      }
      if ((type === "dataSync" || type === "mediaProcessing") && t >= play(ctx)["foreground-services"].timeLimitFromTargetSdk) {
        const limitAt = play(ctx)["foreground-services"].timeLimitFromTargetSdk;
        warns.push(`${s.name}: ${type} has a 6 h per 24 h time limit on Android 15+ when you target ${limitAt}+`);
      }
      if (type === "systemExempted") warns.push(`${s.name}: systemExempted is only allowed for specific kinds of apps`);
    }
  }
  if (fgsPerm && typed.length && untyped.length) {
    info.push(`${untyped.length} other ${untyped.length === 1 ? "service has" : "services have"} no type. Any that call startForeground() need one.`);
  }
  if (allTypes.size) info.push(`Declare these types in Play Console (App content > Foreground services): ${[...allTypes].join(", ")}`);
  if (ctx.manifestKind === "source") info.push("Libraries can add services at build time. Build once or pass --apk to see them.");

  if (fails.length) return result("foreground-services", "fail", fails[0], [...fails.slice(1), ...warns, ...info]);
  if (warns.length) return result("foreground-services", "warn", warns[0], [...warns.slice(1), ...info]);
  return result("foreground-services", "pass", `${typed.length} typed ${typed.length === 1 ? "service" : "services"}, permissions in place${assumedNote(ctx)}`, info);
}

// C. Edge to edge
export function checkEdgeToEdge(ctx: CheckContext): CheckResult {
  if (!ctx.edgeToEdgeOptOuts) return result("edge-to-edge", "skip", "theme flags need the project folder (APK resources aren't read)");
  const optOuts = ctx.edgeToEdgeOptOuts.filter((o) => isTrue(o.value));
  const t = ctx.target.effective;
  if (!optOuts.length) {
    return result("edge-to-edge", "pass", "no windowOptOutEdgeToEdgeEnforcement opt-out found", [], null, {
      verboseItems: ["Apps targeting 35+ draw edge to edge on Android 15+. Check your insets on a real device."],
    });
  }
  const files = optOuts.map((o) => o.file);
  const ignoredFrom = play(ctx)["edge-to-edge"].optOutIgnoredFromTargetSdk;
  if (t >= ignoredFrom) {
    return result("edge-to-edge", "fail", `windowOptOutEdgeToEdgeEnforcement is ignored on Android 16 when you target ${ignoredFrom}${assumedNote(ctx)}. Handle insets instead`, files);
  }
  return result(
    "edge-to-edge",
    "warn",
    `windowOptOutEdgeToEdgeEnforcement stops working when you target ${ignoredFrom}, which Play requires for updates`,
    files,
  );
}

// D. Large screens
const LOCKED_ORIENTATIONS = new Set([
  "portrait",
  "landscape",
  "reversePortrait",
  "reverseLandscape",
  "sensorPortrait",
  "sensorLandscape",
  "userPortrait",
  "userLandscape",
  "nosensor",
  "locked",
]);
const RESIZABILITY_OPT_OUT = "android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY";

export function checkLargeScreens(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  if (!m) return result("large-screens", "skip", NO_MANIFEST);
  if ((m.application["android:appCategory"] ?? "").trim() === "game") return result("large-screens", "skip", "games are exempt (appCategory=game)");
  const LARGE_SCREEN_HINT =
    "Fix: drop screenOrientation, resizeableActivity and aspect-ratio locks, or provide large-screen layouts.";
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  const appNotResizable = isFalse(m.application["android:resizeableActivity"]);
  if (appNotResizable) {
    const file = m.applicationFile ?? m.files[0] ?? "AndroidManifest.xml";
    const line = triggerLine(m.applicationAttrLines, ["android:resizeableActivity"], m.applicationLine);
    items.push(`application  ${at(file, line)}  resizeableActivity=false`);
    locations.push({ file, line, message: "application sets resizeableActivity=false" });
  }
  for (const a of m.activities) {
    const bits: string[] = [];
    const triggers: string[] = [];
    const o = (a.attrs["android:screenOrientation"] ?? "").trim();
    if (LOCKED_ORIENTATIONS.has(o)) {
      bits.push(o);
      triggers.push("android:screenOrientation");
    }
    if (isFalse(a.attrs["android:resizeableActivity"])) {
      bits.push("resizeableActivity=false");
      triggers.push("android:resizeableActivity");
    }
    if (a.attrs["android:minAspectRatio"]) {
      bits.push(`minAspectRatio=${a.attrs["android:minAspectRatio"]}`);
      triggers.push("android:minAspectRatio");
    }
    if (a.attrs["android:maxAspectRatio"]) {
      bits.push(`maxAspectRatio=${a.attrs["android:maxAspectRatio"]}`);
      triggers.push("android:maxAspectRatio");
    }
    if (!bits.length) continue;
    const cls = shortClass(a.name);
    const attr = bits.join(", ");
    const line = triggerLine(a.attrLines, triggers, a.line);
    items.push(`${cls}  ${at(a.file, line)}  ${attr}`);
    locations.push({ file: a.file, line, message: `${cls} locks ${attr}` });
  }
  const optOut =
    isTrue(m.appProperties[RESIZABILITY_OPT_OUT]) || m.activities.some((a) => isTrue(a.properties[RESIZABILITY_OPT_OUT]));
  const t = ctx.target.effective;
  if (!items.length && !optOut) return result("large-screens", "pass", "no orientation, resizability or aspect ratio locks");
  const n = items.length - (appNotResizable ? 1 : 0);
  const lockText = n > 0 ? `${n} ${n === 1 ? "activity locks" : "activities lock"} orientation or size` : "the app locks resizing";
  const out = [...items];
  const large = play(ctx)["large-screens"];
  if (optOut) out.push(`${RESIZABILITY_OPT_OUT} is set. It's temporary and stops working at API ${large.optOutEndsAtTargetSdk}.`);
  out.push(LARGE_SCREEN_HINT);
  if (!items.length) {
    return result("large-screens", "warn", `uses the temporary resizability opt-out, which is gone at API ${large.optOutEndsAtTargetSdk}`, out, null, { locations });
  }
  const detail =
    t >= large.locksIgnoredFromTargetSdk
      ? `${lockText}. Android 16 ignores this on screens 600dp and wider when you target ${large.locksIgnoredFromTargetSdk}${assumedNote(ctx)}`
      : `${lockText}. It will be ignored on screens 600dp and wider once you target ${large.locksIgnoredFromTargetSdk}`;
  return result("large-screens", "warn", detail, out, null, { locations });
}

// E. Predictive back
const BACK_PATTERNS: [RegExp, string][] = [
  [/\boverride\s+fun\s+onBackPressed\s*\(/, "overrides onBackPressed()"],
  [/\bvoid\s+onBackPressed\s*\(\s*\)/, "overrides onBackPressed()"],
  [/\bKEYCODE_BACK\b/, "handles KEYCODE_BACK"],
];

type DeclaredClass = { simple: string; full?: string };

/** Classes declared in a Kotlin or Java file, with the package when it has one. */
function declaredClasses(text: string): DeclaredClass[] {
  const pkg = /^\s*package\s+([\w.]+)/m.exec(text)?.[1];
  const out: DeclaredClass[] = [];
  for (const m of text.matchAll(/\b(?:class|object)\s+([A-Za-z_]\w*)/g)) out.push({ simple: m[1], full: pkg ? `${pkg}.${m[1]}` : undefined });
  return out;
}

function activityMatches(a: ManifestComponent, c: DeclaredClass): boolean {
  const name = a.name;
  if (c.full && name === c.full) return true;
  // Unqualified names (".Foo", "Foo", or a file without a package) match on the class name.
  const simple = name.slice(name.lastIndexOf(".") + 1);
  if (simple !== c.simple) return false;
  return !c.full || name.startsWith(".") || !name.includes(".");
}

export function checkPredictiveBack(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  const attr = "android:enableOnBackInvokedCallback";
  const appOptOut = !!m && isFalse(m.application[attr]);
  const activityOptOuts = m ? m.activities.filter((a) => isFalse(a.attrs[attr])) : [];
  const activityOptIns = m ? m.activities.filter((a) => isTrue(a.attrs[attr])) : [];
  const t = ctx.target.effective;
  // Only an <application>-level opt-out covers the whole app, and only when no activity opts back in.
  if (appOptOut && !activityOptIns.length) {
    return result("predictive-back", "info", 'opted out with enableOnBackInvokedCallback="false" on <application>. This is temporary, so plan the move to OnBackPressedCallback');
  }
  const optOutNote = activityOptOuts.length
    ? [
        `${activityOptOuts.length} ${activityOptOuts.length === 1 ? "activity opts" : "activities opt"} out with enableOnBackInvokedCallback="false" (${cap(activityOptOuts.map((a) => a.name), 3).join(", ")}). That only covers ${activityOptOuts.length === 1 ? "that activity" : "those activities"}.`,
      ]
    : [];
  if (!ctx.sources) {
    if (!m) return result("predictive-back", "skip", NO_MANIFEST);
    return result("predictive-back", "skip", "needs the project folder to look for onBackPressed() and KEYCODE_BACK", optOutNote);
  }
  // A file is excused when it declares an activity that opted out (or, with an app-level opt-out,
  // any class that isn't an activity opting back in).
  const excused = (classes: DeclaredClass[]): boolean => {
    const matched = (list: ManifestComponent[]) => classes.some((c) => list.some((a) => activityMatches(a, c)));
    if (matched(activityOptIns)) return false;
    if (matched(activityOptOuts)) return true;
    return appOptOut;
  };
  const hits: string[] = [];
  const skipped: string[] = [];
  for (const f of ctx.sources()) {
    for (const [re, what] of BACK_PATTERNS) {
      if (re.test(f.text)) {
        if (excused(declaredClasses(f.text))) skipped.push(f.name);
        else hits.push(`${f.name}: ${what}`);
        break;
      }
    }
  }
  const notes = [
    ...optOutNote,
    ...(skipped.length ? [`Not counted, because their activity opts out: ${cap(skipped, 3).join(", ")}`] : []),
  ];
  if (!hits.length) {
    if (skipped.length) {
      return result("predictive-back", "info", 'the only old back API uses are in activities that opt out with enableOnBackInvokedCallback="false". This is temporary, so plan the move to OnBackPressedCallback', notes);
    }
    return result("predictive-back", "pass", "no onBackPressed() overrides or KEYCODE_BACK handling found", notes);
  }
  const backFrom = play(ctx)["predictive-back"].defaultOnFromTargetSdk;
  if (t >= backFrom) {
    return result(
      "predictive-back",
      "warn",
      `${hits.length} ${hits.length === 1 ? "file uses" : "files use"} the old back APIs. On Android 16 with target ${backFrom} they aren't called${assumedNote(ctx)}`,
      [...cap(hits), "Move to OnBackPressedCallback (androidx.activity) or OnBackInvokedCallback.", ...notes],
    );
  }
  return result("predictive-back", "warn", `${hits.length} ${hits.length === 1 ? "file uses" : "files use"} the old back APIs, which stop being called once you target ${backFrom}`, [...cap(hits), ...notes]);
}

// H. Photo and video permissions
export function checkPhotoVideo(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  if (!m) return result("photo-video", "skip", NO_MANIFEST);
  const found: string[] = [];
  for (const p of ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "MANAGE_EXTERNAL_STORAGE"]) {
    if (hasPermission(m, p)) found.push(p);
  }
  const legacy = hasPermission(m, "READ_EXTERNAL_STORAGE");
  const items: string[] = [];
  if (legacy && !(legacy.maxSdk !== undefined && legacy.maxSdk <= 32)) {
    found.push("READ_EXTERNAL_STORAGE");
    items.push('READ_EXTERNAL_STORAGE has no android:maxSdkVersion="32". On Android 13+ use READ_MEDIA_* or the photo picker.');
  }
  if (!found.length) return result("photo-video", "pass", "no broad photo, video or storage permissions");
  if (found.includes("READ_MEDIA_IMAGES") || found.includes("READ_MEDIA_VIDEO")) {
    items.unshift("Use the photo picker (androidx.activity 1.7.0+) unless the app's core use needs broad access.");
  }
  if (found.includes("MANAGE_EXTERNAL_STORAGE")) items.push("MANAGE_EXTERNAL_STORAGE (All files access) needs a Play Console declaration and a qualifying use.");
  return result("photo-video", "warn", `${found.join(", ")} declared. Needs a Play Console declaration or the photo picker`, items);
}

// G. Exact alarms
export function checkExactAlarms(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  if (!m) return result("exact-alarms", "skip", NO_MANIFEST);
  const use = hasPermission(m, "USE_EXACT_ALARM");
  const schedule = hasPermission(m, "SCHEDULE_EXACT_ALARM");
  if (!use && !schedule) return result("exact-alarms", "pass", "no exact alarm permissions");
  const warns: string[] = [];
  const items: string[] = [];
  if (use) warns.push("USE_EXACT_ALARM declared. Play only allows it for alarm, timer and calendar apps");
  if (schedule) {
    const checks = ctx.sources?.().some((f) => f.text.includes("canScheduleExactAlarms("));
    if (checks) items.push("SCHEDULE_EXACT_ALARM: canScheduleExactAlarms() is called. Good.");
    else {
      warns.push("SCHEDULE_EXACT_ALARM is denied by default on Android 14+ for new installs");
      items.push(ctx.sources ? "No canScheduleExactAlarms() call found. Check it before scheduling." : "Make sure the app checks canScheduleExactAlarms() before scheduling.");
    }
  }
  if (!warns.length) return result("exact-alarms", "pass", "SCHEDULE_EXACT_ALARM with a canScheduleExactAlarms() check", []);
  return result("exact-alarms", "warn", warns[0], [...warns.slice(1), ...items]);
}

// I. Other restricted permissions
const SMS = ["SEND_SMS", "RECEIVE_SMS", "READ_SMS", "RECEIVE_WAP_PUSH", "RECEIVE_MMS", "WRITE_SMS", "READ_CELL_BROADCASTS"];
const CALL_LOG = ["READ_CALL_LOG", "WRITE_CALL_LOG", "PROCESS_OUTGOING_CALLS"];

export function checkRestrictedPermissions(ctx: CheckContext): CheckResult {
  const m = ctx.manifest;
  if (!m) return result("restricted-permissions", "skip", NO_MANIFEST);
  const t = ctx.target.effective;
  const items: string[] = [];
  const names: string[] = [];
  const deadlines: string[] = [];
  const add = (perm: string, why: string, deadline?: string) => {
    names.push(perm);
    items.push(`${perm}: ${why}`);
    if (deadline) deadlines.push(deadline);
  };
  if (hasPermission(m, "QUERY_ALL_PACKAGES") && t >= 30) add("QUERY_ALL_PACKAGES", "needs a declaration and a core use that requires it. Prefer <queries>");
  if (hasPermission(m, "REQUEST_INSTALL_PACKAGES")) add("REQUEST_INSTALL_PACKAGES", "needs a declaration and a core use that requires it");
  const sms = SMS.filter((p) => hasPermission(m, p));
  if (sms.length) add(sms.join(", "), "SMS permissions are only for the default SMS handler (or an approved exception)");
  const calls = CALL_LOG.filter((p) => hasPermission(m, p));
  if (calls.length) add(calls.join(", "), "Call Log permissions are only for the default phone handler (or an approved exception)");
  if (hasPermission(m, "ACCESS_BACKGROUND_LOCATION")) add("ACCESS_BACKGROUND_LOCATION", "needs a Play Console declaration and review");
  if (hasPermission(m, "USE_FULL_SCREEN_INTENT") && t >= 34) add("USE_FULL_SCREEN_INTENT", "only auto-granted for alarm and calling apps; others need a declaration");
  const restricted = play(ctx)["restricted-permissions"];
  if (t >= restricted.atTargetSdk) {
    if (hasPermission(m, "ACCESS_FINE_LOCATION")) {
      add("ACCESS_FINE_LOCATION", `at target ${restricted.atTargetSdk}+ needs a declaration from ${fmtDate(restricted.fineLocationAndContactsFrom)}. Use the location button for one-off location`, restricted.fineLocationAndContactsFrom);
    }
    if (hasPermission(m, "READ_CONTACTS")) add("READ_CONTACTS", `at target ${restricted.atTargetSdk}+ needs a declaration from ${fmtDate(restricted.fineLocationAndContactsFrom)}, or use the Contact Picker`, restricted.fineLocationAndContactsFrom);
    if (hasPermission(m, "ACCESS_LOCAL_NETWORK")) add("ACCESS_LOCAL_NETWORK", `at target ${restricted.atTargetSdk}+ needs a declaration from ${fmtDate(restricted.localNetworkFrom)}`, restricted.localNetworkFrom);
  }
  if (!names.length) return result("restricted-permissions", "pass", "no restricted permissions that need a declaration");
  deadlines.sort();
  return result(
    "restricted-permissions",
    "warn",
    `${names.length} restricted ${names.length === 1 ? "permission needs" : "permissions need"} a Play Console declaration or a qualifying use`,
    items,
    deadlines[0] ?? null,
  );
}

// L. Account deletion reminder
const AUTH_SDKS: [string, RegExp][] = [
  ["Firebase Auth", /^com\.google\.firebase:firebase-auth(-ktx)?$/],
  ["Auth0", /^com\.auth0\.android:/],
  ["Supabase Auth", /^io\.github\.jan-tennert\.supabase:(auth-kt|gotrue-kt)$/],
  ["Amplify Auth", /^com\.amplifyframework:aws-auth-cognito$/],
  ["Okta", /^com\.okta\.(android|kotlin):/],
  ["AppAuth", /^net\.openid:appauth$/],
  ["Credential Manager", /^androidx\.credentials:credentials$/],
  ["Google Sign-In", /^com\.google\.android\.gms:play-services-auth$/],
  ["Facebook Login", /^com\.facebook\.android:facebook-login$/],
  ["Clerk", /^com\.clerk:/],
];

export function checkAccountDeletion(ctx: CheckContext): CheckResult {
  if (!ctx.dependencies) return result("account-deletion", "skip", "needs the project folder to look for sign-in SDKs");
  const found = new Set<string>();
  for (const d of ctx.dependencies) {
    const c = `${d.group}:${d.artifact}`;
    for (const [label, re] of AUTH_SDKS) if (re.test(c)) found.add(label);
  }
  if (!found.size) return result("account-deletion", "skip", "no sign-in SDK found");
  return result("account-deletion", "info", `sign-in SDK found (${[...found].join(", ")}). Make sure in-app and web account deletion exist`, [
    "If users can create accounts, Play needs an in-app way to delete the account and a web link in the Data safety form.",
  ]);
}

export const CHECKS: Record<CheckId, (ctx: CheckContext) => CheckResult> = {
  "target-api": checkTargetApi,
  "16kb": check16kb,
  "play-billing": checkBilling,
  "foreground-services": checkForegroundServices,
  "edge-to-edge": checkEdgeToEdge,
  "large-screens": checkLargeScreens,
  "predictive-back": checkPredictiveBack,
  "photo-video": checkPhotoVideo,
  "exact-alarms": checkExactAlarms,
  "restricted-permissions": checkRestrictedPermissions,
  "account-deletion": checkAccountDeletion,
};

export { PLAY_MIN_TARGET, short };
