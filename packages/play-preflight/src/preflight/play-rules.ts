import { createClient, USER_AGENT, type ApiClient } from "../sixteenkb/api";
import bundledJson from "./play-rules.snapshot.json";

export const PLAY_RULES_SCHEMA_VERSION = 1;
export const PLAY_RULES_PATH = "/api/play-rules";
export const PLAY_RULES_TIMEOUT_MS = 4000;

export type FormFactor = "phone" | "wear" | "automotive" | "tv";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PlayRulesChecks = {
  "target-api": {
    minTargetSdk: Record<FormFactor, number>;
    since: string;
    extensionEnded: string;
    existingAppsHiddenBelow: number;
  };
  "16kb": { blockFrom: string };
  "play-billing": {
    currentMajorRequired: number;
    nextMajor: number;
    v7Cutoff: string;
    v7Extension: string;
    v8SupportedUntil: string;
    v8Extension: string;
    v9SupportedUntil: string;
  };
  "foreground-services": {
    requiredFromTargetSdk: number;
    timeLimitFromTargetSdk: number;
  };
  "edge-to-edge": { optOutIgnoredFromTargetSdk: number };
  "large-screens": {
    locksIgnoredFromTargetSdk: number;
    optOutEndsAtTargetSdk: number;
  };
  "predictive-back": { defaultOnFromTargetSdk: number };
  "photo-video": { fromTargetSdk: number };
  "exact-alarms": { fromTargetSdk: number };
  "restricted-permissions": {
    atTargetSdk: number;
    fineLocationAndContactsFrom: string;
    localNetworkFrom: string;
  };
  "account-deletion": { inForceSince: string };
};

export type PlayRules = {
  schemaVersion: number;
  updatedAt: string;
  checks: PlayRulesChecks;
};

export type PlayRulesSource = "live" | "bundled";
export type PlayRulesFallback = "offline" | "error" | "unknown-schema";

export type ResolvedPlayRules = {
  source: PlayRulesSource;
  rules: PlayRules;
  fallbackReason?: PlayRulesFallback;
};

export const BUNDLED_PLAY_RULES: PlayRules = bundledJson as PlayRules;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isoDate(v: unknown): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) ? v : undefined;
}

function int(v: unknown, min = 1, max = 99): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function minTargetSdk(v: unknown): Record<FormFactor, number> | undefined {
  if (!isObject(v)) return undefined;
  const phone = int(v.phone);
  const wear = int(v.wear);
  const automotive = int(v.automotive);
  const tv = int(v.tv);
  if (phone === undefined || wear === undefined || automotive === undefined || tv === undefined) return undefined;
  return { phone, wear, automotive, tv };
}

/**
 * Accept a payload only when schemaVersion is the one this build understands
 * and every value the checks read is present and well formed. Unknown extra
 * fields are ignored so the site can add keys later.
 */
