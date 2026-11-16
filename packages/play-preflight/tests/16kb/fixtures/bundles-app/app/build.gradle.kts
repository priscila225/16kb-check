plugins {
    id("com.android.application")
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
    // Made-up convention plugin id. Not a real plugin.
    id("acme.android.conventions")
}

dependencies {
    // Bundle whose name matches a library alias, declared in the last TOML table.
    implementation(libs.bundles.adsSdk)
    // Same bundle via the dash / dot accessor forms Gradle generates.
    implementation(libs.bundles.net.stack)
    implementation(libs.bundles["ui-kit"])

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3.adaptive.navigation.suite)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation(libs.junit.jupiter.api)
    "testImplementation"("org.mockito:mockito-core:5.14.2")
    kaptTest("com.google.dagger:hilt-compiler:2.52")
    androidTestImplementation(libs.androidx.test.runner)
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.7.5")
}
