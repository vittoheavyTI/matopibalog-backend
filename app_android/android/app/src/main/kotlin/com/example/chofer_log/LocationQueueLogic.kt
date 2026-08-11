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
