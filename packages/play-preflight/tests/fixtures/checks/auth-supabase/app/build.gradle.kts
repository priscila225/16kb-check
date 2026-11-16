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
    implementation("io.github.jan-tennert.supabase:auth-kt:3.0.0")
    implementation("androidx.credentials:credentials:1.3.0")
}
