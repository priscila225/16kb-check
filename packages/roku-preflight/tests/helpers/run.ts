import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCheck, type CheckIo } from "../../src/preflight/run.ts";
import { bundledRokuRules } from "../../src/preflight/roku-rules.ts";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const fixture = (name: string) => join(FIXTURES, name);

export type JsonCheck = {
  id: string;
  status: string;
  title: string;
  detail: string;
  deadline: string | null;
  source: string;
  link: string;
  items: string[];
  locations?: { file: string; line?: number; message: string }[];
};
export type JsonOut = {
  tool: string;
  version: string;
  input: { title?: string; kind: string; input: string; version?: string; rsgVersion?: string; screensaver?: boolean };
  checks: JsonCheck[];
  summary: Record<string, number>;
  notes: string[];
  privacy: { offline: boolean };
  rokuRules?: { source: "live" | "bundled"; updatedAt: string; fallbackReason?: string };
  exitCode: number;
};

/** After the Oct 1, 2026 rules, before the Nov 2026 blackout and the Apr 1, 2027 API error. */
export const DEFAULT_NOW = new Date("2026-10-15T12:00:00Z");

function ioFor(args: string[], extra: Partial<CheckIo>): Partial<CheckIo> {
  const base: Partial<CheckIo> = { now: extra.now ?? DEFAULT_NOW, ...extra };
  if (extra.rokuRules !== undefined || extra.api || args.includes("--offline")) return base;
  return { rokuRules: bundledRokuRules(), ...base };
}

export async function runJson(args: string[], extra: Partial<CheckIo> = {}): Promise<{ exitCode: number; json: JsonOut; err: string }> {
  let out = "";
  let err = "";
  const res = await runCheck([...args, "--json"], {
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
    ...ioFor(args, extra),
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
    ...ioFor(args, extra),
  });
  return { exitCode: res.exitCode, out, err };
}

export function byId(json: JsonOut): Record<string, JsonCheck> {
  return Object.fromEntries(json.checks.map((c) => [c.id, c]));
}

export async function one(name: string, id: string, args: string[] = []): Promise<JsonCheck> {
  const { json } = await runJson([fixture(name), "--offline", "--only", id, ...args]);
  return byId(json)[id]!;
}
