package com.example.chofer_log

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.math.roundToInt

class LocationTrackingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var token: String? = null
    private var baseUrl: String? = null
    // SEC-1: modo de autenticação do serviço nativo.
    //   MODE_SESSION  → envia Authorization: Bearer <access token> (fluxo compatível/atual).
    //   MODE_TRACKING → envia X-Tracking-Credential: <credencial escopada> (Opção C).
    // A credencial de tracking NÃO expira junto com o access token de UI (§5): sobrevive
    // à rotação/expiração do access e é renovada (tracking-only) antes de expirar.
    private var mode: String = MODE_SESSION
    private var credentialExpiresAt: Long = 0L
    private var lastSent: Location? = null
    private var lastSentAt: Long = 0L
    private lateinit var locationManager: LocationManager

    private val tick = object : Runnable {
        override fun run() {
            captureAndSend()
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        token = intent?.getStringExtra(EXTRA_TOKEN)
        baseUrl = intent?.getStringExtra(EXTRA_BASE_URL)?.trimEnd('/')
        mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_SESSION
        credentialExpiresAt = intent?.getLongExtra(EXTRA_EXPIRES_AT, 0L) ?: 0L

        startForeground(NOTIFICATION_ID, notification())
        handler.removeCallbacks(tick)
        handler.post(tick)
        // START_REDELIVER_INTENT: se o processo morrer, o Android reentrega o ÚLTIMO
        // intent (com a credencial), preservando o rastreamento sem guardar segredo em
        // disco. A credencial é telemetria-only/revogável/expira — não é o access token.
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun captureAndSend() {
        val currentToken = token ?: return
        val currentBaseUrl = baseUrl ?: return
        if (!hasLocationPermission()) {
            Thread { reportState(currentToken, currentBaseUrl, "permissao_nao_concedida") }.start()
            stopSelf()
            return
        }

        Thread {
            maybeRenewCredential(currentToken, currentBaseUrl)
            flushQueue(currentToken, currentBaseUrl)
            val location = bestKnownLocation()
            if (location != null && shouldSend(location)) {
                val sent = sendPoint(currentToken, currentBaseUrl, locationToJson(location))
                if (sent) {
                    lastSent = location
                    lastSentAt = System.currentTimeMillis()
                }
            } else {
                requestSingleUpdate()
            }
        }.start()
    }

    private fun requestSingleUpdate() {
        if (!hasLocationPermission()) return
        val provider = when {
            locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> {
                val currentToken = token ?: return
                val currentBaseUrl = baseUrl ?: return
                Thread { reportState(currentToken, currentBaseUrl, "gps_desativado") }.start()
                return
            }
        }
        locationManager.requestSingleUpdate(provider, object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val currentToken = token ?: return
                val currentBaseUrl = baseUrl ?: return
                if (!shouldSend(location)) return
                Thread {
                    val sent = sendPoint(currentToken, currentBaseUrl, locationToJson(location))
                    if (sent) {
                        lastSent = location
                        lastSentAt = System.currentTimeMillis()
                    }
                }.start()
            }
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }, Looper.getMainLooper())
    }

    private fun bestKnownLocation(): Location? {
        if (!hasLocationPermission()) return null
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        return providers.mapNotNull { provider ->
            try {
                if (locationManager.isProviderEnabled(provider)) locationManager.getLastKnownLocation(provider) else null
            } catch (_: Exception) {
                null
            }
        }.maxByOrNull { it.time }
    }

    private fun shouldSend(location: Location): Boolean {
        val previous = lastSent ?: return true
        val elapsed = System.currentTimeMillis() - lastSentAt
        if (elapsed >= HEARTBEAT_MS) return true
        return previous.distanceTo(location) >= MIN_DISTANCE_METERS
    }

    private fun sendPoint(bearer: String, apiBase: String, payload: JSONObject): Boolean {
        return try {
            val ok = postJson("$apiBase/fretes/localizacao/sessao", bearer, payload)
            if (!ok) enqueue(payload)
            ok
        } catch (_: Exception) {
            enqueue(payload)
            reportState(bearer, apiBase, "sem_conexao")
            false
        }
    }

    private fun flushQueue(bearer: String, apiBase: String) {
        val queue = readQueue()
        if (queue.length() == 0) return
        val remaining = JSONArray()
        for (i in 0 until queue.length()) {
            val payload = queue.optJSONObject(i) ?: continue
            val ok = try {
                postJson("$apiBase/fretes/localizacao/sessao", bearer, payload)
            } catch (_: Exception) {
                reportState(bearer, apiBase, "sem_conexao")
                false
            }
            if (!ok) remaining.put(payload)
        }
        writeQueue(remaining)
    }

    // Aplica a autenticação conforme o modo: credencial escopada (tracking) via header
    // dedicado, ou access token (sessão) via Authorization. NUNCA loga o valor.
    private fun applyAuth(conn: HttpURLConnection, credential: String) {
        if (mode == MODE_TRACKING) {
            conn.setRequestProperty(HEADER_TRACKING, credential)
        } else {
            conn.setRequestProperty("Authorization", "Bearer $credential")
        }
    }

    // Um erro é DEFINITIVO (encerra o serviço) só quando não há como recuperar:
    //   * MODE_SESSION: mantém o comportamento atual (401/403/409 → stop).
    //   * MODE_TRACKING: 401/403 (credencial inválida/expirada/revogada/bloqueada/escopo)
    //     e 409 (sem viagem apta = fim do rastreamento). 503/5xx/408/429 são TRANSITÓRIOS
    //     e NUNCA param o serviço nem apagam a fila.
    private fun isDefinitiveStop(code: Int): Boolean {
        return code == 401 || code == 403 || code == 409
    }

    private fun postJson(endpoint: String, credential: String, payload: JSONObject): Boolean {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        applyAuth(conn, credential)
        OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
        val code = conn.responseCode
        conn.disconnect()
        if (isDefinitiveStop(code)) {
            stopSelf()
            return true
        }
        // 2xx: enviado. Demais 4xx (400/404/422) não-definitivos: descarta o ponto (não
        // reenfileira) mas NÃO para. 408/429/5xx: transitório → mantém na fila.
        return code in 200..299 || (code in 400..499 && code != 408 && code != 429)
    }

    // Renovação TRACKING-ONLY (viagens longas): estende a validade da PRÓPRIA credencial
    // antes de expirar, sem jamais tocar o refresh SEC-1. Só no modo tracking e quando
    // estamos dentro da janela de renovação. Erro definitivo → encerra; transitório → tenta depois.
    private fun maybeRenewCredential(credential: String, apiBase: String) {
        if (mode != MODE_TRACKING || credentialExpiresAt <= 0L) return
        val now = System.currentTimeMillis()
        if (now < credentialExpiresAt - RENEW_THRESHOLD_MS) return
        try {
            val conn = (URL("$apiBase/fretes/localizacao/sessao/renovar-credencial").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 15000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            applyAuth(conn, credential)
            OutputStreamWriter(conn.outputStream).use { it.write("{}") }
            val code = conn.responseCode
            val body = if (code in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else ""
            conn.disconnect()
            if (code in 200..299) {
                val exp = JSONObject(body).optString("expires_at", "")
                if (exp.isNotEmpty()) {
                    try { credentialExpiresAt = java.time.Instant.parse(exp).toEpochMilli() } catch (_: Exception) {}
                }
            } else if (isDefinitiveStop(code)) {
                stopSelf()
            }
            // transitório: ignora e tenta na próxima passagem.
        } catch (_: Exception) {
            // transitório (rede): não para; tenta depois.
        }
    }

    private fun reportState(bearer: String, apiBase: String, state: String) {
        try {
            postJson(
                "$apiBase/fretes/localizacao/sessao/estado",
                bearer,
                JSONObject().put("estado", state),
            )
        } catch (_: Exception) {
            // Best-effort: estado operacional nao pode deslogar nem expor coordenadas.
        }
    }

    private fun locationToJson(location: Location): JSONObject {
        return JSONObject()
            .put("latitude", String.format(Locale.US, "%.7f", location.latitude).toDouble())
            .put("longitude", String.format(Locale.US, "%.7f", location.longitude).toDouble())
            .put("accuracy_m", if (location.hasAccuracy()) (location.accuracy * 100.0).roundToInt() / 100.0 else JSONObject.NULL)
            .put("captured_at", isoNow())
            .put("source", "app_foreground_service")
    }

    private fun enqueue(payload: JSONObject) {
        val queue = readQueue()
        val next = JSONArray()
        next.put(payload)
        val start = maxOf(0, queue.length() - QUEUE_LIMIT + 1)
        for (i in start until queue.length()) {
            val item = queue.optJSONObject(i) ?: continue
            if (item.optString("captured_at") != payload.optString("captured_at")) next.put(item)
        }
        writeQueue(next)
    }

    private fun readQueue(): JSONArray {
        val raw = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_QUEUE, "[]")
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    private fun writeQueue(queue: JSONArray) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_QUEUE, queue.toString()).apply()
    }

    private fun hasLocationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Localizacao da viagem", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Compartilhamento ativo somente durante a viagem."
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Matopiba Log")
            .setContentText("Compartilhamento de localizacao ativo durante a viagem.")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
    }

    private fun isoNow(): String {
        return java.time.Instant.now().toString()
    }

    companion object {
        private const val ACTION_STOP = "br.com.matopibalog.location.STOP"
        private const val EXTRA_TOKEN = "token"
        private const val EXTRA_BASE_URL = "baseUrl"
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_EXPIRES_AT = "expiresAt"
        const val MODE_SESSION = "session"
        const val MODE_TRACKING = "tracking"
        private const val HEADER_TRACKING = "X-Tracking-Credential"
        private const val CHANNEL_ID = "matopibalog_localizacao_viagem"
        private const val NOTIFICATION_ID = 4227
        private const val INTERVAL_MS = 5 * 60 * 1000L
        private const val HEARTBEAT_MS = 15 * 60 * 1000L
        // Renova a credencial quando faltar <= 1h para expirar (viagens longas).
        private const val RENEW_THRESHOLD_MS = 60 * 60 * 1000L
        private const val MIN_DISTANCE_METERS = 100f
        private const val QUEUE_LIMIT = 20
        private const val PREFS = "matopibalog_location_tracking"
        private const val KEY_QUEUE = "queue"

        fun start(context: Context, token: String, baseUrl: String, mode: String = MODE_SESSION, expiresAt: Long = 0L) {
            val intent = Intent(context, LocationTrackingService::class.java).apply {
                putExtra(EXTRA_TOKEN, token)
                putExtra(EXTRA_BASE_URL, baseUrl)
                putExtra(EXTRA_MODE, mode)
                putExtra(EXTRA_EXPIRES_AT, expiresAt)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationTrackingService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }
}