export function parsePlayRules(data: unknown): PlayRules | undefined {
  if (!isObject(data)) return undefined;
  if (data.schemaVersion !== PLAY_RULES_SCHEMA_VERSION) return undefined;
  const updatedAt = isoDate(data.updatedAt);
  if (!updatedAt) return undefined;
  if (!isObject(data.checks)) return undefined;
  const c = data.checks;

  if (!isObject(c["target-api"])) return undefined;
  const targetApi = {
    minTargetSdk: minTargetSdk(c["target-api"].minTargetSdk),
    since: isoDate(c["target-api"].since),
    extensionEnded: isoDate(c["target-api"].extensionEnded),
    existingAppsHiddenBelow: int(c["target-api"].existingAppsHiddenBelow),
  };
  if (!targetApi.minTargetSdk || !targetApi.since || !targetApi.extensionEnded || targetApi.existingAppsHiddenBelow === undefined) {
    return undefined;
  }

  if (!isObject(c["16kb"])) return undefined;
  const sixteenKb = { blockFrom: isoDate(c["16kb"].blockFrom) };
  if (!sixteenKb.blockFrom) return undefined;

  if (!isObject(c["play-billing"])) return undefined;
  const billing = {
    currentMajorRequired: int(c["play-billing"].currentMajorRequired, 1, 99),
    nextMajor: int(c["play-billing"].nextMajor, 1, 99),
    v7Cutoff: isoDate(c["play-billing"].v7Cutoff),
    v7Extension: isoDate(c["play-billing"].v7Extension),
    v8SupportedUntil: isoDate(c["play-billing"].v8SupportedUntil),
    v8Extension: isoDate(c["play-billing"].v8Extension),
    v9SupportedUntil: isoDate(c["play-billing"].v9SupportedUntil),
  };
  if (
    billing.currentMajorRequired === undefined ||
    billing.nextMajor === undefined ||
    !billing.v7Cutoff ||
    !billing.v7Extension ||
    !billing.v8SupportedUntil ||
    !billing.v8Extension ||
    !billing.v9SupportedUntil
  ) {
    return undefined;
  }

  if (!isObject(c["foreground-services"])) return undefined;
  const fgs = {
    requiredFromTargetSdk: int(c["foreground-services"].requiredFromTargetSdk),
    timeLimitFromTargetSdk: int(c["foreground-services"].timeLimitFromTargetSdk),
  };
  if (fgs.requiredFromTargetSdk === undefined || fgs.timeLimitFromTargetSdk === undefined) return undefined;

  if (!isObject(c["edge-to-edge"])) return undefined;
  const edge = { optOutIgnoredFromTargetSdk: int(c["edge-to-edge"].optOutIgnoredFromTargetSdk) };
  if (edge.optOutIgnoredFromTargetSdk === undefined) return undefined;

  if (!isObject(c["large-screens"])) return undefined;
  const large = {
    locksIgnoredFromTargetSdk: int(c["large-screens"].locksIgnoredFromTargetSdk),
    optOutEndsAtTargetSdk: int(c["large-screens"].optOutEndsAtTargetSdk),
  };
  if (large.locksIgnoredFromTargetSdk === undefined || large.optOutEndsAtTargetSdk === undefined) return undefined;

  if (!isObject(c["predictive-back"])) return undefined;
  const back = { defaultOnFromTargetSdk: int(c["predictive-back"].defaultOnFromTargetSdk) };
  if (back.defaultOnFromTargetSdk === undefined) return undefined;

  if (!isObject(c["photo-video"])) return undefined;
  const photo = { fromTargetSdk: int(c["photo-video"].fromTargetSdk) };
  if (photo.fromTargetSdk === undefined) return undefined;

  if (!isObject(c["exact-alarms"])) return undefined;
  const alarms = { fromTargetSdk: int(c["exact-alarms"].fromTargetSdk) };
  if (alarms.fromTargetSdk === undefined) return undefined;

  if (!isObject(c["restricted-permissions"])) return undefined;
  const restricted = {
    atTargetSdk: int(c["restricted-permissions"].atTargetSdk),
    fineLocationAndContactsFrom: isoDate(c["restricted-permissions"].fineLocationAndContactsFrom),
    localNetworkFrom: isoDate(c["restricted-permissions"].localNetworkFrom),
  };
  if (restricted.atTargetSdk === undefined || !restricted.fineLocationAndContactsFrom || !restricted.localNetworkFrom) {
    return undefined;
  }

  if (!isObject(c["account-deletion"])) return undefined;
  const deletion = { inForceSince: isoDate(c["account-deletion"].inForceSince) };
  if (!deletion.inForceSince) return undefined;

  return {
    schemaVersion: PLAY_RULES_SCHEMA_VERSION,
    updatedAt,
    checks: {
      "target-api": targetApi as PlayRulesChecks["target-api"],
      "16kb": { blockFrom: sixteenKb.blockFrom },
      "play-billing": billing as PlayRulesChecks["play-billing"],
      "foreground-services": fgs as PlayRulesChecks["foreground-services"],
      "edge-to-edge": edge as PlayRulesChecks["edge-to-edge"],
      "large-screens": large as PlayRulesChecks["large-screens"],
      "predictive-back": back as PlayRulesChecks["predictive-back"],
      "photo-video": photo as PlayRulesChecks["photo-video"],
      "exact-alarms": alarms as PlayRulesChecks["exact-alarms"],
      "restricted-permissions": restricted as PlayRulesChecks["restricted-permissions"],
      "account-deletion": { inForceSince: deletion.inForceSince },
    },
  };
}

export function bundledPlayRules(reason?: PlayRulesFallback): ResolvedPlayRules {
  const parsed = parsePlayRules(BUNDLED_PLAY_RULES) ?? BUNDLED_PLAY_RULES;
  return { source: "bundled", rules: parsed, fallbackReason: reason };
}

export async function fetchPlayRules(client: ApiClient, timeoutMs: number = PLAY_RULES_TIMEOUT_MS): Promise<PlayRules | undefined> {
  const url = `${client.baseUrl}${PLAY_RULES_PATH}`;
  const res = await client.fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`devbooth.dev play-rules failed (${res.status} ${res.statusText})`);
  return parsePlayRules(await res.json());
}

/**
 * Online: GET /api/play-rules with a short timeout. Falls back to the snapshot
 * bundled at publish time when offline, the request fails, or the schema is unknown.
 * Never sends anything about the project. --no-submit does not affect this.
 */
export async function loadPlayRules(opts: {
  offline: boolean;
  client?: ApiClient;
  timeoutMs?: number;
}): Promise<ResolvedPlayRules> {
  if (opts.offline) return bundledPlayRules("offline");
  try {
    const rules = await fetchPlayRules(opts.client ?? createClient(), opts.timeoutMs ?? PLAY_RULES_TIMEOUT_MS);
    if (!rules) return bundledPlayRules("unknown-schema");
    return { source: "live", rules };
  } catch {
    return bundledPlayRules("error");
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function playRulesLine(resolved: ResolvedPlayRules): string {
  const when = fmtDate(resolved.rules.updatedAt);
  if (resolved.source === "live") return `Play rules: live from devbooth.dev, updated ${when}`;
  if (resolved.fallbackReason === "offline") return `Play rules: bundled snapshot from ${when} (--offline)`;
  if (resolved.fallbackReason === "unknown-schema") return `Play rules: bundled snapshot from ${when} (unrecognized data)`;
  if (resolved.fallbackReason === "error") return `Play rules: bundled snapshot from ${when} (site didn't respond)`;
  return `Play rules: bundled snapshot from ${when}`;
}

export function playRulesJson(resolved: ResolvedPlayRules) {
  return {
    source: resolved.source,
    updatedAt: resolved.rules.updatedAt,
    ...(resolved.fallbackReason ? { fallbackReason: resolved.fallbackReason } : {}),
  };
}
