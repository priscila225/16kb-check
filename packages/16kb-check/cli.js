#!/usr/bin/env node
"use strict";

// 16kb-check moved to play-preflight. This wrapper keeps old scripts and CI jobs working
// by running `play-preflight 16kb` with the same arguments.
const VERSION = require("./package.json").version;
const NOTICE =
  "16kb-check moved to play-preflight.\n" +
  "  Same 16 KB table:        npx play-preflight 16kb\n" +
  "  Every Google Play check: npx play-preflight check\n\n";

async function main(argv) {
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  // The notice goes to stderr so --json output on stdout stays valid.
  process.stderr.write(NOTICE);
  const { run16kb } = require("play-preflight");
  const result = await run16kb(argv);
  return result.exitCode;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`${e && e.stack ? e.stack : String(e)}\n`);
    process.exit(2);
  },
);
