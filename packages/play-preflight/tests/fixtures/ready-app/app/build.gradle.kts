plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.example.ready"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.example.ready"
        minSdk = 24
        targetSdk = libs.versions.targetSdk.get().toInt()
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.billing.ktx)
}
