plugins {
    id("com.android.application")
}

android {
    namespace = "dev.example.fixture"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.example.fixture"
        minSdk = 24
        targetSdk = 36
    }
}

dependencies {
    implementation("io.sentry:sentry-android:7.14.0")
    implementation("com.github.acme-internal:secret-kit:2.0.0")
}
