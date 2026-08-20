-- 071_lancamento_status_cancelado_check.sql
-- HOTFIX da Onda 1: o CHECK de `status` de despesas/abastecimentos/vales só permitia
-- ('aprovado','pendente','rejeitado','finalizado') — sem 'cancelado'. Com isso, a
-- transição para CANCELADO (RPC lancamento_transicionar) violava o CHECK (SQLSTATE
-- 23514) e o cancelamento retornava 500. A migration 070 adicionou as colunas de
-- cancelamento mas esqueceu de relaxar o CHECK.
--
-- Fix: recria o CHECK incluindo 'cancelado'. ADITIVO em efeito (o novo conjunto é
-- superset do antigo → nenhuma linha existente viola), idempotente, sem tocar dados.
-- DROP+ADD do MESMO constraint é a forma canônica de relaxar um CHECK.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['despesas','abastecimentos','vales'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_status_check');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (status = ANY (ARRAY['
      || '''aprovado'',''pendente'',''rejeitado'',''finalizado'',''cancelado'']::text[]))',
      t, t || '_status_check'
    );
  END LOOP;
END $$;

-- ROLLBACK manual (documentação — restaura o conjunto anterior, SÓ se não houver linhas
-- com status='cancelado'; caso haja, mantê-lo é o correto):
--   DO $$ DECLARE t text; BEGIN
--     FOREACH t IN ARRAY ARRAY['despesas','abastecimentos','vales'] LOOP
--       EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t||'_status_check');
--       EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (status = ANY (ARRAY[''aprovado'',''pendente'',''rejeitado'',''finalizado'']::text[]))', t, t||'_status_check');
--     END LOOP;
--   END $$;
