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
                    val freteId = call.argument<String>("freteId")
                    val token = call.argument<String>("token")
                    val baseUrl = call.argument<String>("baseUrl")
                    if (freteId.isNullOrBlank() || token.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                        result.error("invalid_args", "Dados insuficientes para iniciar.", null)
                        return@setMethodCallHandler
                    }
                    LocationTrackingService.start(this, freteId, token, baseUrl)
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
