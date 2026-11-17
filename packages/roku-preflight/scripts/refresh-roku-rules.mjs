#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.ROKU_PREFLIGHT_API
  ? `${process.env.ROKU_PREFLIGHT_API.replace(/\/$/, "")}/api/roku-rules`
  : "https://devbooth.dev/api/roku-rules";
const res = await fetch(url, { headers: { Accept: "application/json" } });
if (!res.ok) {
  console.error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const data = await res.json();
if (data?.schemaVersion !== 1 || typeof data?.updatedAt !== "string" || !data?.checks) {
  console.error("Unrecognized roku-rules payload");
  process.exit(1);
}
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "preflight", "roku-rules.snapshot.json");
writeFileSync(dest, `${JSON.stringify(data, null, 2)}
`);
console.log(`Wrote ${dest} (updatedAt ${data.updatedAt})`);
