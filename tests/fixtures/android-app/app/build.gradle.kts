plugins {
    alias(libs.plugins.android.application)
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.demo"
    compileSdk = 35
}

dependencies {
    implementation(libs.sentry.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.okhttp)
    implementation(libs.mapbox)
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation(project(":core"))
    implementation(files("libs/local-sdk.aar"))
    // Made-up private coordinate for filter tests. Not a real library.
    implementation("com.github.acme-internal:secret-kit:1.0.0")
    implementation("io.jitpack.sample:helper:0.2.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
