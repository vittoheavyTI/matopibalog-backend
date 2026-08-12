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
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.example.chofer_log.LocationQueueLogic.SendResult
import com.example.chofer_log.LocationQueueLogic.StartUpdatesResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/**
 * SEC-1 (Opção C) — serviço de rastreamento. REAVALIAÇÃO 2026-08-11 (BLOCKER-2):
 *
 * ARQUITETURA HÍBRIDA (decisão do gate):
 *  - FONTE PRIMÁRIA/CANÔNICA de fixes = FusedLocationProviderClient.requestLocationUpdates,
 *    dentro de um ForegroundService type=location (contexto operacional). É a via recomendada
 *    pelo Android para localização confiável em background e resiliente a Doze — substitui o
 *    Handler.postDelayed (timer local suspenso pelo Doze) e o requestSingleUpdate assíncrono.
 *  - WATCHDOG (AlarmManager + broadcast local) NÃO é a fonte de pontos nem promete heartbeat de
 *    9-15min: serve APENAS para detectar ausência ANORMAL de fix fresco/utilizável e RECUPERAR
 *    (re-request + um getCurrentLocation pontual). setAndAllowWhileIdle NÃO é usado como garantia.
 *  - FRESCOR: captured_at = tempo REAL do fix (loc.time); idade calculada via elapsedRealtimeNanos;
 *    fixes acima de MAX_FIX_AGE_MS são descartados (nunca marcar coordenada velha como fresca).
 *  - WakeLock parcial cobre o envio de rede disparado pelo callback / watchdog.
 *
 * PRESERVADOS (inalterados): fila offline (enqueue/flush, preserva em erro de rede), rotação CAS
 * da credencial (renew), multi-viagem, anti-resurrection, device binding, revogação por sessão,
 * teto absoluto, hash-only. TODA conclusão de runtime (entrega em Doze, cadência real, recuperação
 * de process-death) fica PENDENTE de revalidação física com APK release.
 */
class LocationTrackingService : Service() {
    @Volatile private var token: String? = null
    @Volatile private var baseUrl: String? = null
    @Volatile private var mode: String = MODE_SESSION
    @Volatile private var deviceId: String? = null
    @Volatile private var credentialExpiresAt: Long = 0L   // validade nominal (renovar antes)
    @Volatile private var maxExpiresAt: Long = 0L          // teto absoluto (não renova além)
    private var lastSent: Location? = null
    private var lastSentAt: Long = 0L
    @Volatile private var lastCallbackAt: Long = 0L        // diagnóstico: último callback do Fused (mesmo stale)
    @Volatile private var lastFreshFixAt: Long = 0L        // watchdog: último fix UTILIZÁVEL/FRESCO (autoridade da saúde)

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var alarmManager: AlarmManager
    private lateinit var powerManager: PowerManager
    @Volatile private var updatesRequested = false
    @Volatile private var watchdogRegistrado = false

    private val inFlight = AtomicBoolean(false)
    private val queueLock = Any()

    // SendResult / classify / orderedDedupCap vivem em LocationQueueLogic (puro, testável em JVM).

