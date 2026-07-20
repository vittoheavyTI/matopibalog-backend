-- 031_add_faturas_recorrencia.sql
-- Frente #5 (Billing v2): faturas automáticas / recorrência — base de dados.
--
-- O PROBLEMA QUE ISTO RESOLVE:
--   A cobrança recorrente precisa saber, para cada empresa, se a fatura DAQUELE
--   MÊS já foi emitida — senão um segundo disparo (retry, reprocessamento de
--   webhook, dois workers, um clique a mais) gera fatura duplicada e cobra o
--   cliente duas vezes pela mesma competência. Hoje `faturas` não tem como
--   identificar "a fatura de jul/2026 da empresa X": não há competência gravada
--   nem marca de que a linha nasceu do fluxo recorrente. Esta migration cria as
--   duas colunas e a trava de unicidade que tornam a emissão IDEMPOTENTE.
--
-- O QUE ESTA MIGRATION FAZ (e só isso):
--   * `periodo_referencia date` — a competência mensal, sempre no dia 1º do mês;
--   * `origem text` — de qual fluxo a fatura nasceu (ex.: 'recorrente');
--   * CHECK garantindo que `periodo_referencia`, quando preenchido, cai no dia 1;
--   * índice único PARCIAL (empresa_id, periodo_referencia) só para as recorrentes.
--
-- GARANTIAS:
--   * ADITIVA: só ADD COLUMN + CHECK + índice. NÃO altera `valor`, status,
--     nem qualquer outra coluna, nem qualquer LINHA existente;
--   * idempotente (ADD COLUMN IF NOT EXISTS, CHECK sob consulta a pg_constraint,
--     CREATE UNIQUE INDEX IF NOT EXISTS);
--   * SEM backfill: faturas antigas ficam com periodo_referencia e origem NULL, e
--     isso é correto — elas não nasceram do fluxo recorrente e não têm
--     competência a declarar. Ambas as colunas são NULLABLE justamente por isso;
--   * sem RLS nesta frente (faturas já opera via backend/service_role);
--   * NÃO cria fatura, NÃO altera cobrança, NÃO toca empresas.plano_id, NÃO mexe
--     em código de backend/frontend/app, no Asaas nem no webhook.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE AQUI HÁ UM CHECK (e por que isso NÃO contradiz a migration 030)
--
-- A 030 argumentou, com razão, que um CHECK em `faturas` é perigoso: se ele
-- recusa a linha, o INSERT falha, e sem fatura NÃO HÁ COBRANÇA — um problema de
-- metadado derrubaria o caminho do dinheiro. Aquele CHECK proibido seria de
-- DOMÍNIO COMERCIAL (o conjunto de modelos de cobrança), uma regra MUTÁVEL que
-- evolui com o catálogo. Prender `faturas` a ela acoplaria dois ciclos de vida.
--
-- O CHECK desta migration é de natureza oposta, em duas frentes:
--
--   1. É um INVARIANTE ESTRUTURAL PERMANENTE, não uma regra comercial. Uma
--      "competência mensal" é, por definição, o primeiro dia do mês. Isso não
--      muda com plano, preço ou modelo de cobrança — é o que a palavra significa.
--      Um CHECK que exige dia 1 nunca precisará de manutenção acoplada a `planos`.
--
--   2. Ele NÃO PODE derrubar o caminho do dinheiro dos fluxos existentes. O CHECK
--      é `periodo_referencia IS NULL OR dia = 1`: toda fatura que NÃO declara
--      competência (manual, avulsa, upgrade, tudo que existe hoje) deixa a coluna
--      NULL e passa incólume. Ele só pode recusar uma linha que JÁ SE PROPÔS a
--      ser recorrente e chegou com um período malformado — exatamente o caso em
--      que emitir seria pior do que falhar, porque um período errado quebra a
--      própria trava de idempotência que justifica esta migration.
--
-- Ou seja: a 030 protege o INSERT de fatura de morrer por causa de auditoria;
-- esta protege a idempotência da recorrência de morrer por causa de um período
-- silenciosamente malformado. São o mesmo princípio — "metadado não derruba
-- dinheiro" — aplicado a riscos diferentes. É uma exceção CONSCIENTE, não um
-- esquecimento do que a 030 ensinou.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Competência mensal da fatura. NULL = a fatura não pertence a um mês de
--    recorrência (é o caso de tudo que existe hoje). Quando preenchida, o CHECK
--    abaixo exige que seja o 1º dia do mês.
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS periodo_referencia date NULL;

-- 2. Fluxo que originou a fatura (ex.: 'recorrente'). Livre de propósito: o
--    índice parcial adiante só reage ao valor 'recorrente'; qualquer outro valor
--    (ou NULL) fica fora da trava de unicidade, sem custo.
ALTER TABLE faturas
  ADD COLUMN IF NOT EXISTS origem text NULL;

