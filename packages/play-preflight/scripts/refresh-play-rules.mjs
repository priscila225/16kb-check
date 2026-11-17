#!/usr/bin/env node
// Refresh the bundled Play rules snapshot from the live https://devbooth.dev/api/play-rules
// endpoint. Used so offline mode and failed fetches still have current dates.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.argv[2] || "https://devbooth.dev/api/play-rules";
const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
if (!res.ok) throw new Error(`play-rules fetch failed: ${res.status} ${res.statusText}`);
const data = await res.json();
if (data?.schemaVersion !== 1) throw new Error(`unrecognized schemaVersion: ${data?.schemaVersion}`);
if (typeof data.updatedAt !== "string" || !data.checks) throw new Error("play-rules payload was not recognized");
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/preflight/play-rules.snapshot.json");
writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote snapshot (updated ${data.updatedAt}) to ${out}`);
