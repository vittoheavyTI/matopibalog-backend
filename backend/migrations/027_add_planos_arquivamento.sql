-- 027_add_planos_arquivamento.sql
-- Frente #6 (Billing v2): arquivamento de planos no painel + exclusão segura.
--
-- Aditiva e reversível. Duas dimensões ORTOGONAIS, não confundir:
--   * ativo=false        → plano não aparece no APP/cadastro (/planos/publicos já filtra ativo=true);
--   * arquivado_em != null → plano sai da VISÃO PRINCIPAL do painel (vai para "Arquivados").
-- Arquivar também seta ativo=false (arquivado implica fora do app). Desarquivar
-- zera arquivado_em/por mas NÃO reativa (ativo permanece false — reativar é ação separada).
--
-- ja_utilizado: marca durável de "já foi atribuído a alguma empresa". É a base do
-- critério conservador (B) do botão Excluir: só exclui fisicamente quem NUNCA foi usado.
-- Como hoje não há prova histórica de não-uso (faturas não guardam plano_id), o
-- backfill trata TODO plano existente como já usado → só planos NOVOS pós-migration
-- podem se tornar excluíveis. Limpeza da tela é feita por Arquivar, não por Excluir.

ALTER TABLE planos ADD COLUMN IF NOT EXISTS arquivado_em  timestamptz NULL;
ALTER TABLE planos ADD COLUMN IF NOT EXISTS arquivado_por uuid        NULL;
ALTER TABLE planos ADD COLUMN IF NOT EXISTS ja_utilizado  boolean     NOT NULL DEFAULT false;

-- FK segura: apagar um usuário NÃO bloqueia nem apaga o plano — só zera a autoria.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planos_arquivado_por_fkey') THEN
    ALTER TABLE planos
      ADD CONSTRAINT planos_arquivado_por_fkey
      FOREIGN KEY (arquivado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill CONSERVADOR (critério B): sem prova de não-uso, todo plano existente
-- é tratado como já usado. Rode UMA vez após o ALTER.
UPDATE planos SET ja_utilizado = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter):
--   ALTER TABLE planos DROP CONSTRAINT IF EXISTS planos_arquivado_por_fkey;
--   ALTER TABLE planos DROP COLUMN IF EXISTS arquivado_por;
--   ALTER TABLE planos DROP COLUMN IF EXISTS arquivado_em;
--   ALTER TABLE planos DROP COLUMN IF EXISTS ja_utilizado;
-- ─────────────────────────────────────────────────────────────────────────────
