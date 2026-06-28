-- Migration 018: Idempotência de lançamentos (client_request_id)
-- Rodar no Supabase SQL Editor (sem rollback automático). NÃO aplicada por código.
--
-- Contexto: o app usa .timeout() no envio. Um timeout no app NÃO cancela a
-- requisição no backend — o lançamento pode ser concluído depois que o app já
-- mostrou erro e reabilitou o botão. Se o usuário reenviar, sem idempotência o
-- mesmo lançamento é duplicado (despesa/abastecimento/vale).
--
-- Solução: o app passa a gerar um client_request_id (UUID) por tentativa e o
-- reenvia inalterado no retry. O backend deduplica por (motorista_id,
-- client_request_id). Este índice único parcial é a garantia no banco.
--
-- Compatibilidade:
--   * coluna NULLABLE — lançamentos do painel e de APKs antigos (que não enviam
--     o campo) entram com NULL e seguem funcionando exatamente como hoje;
--   * índice PARCIAL (WHERE client_request_id IS NOT NULL) — não indexa nem
--     restringe as linhas antigas/NULL, então nunca colidem entre si.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
-- permitem reaplicar sem erro. Não altera dados existentes, não toca RLS.

ALTER TABLE despesas       ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE abastecimentos ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE vales          ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_despesas_motorista_client_request_id
  ON despesas (motorista_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_abastecimentos_motorista_client_request_id
  ON abastecimentos (motorista_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vales_motorista_client_request_id
  ON vales (motorista_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
