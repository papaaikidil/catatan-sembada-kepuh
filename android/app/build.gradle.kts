plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Nomor versi naik otomatis setiap kali GitHub merakit ulang.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "id.titikbotanika.kepuh"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.titikbotanika.kepuh"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // Kunci yang sama untuk setiap rakitan, supaya APK baru bisa dipasang menimpa yang lama.
    signingConfigs {
        create("sembada") {
            storeFile = file("sembada.jks")
            storePassword = "sembada-key"
            keyAlias = "sembada"
            keyPassword = "sembada-key"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sembada")
        }
        debug {
            signingConfig = signingConfigs.getByName("sembada")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
