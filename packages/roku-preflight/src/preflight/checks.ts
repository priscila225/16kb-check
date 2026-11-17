import { RULES, fmtDate, type CheckId } from "./rules";
import { pkgPath, formatVersion, isAllZeroVersion, manifestGet, type ManifestInfo } from "./manifest";
import { readImage, formatSize } from "./image";
import { findMainEntries, findMainWithoutArgs, hasMatch, searchSources, at, type SourceHit, type TextFile } from "./source";
import type { ProjectScan } from "./project";
import type { ResolvedRokuRules, RokuRulesChecks } from "./roku-rules";
import { isoCmp, isoDay } from "./roku-rules";

export type CheckStatus = "pass" | "warn" | "fail" | "skip" | "info";

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
  deadline: string | null;
  source: string;
  link: string;
  items: string[];
  verboseItems?: string[];
  locations?: CheckLocation[];
};

export type CheckContext = {
  project: ProjectScan;
  rokuRules: ResolvedRokuRules;
  now: Date;
};

function rules(ctx: CheckContext): RokuRulesChecks {
  return ctx.rokuRules.rules.checks;
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

const RANK: Record<CheckStatus, number> = { skip: 0, info: 1, pass: 2, warn: 3, fail: 4 };

function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>((a, b) => (RANK[b] > RANK[a] ? b : a), "skip");
}

function locsFromHits(hits: SourceHit[], message: string): CheckLocation[] {
  return hits.map((h) => ({ file: h.file, line: h.line, message }));
}

function itemHits(hits: SourceHit[], cap = 8): string[] {
  const shown = hits.slice(0, cap).map((h) => `${h.excerpt}  ${at(h)}`);
  if (hits.length > cap) shown.push(`…and ${hits.length - cap} more`);
  return shown;
}

function todayIso(now: Date): string {
  return isoDay(now);
}

// --- manifest-required ---

const APP_REQUIRED = ["title", "major_version", "minor_version", "build_version", "mm_icon_focus_fhd", "mm_icon_focus_hd", "splash_screen_hd"] as const;
const SCREENSAVER_REQUIRED = ["screensaver_title", "major_version", "minor_version", "build_version"] as const;

function checkManifestRequired(ctx: CheckContext): CheckResult {
  const m = ctx.project.manifest;
  const required = ctx.project.screensaver ? SCREENSAVER_REQUIRED : APP_REQUIRED;
  const missing: string[] = [];
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  for (const key of required) {
    if (!manifestGet(m, key)) {
      missing.push(key);
      locations.push({ file: m.file, message: `Missing ${key}` });
    }
  }
  // Cert 6.4 also requires the FHD splash, even though the manifest doc lists it as optional.
  if (!ctx.project.screensaver && !manifestGet(m, "splash_screen_fhd")) {
    missing.push("splash_screen_fhd");
    locations.push({ file: m.file, message: "Missing splash_screen_fhd (required by certification criterion 6.4)" });
  }
  const pathKeys = ctx.project.screensaver
    ? []
    : ["mm_icon_focus_fhd", "mm_icon_focus_hd", "splash_screen_fhd", "splash_screen_hd", "splash_screen_sd"];
  for (const key of pathKeys) {
    const value = manifestGet(m, key);
    if (!value) continue;
    const rel = pkgPath(value);
    if (!rel) {
      items.push(`${key} should use a pkg:/ path (got ${value})`);
      locations.push({ file: m.file, line: m.lines[key], message: `${key} should use a pkg:/ path` });
    } else if (!ctx.project.readFile(rel)) {
      items.push(`${key} points to ${value}, which is not in the package`);
      locations.push({ file: m.file, line: m.lines[key], message: `${key} path does not exist: ${value}` });
    }
  }
  if (!m.trailingNewline) {
    items.push("The last line of the manifest must end with a newline");
    locations.push({ file: m.file, message: "Manifest is missing a trailing newline" });
  }
  if (missing.length || items.length) {
    const hard = missing.length > 0 || items.some((i) => i.includes("not in the package") || i.includes("must end with a newline"));
    const status: CheckStatus = hard ? "fail" : "warn";
    const detail = missing.length
      ? `Missing ${missing.join(", ")}`
      : items[0] ?? "Manifest has problems";
    return result("manifest-required", status, detail, items.filter((i) => !missing.some((k) => i.startsWith(k))), null, { locations });
  }
  return result("manifest-required", "pass", "Required fields, pkg:/ paths and trailing newline are in place");
}

// --- version ---

