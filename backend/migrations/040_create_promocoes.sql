-- 040_create_promocoes.sql
-- MEGA-FRENTE Billing Comercial Avançado — FASE 5: motor de PROMOÇÕES / TICKETS.
--
-- O QUE ESTA MIGRATION FAZ (só ESTRUTURA — nenhuma promoção real entra aqui)
--   Cria as 3 tabelas do motor de promoções, no desenho proposto pelo prompt:
--     * promocoes         → a CAMPANHA (tipo de desconto, janela, plano-alvo, limites);
--     * promocao_codigos  → os CÓDIGOS/TICKETS da campanha (1 ou muitos: feira);
--     * promocao_resgates → a TRILHA DE AUDITORIA (quem aplicou, empresa, preço
--                           original/final, motivo, snapshot).
--
--   POR QUE 3 TABELAS (e não 1): separar CAMPANHA de CÓDIGO permite os dois casos
--   reais — um código único compartilhado (com limite de usos) OU muitos tickets
--   únicos de feira, todos sob a mesma campanha. E separar o RESGATE dá auditoria
--   imutável por uso, sem inflar a campanha.
--
--   A APLICAÇÃO (promocaoDomainService) guarda a POLÍTICA (validade, limites, uso
--   único, alvo, tipo de desconto e cálculo em centavos). O BANCO guarda o
--   invariante estrutural (FKs, janela coerente, faixas de valor).
--
-- GARANTIAS
--   * CREATE TABLE IF NOT EXISTS — idempotente; não altera nenhuma tabela existente;
--   * SEM dado: nenhuma campanha/código/resgate é inserido aqui;
--   * NÃO cobra nada, NÃO fala com Asaas, NÃO aplica preço.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

-- ─── 1. promocoes — a campanha ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promocoes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                    text NOT NULL,                 -- nome da campanha
  descricao               text NULL,
  -- tipo de benefício. A app valida qual campo de valor cada tipo usa.
  tipo                    text NOT NULL CHECK (tipo IN (
                            'desconto_percentual_mensalidade',
                            'desconto_fixo_mensalidade',
                            'desconto_percentual_implantacao',
                            'desconto_fixo_implantacao',
                            'isencao_implantacao',
                            'trial_estendido',
                            'preco_promocional'
                          )),
  percentual              numeric(5,2) NULL,             -- 0..100 (tipos percentuais)
  valor                   numeric(10,2) NULL,            -- desconto fixo / preço promocional
  duracao_meses           integer NULL,                  -- preço promocional / duração do desconto
  dias_trial_extra        integer NULL,                  -- trial_estendido
  data_inicio             timestamptz NOT NULL,
  data_fim                timestamptz NOT NULL,
  ativo                   boolean NOT NULL DEFAULT true,
  limite_usos_total       integer NULL,                  -- NULL = ilimitado
  usos_total              integer NOT NULL DEFAULT 0,
  uso_unico_por_empresa   boolean NOT NULL DEFAULT true,
  plano_alvo_id           uuid NULL REFERENCES planos(id) ON DELETE SET NULL, -- NULL = todos
  criado_por              uuid NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NULL,
  CONSTRAINT promocoes_janela_coerente_check   CHECK (data_fim >= data_inicio),
  CONSTRAINT promocoes_percentual_faixa_check  CHECK (percentual IS NULL OR (percentual >= 0 AND percentual <= 100)),
  CONSTRAINT promocoes_valor_nao_negativo_check CHECK (valor IS NULL OR valor >= 0),
  CONSTRAINT promocoes_limite_nao_negativo_check CHECK (limite_usos_total IS NULL OR limite_usos_total >= 0)
);

-- ─── 2. promocao_codigos — códigos/tickets da campanha ───────────────────────
CREATE TABLE IF NOT EXISTS promocao_codigos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id  uuid NOT NULL REFERENCES promocoes(id) ON DELETE CASCADE,
  codigo       text NOT NULL,                 -- normalizado em MAIÚSCULAS pela app
  limite_usos  integer NULL,                  -- por-código; NULL = ilimitado na campanha
  usos         integer NOT NULL DEFAULT 0,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promocao_codigos_limite_nao_negativo_check CHECK (limite_usos IS NULL OR limite_usos >= 0)
);

-- Código único global (um código mapeia para UMA campanha). Case-insensitive via
-- índice em upper(codigo): 'FEIRA10' e 'feira10' são o mesmo código.
CREATE UNIQUE INDEX IF NOT EXISTS ux_promocao_codigos_codigo ON promocao_codigos (upper(codigo));
CREATE INDEX IF NOT EXISTS ix_promocao_codigos_promocao ON promocao_codigos (promocao_id);

-- ─── 3. promocao_resgates — auditoria imutável por uso ───────────────────────
CREATE TABLE IF NOT EXISTS promocao_resgates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id    uuid NOT NULL REFERENCES promocoes(id) ON DELETE CASCADE,
  codigo_id      uuid NULL REFERENCES promocao_codigos(id) ON DELETE SET NULL, -- NULL = manual sem código
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  aplicado_por   uuid NULL REFERENCES usuarios(id) ON DELETE SET NULL,         -- NULL = self-service; preenchido = super-admin
  manual         boolean NOT NULL DEFAULT false,        -- aplicado manualmente (ex.: após expiração)
  alvo           text NULL,                             -- 'mensalidade' | 'implantacao' | 'trial'
  preco_original numeric(10,2) NULL,
  preco_final    numeric(10,2) NULL,
  desconto_valor numeric(10,2) NULL,
  motivo         text NULL,
  fatura_id      uuid NULL,                             -- link opcional à fatura afetada (snapshot)
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_promocao_resgates_promocao_empresa ON promocao_resgates (promocao_id, empresa_id);
CREATE INDEX IF NOT EXISTS ix_promocao_resgates_empresa ON promocao_resgates (empresa_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: promoções são catálogo de PLATAFORMA (só super-admin cria/gerencia; o
-- cadastro/checkout só VALIDA um código). O acesso é mediado pelo backend com
-- service key (mesmo modelo de `planos`, que não tem RLS). Não habilitamos RLS
-- aqui; se um dia estas tabelas forem expostas via PostgREST, revisar antes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (rodar após o CREATE — TODAS somente leitura)
--
-- (1) As 3 tabelas existem e estão vazias.
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN
--     ('promocoes','promocao_codigos','promocao_resgates') ORDER BY table_name;
--   SELECT (SELECT count(*) FROM promocoes) AS promocoes,
--          (SELECT count(*) FROM promocao_codigos) AS codigos,
--          (SELECT count(*) FROM promocao_resgates) AS resgates;   -- esperado: 0,0,0
--
-- (2) Índice único case-insensitive de código existe.
--   SELECT indexname FROM pg_indexes WHERE tablename='promocao_codigos';
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter — seguro enquanto vazias)
--   DROP TABLE IF EXISTS promocao_resgates;
--   DROP TABLE IF EXISTS promocao_codigos;
--   DROP TABLE IF EXISTS promocoes;
-- ─────────────────────────────────────────────────────────────────────────────
