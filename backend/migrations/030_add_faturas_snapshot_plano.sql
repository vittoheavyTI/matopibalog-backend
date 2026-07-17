-- 030_add_faturas_snapshot_plano.sql
-- Frente #4 (Billing v2): cobrança por motorista. PR 6 — snapshot de plano na fatura.
--
-- O PROBLEMA QUE ISTO RESOLVE:
--   Hoje `faturas` guarda só `valor`. Não há `plano_id`, preço unitário nem
--   quantidade — é impossível reconstruir POR QUE uma cobrança teve o valor que
--   teve. Enquanto todo plano era de preço fixo isso doía pouco; com preço por
--   motorista, o valor passa a ser uma CONTA (unitário × quantidade), e um
--   cliente que conteste "por que R$ 1.000,00?" merece resposta gravada na linha,
--   não reconstruída de memória a partir do plano de hoje — que pode ter mudado.
--
-- O QUE É SNAPSHOT E O QUE NÃO É:
--   `valor` continua sendo o VALOR FINAL COBRADO — nada aqui o altera ou
--   substitui. As colunas abaixo são o CONGELAMENTO da composição no momento da
--   cobrança. Editar o plano depois não as reescreve: é esse o ponto.
--
-- GARANTIAS:
--   * ADITIVA: só ADD COLUMN + FK + índice. NÃO altera `valor`, status, nem
--     qualquer outra coluna, nem qualquer LINHA;
--   * idempotente (ADD COLUMN IF NOT EXISTS, FK sob consulta a pg_constraint,
--     CREATE INDEX IF NOT EXISTS);
--   * SEM backfill: faturas antigas ficam com snapshot NULL, e isso é correto —
--     não temos como saber a composição delas, e inventar seria pior que admitir
--     a ausência. Todas as colunas são NULLABLE justamente por isso;
--   * sem RLS nesta frente (faturas já opera via backend/service_role);
--   * NÃO cria fatura, NÃO altera cobrança, NÃO toca empresas.plano_id.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE NÃO HÁ NENHUM CHECK AQUI (leitura obrigatória antes de "melhorar")
--
-- A migration 029 pôs CHECK de domínio e de coerência em `planos`, e isso foi
-- certo lá. Aqui seria ERRADO, porque as apostas são invertidas:
--
--   * em `planos`, um CHECK que recusa uma linha só impede um plano ruim de
--     nascer — nenhum dinheiro em jogo;
--   * em `faturas`, um CHECK que recusa uma linha faz o INSERT da fatura falhar,
--     e sem fatura NÃO HÁ COBRANÇA. Um problema de METADADO derrubaria o caminho
--     do dinheiro. Snapshot é auditoria: ele nunca pode ser motivo de uma
--     cobrança não acontecer.
--
-- Um CHECK de domínio em modelo_cobranca_snapshot ('fixo'|'por_motorista') seria
-- pior ainda: acoplaria a evolução de `faturas` à de `planos`. No dia em que
-- alguém adicionar um terceiro modelo ao CHECK de `planos` e esquecer deste, a
-- criação de faturas quebraria — e o sintoma apareceria no cliente, não no
-- catálogo. Quem garante a coerência do snapshot é a aplicação, que escreve o
-- valor a partir de uma constante controlada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Vínculo com o plano que originou a cobrança.
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS plano_id uuid NULL;

-- 2. Composição CONGELADA no momento da cobrança.
--    Em plano fixo, unitário e quantidade ficam NULL: não houve conta, o valor
--    foi digitado. NULL aqui significa "não se aplica", não "esqueceram".
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS plano_nome_snapshot      text          NULL;
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS modelo_cobranca_snapshot text          NULL;
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS preco_unitario_snapshot  numeric(10,2) NULL;
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS quantidade_snapshot      integer       NULL;

-- 3. FK segura: apagar um plano NÃO apaga nem bloqueia a fatura — só zera o
--    vínculo. Os snapshots de nome/modelo/unitário/quantidade SOBREVIVEM, que é
--    exatamente o que uma trilha de auditoria precisa fazer quando a origem some.
--    (Mesma filosofia da FK planos_arquivado_por_fkey, migration 027.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'faturas_plano_id_fkey') THEN
    ALTER TABLE faturas
      ADD CONSTRAINT faturas_plano_id_fkey
      FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Índice na FK. O Postgres NÃO cria índice de FK automaticamente, e o
--    ON DELETE SET NULL faz ele varrer `faturas` a cada plano apagado. Hoje o
--    volume é irrelevante; o índice é seguro barato para quando não for.
CREATE INDEX IF NOT EXISTS idx_faturas_plano_id ON faturas (plano_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o ALTER — TODAS somente leitura)
--
-- (1) As 5 colunas nasceram, todas NULLABLE e sem default.
--     Espera-se 5 linhas, is_nullable = YES e column_default = NULL em todas.
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'faturas'
--     AND column_name IN ('plano_id', 'plano_nome_snapshot',
--                         'modelo_cobranca_snapshot', 'preco_unitario_snapshot',
--                         'quantidade_snapshot')
--   ORDER BY column_name;
--
-- (2) GATE FINANCEIRO — nenhuma fatura existente foi tocada.
--     `valor` é a coluna que importa: nada aqui pode ter mexido nela.
--     Espera-se: total = (o total de antes), com_snapshot = 0, e as somas de
--     valor por status idênticas ao que eram antes da migration.
--   SELECT status,
--          count(*)                          AS faturas,
--          count(plano_id)                   AS com_plano_id,
--          count(modelo_cobranca_snapshot)   AS com_snapshot,
--          sum(valor)                        AS soma_valor
--   FROM faturas GROUP BY status ORDER BY status;
--
-- (3) A FK e o índice existem.
--     Espera-se: faturas_plano_id_fkey e idx_faturas_plano_id.
--   SELECT conname AS objeto FROM pg_constraint
--   WHERE conrelid = 'faturas'::regclass AND conname = 'faturas_plano_id_fkey'
--   UNION ALL
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'faturas' AND indexname = 'idx_faturas_plano_id';
--
-- (4) A FK aponta para planos com ON DELETE SET NULL (não CASCADE, não RESTRICT).
--     Espera-se confdeltype = 'n' (SET NULL). 'c' seria CASCADE — apagaria
--     faturas junto com o plano, o oposto do que queremos.
--   SELECT conname, confrelid::regclass AS referencia, confdeltype
--   FROM pg_constraint WHERE conname = 'faturas_plano_id_fkey';
--
-- NOTA — não há teste negativo aqui, e não há CHECK a testar: veja o bloco
-- "POR QUE NÃO HÁ NENHUM CHECK AQUI" acima. A coerência do snapshot é provada
-- em teste unitário do upgradeRequestService, não contra o banco.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter)
--
-- Seguro a qualquer momento: as colunas são puro metadado. Derrubá-las NÃO
-- afeta `valor`, status, cobrança nem nada que já foi pago — só descarta a
-- trilha de auditoria acumulada até aqui, que não é recuperável depois.
--
--   DROP INDEX IF EXISTS idx_faturas_plano_id;
--   ALTER TABLE faturas DROP CONSTRAINT IF EXISTS faturas_plano_id_fkey;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS quantidade_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS preco_unitario_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS modelo_cobranca_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS plano_nome_snapshot;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS plano_id;
-- ─────────────────────────────────────────────────────────────────────────────
