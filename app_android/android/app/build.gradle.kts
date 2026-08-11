plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android plugin.
    id("dev.flutter.flutter-gradle-plugin")
    kotlin("android")
}

// Firebase (push): aplica o plugin google-services SOMENTE quando o
// google-services.json existir. Sem o arquivo, o build segue normal e o app
// roda sem push (PushService trata a ausencia). Assim nao quebramos o build nem
// o Codemagic enquanto o Firebase nao estiver configurado.
val googleServicesJson = file("google-services.json")
if (googleServicesJson.exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.warn("google-services.json ausente: build sem Firebase/push (notificacoes internas continuam).")
}

android {
    // namespace mantido no pacote de codigo original para nao mover MainActivity.kt
    // agora (a renomeacao do pacote de codigo faz parte do rebranding chofer->matopiba).
    // O applicationId (identidade do app / Firebase) ja e o definitivo abaixo.
    namespace = "com.example.chofer_log"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications usa APIs de java.time; com minSdk 21 e
        // necessario o desugaring da biblioteca padrao para o build passar.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    defaultConfig {
        // Application ID definitivo de producao (reverse-DNS do dominio
        // matopibalog.com.br). O Firebase e registrado contra este id e o
        // google-services.json deve casar com ele.
        applicationId = "br.com.matopibalog.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Suporte de desugaring exigido por flutter_local_notifications (java.time)
    // quando minSdk < 26.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    // SEC-1 BLOCKER-2: FusedLocationProviderClient (fonte primaria de fixes do
    // LocationTrackingService). Ja presente transitivamente via geolocator_android;
    // declarada explicitamente para estabilidade de versao.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // SEC-1: testes JVM da logica PURA da fila offline (LocationQueueLogic).
    testImplementation("junit:junit:4.13.2")
}