-- 3. CHECK: competência, quando existe, é sempre dia 1º. Veja o bloco acima para
--    por que este CHECK é seguro (não bloqueia nenhum fluxo que deixe a coluna
--    NULL) e por que não contradiz a 030. Adicionado sob consulta a
--    pg_constraint para ser idempotente — Postgres não tem ADD CONSTRAINT IF NOT
--    EXISTS para CHECK.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'faturas_periodo_referencia_dia1_check'
  ) THEN
    ALTER TABLE faturas
      ADD CONSTRAINT faturas_periodo_referencia_dia1_check
      CHECK (periodo_referencia IS NULL OR EXTRACT(DAY FROM periodo_referencia) = 1);
  END IF;
END $$;

-- 4. Trava de idempotência: no máximo UMA fatura recorrente por empresa e
--    competência. Índice único PARCIAL — só vale onde origem = 'recorrente'.
--    Consequências desse recorte, todas intencionais:
--      * faturas antigas (origem NULL) ficam FORA do índice — nenhuma colisão no
--        deploy, mesmo sem backfill;
--      * faturas manuais/avulsas/de upgrade nunca disputam essa unicidade;
--      * o par (empresa, mês) da recorrência passa a ser único no banco, então
--        um segundo disparo do mesmo mês bate no índice e falha em vez de
--        duplicar a cobrança silenciosamente.
CREATE UNIQUE INDEX IF NOT EXISTS ux_faturas_recorrente_empresa_periodo
  ON faturas (empresa_id, periodo_referencia)
  WHERE origem = 'recorrente';

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após os ALTER — TODAS somente leitura)
--
-- (V1) As 2 colunas nasceram, ambas NULLABLE e sem default.
--      Espera-se 2 linhas, is_nullable = YES e column_default = NULL em ambas.
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'faturas'
--     AND column_name IN ('periodo_referencia', 'origem')
--   ORDER BY column_name;
--
-- (V2) GATE FINANCEIRO — nenhuma fatura existente foi tocada.
--      `valor` é a coluna que importa: nada aqui pode ter mexido nela, e como não
--      houve backfill, nenhuma linha antiga deve ter periodo_referencia/origem.
--      Espera-se: total = (o total de antes), com_periodo = 0, com_origem = 0, e
--      as somas de valor por status idênticas ao que eram antes da migration.
--   SELECT status,
--          count(*)                    AS faturas,
--          count(periodo_referencia)   AS com_periodo,
--          count(origem)               AS com_origem,
--          sum(valor)                  AS soma_valor
--   FROM faturas GROUP BY status ORDER BY status;
--
-- (V3) O CHECK e o índice único parcial existem.
--      Espera-se: faturas_periodo_referencia_dia1_check e
--      ux_faturas_recorrente_empresa_periodo.
--   SELECT conname AS objeto FROM pg_constraint
--   WHERE conrelid = 'faturas'::regclass
--     AND conname = 'faturas_periodo_referencia_dia1_check'
--   UNION ALL
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'faturas' AND indexname = 'ux_faturas_recorrente_empresa_periodo';
--
-- (V4) O índice é UNIQUE e PARCIAL com o predicado certo, e o CHECK carrega a
--      cláusula esperada. Espera-se ver "UNIQUE" e "WHERE (origem = 'recorrente')"
--      no indexdef, e "EXTRACT(day ...) = 1" (ou equivalente) no CHECK.
--   SELECT indexdef FROM pg_indexes
--   WHERE tablename = 'faturas' AND indexname = 'ux_faturas_recorrente_empresa_periodo';
--   SELECT pg_get_constraintdef(oid) AS check_def FROM pg_constraint
--   WHERE conname = 'faturas_periodo_referencia_dia1_check';
--
-- NOTA — não há teste negativo destrutivo aqui (esta migration não INSERE nada).
-- A prova de que o CHECK recusa dia != 1 e de que o índice recusa a 2ª recorrente
-- do mesmo mês pertence ao teste do serviço de recorrência, não a este arquivo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter)
--
-- Seguro a qualquer momento: as colunas são puro metadado de recorrência.
-- Derrubá-las NÃO afeta `valor`, status, cobrança nem nada que já foi pago — só
-- descarta a marcação de competência/origem e a trava de idempotência. Ordem
-- inversa da criação (índice → CHECK → colunas).
--
--   DROP INDEX IF EXISTS ux_faturas_recorrente_empresa_periodo;
--   ALTER TABLE faturas DROP CONSTRAINT IF EXISTS faturas_periodo_referencia_dia1_check;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS origem;
--   ALTER TABLE faturas DROP COLUMN IF EXISTS periodo_referencia;
-- ─────────────────────────────────────────────────────────────────────────────
