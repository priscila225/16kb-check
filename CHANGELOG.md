# Changelog

## 0.1.1

- Version catalog bundles (`libs.bundles.x`) now resolve, including when `[bundles]` is the last table, when a bundle has the same name as a library alias, for camelCase, dot, dash, underscore and `libs.bundles["x"]` accessors, and for bundles split over several lines.
- Gradle plugins moved out of the library table and counts into a short "Build plugins" section. The Android Gradle Plugin version is read from the plugins block, the version catalog, or the buildscript classpath, and a version below 8.5.1 is flagged. If it can't be resolved, the report says it was not checked.
- The text table never cuts a coordinate. Columns size to their content, BOM-managed versions show as "via BOM", and the minimum 16 KB version for rows that need attention goes on its own line.
- Test-only dependencies (`test*`, `androidTest*`, `testFixtures*`, `kaptTest`, `kspAndroidTest`, and known test frameworks such as JUnit and Mockito) are left out of the readiness counts. The report says how many were ignored.
- A note appears when any library is still being checked, since counts can change between runs. `--json` now includes `checkedAt` and `settling`.
- The deadline line now matches the wording on developer.android.com.
- The report says it is a dependency-level check and suggests verifying the APK with `zipalign -c -P 16 -v 4 app.apk` or APK Analyzer.
- README: how to silence npm's own update notice with `npm_config_update_notifier=false`.

## 0.1.0

- First release.
