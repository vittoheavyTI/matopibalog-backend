-- 036_add_empresas_arquivamento.sql
-- Mega-frente de higiene operacional: arquivamento SOFT de empresas (contas de
-- teste/lixo saem da operação sem perder histórico). Espelha o arquivamento de
-- planos (migration 027), mas para empresas.
--
-- SÓ DDL, ADITIVA E REVERSÍVEL. NENHUM DML aqui — nenhuma empresa é arquivada por
-- este arquivo. Arquivar contas específicas é uma migration/script SEPARADO
-- (037), com lista explícita de empresa_id e autorização à parte.
--
-- DIMENSÃO ORTOGONAL a `status` — NÃO confundir:
--   * status='suspenso'      → estado FINANCEIRO/operacional (inadimplência etc.);
--   * arquivada_em != null    → LIMPEZA: a conta sai da visão/operação padrão do
--                               painel e dos jobs de billing, mantendo todo o
--                               histórico (faturas, fretes, usuários) intacto.
-- Uma conta pode estar suspensa E não arquivada, ou ativa E arquivada. Reaproveitar
-- `suspenso` para "arquivo" seria errado — por isso a coluna nova.
--
-- Faturas, assinaturas Asaas e qualquer dado financeiro NÃO são tocados por
-- arquivar. Arquivar é reversível (basta zerar arquivada_em).

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS arquivada_em     timestamptz NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS arquivada_motivo text        NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS arquivada_por    uuid        NULL;

-- Autoria: apagar um usuário NÃO bloqueia nem apaga a empresa — só zera a autoria.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresas_arquivada_por_fkey') THEN
    ALTER TABLE empresas
      ADD CONSTRAINT empresas_arquivada_por_fkey
      FOREIGN KEY (arquivada_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índice parcial: a operação consulta "não arquivadas" o tempo todo; arquivadas
-- são a exceção. Parcial mantém o índice pequeno (só as arquivadas).
CREATE INDEX IF NOT EXISTS idx_empresas_arquivada_em
  ON empresas (arquivada_em)
  WHERE arquivada_em IS NOT NULL;

-- Backfill: NENHUM. Toda empresa nasce (e permanece) NÃO arquivada até uma ação
-- explícita de arquivamento. Default NULL já garante isso.

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter):
--   DROP INDEX IF EXISTS idx_empresas_arquivada_em;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_arquivada_por_fkey;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS arquivada_por;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS arquivada_motivo;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS arquivada_em;
-- ─────────────────────────────────────────────────────────────────────────────
