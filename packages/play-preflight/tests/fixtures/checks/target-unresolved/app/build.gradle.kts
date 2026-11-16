plugins {
    id("com.android.application")
}

android {
    namespace = "dev.example.fixture"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.example.fixture"
        minSdk = 24
        targetSdk = AppConfig.computeTarget()
    }
}

dependencies {

}
