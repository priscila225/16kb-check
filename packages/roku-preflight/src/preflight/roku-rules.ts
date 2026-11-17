import { createClient, USER_AGENT, type ApiClient } from "./api";
import bundledJson from "./roku-rules.snapshot.json";

export const ROKU_RULES_SCHEMA_VERSION = 1;
export const ROKU_RULES_PATH = "/api/roku-rules";
export const ROKU_RULES_TIMEOUT_MS = 4000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SizePair = [number, number];

export type RokuRulesChecks = {
  "package-size": { maxMb: number };
  "rsg-version": { required: string; requiredSince: string };
  "min-firmware": { minimum: string; requiredSince: string };
  "memory-monitor": { requiredSince: string };
  "init-client-certificates": { warningSince: string; errorFrom: string };
  launch: { maxSeconds: number; beacon: string };
  transitions: { maxSeconds: number };
  "video-start": { maxSeconds: number };
  navigation: { maxMs: number };
  artwork: {
    iconFhd: SizePair;
    iconHd: SizePair;
    splashFhd: SizePair;
    splashHd: SizePair;
    splashSd: SizePair;
  };
  blackouts: { start: string; end: string }[];
};

export type RokuRules = {
  schemaVersion: number;
  updatedAt: string;
  checks: RokuRulesChecks;
};

export type RokuRulesSource = "live" | "bundled";
export type RokuRulesFallback = "offline" | "error" | "unknown-schema";

export type ResolvedRokuRules = {
  source: RokuRulesSource;
  rules: RokuRules;
  fallbackReason?: RokuRulesFallback;
};

export const BUNDLED_ROKU_RULES: RokuRules = bundledJson as RokuRules;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isoDate(v: unknown): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) ? v : undefined;
}

function num(v: unknown, min = 0, max = 10_000): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

function int(v: unknown, min = 0, max = 10_000): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

function sizePair(v: unknown): SizePair | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const w = int(v[0], 1, 10_000);
  const h = int(v[1], 1, 10_000);
  if (w === undefined || h === undefined) return undefined;
  return [w, h];
}

function blackouts(v: unknown): { start: string; end: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: { start: string; end: string }[] = [];
  for (const item of v) {
    if (!isObject(item)) return undefined;
    const start = isoDate(item.start);
    const end = isoDate(item.end);
    if (!start || !end) return undefined;
    out.push({ start, end });
  }
  return out;
}

/**
 * Accept a payload only when schemaVersion is the one this build understands
 * and every value the checks read is present and well formed. Unknown extra
 * fields are ignored so the site can add keys later.
 */
export function parseRokuRules(data: unknown): RokuRules | undefined {
  if (!isObject(data)) return undefined;
  if (data.schemaVersion !== ROKU_RULES_SCHEMA_VERSION) return undefined;
  const updatedAt = isoDate(data.updatedAt);
  if (!updatedAt) return undefined;
  if (!isObject(data.checks)) return undefined;
  const c = data.checks;

  if (!isObject(c["package-size"])) return undefined;
  const packageSize = { maxMb: num(c["package-size"].maxMb, 0.1, 100) };
  if (packageSize.maxMb === undefined) return undefined;

  if (!isObject(c["rsg-version"])) return undefined;
  const rsg = {
    required: typeof c["rsg-version"].required === "string" ? c["rsg-version"].required.trim() : undefined,
    requiredSince: isoDate(c["rsg-version"].requiredSince),
  };
  if (!rsg.required || !rsg.requiredSince) return undefined;

  if (!isObject(c["min-firmware"])) return undefined;
  const firmware = {
    minimum: typeof c["min-firmware"].minimum === "string" ? c["min-firmware"].minimum.trim() : undefined,
    requiredSince: isoDate(c["min-firmware"].requiredSince),
  };
  if (!firmware.minimum || !firmware.requiredSince) return undefined;

  if (!isObject(c["memory-monitor"])) return undefined;
  const memory = { requiredSince: isoDate(c["memory-monitor"].requiredSince) };
  if (!memory.requiredSince) return undefined;

  if (!isObject(c["init-client-certificates"])) return undefined;
  const certs = {
    warningSince: isoDate(c["init-client-certificates"].warningSince),
    errorFrom: isoDate(c["init-client-certificates"].errorFrom),
  };
  if (!certs.warningSince || !certs.errorFrom) return undefined;

  if (!isObject(c.launch)) return undefined;
  const launch = {
    maxSeconds: num(c.launch.maxSeconds, 1, 120),
    beacon: typeof c.launch.beacon === "string" ? c.launch.beacon.trim() : undefined,
  };
  if (launch.maxSeconds === undefined || !launch.beacon) return undefined;

  if (!isObject(c.transitions)) return undefined;
  const transitions = { maxSeconds: num(c.transitions.maxSeconds, 0.1, 60) };
  if (transitions.maxSeconds === undefined) return undefined;

  if (!isObject(c["video-start"])) return undefined;
  const videoStart = { maxSeconds: num(c["video-start"].maxSeconds, 0.1, 60) };
  if (videoStart.maxSeconds === undefined) return undefined;

  if (!isObject(c.navigation)) return undefined;
  const navigation = { maxMs: int(c.navigation.maxMs, 1, 10_000) };
  if (navigation.maxMs === undefined) return undefined;

  if (!isObject(c.artwork)) return undefined;
  const artwork = {
    iconFhd: sizePair(c.artwork.iconFhd),
    iconHd: sizePair(c.artwork.iconHd),
    splashFhd: sizePair(c.artwork.splashFhd),
    splashHd: sizePair(c.artwork.splashHd),
    splashSd: sizePair(c.artwork.splashSd),
  };
  if (!artwork.iconFhd || !artwork.iconHd || !artwork.splashFhd || !artwork.splashHd || !artwork.splashSd) {
    return undefined;
  }

  const blackoutList = blackouts(c.blackouts);
  if (!blackoutList) return undefined;

  return {
    schemaVersion: ROKU_RULES_SCHEMA_VERSION,
    updatedAt,
    checks: {
      "package-size": { maxMb: packageSize.maxMb },
      "rsg-version": { required: rsg.required, requiredSince: rsg.requiredSince },
      "min-firmware": { minimum: firmware.minimum, requiredSince: firmware.requiredSince },
      "memory-monitor": { requiredSince: memory.requiredSince },
      "init-client-certificates": { warningSince: certs.warningSince, errorFrom: certs.errorFrom },
      launch: { maxSeconds: launch.maxSeconds, beacon: launch.beacon },
      transitions: { maxSeconds: transitions.maxSeconds },
      "video-start": { maxSeconds: videoStart.maxSeconds },
      navigation: { maxMs: navigation.maxMs },
      artwork: artwork as RokuRulesChecks["artwork"],
      blackouts: blackoutList,
    },
  };
}