function checkVersion(ctx: CheckContext): CheckResult {
  const m = ctx.project.manifest;
  const v = formatVersion(m);
  if (!manifestGet(m, "major_version") || !manifestGet(m, "minor_version") || !manifestGet(m, "build_version")) {
    return result("version", "fail", "major_version, minor_version and build_version must all be set", [], null, {
      locations: [{ file: m.file, message: "Version fields are missing" }],
    });
  }
  if (isAllZeroVersion(m)) {
    return result(
      "version",
      "fail",
      `Version is ${v}, which is all zeros. Criterion 6.1 requires a non-zero version`,
      [],
      null,
      { locations: [{ file: m.file, line: m.lines.major_version, message: "Version is 0.0.0" }] },
    );
  }
  return result(
    "version",
    "pass",
    `${v} (this check cannot tell whether you incremented it since the last store build)`,
  );
}

// --- rsg-version ---

function checkRsgVersion(ctx: CheckContext): CheckResult {
  const required = rules(ctx)["rsg-version"].required;
  const since = rules(ctx)["rsg-version"].requiredSince;
  const m = ctx.project.manifest;
  const value = manifestGet(m, "rsg_version");
  if (value === required) {
    return result("rsg-version", "pass", `rsg_version=${value}, required since ${fmtDate(since)}`, [], since);
  }
  const detail = value
    ? `rsg_version=${value}. Static Analysis has required rsg_version=${required} since ${fmtDate(since)}`
    : `rsg_version is missing. Static Analysis has required rsg_version=${required} since ${fmtDate(since)}`;
  return result("rsg-version", "fail", detail, [], since, {
    locations: [{ file: m.file, line: m.lines.rsg_version, message: detail }],
  });
}

// --- artwork ---

type ArtSpec = { key: string; label: string; size: [number, number]; required: boolean };