    // Fonte primária: callbacks contínuos do Fused (entregues no main looper).
    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            lastCallbackAt = System.currentTimeMillis()
            result.lastLocation?.let { handleLocation(it) }
        }
        override fun onLocationAvailability(availability: LocationAvailability) {
            if (!availability.isLocationAvailable) Thread { reportState("gps_desativado") }.start()
        }
    }

    // Watchdog: recupera ausência anormal de fix fresco/utilizável (não é a fonte de pontos).
    private val watchdogReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            runWatchdog()
            scheduleWatchdog()
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverything()
            stopSelf()
            return START_NOT_STICKY
        }

        // Idempotente: só reseta a credencial quando o intent REALMENTE a traz (START/renovação).
        if (intent?.hasExtra(EXTRA_TOKEN) == true) {
            token = intent.getStringExtra(EXTRA_TOKEN)
            baseUrl = intent.getStringExtra(EXTRA_BASE_URL)?.trimEnd('/')
            mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_SESSION
            deviceId = intent.getStringExtra(EXTRA_DEVICE)
            credentialExpiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0L)
            maxExpiresAt = intent.getLongExtra(EXTRA_MAX_EXPIRES_AT, 0L)
        }

        startForeground(NOTIFICATION_ID, notification())
        if (token == null || baseUrl == null) {
            // Redelivery sem credencial em memória (process-death com último intent sem token):
            // encerra limpo; o reconcile do app reemite ao voltar à atividade.
            stopEverything()
            stopSelf()
            return START_NOT_STICKY
        }
        val startResult = startLocationUpdates()
        if (startResult == StartUpdatesResult.TERMINAL) {
            // startLocationUpdates já fez stopEverything(terminal) nos ramos terminais.
            return START_NOT_STICKY
        }
        registrarWatchdog()
        scheduleWatchdog()
        // Inicialização operacional aceita → RUNNING (updates ativos ou recuperáveis pelo watchdog).
        transitionTo(LocationQueueLogic.stateAfterStart(startResult))
        // START_REDELIVER_INTENT: o último intent (START/renovação completo) e reentregue após
        // process-death → re-request dos updates + rearme do watchdog. Prova de runtime = recheck.
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        stopEverything()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // terminal=true → estado TERMINAL (erro/permissão/credencial morta; recuperação controlada
    // permitida). terminal=false → STOPPED (parada limpa: ACTION_STOP, redelivery sem credencial,
    // onDestroy). Ambos são "não-vivos" para o Flutter; a distinção é diagnóstica/semântica.
    private fun stopEverything(terminal: Boolean = false) {
        transitionTo(
            if (terminal) LocationQueueLogic.NativeTrackingState.TERMINAL
            else LocationQueueLogic.NativeTrackingState.STOPPED
        )
        try { fusedClient.removeLocationUpdates(locationCallback) } catch (_: Exception) {}
        updatesRequested = false
        cancelWatchdog()
        if (watchdogRegistrado) {
            try { unregisterReceiver(watchdogReceiver) } catch (_: Exception) {}
            watchdogRegistrado = false
        }
    }

    // ── Fonte primária: Fused requestLocationUpdates ────────────────────────────
    private fun startLocationUpdates(): StartUpdatesResult {
        if (!hasLocationPermission()) {
            Thread { reportState("permissao_nao_concedida") }.start()
            stopEverything(terminal = true)
            stopSelf()
            return StartUpdatesResult.TERMINAL
        }
        // PRIORIDADE (reassessment #5): PRIORITY_HIGH_ACCURACY durante a VIAGEM ATIVA. O serviço
        // só roda enquanto há viagem em andamento (janela operacional curta e, tipicamente, com o
        // aparelho carregando no veículo). Rastreamento de ROTA logística exige fidelidade de GPS;
        // Balanced (rede/wifi) daria pontos grosseiros/saltados sob o filtro de 100m. A cadência é
        // contida por INTERVAL_MS + filtro de distância (não é 1/seg). accuracy_m/idade/cadência
        // serão MEDIDOS no recheck físico e a prioridade pode ser reajustada com evidência.
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .setMinUpdateDistanceMeters(0f) // fixes periódicos mesmo parado; o filtro é no app (shouldSend)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            updatesRequested = true
            val agora = System.currentTimeMillis()
            lastCallbackAt = agora
            lastFreshFixAt = agora // grace: evita recuperação falsa antes do 1º fix
            return StartUpdatesResult.STARTED
        } catch (_: SecurityException) {
            Thread { reportState("permissao_nao_concedida") }.start()
            stopEverything(terminal = true)
            stopSelf()
            return StartUpdatesResult.TERMINAL
        } catch (_: Exception) {
            updatesRequested = false
            return StartUpdatesResult.RECOVERABLE
        }
    }

    // Processa UM fix: valida frescor, aplica filtro (distância/heartbeat) e envia sob WakeLock.
    private fun handleLocation(location: Location) {
        if (token == null || baseUrl == null) return
        if (!hasLocationPermission()) { Thread { reportState("permissao_nao_concedida") }.start(); stopEverything(terminal = true); stopSelf(); return }
        // FRESCOR ESTRITO (reassessment #4): sem timestamp REAL de captura → fix inválido,
        // NÃO é enviado (nunca inventar captured_at).
        if (location.time <= 0L) return
        // FRESCOR: descarta fix velho (não vira "fresco"). Fix stale NÃO conta como utilizável.
        if (fixAgeMs(location) > MAX_FIX_AGE_MS) return
        // Fix UTILIZÁVEL/FRESCO recebido — marca a saúde do stream ANTES do filtro de envio
        // (parado + <100m também é "saudável"; o watchdog não deve recuperar só por não enviar).
        lastFreshFixAt = System.currentTimeMillis()
        if (!shouldSend(location)) return
        if (!inFlight.compareAndSet(false, true)) return
        Thread {
            val wl = acquireWakeLock()
            try {
                maybeRenewCredential()
                flushQueue()
                if (sendPoint(locationToJson(location)) == SendResult.SENT) {
                    lastSent = location
                    lastSentAt = System.currentTimeMillis()
                }
            } finally {
                inFlight.set(false)
                releaseWakeLock(wl)
            }
        }.start()
    }

    // Idade do fix por relógio MONOTÔNICO (imune a ajustes de wall-clock).
    private fun fixAgeMs(location: Location): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && location.elapsedRealtimeNanos > 0L) {
            (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L
        } else {
            System.currentTimeMillis() - location.time
        }
    }

    private fun shouldSend(location: Location): Boolean {
        val previous = lastSent ?: return true
        val elapsed = System.currentTimeMillis() - lastSentAt
        if (elapsed >= HEARTBEAT_MS) return true
        return previous.distanceTo(location) >= MIN_DISTANCE_METERS
    }

    // ── Watchdog: recupera ausência anormal de fix fresco/utilizável (NÃO é heartbeat garantido) ──
    private fun registrarWatchdog() {
        if (watchdogRegistrado) return
        val filtro = android.content.IntentFilter(ACTION_WATCHDOG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(watchdogReceiver, filtro, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(watchdogReceiver, filtro)
        }
        watchdogRegistrado = true
    }

    private fun watchdogPendingIntent(): PendingIntent {
        val intent = Intent(ACTION_WATCHDOG).setPackage(packageName)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(this, REQ_WATCHDOG, intent, flags)
    }

    private fun scheduleWatchdog() {
        val pi = watchdogPendingIntent()
        val at = SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
            } else {
                alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
            }
        } catch (_: Exception) {}
    }

    private fun cancelWatchdog() {
        try { alarmManager.cancel(watchdogPendingIntent()) } catch (_: Exception) {}
    }

    private fun runWatchdog() {
        if (token == null || baseUrl == null) return
        Thread {
            // Trabalho SÍNCRONO (renovação proativa + flush) sob WakeLock liberado no finally.
            val wl = acquireWakeLock()
            try {
                maybeRenewCredential()
                flushQueue()
            } finally {
                releaseWakeLock(wl)
            }
            // RECUPERAÇÃO baseada na AUSÊNCIA DE FIX UTILIZÁVEL/FRESCO (reassessment #1), não de
            // callback: callbacks podem chegar sempre stale e nenhum ponto útil existir.
            if (LocationQueueLogic.watchdogNeedsRecovery(
                    lastFreshFixAt, System.currentTimeMillis(), WATCHDOG_STALE_MS, updatesRequested)) {
                try { fusedClient.removeLocationUpdates(locationCallback) } catch (_: Exception) {}
                updatesRequested = false
                recoverOneShotLocation() // administra o próprio WakeLock até a conclusão do Task
                if (startLocationUpdates() == StartUpdatesResult.TERMINAL) return@Thread
            }
        }.start()
    }

    // One-shot de recuperação. O WakeLock (reassessment #2) é mantido até o Task CONCLUIR
    // (success/failure), não liberado antes da espera assíncrona. Teto de segurança no timeout.
    private fun recoverOneShotLocation() {
        if (!hasLocationPermission()) return
        val wl = acquireWakeLock()
        try {
            val req = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(MAX_FIX_AGE_MS)
                .build()
            fusedClient.getCurrentLocation(req, null)
                .addOnSuccessListener { loc ->
                    if (loc != null) { lastCallbackAt = System.currentTimeMillis(); handleLocation(loc) }
                }
                .addOnCompleteListener { releaseWakeLock(wl) }
        } catch (_: Exception) {
            releaseWakeLock(wl)
        }
    }

    private fun acquireWakeLock(): PowerManager.WakeLock? = try {
        powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
            setReferenceCounted(false)
            acquire(WAKELOCK_TIMEOUT_MS)
        }
    } catch (_: Exception) { null }

    private fun releaseWakeLock(wl: PowerManager.WakeLock?) {
        try { if (wl?.isHeld == true) wl.release() } catch (_: Exception) {}
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

    private fun readErrorCode(conn: HttpURLConnection): String? {
        return try {
            val body = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: return null
            if (body.isBlank()) null else JSONObject(body).optString("error", "").ifBlank { null }
        } catch (_: Exception) { null }
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
        return LocationQueueLogic.classify(code, errorCode)
    }

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
                    stopEverything(terminal = true); stopSelf()
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
            if (parar) { falhas.add(payload); continue }
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
                SendResult.SENT -> { /* confirmado → remove */ }
                SendResult.STOP -> {
                    if (mode == MODE_TRACKING) falhas.add(payload)
                    parar = true
                }
                else -> falhas.add(payload)
            }
        }
        if (falhas.isNotEmpty()) enqueueAll(falhas)
        if (parar) { stopEverything(terminal = true); stopSelf() }
    }

    // Renova (ROTACIONA) a credencial — só MODE_TRACKING. Aceita expirada dentro do teto.
    private fun renewCredential(): Boolean {
        if (mode != MODE_TRACKING) return false
        val base = baseUrl ?: return false
        if (token == null) return false
        val now = System.currentTimeMillis()
        if (maxExpiresAt in 1..now) { reportState("interrompida"); stopEverything(terminal = true); stopSelf(); return false }
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
                    updateSelfIntent()
                    return true
                }
                false
            } else {
                val errorCode = readErrorCode(conn)
                conn.disconnect()
                if (LocationQueueLogic.classify(code, errorCode) == SendResult.STOP) { stopEverything(terminal = true); stopSelf() }
                false
            }
        } catch (_: Exception) { false }
    }

    private fun maybeRenewCredential() {
        if (mode != MODE_TRACKING || credentialExpiresAt <= 0L) return
        if (System.currentTimeMillis() < credentialExpiresAt - RENEW_THRESHOLD_MS) return
        renewCredential()
    }

    // Reemite o start intent com os valores ATUAIS → redelivery traz o token rotacionado.
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
        } catch (_: Exception) {}
    }

    private fun reportState(state: String) {
        val base = baseUrl ?: return
        try {
            postJson("$base/fretes/localizacao/sessao/estado", JSONObject().put("estado", state))
        } catch (_: Exception) {}
    }

    private fun parseIso(iso: String): Long {
        return try { java.time.Instant.parse(iso).toEpochMilli() } catch (_: Exception) { 0L }
    }

    // FRESCOR: captured_at = tempo REAL do fix (loc.time). SEM fallback para "agora": handleLocation
    // já descartou fixes com time<=0 (nunca serializar um ponto com captured_at inventado).
    private fun locationToJson(location: Location): JSONObject {
        val capturedAt = java.time.Instant.ofEpochMilli(location.time).toString()
        return JSONObject()
            .put("latitude", String.format(Locale.US, "%.7f", location.latitude).toDouble())
            .put("longitude", String.format(Locale.US, "%.7f", location.longitude).toDouble())
            .put("accuracy_m", if (location.hasAccuracy()) (location.accuracy * 100.0).roundToInt() / 100.0 else JSONObject.NULL)
            .put("captured_at", capturedAt)
            .put("source", "app_foreground_service")
    }

    private fun enqueue(payload: JSONObject) = enqueueAll(listOf(payload))

    private fun enqueueAll(itens: List<JSONObject>) {
        if (itens.isEmpty()) return
        synchronized(queueLock) {
            val atual = readQueue()
            // chave(captured_at) → JSONObject; novos primeiro (primeiro a inserir vence o dedup).
            val porChave = HashMap<String, JSONObject>()
            val newKeys = ArrayList<String>()
            val existingKeys = ArrayList<String>()
            for (o in itens) {
                val k = o.optString("captured_at")
                if (k.isNotEmpty()) { newKeys.add(k); if (!porChave.containsKey(k)) porChave[k] = o }
            }
            for (i in 0 until atual.length()) {
                atual.optJSONObject(i)?.let { o ->
                    val k = o.optString("captured_at")
                    if (k.isNotEmpty()) { existingKeys.add(k); if (!porChave.containsKey(k)) porChave[k] = o }
                }
            }
            val ordem = LocationQueueLogic.orderedDedupCap(existingKeys, newKeys, QUEUE_LIMIT)
            val next = JSONArray()
            for (k in ordem) porChave[k]?.let { next.put(it) }
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

    companion object {
        // SEC-1 (credential storm hardening) — máquina de estados EXPLÍCITA do serviço, consultada
        // pelo MethodChannel 'trackingState'. @Volatile: visível entre threads. Default STOPPED:
        // process-death perde o estado estático → volta a STOPPED (NUNCA interpretado como RUNNING),
        // preservando o fail-safe (o Flutter recupera). START_REDELIVER reexecuta onStartCommand,
        // que volta a marcar RUNNING.
        @Volatile private var trackingState: LocationQueueLogic.NativeTrackingState =
            LocationQueueLogic.NativeTrackingState.STOPPED
        // Instante (relógio MONOTÔNICO) da última transição — base do fail-safe de STARTING travado.
        @Volatile private var stateSinceElapsedMs: Long = 0L
        // Fail-safe de startup: STARTING que exceda isto (startup preso, sem chegar a RUNNING) é
        // reportado como TERMINAL, permitindo recuperação. Rede de segurança, não cadência normal.
        private const val STARTING_MAX_AGE_MS = 30 * 1000L

        @Synchronized private fun transitionTo(next: LocationQueueLogic.NativeTrackingState) {
            trackingState = next
            stateSinceElapsedMs = SystemClock.elapsedRealtime()
        }

        // Marca STARTING SINCRONAMENTE, antes de startForegroundService — fecha a janela em que o
        // MethodChannel 'start' dá ACK mas onStartCommand ainda não rodou (native_start_ack_race).
        fun markStarting() = transitionTo(LocationQueueLogic.NativeTrackingState.STARTING)

        // Estado EFETIVO para o Flutter (com downgrade fail-safe de STARTING travado por idade
        // monotônica). Retorna o nome em minúsculas: stopped|starting|running|terminal.
        @Synchronized fun reportedStateName(): String {
            val idade = SystemClock.elapsedRealtime() - stateSinceElapsedMs
            return LocationQueueLogic.reportedState(trackingState, idade, STARTING_MAX_AGE_MS)
                .name.lowercase(Locale.US)
        }
        private const val ACTION_STOP = "br.com.matopibalog.location.STOP"
        private const val ACTION_WATCHDOG = "br.com.matopibalog.location.WATCHDOG"
        private const val REQ_WATCHDOG = 4229
        private const val WAKELOCK_TAG = "matopibalog:location_send"
        private const val WAKELOCK_TIMEOUT_MS = 60 * 1000L
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
        // Intervalo desejado dos updates do Fused; envio real e filtrado por shouldSend (100m/heartbeat).
        private const val INTERVAL_MS = 60 * 1000L
        private const val MIN_UPDATE_INTERVAL_MS = 30 * 1000L
        private const val HEARTBEAT_MS = 15 * 60 * 1000L
        private const val RENEW_THRESHOLD_MS = 60 * 60 * 1000L
        private const val MIN_DISTANCE_METERS = 100f
        // Frescor: descarta fixes mais velhos que isto (nao atualizar Torre com stale).
        private const val MAX_FIX_AGE_MS = 3 * 60 * 1000L
        // Watchdog: periodo do check e limiar de "ausencia anormal" de fix fresco/utilizavel.
        private const val WATCHDOG_INTERVAL_MS = 8 * 60 * 1000L
        private const val WATCHDOG_STALE_MS = 5 * 60 * 1000L
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
            // SÍNCRONO antes do disparo: marca STARTING para que uma consulta de liveness imediata
            // (reconcile logo após o start) veja o serviço como VIVO e NÃO reemita credencial.
            markStarting()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationTrackingService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }
}
