import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCheck, type CheckIo } from "../../src/preflight/run.ts";
import type { CatalogEntry } from "../../src/sixteenkb/check/types.ts";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const fixture = (name: string) => join(FIXTURES, name);

export const CATALOG: CatalogEntry[] = [
  {
    slug: "sentry-android",
    name: "Sentry Android",
    status: "compatible",
    minVersion: "7.18.0",
    notes: "",
    mavenCoords: ["io.sentry:sentry-android", "io.sentry:sentry-android-*"],
  },
  {
    slug: "firebase-android",
    name: "Firebase Android",
    status: "compatible",
    minVersion: "any (no native libraries in most modules)",
    notes: "",
    mavenCoords: ["com.google.firebase:*"],
  },
  {
    slug: "play-billing",
    name: "Play Billing",
    status: "compatible",
    minVersion: "any",
    notes: "",
    mavenCoords: ["com.android.billingclient:*"],
  },
];

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
export type JsonCheck = { id: string; status: string; title: string; detail: string; deadline: string | null; source: string; link: string; items: string[]; sdk?: SdkCounts; locations?: { file: string; line?: number; message: string }[] };
export type JsonOut = {
  tool: string;
  version: string;
  input: { module?: string; targetSdk?: number; targetFrom?: string; minSdk?: number; minSdkFrom?: string; compileSdk?: number; compileSdkFrom?: string; formFactor: string; manifestKind: string; binary?: string };
  checks: JsonCheck[];
  summary: Record<string, number>;
  notes: string[];
  privacy: { offline: boolean; noSubmit?: boolean; lookedUp: boolean; skippedPrivate: number; submitted?: number; pendingUnknown?: number };
  exitCode: number;
};

export async function runJson(args: string[], extra: Partial<CheckIo> = {}): Promise<{ exitCode: number; json: JsonOut; err: string }> {
  let out = "";
  let err = "";
  const res = await runCheck([...args, "--json"], {
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
    ...extra,
  });
  if (!out) throw new Error(`no output; stderr: ${err}`);
  return { exitCode: res.exitCode, json: JSON.parse(out) as JsonOut, err };
}

export async function runText(args: string[], extra: Partial<CheckIo> = {}): Promise<{ exitCode: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const res = await runCheck(args, {
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
    ...extra,
  });
  return { exitCode: res.exitCode, out, err };
}

export function byId(json: JsonOut): Record<string, JsonCheck> {
  return Object.fromEntries(json.checks.map((c) => [c.id, c]));
}

/** Run a single check offline on a per-check fixture. */
export async function one(name: string, id: string, args: string[] = []): Promise<JsonCheck> {
  const { json } = await runJson([fixture(`checks/${name}`), "--offline", "--only", id, ...args]);
  return byId(json)[id];
}
