# 16kb-check

Check an Android project for Google Play 16KB page-size compatibility, right in your terminal.

Google Play requires apps that target Android 15 (API 35) or higher to support 16 KB memory page sizes on 64-bit devices. Starting February 1, 2027, updates that don't support 16 KB page sizes can't be released ([Android Developers](https://developer.android.com/guide/practices/page-sizes)). Run this at the root of your Android project and get a pass or fail report for every public SDK you declared.

```bash
npx 16kb-check
```

## Demo

```
SDK                                     Version  Status     Link
──────────────────────────────────────  ───────  ─────────  ────
io.sentry:sentry-android                7.14.0   not ready  https://16kb.dev/sdk/sentry-android
    Min 16 KB version: 7.18.0
com.mapbox.maps:android                 11.7.0   partial    https://16kb.dev/sdk/mapbox-maps-android
    Min 16 KB version: 11.7.0 (-ndk27 artifacts)
androidx.annotation:annotation          1.8.0    ready      https://16kb.dev/sdk/androidx-other-java
androidx.core:core-ktx                  1.15.0   ready      https://16kb.dev/sdk/androidx-core-ui
com.google.firebase:firebase-analytics  via BOM  ready      https://16kb.dev/sdk/firebase-android
com.squareup.okhttp3:okhttp             4.12.0   ready      https://16kb.dev/sdk/okhttp
com.squareup.okio:okio                  3.9.0    ready      https://16kb.dev/sdk/okhttp

"via BOM" means the version comes from this BOM: com.google.firebase:firebase-bom:33.7.0

7 public libraries: 5 ready, 1 not ready, 1 partial, 0 checking, 0 unknown.
2 private or internal libraries were skipped on this machine and never sent.
2 test-only dependencies were ignored (test, androidTest, testFixtures and test frameworks).
2 libraries may block your Feb 1, 2027 release.

Build plugins (build-time only, not packaged into your app, not counted above):
  com.android.application       8.7.3
  com.android.library           —
  org.jetbrains.kotlin.android  2.0.21
AGP check: Android Gradle Plugin 8.7.3 is 8.5.1 or newer, so uncompressed .so files are zip-aligned to 16 KB.

Note: This report only sees dependencies you declared, not every transitive library Gradle would resolve.
Note: BOM / platform versions are recorded but not expanded to a concrete module version, except when the SDK is compatible at any version.

This is a dependency-level check. Tip: verify the built APK with `zipalign -c -P 16 -v 4 app.apk` or Android Studio's APK Analyzer.
Google Play: apps targeting Android 15 (API 35) or higher must support 16 KB page sizes on 64-bit devices. Starting Feb 1, 2027, updates that don't support 16 KB can't be released.
```

This is the real output of `npx 16kb-check --path tests/fixtures/android-app --no-color` against the live 16kb.dev catalog. Your project will follow the same shape.

## Usage

```bash
# From the root of an Android project (where settings.gradle or settings.gradle.kts lives)
npx 16kb-check

# A different directory
npx 16kb-check --path /path/to/android-app

# Machine-readable output
npx 16kb-check --json

# Fail a CI job when a library is not ready or only partly ready
npx 16kb-check --ci

# Disable color
npx 16kb-check --no-color
```

Requires Node 18 or newer.

The CLI reads `settings.gradle` / `settings.gradle.kts`, every `build.gradle` / `build.gradle.kts`, and `gradle/libs.versions.toml` (plus other version catalogs in `gradle/`). It understands string coordinates, `group`/`name`/`version` maps, version catalog aliases, simple `${version}` variables, and `platform()` / BOM declarations. Test-only configurations, `project(...)` modules, and local `files()` / `fileTree()` artifacts are ignored.

Results are looked up against the public catalog at [16kb.dev](https://16kb.dev). If a public SDK is not in the database yet, the CLI asks the site to start an automatic check and shows a `checking` status, subject to the site's daily rate limit.

This report only sees dependencies you declared, not every transitive library Gradle would resolve.

### What gets counted

- **Release dependencies** are the only rows in the table and the only ones in the ready / not ready counts. Version catalog bundles (`libs.bundles.*`) are expanded into their libraries.
- **Test-only dependencies** (`test*`, `androidTest*`, `testFixtures*`, `kaptTest`, `kspAndroidTest`, and well-known test frameworks such as JUnit, Mockito, MockK, Robolectric, AndroidX Test) are ignored. The report says how many were ignored.
- **Build plugins** (`plugins {}`, `apply plugin:`, catalog `[plugins]`) are listed in their own short section. They run at build time and are not packaged into your app, so they are not counted.
- **Android Gradle Plugin**: the CLI reads the AGP version from the `plugins {}` block, the version catalog, or `buildscript { classpath "com.android.tools.build:gradle:..." }`. Below 8.5.1 it prints a warning, because AGP 8.5.1+ is what zip-aligns uncompressed `.so` files on 16 KB boundaries. If the version can't be resolved, the report says it was not checked.
- Versions managed by a BOM show as `via BOM`, and the BOM is named under the table. Coordinates are never cut off.

### Still checking

When a public SDK is new to 16kb.dev, the site checks it in the background, so counts can change between back-to-back runs. The report says when results are still settling. Re-run in a few minutes. `--json` includes `checkedAt` (ISO timestamp) and `settling` (true while anything is still being checked).

### It's a dependency-level check

The CLI checks what you declared, not the APK you built. Verify the final build too:

```bash
zipalign -c -P 16 -v 4 app.apk
```

or open the APK in Android Studio's APK Analyzer (Build > Analyze APK) and check the Alignment column for `.so` files.

## CI example

```yaml
name: 16KB check

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check 16KB compatibility
        run: npx --yes 16kb-check --ci --no-color
```

`--ci` exits with code 1 when any public library is `not ready` or `partial`. Unknown or still-checking libraries, and the AGP warning, do not fail the build.

### npm update notice

When you run through `npx`, npm itself may print a "New major version of npm available" notice after the report. That line comes from npm, not from 16kb-check. To turn it off (for example when you parse `--json` output), set:

```bash
npm_config_update_notifier=false npx --yes 16kb-check --json
```

## Privacy

Your Gradle and TOML files never leave your machine. We do not upload or store your project.

Private and internal SDKs are filtered out locally, before any network call. That includes:

- `com.github.*` coordinates and JitPack
- `project(...)` modules and local `files()` / `fileTree()` artifacts
- Any group that is not on the known public Maven prefix list (AndroidX, Google, and other well-known public publishers)

Private names are not printed in the table or the JSON output, and they are never sent to 16kb.dev. Only public `group:artifact` names are looked up. If a public SDK is not in the database yet and you declared a public version, that version may be sent so the site can check the published artifact. File contents are never sent.

## `--deep` (not implemented yet)

A future `--deep` flag would download public AARs from Maven Central or Google Maven and inspect each `.so` file's `PT_LOAD` `p_align` on your machine, so the check can also run offline. That is still a TODO. Today the CLI uses the [16kb.dev](https://16kb.dev) catalog.

## Status values

| Status     | Meaning |
|------------|---------|
| ready      | Compatible with 16KB, including well-known JVM-only libraries with no native code |
| not ready  | No compatible version, or the declared version is below the minimum 16KB-ready version |
| partial    | Only partly compatible, or extra steps are documented (for example a special artifact) |
| checking   | A public SDK we did not have yet; an automatic check is running on 16kb.dev |
| unknown    | Not in the database, or the declared version could not be compared |

Each row links to `https://16kb.dev/sdk/<slug>` when the SDK is in the catalog.

## License

MIT. Built for [16kb.dev](https://16kb.dev).
