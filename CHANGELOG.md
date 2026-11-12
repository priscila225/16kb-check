# Changelog

## 0.1.2

- Public SDK groups that are listed in the 16kb.dev catalog (for example `org.pytorch`, `org.tensorflow`, `com.arthenica`) are now recognized as public. The CLI ships a list of the catalog's own groups and also reads groups from the catalog it downloads before it filters anything. Unknown and private coordinates are still never sent.
- Build logic is no longer counted as app libraries: `buildSrc`, included builds such as `build-logic`, convention-plugin modules (`kotlin-dsl`, `java-gradle-plugin`, `gradlePlugin {}`), Android lint-check modules, and Gradle/lint API artifacts. Annotation processors (`kapt`, `ksp`, `annotationProcessor`, including variant forms such as `kspDebug`) are also left out because they are never packaged.
- Modules that apply `com.android.test` (by id or through a version catalog alias) are test-only, so their `implementation` dependencies are not counted. More test artifacts are recognized, such as `hilt-android-testing`.
- The Android Gradle Plugin version is found when the buildscript block has several `classpath` lines and AGP is not the first one, for both string and version catalog forms.
- Each version catalog file resolves `version.ref` against its own `[versions]`, so two catalogs that use the same version key no longer swap versions.
- When the server says a library is already in the database but the downloaded catalog copy was older, the CLI reloads a fresh catalog so the row shows its real status instead of "unknown".

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
