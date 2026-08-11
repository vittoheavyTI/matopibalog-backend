package com.example.chofer_log

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "br.com.matopibalog/location_tracking"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val token = call.argument<String>("token")
                    val baseUrl = call.argument<String>("baseUrl")
                    // SEC-1 (Opção C): modo, device e expirações da credencial.
                    // Ausentes → "session" (compatível): o app envia o access token, como hoje.
                    val mode = call.argument<String>("mode") ?: LocationTrackingService.MODE_SESSION
                    val deviceId = call.argument<String>("deviceId")
                    val expiresAt = asLong(call.argument<Any>("expiresAt"))
                    val maxExpiresAt = asLong(call.argument<Any>("maxExpiresAt"))
                    if (token.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                        result.error("invalid_args", "Dados insuficientes para iniciar.", null)
                        return@setMethodCallHandler
                    }
                    LocationTrackingService.start(this, token, baseUrl, mode, deviceId, expiresAt, maxExpiresAt)
                    result.success(true)
                }
                "stop" -> {
                    LocationTrackingService.stop(this)
                    result.success(true)
                }
                // SEC-1 (reassessment #3): liveness REAL do serviço nativo. O Flutter NÃO é a
                // autoridade do estado nativo — o serviço pode ter feito stopSelf() sozinho
                // (STOP semântico/permissão/etc.). O guard de reuso consulta isto antes de
                // "economizar" uma emissão, evitando silent_dead_tracking.
                "isActive" -> result.success(LocationTrackingService.running)
                else -> result.notImplemented()
            }
        }
    }

    // MethodChannel entrega int Dart como Int ou Long conforme a magnitude.
    private fun asLong(v: Any?): Long = when (v) {
        is Int -> v.toLong()
        is Long -> v
        is Double -> v.toLong()
        else -> 0L
    }
}
