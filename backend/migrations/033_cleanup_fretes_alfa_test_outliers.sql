-- 033_cleanup_fretes_alfa_test_outliers.sql
-- Auditoria de fretes (PR 4): limpeza CONTROLADA e AUDITÁVEL dos 5 fretes de teste
-- da Empresa Alfa com valores absurdos (ex.: R$ 37.800.000,00), que distorcem
-- relatórios/dashboard. Esses registros são internamente coerentes com a fórmula
-- (toneladas × km × valor_tonelada_km), então o problema é dado de teste legado,
-- não bug de cálculo (ver PRs #291/#292).
--
-- ESTRATÉGIA (nada é apagado):
--   * SOFT-DELETE pelo padrão do sistema: status = 'cancelado'. É exatamente o que
--     o backend faz ao "excluir" um frete (fretesController.delete → update status
--     'cancelado', nunca DELETE físico). Os agregados do dashboard já ignoram
--     'cancelado' (dashboardController filtra 'finalizado'); então cancelar remove
--     o registro das somas SEM apagar o histórico.
--   * BACKUP LÓGICO antes de alterar: snapshot JSONB completo de cada frete numa
--     tabela de auditoria dedicada. Permite rollback e prova do estado anterior.
--   * VALORES MONETÁRIOS PRESERVADOS: só o campo `status` muda. valor_frete,
--     toneladas, valor_tonelada_km, km_* ficam intactos (e ainda ficam no snapshot).
--
-- GARANTIAS:
--   * SEM DELETE / TRUNCATE. Nenhum registro é removido.
--   * UPDATE restrito aos 5 ids EXPLÍCITOS e apenas quando ainda não cancelados.
--   * NÃO toca faturas/billing/Asaas/planos/usuarios nem qualquer outra tabela
--     além de `fretes` (update de status) e `fretes_correcoes_auditoria` (insert).
--   * Idempotente: a tabela e a UNIQUE (frete_id, acao) garantem que reexecutar não
--     duplica snapshot (ON CONFLICT DO NOTHING); o UPDATE ignora quem já está
--     'cancelado'. Rodar duas vezes = mesmo resultado final.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código), DEPOIS
-- de um baseline (ver seção VALIDAÇÃO). Nada aqui é executado pelo backend.

-- ── 1) Tabela de auditoria de correções (aditiva, idempotente) ────────────────
CREATE TABLE IF NOT EXISTS fretes_correcoes_auditoria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id    uuid NOT NULL,
  acao        text NOT NULL,
  motivo      text,
  snapshot    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE (frete_id, acao): idempotência do snapshot (um snapshot por ação/frete).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_correcoes_auditoria_frete_acao_uniq'
  ) THEN
    ALTER TABLE fretes_correcoes_auditoria
      ADD CONSTRAINT fretes_correcoes_auditoria_frete_acao_uniq UNIQUE (frete_id, acao);
  END IF;
END $$;

-- ── 2) Snapshot ANTES de qualquer alteração (backup lógico) ───────────────────
-- Grava o estado atual completo (to_jsonb) dos 5 fretes. ON CONFLICT preserva o
-- snapshot original em reexecuções (não sobrescreve com um estado já alterado).
INSERT INTO fretes_correcoes_auditoria (frete_id, acao, motivo, snapshot)
SELECT f.id,
       'cancelar_outlier_teste',
       'Frete de teste da Empresa Alfa com valor absurdo (auditoria de fretes). '
         || 'Soft-delete para status=cancelado, retirando dos relatorios. '
         || 'Valores monetarios NAO alterados; estado anterior preservado neste snapshot.',
       to_jsonb(f)
  FROM fretes f
 WHERE f.id IN (
   '952eb92a-79d2-4be3-9357-91a545153db7',
   '4fd9a3dd-c737-4435-a30b-d18dcf67d8dc',
   '2a93adff-4140-447a-a68c-be7abc9aac07',
   '7998edf9-4b48-42be-8599-7d02a66d6080',
   '4b80c241-d8da-4142-a151-f9d9412d8553'
 )