function checkArtwork(ctx: CheckContext): CheckResult {
  if (ctx.project.screensaver) {
    return result("artwork", "skip", "Standalone screensaver, so channel icons and splash screens are not required");
  }
  const art = rules(ctx).artwork;
  const specs: ArtSpec[] = [
    { key: "mm_icon_focus_fhd", label: "FHD icon", size: art.iconFhd, required: true },
    { key: "mm_icon_focus_hd", label: "HD icon", size: art.iconHd, required: true },
    { key: "splash_screen_fhd", label: "FHD splash", size: art.splashFhd, required: true },
    { key: "splash_screen_hd", label: "HD splash", size: art.splashHd, required: true },
    { key: "splash_screen_sd", label: "SD splash", size: art.splashSd, required: false },
  ];
  const m = ctx.project.manifest;
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  const statuses: CheckStatus[] = [];
  for (const spec of specs) {
    const value = manifestGet(m, spec.key);
    if (!value) {
      if (spec.required) {
        items.push(`${spec.label} (${spec.key}, ${spec.size[0]}x${spec.size[1]}) is missing`);
        locations.push({ file: m.file, message: `Missing ${spec.key}` });
        statuses.push("fail");
      } else {
        items.push(`${spec.label} (${spec.key}, ${spec.size[0]}x${spec.size[1]}) is not set. The manifest doc still lists it as required`);
        locations.push({ file: m.file, message: `Missing optional-but-documented ${spec.key}` });
        statuses.push("warn");
      }
      continue;
    }
    const rel = pkgPath(value) ?? value.replace(/^pkg:\//i, "");
    const data = ctx.project.readFile(rel);
    if (!data) {
      items.push(`${spec.label} file ${value} is missing`);
      locations.push({ file: m.file, line: m.lines[spec.key], message: `${spec.key} file is missing` });
      statuses.push("fail");
      continue;
    }
    const img = readImage(data);
    const expected = `${spec.size[0]}x${spec.size[1]}`;
    if (img.width === undefined || img.height === undefined) {
      items.push(`${spec.label} at ${rel}: could not read ${img.format} dimensions (expected ${expected})`);
      locations.push({ file: rel, message: `Could not read image dimensions, expected ${expected}` });
      statuses.push("warn");
      continue;
    }
    if (img.width !== spec.size[0] || img.height !== spec.size[1]) {
      items.push(`${spec.label} at ${rel} is ${formatSize(img.width, img.height)}, expected ${expected}`);
      locations.push({ file: rel, message: `${spec.label} is ${formatSize(img.width, img.height)}, expected ${expected}` });
      statuses.push("fail");
    }
    if (img.transparent) {
      items.push(`${spec.label} at ${rel} is transparent. Criterion 6.4 says artwork must not be transparent`);
      locations.push({ file: rel, message: `${spec.label} is transparent` });
      statuses.push("fail");
    }
  }
  const status = worst(statuses.length ? statuses : ["pass"]);
  if (status === "pass") {
    return result("artwork", "pass", "FHD and HD icons and splash screens match the official sizes and are not transparent");
  }
  const detail = items[0] ?? "Artwork does not meet official sizes";
  return result("artwork", status, items.length === 1 ? detail : `${items.length} artwork problems`, items, null, { locations });
}

// --- package-size ---

function formatMb(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function checkPackageSize(ctx: CheckContext): CheckResult {
  const maxMb = rules(ctx)["package-size"].maxMb;
  const maxBytes = Math.round(maxMb * 1024 * 1024);
  const bytes = ctx.project.packageBytes;
  const measured = ctx.project.kind === "zip" ? "zip file" : "packaged zip built from this folder";
  if (bytes > maxBytes) {
    return result(
      "package-size",
      "fail",
      `${formatMb(bytes)} (${bytes.toLocaleString("en-US")} bytes, ${measured}). Criterion 3.7 caps packages at ${maxMb} MB (${maxBytes.toLocaleString("en-US")} bytes)`,
    );
  }
  return result("package-size", "pass", `${formatMb(bytes)} (${measured}). Limit is ${maxMb} MB`);
}

// --- deep-linking ---

const CONTENT_ID_RE = /contentid/i;
const MEDIA_TYPE_RE = /mediatype/i;
const RO_INPUT_RE = /\broinput(event)?\b/i;

function checkDeepLinking(ctx: CheckContext): CheckResult {
  if (ctx.project.screensaver) {
    return result("deep-linking", "skip", "Standalone screensaver, so deep linking is not required");
  }
  const m = ctx.project.manifest;
  const sources = ctx.project.sources;
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  const statuses: CheckStatus[] = [];

  const flag = manifestGet(m, "supports_input_launch");
  if (flag !== "1") {
    items.push("manifest is missing supports_input_launch=1, which is required for mid-run deep links via roInput");
    locations.push({ file: m.file, line: m.lines.supports_input_launch, message: "supports_input_launch=1 is missing" });
    statuses.push("fail");
  }

  const withArgs = findMainEntries(sources);
  const withoutArgs = findMainWithoutArgs(sources);
  if (!withArgs.length) {
    const msg = withoutArgs.length
      ? `Main/RunUserInterface has no launch-args parameter (${at(withoutArgs[0]!)})`
      : "No Main or RunUserInterface entry with launch args was found";
    items.push(msg);
    locations.push(
      ...(withoutArgs.length
        ? locsFromHits(withoutArgs, "Main has no launch-args parameter")
        : [{ file: "source", message: "No Main or RunUserInterface entry with launch args was found" }]),
    );
    statuses.push("fail");
  } else {
    const hasId = hasMatch(sources, CONTENT_ID_RE);
    const hasType = hasMatch(sources, MEDIA_TYPE_RE);
    if (!hasId || !hasType) {
      const missing = [!hasId ? "contentId" : undefined, !hasType ? "mediaType" : undefined].filter(Boolean).join(" and ");
      items.push(`Main reads launch args, but ${missing} was not found in source. This is a presence check, not a playback test`);
      locations.push({ file: withArgs[0]!.file, line: withArgs[0]!.line, message: `${missing} not found in source` });
      statuses.push("fail");
    }
  }

  const inputHits = searchSources(sources, RO_INPUT_RE);
  if (!inputHits.length) {
    items.push("No roInput or roInputEvent handling was found. Mid-run deep links need this, plus supports_input_launch=1");
    locations.push({ file: withArgs[0]?.file ?? "source", line: withArgs[0]?.line, message: "roInput / roInputEvent not found" });
    statuses.push("fail");
  }

  if (statuses.includes("fail")) {
    return result("deep-linking", "fail", items[0] ?? "Deep linking hooks are incomplete", items, null, { locations });
  }
  return result(
    "deep-linking",
    "pass",
    "supports_input_launch=1, roInput handling, and Main launch args for contentId and mediaType are present. This does not prove a deep link actually plays",
  );
}

// --- deprecated legacy screens ---

const LEGACY_SCREENS = [
  "roCaptionRenderer",
  "roCodeRegistrationScreen",
  "roFontMetrics",
  "roGridScreen",
  "roKeyboardScreen",
  "roImageCanvas",
  "roListScreen",
  "roMessageDialog",
  "roOneLineDialog",
  "roParagraphScreen",
  "roPinEntryDialog",
  "roPosterScreen",
  "roSearchHistory",
  "roSearchScreen",
  "roSlideShow",
  "roSpringboardScreen",
  "roTextScreen",
  "roVideoScreen",
];

function legacyPattern(): RegExp {
  const names = LEGACY_SCREENS.flatMap((n) => [n, n + "Event", "if" + n.slice(2)]).join("|");
  return new RegExp(`["']?(${names})["']?`, "i");
}

function checkLegacyScreens(ctx: CheckContext): CheckResult {
  const hits = searchSources(ctx.project.sources, legacyPattern());
  // Filter to real component names, not accidental substrings, by checking a word-ish match.
  const real: SourceHit[] = [];
  const re = new RegExp(`\\b(${LEGACY_SCREENS.flatMap((n) => [n, n + "Event", "if" + n.slice(2)]).join("|")})\\b`, "i");
  for (const h of hits) {
    if (re.test(h.excerpt)) real.push(h);
  }
  if (!real.length) {
    return result("deprecated-legacy-screens", "pass", "No sunset legacy screen components were found");
  }
  const names = [...new Set(real.map((h) => (h.excerpt.match(re) ?? [])[1] ?? "legacy component"))];
  return result(
    "deprecated-legacy-screens",
    "fail",
    `Found ${names.join(", ")}. These components were sunset and block certification`,
    itemHits(real),
    null,
    { locations: locsFromHits(real, "Sunset legacy screen component") },
  );
}

// --- deprecated APIs ---

type Dep = { id: string; pattern: RegExp; kind: "error" | "certs" | "warn" };

const DEPRECATED: Dep[] = [
  { id: "InitClientCertificates", pattern: /\bInitClientCertificates\s*\(/i, kind: "certs" },
  { id: "ShowChannelStoreSpringboard", pattern: /\bShowChannelStoreSpringboard\s*\(/i, kind: "error" },
  { id: "LaunchApp", pattern: /\bLaunchApp\s*\(/i, kind: "error" },
  { id: "enableFreshConnection", pattern: /\benableFreshConnection\s*\(/i, kind: "error" },
  { id: "UpdateLastKeypressTime", pattern: /\bUpdateLastKeypressTime\s*\(/i, kind: "error" },
  { id: "Eval()", pattern: /\bEval\s*\(/i, kind: "error" },
  { id: "file:// URL", pattern: /file:\/\//i, kind: "error" },
  { id: "in-app ECP", pattern: /:8060\b|\/keypress\/|\/launch\/\d+/i, kind: "error" },
];

function checkDeprecatedApis(ctx: CheckContext): CheckResult {
  const certs = rules(ctx)["init-client-certificates"];
  const today = todayIso(ctx.now);
  const certsAreError = isoCmp(today, certs.errorFrom) >= 0;
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  let certHits: SourceHit[] = [];
  const errorHits: { name: string; hits: SourceHit[] }[] = [];

  for (const dep of DEPRECATED) {
    const hits = searchSources(ctx.project.sources, dep.pattern);
    if (!hits.length) continue;
    if (dep.kind === "certs") certHits = hits;
    else errorHits.push({ name: dep.id, hits });
  }

  for (const { name, hits } of errorHits) {
    items.push(`${name} at ${hits.map(at).join(", ")}`);
    locations.push(...locsFromHits(hits, `${name} is deprecated and blocks publishing`));
  }

  if (certHits.length) {
    const when = fmtDate(certs.errorFrom);
    const msg = certsAreError
      ? `InitClientCertificates() is a blocking Static Analysis error as of ${when}. Use ChannelStore getDeviceAttestationToken instead`
      : `InitClientCertificates() is deprecated. Static Analysis warns today and will block publishing from ${when}. Use ChannelStore getDeviceAttestationToken instead`;
    items.push(`${msg}  (${certHits.map(at).join(", ")})`);
    locations.push(...locsFromHits(certHits, msg));
  }

  if (!items.length) {
    return result(
      "deprecated-apis",
      "pass",
      `No documented deprecated APIs were found. InitClientCertificates() becomes a blocking error on ${fmtDate(certs.errorFrom)}`,
      [],
      certs.errorFrom,
    );
  }

  const status: CheckStatus = errorHits.length || certsAreError ? "fail" : "warn";
  const deadline = certHits.length ? certs.errorFrom : null;
  const detail = items[0]!.split("  (")[0]!;
  return result("deprecated-apis", status, items.length === 1 ? detail : `${items.length} deprecated APIs found`, items, deadline, { locations });
}

// --- launch beacon ---

function checkLaunchBeacon(ctx: CheckContext): CheckResult {
  if (ctx.project.screensaver) {
    return result("launch-beacon", "skip", "Standalone screensaver, so an app launch beacon is not required");
  }
  const beacon = rules(ctx).launch.beacon;
  const max = rules(ctx).launch.maxSeconds;
  const hits = searchSources(ctx.project.sources, new RegExp(`signalBeacon\\s*\\(\\s*["']${beacon}["']`, "i"));
  const loose = hits.length ? hits : searchSources(ctx.project.sources, new RegExp(`["']${beacon}["']`, "i"));
  if (!loose.length) {
    return result(
      "launch-beacon",
      "fail",
      `No ${beacon} signal beacon was found in source. This only checks that the beacon is present, not that launch is under ${max} seconds`,
    );
  }
  return result(
    "launch-beacon",
    "pass",
    `${beacon} is signaled in source. This does not measure launch time (official criterion is ${max} seconds to a fully rendered home screen)`,
    [],
    null,
    { locations: locsFromHits(loose, `${beacon} beacon`) },
  );
}

// --- memory monitor ---

const MEMORY_RE = /\broAppMemoryMonitor\b|\bifAppMemoryMonitor\b|EnableMemoryWarningEvent|GetChannelAvailableMemory|GetChannelMemoryLimit/i;

function checkMemoryMonitor(ctx: CheckContext): CheckResult {
  const since = rules(ctx)["memory-monitor"].requiredSince;
  const hits = searchSources(ctx.project.sources, MEMORY_RE);
  if (!hits.length) {
    return result(
      "memory-monitor",
      "fail",
      `No roAppMemoryMonitor usage was found. Static Analysis has required the Memory Monitor APIs since ${fmtDate(since)}`,
      [],
      since,
    );
  }
  return result("memory-monitor", "pass", `roAppMemoryMonitor is used (required since ${fmtDate(since)})`, [], since, {
    locations: locsFromHits(hits, "Memory Monitor API"),
  });
}

// --- RAF ---

const RAF_LIB_RE = /Library\s+["']Roku_Ads\.brs["']/i;
const RAF_CTOR_RE = /\bRoku_Ads\s*\(/i;
const STITCHED_INIT_RE = /\bStitchedAdsInit\s*\(/i;
const STITCHED_EVENT_RE = /\bStitchedAdHandledEvent\s*\(/i;
const AD_MEASURE_RE = /\benableAdMeasurements\s*\(/i;
const AD_HINT_RE = /Roku_Ads|roku_ads_lib|StitchedAdsInit|enableAdMeasurements|\bVAST\b|\bVMAP\b|ima.?sdk|video.?ads/i;

function checkRaf(ctx: CheckContext): CheckResult {
  const sources = ctx.project.sources;
  const m = ctx.project.manifest;
  const hinted = hasMatch(sources, AD_HINT_RE) || (manifestGet(m, "bs_libs_required") ?? "").toLowerCase().includes("roku_ads_lib");
  if (!hinted) {
    return result("raf", "skip", "Roku Advertising Framework not used");
  }
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  const statuses: CheckStatus[] = [];
  const libHits = searchSources(sources, RAF_LIB_RE);
  const ctorHits = searchSources(sources, RAF_CTOR_RE);
  const bsLibs = (manifestGet(m, "bs_libs_required") ?? "").split(/[,\s]+/).filter(Boolean);
  const hasLibManifest = bsLibs.some((s) => s.toLowerCase() === "roku_ads_lib");
  if (!libHits.length) {
    items.push('Missing Library "Roku_Ads.brs" import');
    statuses.push("fail");
  }
  if (!ctorHits.length) {
    items.push("Missing Roku_Ads() constructor");
    statuses.push("fail");
  }
  if (!hasLibManifest) {
    items.push("manifest is missing bs_libs_required=roku_ads_lib");
    locations.push({ file: m.file, line: m.lines.bs_libs_required, message: "bs_libs_required=roku_ads_lib is missing" });
    statuses.push("fail");
  }
  const initHits = searchSources(sources, STITCHED_INIT_RE);
  const eventHits = searchSources(sources, STITCHED_EVENT_RE);
  if (initHits.length && !eventHits.length) {
    items.push("StitchedAdsInit is used without StitchedAdHandledEvent");
    locations.push(...locsFromHits(initHits, "StitchedAdsInit without StitchedAdHandledEvent"));
    statuses.push("fail");
  } else if (eventHits.length && !initHits.length) {
    items.push("StitchedAdHandledEvent is used without StitchedAdsInit");
    locations.push(...locsFromHits(eventHits, "StitchedAdHandledEvent without StitchedAdsInit"));
    statuses.push("fail");
  }
  if (!hasMatch(sources, AD_MEASURE_RE)) {
    items.push("enableAdMeasurements was not found. For U.S. non-kids apps this is typically required; this is a warning because region and kids status cannot be known from the project");
    statuses.push("warn");
  }
  if (!statuses.length) {
    return result("raf", "pass", "RAF library import, constructor and manifest entry are present");
  }
  const status = worst(statuses);
  return result("raf", status, items[0] ?? "RAF setup looks incomplete", items, null, { locations });
}

// --- Roku Pay ---

const PAY_HINT_RE = /\broChannelStore\b|\bChannelStore\b|\bdoOrder\s*\(|\bGetCatalog\s*\(|\bdoPurchase\s*\(|Roku\s*Pay|storeProduct|productType|\bsubscri(be|ption)\b/i;
const CHANNELSTORE_RE = /\broChannelStore\b|CreateObject\s*\(\s*["']roChannelStore["']|\bChannelStore\b/i;
const SUB_HINT_RE = /\bsubscri(be|ption)|renewal|alreadySubscribed|productType\s*=\s*["']MonthlySub/i;
const DO_RECOVERY_RE = /\bdoRecovery\b/i;

function checkRokuPay(ctx: CheckContext): CheckResult {
  const sources = ctx.project.sources;
  if (!hasMatch(sources, PAY_HINT_RE)) {
    return result("roku-pay", "skip", "Roku Pay not used");
  }
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  const statuses: CheckStatus[] = [];
  const storeHits = searchSources(sources, CHANNELSTORE_RE);
  if (!storeHits.length) {
    items.push("The project looks transactional, but no ChannelStore or roChannelStore usage was found");
    statuses.push("fail");
  }
  if (hasMatch(sources, SUB_HINT_RE) && !hasMatch(sources, DO_RECOVERY_RE)) {
    items.push("Subscription-related code was found without doRecovery. Enhanced Subscription Recovery is required for subscriptions; this is a presence check only");
    statuses.push("warn");
  }
  if (!statuses.length) {
    return result("roku-pay", "pass", "ChannelStore / Roku Pay usage is present. This does not prove a purchase flow works");
  }
  return result("roku-pay", worst(statuses), items[0] ?? "Roku Pay setup looks incomplete", items, null, { locations });
}

// --- screensaver manifest ---

function checkScreensaverManifest(ctx: CheckContext): CheckResult {
  const m = ctx.project.manifest;
  const saver = manifestGet(m, "screensaver_title");
  const title = manifestGet(m, "title");
  if (!saver) {
    return result("screensaver-manifest", "skip", "Not a standalone screensaver");
  }
  const items: string[] = [];
  const locations: CheckLocation[] = [];
  if (title !== undefined) {
    items.push("title is set. A standalone screensaver must use screensaver_title only; Static Analysis treats a package with title as a channel and fails criterion 4.5");
    locations.push({ file: m.file, line: m.lines.title, message: "title is not allowed on a standalone screensaver" });
  }
  for (const key of ["major_version", "minor_version", "build_version"] as const) {
    if (!manifestGet(m, key)) {
      items.push(`${key} is required on a screensaver manifest`);
      locations.push({ file: m.file, message: `Missing ${key}` });
    }
  }
  if (items.length) {
    return result("screensaver-manifest", "fail", items[0]!, items, null, { locations });
  }
  return result("screensaver-manifest", "pass", `screensaver_title=${saver}, and title is not set`);
}

export const CHECKS: Record<CheckId, (ctx: CheckContext) => CheckResult> = {
  "manifest-required": checkManifestRequired,
  version: checkVersion,
  "rsg-version": checkRsgVersion,
  artwork: checkArtwork,
  "package-size": checkPackageSize,
  "deep-linking": checkDeepLinking,
  "deprecated-legacy-screens": checkLegacyScreens,
  "deprecated-apis": checkDeprecatedApis,
  "launch-beacon": checkLaunchBeacon,
  "memory-monitor": checkMemoryMonitor,
  raf: checkRaf,
  "roku-pay": checkRokuPay,
  "screensaver-manifest": checkScreensaverManifest,
};
