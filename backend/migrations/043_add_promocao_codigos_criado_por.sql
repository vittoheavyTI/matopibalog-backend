-- 043_add_promocao_codigos_criado_por.sql
-- Hardening de segurança (mega-frente comercial): auditoria de "quem gerou o
-- código promocional". A tabela promocao_codigos (migration 040) não guardava o
-- autor — só o timestamp. Esta migration adiciona a coluna, alinhando com
-- promocoes.criado_por e promocao_resgates.aplicado_por.
--
-- GARANTIAS
--   * ADITIVA: só ADD COLUMN + FK. NÃO altera dado nem comportamento;
--   * idempotente (ADD COLUMN IF NOT EXISTS + FK sob consulta a pg_constraint);
--   * SEM backfill: códigos já existentes ficam com criado_por NULL (autor
--     desconhecido, honesto — não inventa autoria retroativa);
--   * o backend já grava criado_por=req.user.uid ao gerar código, e é
--     DEPLOY-SAFE: enquanto esta migration não roda, o insert reinsere sem a
--     coluna (o código continua funcionando; só a auditoria do autor fica
--     pendente até aplicar).
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização).

ALTER TABLE promocao_codigos
  ADD COLUMN IF NOT EXISTS criado_por uuid NULL;

-- FK segura: apagar o usuário NÃO apaga nem trava o código — só zera a autoria
-- (mesmo padrão de planos.arquivado_por e faturas.implantacao_isento_por).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promocao_codigos_criado_por_fkey'
  ) THEN
    ALTER TABLE promocao_codigos
      ADD CONSTRAINT promocao_codigos_criado_por_fkey
      FOREIGN KEY (criado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (somente leitura)
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='promocao_codigos' AND column_name='criado_por';
--   -- esperado: criado_por | uuid | YES
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (seguro; a coluna é aditiva e nullable)
--   ALTER TABLE promocao_codigos DROP CONSTRAINT IF EXISTS promocao_codigos_criado_por_fkey;
--   ALTER TABLE promocao_codigos DROP COLUMN IF EXISTS criado_por;
-- ─────────────────────────────────────────────────────────────────────────────
