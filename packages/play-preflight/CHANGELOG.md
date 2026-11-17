# Changelog

## 1.0.0

First release as play-preflight (formerly 16kb-check).

- `play-preflight check` runs every Google Play check: target API by form factor, 16 KB page size, Play Billing Library version, foreground service types, edge to edge, large screens, predictive back, photo and video access, exact alarms, other restricted permissions, and an account deletion reminder.
- Every check prints PASS, WARN, FAIL, SKIP or INFO with Google's official source and a devbooth.dev link. Any FAIL exits 1. `--strict` also fails on WARN.
- `--apk` reads the binary manifest and checks every 64-bit `.so` for 16 KB ELF alignment and 16 KB zip alignment, fully offline. `--aab` checks the `.so` files in every module.
- Uses a fresh merged manifest from `build/intermediates` when there is one, so permissions added by libraries are included.
- targetSdk is resolved from Gradle files, version catalogs, `gradle.properties`, `ext` / `extra` and convention plugins, or `--target-sdk`. minSdk and compileSdk are read the same way (minSdk also from the APK) and shown in the header.
- Predictive back: only an `<application>` opt-out covers the whole app. An activity opt-out, like one a library adds, only excuses that activity.
- Foreground services: an untyped service from a dependency, or one whose owner can't be told (APK only), is a WARN about the runtime risk. It's a FAIL only when the service is in your own manifest.
- `--json`, `--only`, `--skip`, `--offline`, `--module`.
- `play-preflight 16kb` is the old 16kb-check table, unchanged.
- The SDK lookup sends `User-Agent: play-preflight/<version>`.