export function bundledRokuRules(reason?: RokuRulesFallback): ResolvedRokuRules {
  const parsed = parseRokuRules(BUNDLED_ROKU_RULES) ?? BUNDLED_ROKU_RULES;
  return { source: "bundled", rules: parsed, fallbackReason: reason };
}

export async function fetchRokuRules(client: ApiClient, timeoutMs: number = ROKU_RULES_TIMEOUT_MS): Promise<RokuRules | undefined> {
  const url = `${client.baseUrl}${ROKU_RULES_PATH}`;
  const res = await client.fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`devbooth.dev roku-rules failed (${res.status} ${res.statusText})`);
  return parseRokuRules(await res.json());
}

/**
 * Online: GET /api/roku-rules with a short timeout. Falls back to the snapshot
 * bundled at publish time when offline, the request fails, or the schema is unknown.
 * Never sends anything about the project.
 */
export async function loadRokuRules(opts: {
  offline: boolean;
  client?: ApiClient;
  timeoutMs?: number;
}): Promise<ResolvedRokuRules> {
  if (opts.offline) return bundledRokuRules("offline");
  try {
    const rules = await fetchRokuRules(opts.client ?? createClient(), opts.timeoutMs ?? ROKU_RULES_TIMEOUT_MS);
    if (!rules) return bundledRokuRules("unknown-schema");
    return { source: "live", rules };
  } catch {
    return bundledRokuRules("error");
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}, ${y}`;
}

export function fmtDateRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm! - 1]} ${sd}–${ed}, ${sy}`;
  if (sy === ey) return `${MONTHS[sm! - 1]} ${sd} – ${MONTHS[em! - 1]} ${ed}, ${sy}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function rokuRulesLine(resolved: ResolvedRokuRules): string {
  const when = fmtDate(resolved.rules.updatedAt);
  if (resolved.source === "live") return `Roku rules: live from devbooth.dev, updated ${when}`;
  if (resolved.fallbackReason === "offline") return `Roku rules: bundled snapshot from ${when} (--offline)`;
  if (resolved.fallbackReason === "unknown-schema") return `Roku rules: bundled snapshot from ${when} (unrecognized data)`;
  if (resolved.fallbackReason === "error") return `Roku rules: bundled snapshot from ${when} (site didn't respond)`;
  return `Roku rules: bundled snapshot from ${when}`;
}

export function rokuRulesJson(resolved: ResolvedRokuRules) {
  return {
    source: resolved.source,
    updatedAt: resolved.rules.updatedAt,
    ...(resolved.fallbackReason ? { fallbackReason: resolved.fallbackReason } : {}),
  };
}

export function isoDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compare YYYY-MM-DD strings. */
export function isoCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function currentOrUpcomingBlackout(
  blackouts: { start: string; end: string }[],
  today: string,
  upcomingDays = 14,
): { start: string; end: string; current: boolean } | undefined {
  const upcomingUntil = new Date(`${today}T00:00:00Z`);
  upcomingUntil.setUTCDate(upcomingUntil.getUTCDate() + upcomingDays);
  const until = isoDay(upcomingUntil);
  for (const b of blackouts) {
    if (isoCmp(today, b.start) >= 0 && isoCmp(today, b.end) <= 0) return { ...b, current: true };
    if (isoCmp(b.start, today) > 0 && isoCmp(b.start, until) <= 0) return { ...b, current: false };
  }
  return undefined;
}
