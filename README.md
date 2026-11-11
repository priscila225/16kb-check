# 16kb-check

Check an Android project for Google Play 16KB page-size compatibility, right in your terminal.

Starting February 1, 2027, Google Play will block app updates that target API 35+ if they are not 16KB ready. Run this at the root of your Android project and get a pass or fail report for every public SDK you declared.

```bash
npx 16kb-check
```

## Demo

```
SDK                                         Version             Status      Min 16KB          Link                                            
──────────────────────────────────────────  ──────────────────  ──────────  ────────────────  ────────────────────────────────────────────────
io.sentry:sentry-android                    7.14.0              not ready   7.18.0            https://16kb.dev/sdk/sentry-android             
com.mapbox.maps:android                     11.7.0              partial     11.7.0 (-ndk27 …  https://16kb.dev/sdk/mapbox-maps-android        
org.jetbrains.kotlin.android                2.0.21              ready       —                                                                 
androidx.annotation:annotation              1.8.0               ready       any (no native …  https://16kb.dev/sdk/androidx-other-java        
androidx.core:core-ktx                      1.15.0              ready       any (no native …  https://16kb.dev/sdk/androidx-core-ui           
com.android.application                     8.7.3               ready       any (build tool…  https://16kb.dev/sdk/android-gradle-plugin      
com.android.library                         —                   ready       any (build tool…  https://16kb.dev/sdk/android-gradle-plugin      
com.google.firebase:firebase-analytics      BOM com.google.fi…  ready       any (no native …  https://16kb.dev/sdk/firebase-android           
com.squareup.okhttp3:okhttp                 4.12.0              ready       any (no native …  https://16kb.dev/sdk/okhttp                     
com.squareup.okio:okio                      3.9.0               ready       any (no native …  https://16kb.dev/sdk/okhttp                     

10 public libraries: 8 ready, 1 not ready, 1 partial, 0 checking, 0 unknown.
2 private or internal libraries were skipped on this machine and never sent.
2 libraries may block your Feb 1, 2027 release.

Note: This report only sees dependencies you declared, not every transitive library Gradle would resolve.
Note: BOM / platform versions are recorded but not expanded to a concrete module version, except when the SDK is compatible at any version.

Google Play blocks updates targeting API 35+ without 16KB support from Feb 1, 2027.
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

Requires Node 18 or newer. Until this package is published to npm, you can also run it from the GitHub repo:

```bash
npx --yes github:priscila225/16kb-check
```

The CLI reads `settings.gradle` / `settings.gradle.kts`, every `build.gradle` / `build.gradle.kts`, and `gradle/libs.versions.toml` (plus other version catalogs in `gradle/`). It understands string coordinates, `group`/`name`/`version` maps, version catalog aliases, simple `${version}` variables, and `platform()` / BOM declarations. Test-only configurations, `project(...)` modules, and local `files()` / `fileTree()` artifacts are ignored.

Results are looked up against the public catalog at [16kb.dev](https://16kb.dev). If a public SDK is not in the database yet, the CLI asks the site to start an automatic check and shows a `checking` status, subject to the site's daily rate limit.

This report only sees dependencies you declared, not every transitive library Gradle would resolve.

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

`--ci` exits with code 1 when any public library is `not ready` or `partial`. Unknown or still-checking libraries do not fail the build.

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
