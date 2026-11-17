#!/usr/bin/env node
import { VERSION } from "./version";
import { run as run16kb, type RunIo } from "./sixteenkb/cli";
import { runCheck, type CheckIo } from "./preflight/run";

export const HELP = `play-preflight — check an Android app against Google Play's rules before you ship.

Usage:
  npx play-preflight [check] [dir] [options]   Run every Play check (the default)
  npx play-preflight 16kb [options]            The 16 KB SDK table (what 16kb-check did)

Run "npx play-preflight check --help" or "npx play-preflight 16kb --help" for options.

Everything runs on this machine. Only public SDK names are looked up on devbooth.dev.
--no-submit downloads the public list but sends nothing. --offline skips the network too.

  https://devbooth.dev/cli
`;

export type MainIo = RunIo & CheckIo;

export async function main(argv: string[], io: MainIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "16kb") return (await run16kb(rest, io)).exitCode;
  if (cmd === "check") return (await runCheck(rest, io)).exitCode;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    io.stdout.write(HELP);
    return 0;
  }
  if (cmd === undefined || cmd.startsWith("-") || !/^[a-z0-9-]+$/.test(cmd) || cmd.includes("/") || cmd.includes(".")) {
    return (await runCheck(argv, io)).exitCode;
  }
  // A bare word could be a folder name (npx play-preflight myapp).
  const { existsSync } = await import("node:fs");
  if (existsSync(cmd)) return (await runCheck(argv, io)).exitCode;
  io.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.stack || e.message : String(e)}\n`);
      process.exit(2);
    },
  );
}
