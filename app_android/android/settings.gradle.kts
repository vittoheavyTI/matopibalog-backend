pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    // Firebase (push). Declarado com apply false: NAO exige google-services.json
    // aqui. O plugin so e aplicado no modulo :app quando o arquivo existir
    // (ver app/build.gradle.kts) — assim o build nao quebra enquanto o Firebase
    // nao estiver configurado.
    id("com.google.gms.google-services") version "4.4.2" apply false
}

include(":app")
