plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.app"
    compileSdk = AppConfig.COMPILE_SDK
    defaultConfig {
        applicationId = "com.example.app"
        minSdk = AppConfig.MIN_SDK
        targetSdk = AppConfig.TARGET_SDK
    }
}