ON CONFLICT (frete_id, acao) DO NOTHING;

-- ── 3) Cancelamento (soft-delete) — SÓ os 5 ids, SÓ status, SÓ se não cancelado ──
UPDATE fretes
   SET status = 'cancelado'
 WHERE id IN (
   '952eb92a-79d2-4be3-9357-91a545153db7',
   '4fd9a3dd-c737-4435-a30b-d18dcf67d8dc',
   '2a93adff-4140-447a-a68c-be7abc9aac07',
   '7998edf9-4b48-42be-8599-7d02a66d6080',
   '4b80c241-d8da-4142-a151-f9d9412d8553'
 )
   AND status <> 'cancelado';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (COMENTADO, MANUAL — NÃO executar sem necessidade). Restaura o status
-- anterior de cada frete a partir do snapshot de auditoria. Não recria nada além
-- do status; nenhum valor monetário foi tocado.
--   UPDATE fretes f
--      SET status = a.snapshot->>'status'
--     FROM fretes_correcoes_auditoria a
--    WHERE a.frete_id = f.id
--      AND a.acao = 'cancelar_outlier_teste'
--      AND f.id IN (
--        '952eb92a-79d2-4be3-9357-91a545153db7',
--        '4fd9a3dd-c737-4435-a30b-d18dcf67d8dc',
--        '2a93adff-4140-447a-a68c-be7abc9aac07',
--        '7998edf9-4b48-42be-8599-7d02a66d6080',
--        '4b80c241-d8da-4142-a151-f9d9412d8553'
--      );
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO READ-ONLY (rodar como BASELINE antes e conferência depois).
--
-- B1 — os 5 ids existem ANTES (esperado: 5):
--   SELECT count(*) FROM fretes WHERE id IN (
--     '952eb92a-79d2-4be3-9357-91a545153db7','4fd9a3dd-c737-4435-a30b-d18dcf67d8dc',
--     '2a93adff-4140-447a-a68c-be7abc9aac07','7998edf9-4b48-42be-8599-7d02a66d6080',
--     '4b80c241-d8da-4142-a151-f9d9412d8553');
--
-- B2 — soma de fretes NÃO cancelados da empresa desses fretes, ANTES (baseline):
--   SELECT sum(valor_frete) AS soma_nao_cancelados
--     FROM fretes
--    WHERE status <> 'cancelado'
--      AND empresa_id = (SELECT empresa_id FROM fretes
--                         WHERE id = '952eb92a-79d2-4be3-9357-91a545153db7');
--
-- Após aplicar (2) e (3):
-- A1 — auditoria tem os 5 snapshots (esperado: 5):
--   SELECT count(*) FROM fretes_correcoes_auditoria WHERE acao = 'cancelar_outlier_teste';
--
-- A2 — os 5 estão cancelados (esperado: 5):
--   SELECT count(*) FROM fretes WHERE status = 'cancelado' AND id IN (
--     '952eb92a-79d2-4be3-9357-91a545153db7','4fd9a3dd-c737-4435-a30b-d18dcf67d8dc',
--     '2a93adff-4140-447a-a68c-be7abc9aac07','7998edf9-4b48-42be-8599-7d02a66d6080',
--     '4b80c241-d8da-4142-a151-f9d9412d8553');
--
-- A3 — soma de fretes NÃO cancelados da empresa DEPOIS (deve cair vs B2):
--   (mesma query de B2)
--
-- A4 — gate financeiro de faturas INTACTO (esperado 6 / 4 / 454.88 / 1):
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE status = 'pago')      AS pagas,
--          count(*) FILTER (WHERE status = 'pendente')  AS pendentes,
--          sum(valor) FILTER (WHERE status = 'pago')    AS soma_pagas
--     FROM faturas;
