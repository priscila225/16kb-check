# Changelog

## 1.1.1

- The target API check now prints the next announced target from `https://devbooth.dev/api/play-rules`, currently "Next: API 37 for new apps and updates from August 2027. Google hasn't named a day."
- The bundled snapshot was refreshed on Nov 23, 2026.

## 1.1.0

- In online mode, Play requirement dates, target API levels and billing cutoffs are loaded from `https://devbooth.dev/api/play-rules`. The request is a GET, sends nothing about your project, and has a short timeout. `--no-submit` does not affect it.
- If you pass `--offline`, the site can't be reached, or the data uses an unknown schema version, the snapshot bundled at publish time is used instead. `npm run refresh-play-rules` updates that snapshot from the live endpoint.
- `--verbose` prints which data was used and the date it was last updated, for example "Play rules: live from devbooth.dev, updated Nov 16, 2026". The same details are in the JSON output as `playRules`.

## 1.0.0

First release as play-preflight (formerly 16kb-check).

- Text output is ordered for scanning: a header with the module, targetSdk, compileSdk and what was scanned, the summary counts at the top, then FAIL, WARN and INFO (with details and links), a one-line PASS list, and SKIP checks collapsed onto one line. The summary is repeated at the bottom only when stdout is not a TTY or with `--format github`. `--verbose` (`-v`) shows links on every check, side notes, and every locked activity, and prints a single `from <file>` line in the header instead of repeating it for every SDK value.
- The source-manifest caveat is a short header line when no `--apk`/`--aab` was given: "source only: build-time permissions not included (pass --apk for the full picture)".
- Large-screen findings use the short class name, `file:line` and the lock (for example `SplashActivity  app/src/main/AndroidManifest.xml:42  portrait`), pointing at the line of the attribute that triggered the finding, with a fix hint and at most five activities unless you pass `--verbose`. The XML parser records tag and attribute line numbers, and `--json` includes a `locations` array when they are known.
- `play-preflight 16kb` default output is the public SDK counts (with "(use --verbose to list)"), one line for skipped private, test-only and build-time dependencies, the AGP verdict and the deadline. `--verbose` lists every public library, the build plugins, notes and the APK verification tip.
- `--format github` emits `::error` / `::warning` / `::notice` annotations with file and line when known, plus the report. Exit codes are documented in `--help` and the README (`0` ok, `1` FAIL or WARN with `--strict`, `2` usage or runtime error). Color is off when stdout is not a TTY or `NO_COLOR` is set.
- `play-preflight check` runs every Google Play check: target API by form factor, 16 KB page size, Play Billing Library version, foreground service types, edge to edge, large screens, predictive back, photo and video access, exact alarms, other restricted permissions, and an account deletion reminder.
- Every check prints PASS, WARN, FAIL, SKIP or INFO with Google's official source and a devbooth.dev link. Any FAIL exits 1. `--strict` also fails on WARN.
- `--apk` reads the binary manifest and checks every 64-bit `.so` for 16 KB ELF alignment and 16 KB zip alignment, fully offline. `--aab` checks the `.so` files in every module.
- Uses a fresh merged manifest from `build/intermediates` when there is one, so permissions added by libraries are included.
- targetSdk is resolved from Gradle files, version catalogs, `gradle.properties`, `ext` / `extra` and convention plugins, or `--target-sdk`. minSdk and compileSdk are read the same way (minSdk also from the APK) and shown in the header.
- Predictive back: only an `<application>` opt-out covers the whole app. An activity opt-out, like one a library adds, only excuses that activity.
- Foreground services: an untyped service from a dependency, or one whose owner can't be told (APK only), is a WARN about the runtime risk. It's a FAIL only when the service is in your own manifest.
- `--json`, `--only`, `--skip`, `--offline`, `--module`.
- `--no-submit` (alias `--no-auto-check`, or `PLAY_PREFLIGHT_NO_SUBMIT=1`) downloads the public SDK catalog but never POSTs unknown SDK names to `/api/check-demand`. The run ends with "Downloaded the public SDK list. Sent no SDK names."
- In default online mode the closing line says whether any unknown public SDK names were sent, including the count. `play-preflight 16kb` uses the same closing line.
- `check --json` includes numeric SDK breakdown counts on the `16kb` check (`ready`, `unknown`, `checking`, private skipped, test-only ignored, build-time ignored).
- `play-preflight 16kb` is the old 16kb-check table, unchanged.
- The SDK lookup sends `User-Agent: play-preflight/<version>`.
