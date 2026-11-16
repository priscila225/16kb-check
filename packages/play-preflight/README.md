# play-preflight

Check an Android app against Google Play's current rules before you ship. One command, every check, all on your machine.

```bash
npx play-preflight check
```

It reads your Gradle files, manifests and resources (or an APK / AAB) and prints one line per rule: **PASS**, **WARN**, **FAIL**, **SKIP**, or **INFO**. Each line links to Google's official page and to a plain-English explainer on [devbooth.dev](https://devbooth.dev). Any FAIL exits with code 1, so it drops straight into CI.

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

The API 37 target deadline isn't announced yet, so play-preflight doesn't print a date for it.

## Sample output

From `npx play-preflight check tests/fixtures/legacy-app --offline --no-color`:

```
play-preflight check  ·  app (targetSdk 35, from app/build.gradle via build.gradle)

FAIL  Target API level        targets 35, Play needs 36 for new apps and updates since Aug 31, 2026
      - The extension ran until Nov 1, 2026, so the rule is fully in force.
      Rule: https://support.google.com/googleplay/android-developer/answer/11926878
      → https://devbooth.dev/rules/play-target-api
WARN  16 KB page size         AGP 8.4.0 is below 8.5.1. Play blocks updates that aren't ready from Feb 1, 2027
      - SDK lookup skipped (--offline).
      - Android Gradle Plugin 8.4.0 is below 8.5.1. Upgrade to AGP 8.5.1 or newer so uncompressed .so files are zip-aligned to 16 KB (or set jniLibs.useLegacyPackaging = true).
      Rule: https://developer.android.com/guide/practices/page-sizes
      → https://devbooth.dev/deadlines/play-16kb
FAIL  Play Billing Library    7.1.1: the cutoff for version 7 and older was Aug 31, 2026 (extension Nov 1, 2026). Update to 8 or later
      - From com.android.billingclient:billing.
      Rule: https://developer.android.com/google/play/billing/deprecation-faq
      → https://devbooth.dev/deadlines/play-billing-9
FAIL  Foreground services     FOREGROUND_SERVICE is declared but no <service> has android:foregroundServiceType. startForeground() throws MissingForegroundServiceTypeException
      - Libraries can add services at build time. Build once or pass --apk to see them.
      Rule: https://developer.android.com/about/versions/14/changes/fgs-types-required
      → https://devbooth.dev/rules/foreground-service-types
WARN  Edge to edge            windowOptOutEdgeToEdgeEnforcement stops working when you target 36, which Play requires for updates
      - app/src/main/res/values/themes.xml
      Rule: https://developer.android.com/about/versions/16/behavior-changes-16
      → https://devbooth.dev/rules/edge-to-edge
WARN  Large screens           1 activity locks orientation or size. It will be ignored on screens 600dp and wider once you target 36
      - .PlayerActivity: screenOrientation=portrait
      Rule: https://developer.android.com/about/versions/16/behavior-changes-16
      → https://devbooth.dev/rules/large-screens-orientation
WARN  Predictive back         1 file uses the old back APIs, which stop being called once you target 36
      - app/src/main/java/dev/example/legacy/MainActivity.kt: overrides onBackPressed()
      Rule: https://developer.android.com/about/versions/16/behavior-changes-16
      → https://devbooth.dev/rules/predictive-back
WARN  Photo & video access    READ_MEDIA_IMAGES declared. Needs a Play Console declaration or the photo picker
      - Use the photo picker (androidx.activity 1.7.0+) unless the app's core use needs broad access.
      - Read from source manifests. Libraries can add permissions at build time, so build once or pass --apk.
      Rule: https://support.google.com/googleplay/android-developer/answer/14115180
      → https://devbooth.dev/rules/photo-video-permissions
WARN  Exact alarms            USE_EXACT_ALARM declared. Play only allows it for alarm, timer and calendar apps
      Rule: https://support.google.com/googleplay/android-developer/answer/13161072
      → https://devbooth.dev/rules/exact-alarms
WARN  Restricted permissions  2 restricted permissions need a Play Console declaration or a qualifying use
      - QUERY_ALL_PACKAGES: needs a declaration and a core use that requires it. Prefer <queries>
      - ACCESS_BACKGROUND_LOCATION: needs a Play Console declaration and review
      - Read from source manifests. Libraries can add permissions at build time, so build once or pass --apk.
      Rule: https://support.google.com/googleplay/android-developer/answer/13161072
      → https://devbooth.dev/deadlines/play-permissions
INFO  Account deletion        sign-in SDK found (Firebase Auth). Make sure in-app and web account deletion exist
      - If users can create accounts, Play needs an in-app way to delete the account and a web link in the Data safety form.
      Rule: https://support.google.com/googleplay/android-developer/answer/13327111
      → https://devbooth.dev/rules/account-deletion

Note: Read from source manifests. Permissions and services that libraries add at build time aren't included. Build once (or pass --apk) for the full picture.

0 pass · 7 warn · 3 fail · 0 skip · 1 info
Checked fully offline. Nothing left this machine.
```

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

# Pick checks
npx play-preflight check --only target-api,16kb
npx play-preflight check --skip account-deletion

# No network at all
npx play-preflight check --offline

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
| `--json` | JSON with `{ id, status, title, detail, deadline, source, link, items }` per check |
| `--strict` | Exit 1 on WARN too |
| `--only <ids>` / `--skip <ids>` | Comma-separated check ids |
| `--offline` | Skip the SDK lookup. Every other check is already local |
| `--no-color` | Plain output |

Exit codes: `0` no failures, `1` at least one FAIL (or WARN with `--strict`), `2` bad input.

Requires Node 18 or newer.

### Where values come from

- **targetSdk**: `--target-sdk`, then the APK, then a fresh merged manifest in `build/intermediates`, then Gradle (`build.gradle(.kts)`, version catalogs, `gradle.properties`, `ext` / `extra`, and convention plugins in `buildSrc` or `build-logic`). If it can't be resolved, the check says so instead of guessing.
- **Manifest**: the APK's binary manifest, else a merged manifest from your last build (if it's newer than your sources), else your source manifests combined. Source manifests miss what libraries add at build time, so the report says when that's the case.
- **Native libraries**: `lib/arm64-v8a` and `lib/x86_64` inside the APK, or `<module>/lib/...` inside the AAB. Each `.so` is parsed as ELF on your machine.

Reading the AAB manifest (protobuf) is planned for a later version.

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
        run: npx --yes play-preflight check --no-color
```

## Privacy

Everything runs on your machine. Your Gradle files, manifests, resources, sources and binaries are never uploaded.

The only network call is the public SDK lookup used by the `16kb` check:

- It downloads the public catalog from `https://devbooth.dev/api/catalog`. That request sends nothing about your project.
- Private and internal libraries are dropped on your machine first, including `com.github.*`, JitPack, `project(...)` modules and anything that isn't a known public Maven group. They're never printed or sent, only counted.
- If a public SDK isn't in the catalog yet, its public `group:artifact` name (and public version string) is sent so the site can check it.
- Your targetSdk, permissions, package name, module names and file contents are never sent.
- `--offline` skips the lookup completely.

## The `16kb` command

`npx play-preflight 16kb` is the full 16 KB SDK table that `16kb-check` printed, with the same options (`--path`, `--json`, `--ci`, `--no-color`). It lists every public SDK you declared with its 16 KB status and the minimum ready version.

## License

MIT. Built for [devbooth.dev](https://devbooth.dev).
