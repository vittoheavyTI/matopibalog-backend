package com.example.chofer_log

/**
 * SEC-1 — lógica PURA (sem Android, sem org.json) da fila offline e da classificação de
 * envio, extraída do LocationTrackingService para teste automatizado em JVM (reassessment #8):
 * captura offline → enqueue → reconexão → flush → captured_at preservado → erro transitório
 * preserva → erro definitivo não corrompe a fila.
 */
object LocationQueueLogic {

    /** Resultado semântico de um POST (§M-2). Decide fila e stopSelf — nunca por status cru. */
    enum class SendResult { SENT, KEEP, RENEW, STOP }

    /**
     * Resultado explícito da tentativa de iniciar updates nativos. Evita tratar caminho terminal
     * (stopSelf) como serviço vivo apenas porque onStartCommand foi chamado.
     */
    enum class StartUpdatesResult { STARTED, RECOVERABLE, TERMINAL }

    /**
     * `running` significa serviço nativo vivo e autorizado a manter/recoverar tracking.
     * STARTED: Fused aceitou updates. RECOVERABLE: serviço segue vivo sem updates ativos e o
     * watchdog pode tentar recovery. TERMINAL: serviço encerrou/encerrará limpo.
     */
    fun nativeRunningAfterStart(result: StartUpdatesResult): Boolean = when (result) {
        StartUpdatesResult.STARTED, StartUpdatesResult.RECOVERABLE -> true
        StartUpdatesResult.TERMINAL -> false
    }

    /**
     * SEC-1 (credential storm hardening) — máquina de estados EXPLÍCITA do serviço nativo,
     * reportada ao Flutter para fechar a race de liveness (native_start_ack_race):
     *  - STOPPED:  parado limpo (ou estado estático perdido por process-death — fail-safe).
     *  - STARTING: start() disparado; ForegroundService ainda inicializando (janela em que o
     *              MethodChannel 'start' JÁ deu ACK mas onStartCommand ainda NÃO rodou). É VIVO:
     *              o Flutter NÃO deve reemitir credencial nessa janela.
     *  - RUNNING:  onStartCommand aceitou a inicialização operacional (updates ativos/recuperáveis).
     *  - TERMINAL: encerrou por erro/permissão/credencial morta → recuperação controlada permitida.
     */
    enum class NativeTrackingState { STOPPED, STARTING, RUNNING, TERMINAL }

    /** Estado após onStartCommand a partir do resultado de iniciar os updates. */
    fun stateAfterStart(result: StartUpdatesResult): NativeTrackingState = when (result) {
        StartUpdatesResult.STARTED, StartUpdatesResult.RECOVERABLE -> NativeTrackingState.RUNNING
        StartUpdatesResult.TERMINAL -> NativeTrackingState.TERMINAL
    }

    /**
     * Estado EFETIVO reportado ao Flutter. Fail-safe de startup travado: um STARTING que passa
     * de `startingMaxAgeMs` (relógio MONOTÔNICO no chamador) é reportado como TERMINAL — assim um
     * ForegroundService que nunca chegou a RUNNING (startup preso) permite recuperação, sem sleep
     * arbitrário. Limite explícito/documentado, usado APENAS como rede de segurança de startup.
     */
    fun reportedState(raw: NativeTrackingState, stateAgeMs: Long, startingMaxAgeMs: Long): NativeTrackingState {
        if (raw == NativeTrackingState.STARTING && stateAgeMs > startingMaxAgeMs) return NativeTrackingState.TERMINAL
        return raw
    }

    /** STARTING e RUNNING são "vivos" — o serviço está em inicialização legítima ou operando. */
    fun nativeStateIsAlive(state: NativeTrackingState): Boolean =
        state == NativeTrackingState.STARTING || state == NativeTrackingState.RUNNING

    /**
     * Classifica por CÓDIGO semântico + status HTTP.
     *  - 2xx → SENT (confirmado, remove da fila).
     *  - expired/rotated → RENEW (renova a credencial; NÃO descarta o ponto).
     *  - 408/429/0/>=5xx → KEEP (transitório: preserva na fila — captura offline cai aqui).
     *  - demais (revoked/max_lifetime/session_revoked/tenant/device/trip_inactive/invalid; e,
     *    em MODE_SESSION, 401/403/409) → STOP (definitivo).
     */
    fun classify(code: Int, errorCode: String?): SendResult {
        if (code in 200..299) return SendResult.SENT
        if (errorCode == "tracking_credential_expired" || errorCode == "tracking_credential_rotated") return SendResult.RENEW
        if (code == 408 || code == 429 || code == 0 || code >= 500) return SendResult.KEEP
        return SendResult.STOP
    }

    /**
     * O ponto deve ser PRESERVADO na fila após este resultado?
     *  - SENT → não (confirmado).
     *  - KEEP/RENEW → sim (transitório/renovação, nunca perde).
     *  - STOP → só em MODE_TRACKING (preserva para não perder por stopSelf; em sessão/legado descarta).
     */
    fun preserveOnResult(res: SendResult, mode: String): Boolean = when (res) {
        SendResult.SENT -> false
        SendResult.KEEP, SendResult.RENEW -> true
        SendResult.STOP -> mode == "tracking"
    }

    /**
     * Ordena/deduplica/limita a fila por `captured_at` (identidade do ponto).
     * `novos` entram PRIMEIRO (mais recentes), depois a fila existente; dedup por chave e teto
     * `limit`. O `captured_at` é a IDENTIDADE preservada — nunca reescrito. Modela o merge do
     * enqueue offline e do re-enqueue de falhas no flush. Chaves vazias/nulas são ignoradas.
     */
    /**
     * O watchdog precisa RECUPERAR o stream de localização? Baseia-se na AUSÊNCIA de FIX
     * UTILIZÁVEL/FRESCO (não de callback): callbacks podem chegar sempre stale sem nenhum ponto
     * útil. Recupera se os updates não estão ativos OU se faz mais que `staleMs` sem fix fresco.
     */
    fun watchdogNeedsRecovery(lastFreshFixAtMs: Long, nowMs: Long, staleMs: Long, updatesRequested: Boolean): Boolean {
        if (!updatesRequested) return true
        return (nowMs - lastFreshFixAtMs) > staleMs
    }

    fun orderedDedupCap(existingKeys: List<String>, newKeys: List<String>, limit: Int): List<String> {
        val out = ArrayList<String>(limit)
        val seen = HashSet<String>()
        fun add(k: String?) {
            if (out.size >= limit) return
            if (k.isNullOrEmpty()) return
            if (!seen.add(k)) return
            out.add(k)
        }
        for (k in newKeys) add(k)
        for (k in existingKeys) add(k)
        return out
    }
}
