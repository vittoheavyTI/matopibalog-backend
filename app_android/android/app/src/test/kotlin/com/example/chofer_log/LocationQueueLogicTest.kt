package com.example.chofer_log

import com.example.chofer_log.LocationQueueLogic.SendResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SEC-1 (reassessment #8) — testes automatizados da lógica PURA da fila offline:
 * captura offline → enqueue → reconexão → flush → captured_at preservado → erro transitório
 * preserva → erro definitivo não corrompe. Roda em JVM (./gradlew testDebugUnitTest).
 */
class LocationQueueLogicTest {

    // ── classify: transitório (mantém na fila) vs definitivo ────────────────────
    @Test fun classify_2xx_e_SENT() {
        assertEquals(SendResult.SENT, LocationQueueLogic.classify(201, null))
        assertEquals(SendResult.SENT, LocationQueueLogic.classify(200, null))
    }

    @Test fun classify_offline_e_transitorio_KEEP() {
        // Sem rede (code 0), timeout (408), rate limit (429), 5xx → transitório → preserva.
        assertEquals(SendResult.KEEP, LocationQueueLogic.classify(0, null))
        assertEquals(SendResult.KEEP, LocationQueueLogic.classify(408, null))
        assertEquals(SendResult.KEEP, LocationQueueLogic.classify(429, null))
        assertEquals(SendResult.KEEP, LocationQueueLogic.classify(503, null))
    }

    @Test fun classify_expired_rotated_e_RENEW() {
        assertEquals(SendResult.RENEW, LocationQueueLogic.classify(401, "tracking_credential_expired"))
        assertEquals(SendResult.RENEW, LocationQueueLogic.classify(409, "tracking_credential_rotated"))
    }

    @Test fun classify_definitivo_e_STOP() {
        assertEquals(SendResult.STOP, LocationQueueLogic.classify(403, "tracking_session_revoked"))
        assertEquals(SendResult.STOP, LocationQueueLogic.classify(409, "tracking_trip_inactive"))
        assertEquals(SendResult.STOP, LocationQueueLogic.classify(400, "tracking_credential_invalid"))
    }

    // ── preserveOnResult: transitório preserva; definitivo não corrompe ─────────
    @Test fun preserve_transitorio_sempre_preserva() {
        assertTrue(LocationQueueLogic.preserveOnResult(SendResult.KEEP, "tracking"))
        assertTrue(LocationQueueLogic.preserveOnResult(SendResult.RENEW, "tracking"))
    }

    @Test fun preserve_sent_descarta() {
        assertFalse(LocationQueueLogic.preserveOnResult(SendResult.SENT, "tracking"))
    }

    @Test fun preserve_stop_em_tracking_preserva_em_sessao_descarta() {
        // Erro definitivo em tracking: preserva (nunca perde por stopSelf).
        assertTrue(LocationQueueLogic.preserveOnResult(SendResult.STOP, "tracking"))
        // Em sessão/legado: descarta (comportamento legado).
        assertFalse(LocationQueueLogic.preserveOnResult(SendResult.STOP, "session"))
    }

    // ── fila: enqueue offline, dedup por captured_at, cap, ordem, preservação ────
    @Test fun enqueue_offline_preserva_e_flush_mantem_ordem() {
        // Offline: pontos gerados entram na fila; nada é perdido.
        val existentes = listOf("t3", "t2", "t1")
        val novos = listOf("t5", "t4")
        val r = LocationQueueLogic.orderedDedupCap(existentes, novos, 20)
        // novos primeiro (mais recentes), depois existentes; captured_at (identidade) preservado.
        assertEquals(listOf("t5", "t4", "t3", "t2", "t1"), r)
    }

    @Test fun dedup_por_captured_at_nao_duplica() {
        val existentes = listOf("t2", "t1")
        val novos = listOf("t3", "t2") // t2 repetido
        val r = LocationQueueLogic.orderedDedupCap(existentes, novos, 20)
        assertEquals(listOf("t3", "t2", "t1"), r)
    }

    @Test fun cap_limita_tamanho_sem_corromper() {
        val existentes = (1..30).map { "e$it" }
        val novos = (1..5).map { "n$it" }
        val r = LocationQueueLogic.orderedDedupCap(existentes, novos, 20)
        assertEquals(20, r.size)
        // novos entram primeiro (não são descartados pelo cap).
        assertEquals(listOf("n1", "n2", "n3", "n4", "n5"), r.subList(0, 5))
    }

    @Test fun chaves_vazias_sao_ignoradas() {
        val r = LocationQueueLogic.orderedDedupCap(listOf("", "t1", ""), listOf("t2", ""), 20)
        assertEquals(listOf("t2", "t1"), r)
    }

    @Test fun reconexao_flush_reenfileira_falha_transitoria_sem_perder() {
        // Simula: fila offline [t1,t2]; ao reconectar, t1 falha transitório (KEEP) e volta,
        // t2 é SENT. Modelamos o re-enqueue: falha (preservada) + eventuais novos.
        val falhasPreservadas = listOf("t1") // t1 KEEP → preservado
        val novosAposFlush = listOf("t3")
        val r = LocationQueueLogic.orderedDedupCap(falhasPreservadas, novosAposFlush, 20)
        assertEquals(listOf("t3", "t1"), r)
        // t1 (capturado offline) NÃO foi perdido.
        assertTrue(r.contains("t1"))
    }
}
