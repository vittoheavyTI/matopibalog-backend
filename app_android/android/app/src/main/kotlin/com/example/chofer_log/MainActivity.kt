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
                    // SEC-1: modo de autenticação e expiração da credencial (Opção C).
                    // Ausentes → "session" (compatível): o app envia o access token, como hoje.
                    val mode = call.argument<String>("mode") ?: LocationTrackingService.MODE_SESSION
                    val expiresAt = when (val v = call.argument<Any>("expiresAt")) {
                        is Int -> v.toLong()
                        is Long -> v
                        is Double -> v.toLong()
                        else -> 0L
                    }
                    if (token.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                        result.error("invalid_args", "Dados insuficientes para iniciar.", null)
                        return@setMethodCallHandler
                    }
                    LocationTrackingService.start(this, token, baseUrl, mode, expiresAt)
                    result.success(true)
                }
                "stop" -> {
                    LocationTrackingService.stop(this)
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
    }
}
