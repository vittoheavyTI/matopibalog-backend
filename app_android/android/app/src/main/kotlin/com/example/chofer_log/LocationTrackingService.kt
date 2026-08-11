package com.example.chofer_log

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

class LocationTrackingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    // SEC-1: campos VOLÁTEIS — a rotação da credencial (renovação) troca `token` em
    // uma thread de trabalho; leituras precisam enxergar o valor atual sem snapshot.
    //   MODE_SESSION  → Authorization: Bearer <access token> (fluxo compatível/atual).
    //   MODE_TRACKING → X-Tracking-Credential + X-Tracking-Device (credencial escopada).
    @Volatile private var token: String? = null
    @Volatile private var baseUrl: String? = null
    @Volatile private var mode: String = MODE_SESSION
    @Volatile private var deviceId: String? = null
    @Volatile private var credentialExpiresAt: Long = 0L   // validade nominal (renovar antes)
    @Volatile private var maxExpiresAt: Long = 0L          // teto absoluto (não renova além)
    private var lastSent: Location? = null
    private var lastSentAt: Long = 0L
    private lateinit var locationManager: LocationManager
    // Trava de reentrância: garante UM ciclo de rede por vez. Sem isto, a renovação
    // (updateSelfIntent → onStartCommand → novo tick) poderia rodar captureAndSend
    // concorrente e corromper a fila (read-modify-write do SharedPreferences).
    private val inFlight = AtomicBoolean(false)
    private val queueLock = Any() // serializa mutações da fila entre threads
    private lateinit var alarmManager: AlarmManager
    private lateinit var powerManager: PowerManager

    // Resultado semântico de um POST (§M-2). Decide fila e stopSelf — nunca por status cru.
    private enum class SendResult { SENT, KEEP, RENEW, STOP }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        createChannel()
    }

    // BLOCKER-2: o "tick" NÃO é mais um Handler.postDelayed (timer local do processo, que o
    // Doze/App Standby SUSPENDE — causa provada dos gaps de 50-80min). Agora um AlarmManager
    // .setAndAllowWhileIdle (fonte de wakeup que dispara mesmo em Doze) entrega um broadcast
    // LOCAL a este receiver, que roda um ciclo de captura/envio usando a credencial EM
    // MEMÓRIA (o ForegroundService permanece vivo em Doze; só a CPU é suspensa). Por ser
    // getBroadcast (não getService), os ticks NÃO reentram no onStartCommand → o intent de
    // redelivery segue sendo o START completo (recuperação de process-death preservada) e a
    // rotação (updateSelfIntent) segue idêntica.
    private val tickReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            captureAndSend()
            scheduleNextTick()
        }
    }
    @Volatile private var tickReceiverRegistrado = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            cancelTick()
            stopSelf()
            return START_NOT_STICKY
        }

        // Só reseta a credencial quando o intent REALMENTE a traz (START/renovação). Isso
        // torna o onStartCommand idempotente e nunca zera o token em memória por engano.
        if (intent?.hasExtra(EXTRA_TOKEN) == true) {
            token = intent.getStringExtra(EXTRA_TOKEN)
            baseUrl = intent.getStringExtra(EXTRA_BASE_URL)?.trimEnd('/')
            mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_SESSION
            deviceId = intent.getStringExtra(EXTRA_DEVICE)
            credentialExpiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0L)
            maxExpiresAt = intent.getLongExtra(EXTRA_MAX_EXPIRES_AT, 0L)
        }

        startForeground(NOTIFICATION_ID, notification())
        registrarTickReceiver()
        handler.post { captureAndSend() } // captura imediata ao (re)iniciar
        scheduleNextTick()
        // START_REDELIVER_INTENT: se o processo morrer, o Android reentrega o ÚLTIMO intent
        // (START/renovação completo — os ticks são broadcasts e não alteram isso), trazendo
        // a credencial ATUAL sem gravar segredo em disco.
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        cancelTick()
        if (tickReceiverRegistrado) {
            try { unregisterReceiver(tickReceiver) } catch (_: Exception) {}
            tickReceiverRegistrado = false
        }
        super.onDestroy()
    }

    private fun registrarTickReceiver() {
        if (tickReceiverRegistrado) return
        val filtro = android.content.IntentFilter(ACTION_TICK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(tickReceiver, filtro, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(tickReceiver, filtro)
        }
        tickReceiverRegistrado = true
    }

    private fun tickPendingIntent(): PendingIntent {
        val intent = Intent(ACTION_TICK).setPackage(packageName)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(this, REQ_TICK, intent, flags)
    }

    // Doze-RESILIENTE: setAndAllowWhileIdle dispara mesmo em Doze (throttle do SO ~1/9min em
    // idle profundo → cadência efetiva parada ~9-15min, batendo com o heartbeat; elimina os
    // gaps de 50-80min do timer local). ELAPSED_REALTIME_WAKEUP acorda a CPU. Sem SCHEDULE_
    // EXACT_ALARM (usa a variante inexata, permitida sem permissão especial).
    private fun scheduleNextTick() {
        val pi = tickPendingIntent()
        val at = SystemClock.elapsedRealtime() + INTERVAL_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // API 23+: Doze existe → variante que dispara mesmo em idle profundo.
                alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
            } else {
                // API < 23: não há Doze; alarme comum basta (mesmo PendingIntent broadcast).
                alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
            }
        } catch (_: Exception) { /* best-effort: falha ao agendar não derruba o serviço */ }
    }

    private fun cancelTick() {
        try { alarmManager.cancel(tickPendingIntent()) } catch (_: Exception) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun captureAndSend() {
        if (token == null || baseUrl == null) return
        if (!hasLocationPermission()) {
            Thread { reportState("permissao_nao_concedida") }.start()
            stopSelf()
            return
        }
        // Um ciclo por vez: se já há envio em andamento, ignora este tick.
        if (!inFlight.compareAndSet(false, true)) return

        Thread {
            // BLOCKER-2: o alarme (setAndAllowWhileIdle) acorda a CPU só brevemente; um
            // WakeLock PARCIAL com teto de segurança garante que a captura/envio de rede
            // termine antes de a CPU voltar a dormir. Sempre liberado no finally.
            val wl = try {
                powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
                    setReferenceCounted(false)
                    acquire(WAKELOCK_TIMEOUT_MS)
                }
            } catch (_: Exception) { null }
            try {
                maybeRenewCredential()
                flushQueue()
                val location = bestKnownLocation()
                if (location != null && shouldSend(location)) {
                    if (sendPoint(locationToJson(location)) == SendResult.SENT) {
                        lastSent = location
                        lastSentAt = System.currentTimeMillis()
                    }
                } else {
                    requestSingleUpdate()
                }
            } finally {
                inFlight.set(false)
                try { if (wl?.isHeld == true) wl.release() } catch (_: Exception) {}
            }
        }.start()
    }

    private fun requestSingleUpdate() {
        if (!hasLocationPermission()) return
        val provider = when {
            locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> {
                Thread { reportState("gps_desativado") }.start()
                return
            }
        }
        locationManager.requestSingleUpdate(provider, object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (!shouldSend(location)) return
                // Apenas ENFILEIRA (serializado); o próximo ciclo de flushQueue envia —
                // evita envio de rede concorrente fora da trava inFlight.
                enqueue(locationToJson(location))
                lastSent = location
                lastSentAt = System.currentTimeMillis()
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

    // ── Autenticação por modo. NUNCA loga o valor. ──────────────────────────────
    private fun applyAuth(conn: HttpURLConnection) {
        val credential = token ?: return
        if (mode == MODE_TRACKING) {
            conn.setRequestProperty(HEADER_TRACKING, credential)
            deviceId?.let { conn.setRequestProperty(HEADER_DEVICE, it) }
        } else {
            conn.setRequestProperty("Authorization", "Bearer $credential")
        }
    }

    // Lê o `error` semântico do corpo (§M-2). Só chamado em não-2xx.
    private fun readErrorCode(conn: HttpURLConnection): String? {
        return try {
            val body = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: return null
            if (body.isBlank()) null else JSONObject(body).optString("error", "").ifBlank { null }
        } catch (_: Exception) { null }
    }

    // Classifica o resultado por CÓDIGO semântico + status. Erros definitivos e
    // transitórios são distintos; expired/rotated pedem renovação (não descartam fila).
    private fun classify(code: Int, errorCode: String?): SendResult {
        if (code in 200..299) return SendResult.SENT
        if (errorCode == "tracking_credential_expired" || errorCode == "tracking_credential_rotated") return SendResult.RENEW
        if (code == 408 || code == 429 || code == 0 || code >= 500) return SendResult.KEEP
        // Definitivos: revoked/max_lifetime/session_revoked/driver_blocked/tenant_mismatch/
        // device_mismatch/trip_inactive/trip_mismatch/invalid — e, em MODE_SESSION, 401/403/409.
        return SendResult.STOP
    }

    private fun postJson(endpoint: String, payload: JSONObject): SendResult {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 15000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        applyAuth(conn)
        OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
        val code = conn.responseCode
        val errorCode = if (code in 200..299) null else readErrorCode(conn)
        conn.disconnect()
        return classify(code, errorCode)
    }

    // Envia UM ponto. A fila só perde o ponto em ingestão confirmada (SENT). Em
    // MODE_SESSION preserva o comportamento legado (descarta em erro definitivo).
    private fun sendPoint(payload: JSONObject): SendResult {
        val base = baseUrl ?: return SendResult.KEEP
        return try {
            var res = postJson("$base/fretes/localizacao/sessao", payload)
            if (res == SendResult.RENEW) {
                res = if (renewCredential()) postJson("$base/fretes/localizacao/sessao", payload) else SendResult.KEEP
            }
            when (res) {
                SendResult.SENT -> {}
                SendResult.KEEP, SendResult.RENEW -> enqueue(payload)
                SendResult.STOP -> {
                    if (mode == MODE_TRACKING) enqueue(payload) // preserva (nunca perde por stopSelf)
                    stopSelf()
                }
            }
            res
        } catch (_: Exception) {
            enqueue(payload)
            reportState("sem_conexao")
            SendResult.KEEP
        }
    }

    private fun flushQueue() {
        val base = baseUrl ?: return
        // DRENA a fila sob lock (assume a posse do lote). Enfileiramentos concorrentes
        // durante a rede vão para uma fila nova e NÃO são sobrescritos.
        val batch = synchronized(queueLock) {
            val q = readQueue()
            if (q.length() > 0) writeQueue(JSONArray())
            q
        }
        if (batch.length() == 0) return
        var parar = false
        val falhas = ArrayList<JSONObject>()
        for (i in 0 until batch.length()) {
            val payload = batch.optJSONObject(i) ?: continue
            if (parar) { falhas.add(payload); continue } // após STOP, preserva o restante
            var res = try {
                postJson("$base/fretes/localizacao/sessao", payload)
            } catch (_: Exception) {
                reportState("sem_conexao"); SendResult.KEEP
            }
            if (res == SendResult.RENEW) {
                res = if (renewCredential()) {
                    try { postJson("$base/fretes/localizacao/sessao", payload) } catch (_: Exception) { SendResult.KEEP }
                } else SendResult.KEEP
            }
            when (res) {
                SendResult.SENT -> { /* confirmado → remove (não reenfileira) */ }
                SendResult.STOP -> {
                    if (mode == MODE_TRACKING) falhas.add(payload) // preserva; em sessão descarta (legado)
                    parar = true
                }
                else -> falhas.add(payload) // KEEP/RENEW-falho → preserva
            }
        }
        if (falhas.isNotEmpty()) enqueueAll(falhas) // re-enfileira falhas mesclando com novos
        if (parar) stopSelf()
    }

    // Renova (ROTACIONA) a credencial — só MODE_TRACKING. Aceita credencial já expirada,
    // desde que dentro do teto absoluto. Atualiza token→B e o intent de redelivery.
    // Retorna true se rotacionou. Erro definitivo → stopSelf. Transitório → false.
    private fun renewCredential(): Boolean {
        if (mode != MODE_TRACKING) return false
        val base = baseUrl ?: return false
        if (token == null) return false
        val now = System.currentTimeMillis()
        if (maxExpiresAt in 1..now) { // ultrapassou o teto → não renova; exige nova emissão pelo app
            reportState("interrompida")
            stopSelf()
            return false
        }
        return try {
            val conn = (URL("$base/fretes/localizacao/sessao/renovar-credencial").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 15000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            applyAuth(conn)
            OutputStreamWriter(conn.outputStream).use { it.write("{}") }
            val code = conn.responseCode
            if (code in 200..299) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(body)
                val novo = json.optString("credential", "")
                if (novo.isNotBlank()) {
                    token = novo
                    json.optString("expires_at", "").let { if (it.isNotBlank()) credentialExpiresAt = parseIso(it) }
                    json.optString("max_expires_at", "").let { if (it.isNotBlank()) maxExpiresAt = parseIso(it) }
                    updateSelfIntent() // o redelivery passa a trazer o token novo
                    return true
                }
                false
            } else {
                val errorCode = readErrorCode(conn)
                conn.disconnect()
                if (classify(code, errorCode) == SendResult.STOP) stopSelf()
                false
            }
        } catch (_: Exception) {
            false // transitório: tenta na próxima passagem
        }
    }

    // Renovação PROATIVA quando faltar <= RENEW_THRESHOLD para expirar (viagens longas).
    private fun maybeRenewCredential() {
        if (mode != MODE_TRACKING || credentialExpiresAt <= 0L) return
        if (System.currentTimeMillis() < credentialExpiresAt - RENEW_THRESHOLD_MS) return
        renewCredential()
    }

    // Reemite o próprio start intent com os valores ATUAIS → o Android passa a
    // redeliver o token rotacionado (recuperação em process death sem persistir segredo).
    private fun updateSelfIntent() {
        val intent = Intent(this, LocationTrackingService::class.java).apply {
            putExtra(EXTRA_TOKEN, token)
            putExtra(EXTRA_BASE_URL, baseUrl)
            putExtra(EXTRA_MODE, mode)
            putExtra(EXTRA_DEVICE, deviceId)
            putExtra(EXTRA_EXPIRES_AT, credentialExpiresAt)
            putExtra(EXTRA_MAX_EXPIRES_AT, maxExpiresAt)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        } catch (_: Exception) { /* best-effort */ }
    }

    private fun reportState(state: String) {
        val base = baseUrl ?: return
        try {
            postJson("$base/fretes/localizacao/sessao/estado", JSONObject().put("estado", state))
        } catch (_: Exception) {
            // Best-effort: estado operacional nao pode deslogar nem expor coordenadas.
        }
    }

    private fun parseIso(iso: String): Long {
        return try { java.time.Instant.parse(iso).toEpochMilli() } catch (_: Exception) { 0L }
    }

    private fun locationToJson(location: Location): JSONObject {
        return JSONObject()
            .put("latitude", String.format(Locale.US, "%.7f", location.latitude).toDouble())
            .put("longitude", String.format(Locale.US, "%.7f", location.longitude).toDouble())
            .put("accuracy_m", if (location.hasAccuracy()) (location.accuracy * 100.0).roundToInt() / 100.0 else JSONObject.NULL)
            .put("captured_at", isoNow())
            .put("source", "app_foreground_service")
    }

    private fun enqueue(payload: JSONObject) = enqueueAll(listOf(payload))

    // Mescla `itens` (mais novos primeiro) com a fila atual, sob lock, com dedup por
    // captured_at e teto QUEUE_LIMIT. Atômico entre threads (evita perda por corrida).
    private fun enqueueAll(itens: List<JSONObject>) {
        if (itens.isEmpty()) return
        synchronized(queueLock) {
            val atual = readQueue()
            val vistos = HashSet<String>()
            val next = JSONArray()
            fun add(o: JSONObject) {
                if (next.length() >= QUEUE_LIMIT) return
                val cap = o.optString("captured_at")
                if (cap.isNotEmpty() && !vistos.add(cap)) return
                next.put(o)
            }
            for (o in itens) add(o)
            for (i in 0 until atual.length()) { atual.optJSONObject(i)?.let { add(it) } }
            writeQueue(next)
        }
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
        // BLOCKER-2: broadcast LOCAL do alarme Doze-resiliente (não exportado).
        private const val ACTION_TICK = "br.com.matopibalog.location.TICK"
        private const val REQ_TICK = 4228
        private const val WAKELOCK_TAG = "matopibalog:location_tick"
        private const val WAKELOCK_TIMEOUT_MS = 60 * 1000L // teto de segurança (nunca vaza)
        private const val EXTRA_TOKEN = "token"
        private const val EXTRA_BASE_URL = "baseUrl"
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_DEVICE = "deviceId"
        private const val EXTRA_EXPIRES_AT = "expiresAt"
        private const val EXTRA_MAX_EXPIRES_AT = "maxExpiresAt"
        const val MODE_SESSION = "session"
        const val MODE_TRACKING = "tracking"
        private const val HEADER_TRACKING = "X-Tracking-Credential"
        private const val HEADER_DEVICE = "X-Tracking-Device"
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

        fun start(
            context: Context,
            token: String,
            baseUrl: String,
            mode: String = MODE_SESSION,
            deviceId: String? = null,
            expiresAt: Long = 0L,
            maxExpiresAt: Long = 0L,
        ) {
            val intent = Intent(context, LocationTrackingService::class.java).apply {
                putExtra(EXTRA_TOKEN, token)
                putExtra(EXTRA_BASE_URL, baseUrl)
                putExtra(EXTRA_MODE, mode)
                putExtra(EXTRA_DEVICE, deviceId)
                putExtra(EXTRA_EXPIRES_AT, expiresAt)
                putExtra(EXTRA_MAX_EXPIRES_AT, maxExpiresAt)
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
