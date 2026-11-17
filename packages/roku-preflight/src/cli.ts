#!/usr/bin/env node
import { existsSync } from "node:fs";
import { VERSION } from "./version";
import { runCheck, type CheckIo } from "./preflight/run";

export const HELP = `roku-preflight — check a Roku app against certification rules before you submit.

Usage:
  npx roku-preflight [check] [path|zip] [options]   Run every static cert check (the default)

Run "npx roku-preflight check --help" for options.

Everything runs on this machine. The only network call is a GET on
https://devbooth.dev/api/roku-rules for current dates and sizes, and it sends
nothing about your project. --offline skips the network too.

This does not replace Roku's official Static Analysis, which is still required
when you submit.

  https://devbooth.dev
`;

export type MainIo = CheckIo;

export async function main(argv: string[], io: MainIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const [cmd, ...rest] = argv;
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
