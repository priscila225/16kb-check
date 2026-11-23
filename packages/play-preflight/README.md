# play-preflight

Check an Android app against Google Play's current rules before you ship. One command, every check, all on your machine.

```bash
npx play-preflight check
```

It reads your Gradle files, manifests and resources (or an APK / AAB) and prints a scannable report: **FAIL**, **WARN** and **INFO** first, with details and links, then a compact **PASS** list and any **SKIP**s on one line. Links to Google's official page and a plain-English explainer on [devbooth.dev](https://devbooth.dev) appear on findings; `--verbose` shows them on every check. Any FAIL exits with code 1, so it drops straight into CI.

`play-preflight` used to be [`16kb-check`](https://www.npmjs.com/package/16kb-check). The old 16 KB SDK table is still here as `npx play-preflight 16kb`.

## What it checks

| Id | Check | Fails when | Warns when |
|---|---|---|---|
| `target-api` | Target API level | targetSdk is below Play's minimum: 36 for phones and tablets, 35 for Wear OS and Automotive, 34 for TV (since Aug 31, 2026) | |
| `16kb` | 16 KB page size | a 64-bit `.so` in the APK/AAB has `PT_LOAD` alignment below 16 KB, or an uncompressed `.so` isn't 16 KB zip-aligned | a public SDK isn't 16 KB ready, AGP is below 8.5.1, or `pageSizeCompat` is set. Play blocks updates that aren't ready from Feb 1, 2027 |
| `play-billing` | Play Billing Library | version 7 or older (cutoff Aug 31, 2026) | version 8 (supported until Aug 31, 2027), or the version can't be resolved |
| `foreground-services` | Foreground service types | `FOREGROUND_SERVICE` without any typed service, a type without its `FOREGROUND_SERVICE_<TYPE>` permission, or `specialUse` without its subtype property | `dataSync` / `mediaProcessing` time limits, `systemExempted` |
| `edge-to-edge` | Edge to edge | `windowOptOutEdgeToEdgeEnforcement` is set and you target 36 | the opt-out is set and you target 35 or lower |
| `large-screens` | Orientation and resizability | | activities lock orientation, resizability or aspect ratio (ignored on screens 600dp+ at target 36), or the temporary opt-out is set. Games are skipped |
| `predictive-back` | Predictive back | | `onBackPressed()` overrides or `KEYCODE_BACK` handling in your sources (not called on Android 16 at target 36). The manifest opt-out shows as INFO |
| `photo-video` | Photo and video access | | `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `MANAGE_EXTERNAL_STORAGE`, or `READ_EXTERNAL_STORAGE` without `maxSdkVersion="32"` |
| `exact-alarms` | Exact alarms | | `USE_EXACT_ALARM`, or `SCHEDULE_EXACT_ALARM` without a `canScheduleExactAlarms()` call |
| `restricted-permissions` | Other restricted permissions | | `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES`, SMS and Call Log, background location, full-screen intents, and at target 37+ fine location and contacts (Jan 27, 2027) and local network (Aug 25, 2027) |
| `account-deletion` | Account deletion | | never. If a sign-in SDK is found, an INFO line reminds you that Play needs in-app and web account deletion |

Permission rules are always warnings, never failures, because whether an app qualifies is a judgment call.

From August 2027, new apps and updates must target API 37. play-preflight prints that as a next-target note, with the month only, because Google hasn't named a day. The date is loaded from https://devbooth.dev/api/play-rules.

## Sample output

From `npx play-preflight check tests/fixtures/ready-app --offline --no-color` in a terminal (the same fixture was 48 lines before the scannable layout):

```
play-preflight check  ·  app  ·  source only  ·  targetSdk 36  minSdk 24  compileSdk 36
9 pass · 0 warn · 0 fail · 2 skip
source only: build-time permissions not included (pass --apk for the full picture)

PASS  Target API level        targets 36. Play needs 36 for new apps and updates since Aug 31, 2026
PASS  Play Billing Library    9.0.0 (supported until Aug 31, 2028)
PASS  Foreground services     1 typed service, permissions in place
PASS  Edge to edge            no windowOptOutEdgeToEdgeEnforcement opt-out found
PASS  Large screens           no orientation, resizability or aspect ratio locks
PASS  Predictive back         no onBackPressed() overrides or KEYCODE_BACK handling found
PASS  Photo & video access    no broad photo, video or storage permissions
PASS  Exact alarms            no exact alarm permissions
PASS  Restricted permissions  no restricted permissions that need a declaration
SKIP  16 KB page size (offline and no APK/AAB given, so nothing to check. Pass --apk or --aab to check the native libraries), Account deletion (no sign-in SDK found)

Checked fully offline. Nothing left this machine.
```

The summary line is at the top. When stdout is not a TTY, or with `--format github`, it is also printed at the bottom so CI log tails still show it.

`--verbose` (or `-v`) adds Rule and devbooth links on every check, side notes like "Next: API 37 for new apps and updates from August 2027", and a single `from <file>` line in the header. `--format github` prints `::error` / `::warning` / `::notice` annotations with file and line when known, then the same report, which GitHub Actions will attach to the pull request.

A failing app lists FAIL, then WARN, then INFO, each with details. Large-screen locks look like `PlayerActivity  app/src/main/AndroidManifest.xml:14  portrait`, pointing at the line of the attribute that triggered the finding (for example `screenOrientation`), with a fix hint and at most five activities unless you pass `--verbose`.

## Usage

```bash
# From your Android project root (where settings.gradle lives)
npx play-preflight check

# Another folder
npx play-preflight check path/to/project

# Read the manifest and native libraries straight from a build
npx play-preflight check --apk app/build/outputs/apk/release/app-release.apk
npx play-preflight check --aab app/build/outputs/bundle/release/app-release.aab

# Machine-readable output
npx play-preflight check --json

# GitHub Actions annotations
npx play-preflight check --format github

# Show every link, side note and ready SDK
npx play-preflight check --verbose

# Pick checks
npx play-preflight check --only target-api,16kb
npx play-preflight check --skip account-deletion

# No network at all
npx play-preflight check --offline

# Download the public SDK list, but never send unknown SDK names
npx play-preflight check --no-submit

# The old 16 KB SDK table (what 16kb-check did)
npx play-preflight 16kb
```

| Option | What it does |
|---|---|
| `[dir]`, `--path <dir>` | Project folder (default: current folder) |
| `--apk <file>` | Read the binary manifest and `.so` files from an APK |
| `--aab <file>` | Read the `.so` files from an AAB. Manifest checks use the project folder |
| `--module <name>` | App module to check when there are several (default: `app`) |
| `--target-sdk <n>` | Use this targetSdk when it can't be resolved from Gradle |
| `--json` | JSON with `{ id, status, title, detail, deadline, source, link, items }` per check. The `16kb` check also has `sdk` with numeric counts (`checked`, `ready`, `notReady`, `partial`, `unknown`, `checking`, `skippedPrivate`, `testOnlyIgnored`, `buildToolingIgnored`), never SDK names. Checks that have a file location also include `locations` with `file`, `line` (when known) and `message` |
| `--format text\|github` | `text` (default) or `github`, which emits `::error` / `::warning` / `::notice` annotations with file and line when known, plus the report |
| `--verbose`, `-v` | Show ready SDK rows, side notes, every locked activity, `from` details in the header, and Rule / devbooth links on all checks |
| `--strict` | Exit 1 on WARN too |
| `--only <ids>` / `--skip <ids>` | Comma-separated check ids |
| `--offline` | No network. Uses the Play dates bundled in this release and skips the SDK lookup |
| `--no-submit`, `--no-auto-check` | Download the public SDK list, but never send unknown SDK names. Same as `PLAY_PREFLIGHT_NO_SUBMIT=1` |
| `--no-color` | Plain output. Color is also off when stdout is not a TTY, or when `NO_COLOR` is set |

Exit codes: `0` no failures (warnings are ok unless `--strict`), `1` at least one FAIL (or a WARN with `--strict`), `2` bad usage or a runtime error (missing project, unreadable APK, unknown flag).

Requires Node 18 or newer.

### Where values come from

- **targetSdk**: `--target-sdk`, then the APK, then a fresh merged manifest in `build/intermediates`, then Gradle (`build.gradle(.kts)`, version catalogs, `gradle.properties`, `ext` / `extra`, and convention plugins in `buildSrc` or `build-logic`). If it can't be resolved, the check says so instead of guessing.
- **Manifest**: the APK's binary manifest, else a merged manifest from your last build (if it's newer than your sources), else your source manifests combined. Source manifests miss what libraries add at build time, so the report says when that's the case.
- **Native libraries**: `lib/arm64-v8a` and `lib/x86_64` inside the APK, or `<module>/lib/...` inside the AAB. Each `.so` is parsed as ELF on your machine.

Reading the AAB manifest (protobuf) is planned for a later version.

Online, the dates and API levels used by the checks come from `https://devbooth.dev/api/play-rules`, so a site update reaches you without a new npm release. If the site can't be reached, the schema isn't recognized, or you pass `--offline`, the snapshot bundled at publish time is used instead. `--verbose` prints which one was used and when it was last updated.

## CI example

```yaml
name: Play preflight

on:
  push:
  pull_request:

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Google Play checks
        run: npx --yes play-preflight check --format github
```

## Privacy

Everything runs on your machine. Your Gradle files, manifests, resources, sources and binaries are never uploaded.

The network calls are GETs on devbooth.dev. Neither request sends anything about your project:

- It downloads the current Play requirement dates from `https://devbooth.dev/api/play-rules` (deadlines, target API levels, billing cutoffs). `--verbose` says whether the live copy or the snapshot bundled in this release was used, and the date it was last updated.
- The `16kb` check also downloads the public catalog from `https://devbooth.dev/api/catalog`.
- Private and internal libraries are dropped on your machine first, including `com.github.*`, JitPack, `project(...)` modules and anything that isn't a known public Maven group. They're never printed or sent, only counted.
- If a public SDK isn't in the catalog yet, its public `group:artifact` name (and public version string) is sent so the site can check it.
- Your targetSdk, permissions, package name, module names and file contents are never sent.
- `--no-submit` (or `--no-auto-check`, or `PLAY_PREFLIGHT_NO_SUBMIT=1`) still downloads the dates and the catalog, but never sends unknown SDK names. The run ends with "Downloaded the public SDK list. Sent no SDK names."
- In default online mode the same closing line says what actually happened: "Downloaded the public SDK list. No unknown SDKs, so nothing was sent." or "Downloaded the public SDK list. Sent K unknown public SDK names to be checked." If any private or internal libraries were skipped, that count is appended. `play-preflight 16kb` prints the same closing line.
- `--offline` skips the network completely and uses the dates bundled in this release.

## The `16kb` command

`npx play-preflight 16kb` is the 16 KB check that `16kb-check` printed, with the same options (`--path`, `--json`, `--ci`, `--no-color`, plus `--no-submit` and `--verbose`). By default it prints the public SDK counts, one line for skipped private, test-only and build-time dependencies, the AGP verdict and the deadline. `--verbose` lists every public library, the build plugins, notes and the APK verification tip.

Exit codes for `16kb`: `0` ok (not-ready libraries are reported, but the command still exits 0 unless `--ci`), `1` if `--ci` was set and a library is not ready or only partially ready, `2` bad usage or a runtime error.

## License

MIT. Built for [devbooth.dev](https://devbooth.dev).
