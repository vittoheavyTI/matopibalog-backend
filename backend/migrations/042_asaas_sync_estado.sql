-- 042_asaas_sync_estado.sql
-- MEGA-FRENTE Fechamento Comercial + Sync Asaas — FASE 4: estado e auditoria do
-- SYNC AUTOMÁTICO Asaas (SANDBOX). Só ESTRUTURA — nenhum sync real aqui.
--
-- PREMISSA: o Matopiba Log é a FONTE DA VERDADE (plano, preço, capacidade). O
-- Asaas é processador/agendador. O Asaas NÃO tem "plano global" → o sync é no
-- nível de ASSINATURA por EMPRESA (asaasSubscriptionService já cria 1 assinatura
-- por empresa, value = plano.preco_mensal, externalReference = empresa_id).
--
-- O QUE ESTA MIGRATION CRIA
--   * asaas_sync_estado    → estado ATUAL do sync por empresa (fila): status
--                            (pendente/sincronizado/erro), valor-alvo, valor já
--                            sincronizado, motivo, tentativas, timestamps;
--   * asaas_sync_tentativas→ AUDITORIA imutável de cada tentativa: antes/depois,
--                            resultado, erro, resumo do payload, timestamp.
--
-- GARANTIAS
--   * CREATE TABLE IF NOT EXISTS — idempotente; não altera tabela existente;
--   * SEM dado; NÃO faz sync, NÃO fala com Asaas, NÃO cobra;
--   * uma linha de estado por empresa (unique) — a fila é "por empresa";
--   * sandbox-only é garantido no CÓDIGO (gate na rota/serviço), não no schema.
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização).

-- ── Estado do sync por empresa (a "fila") ───────────────────────────────────
CREATE TABLE IF NOT EXISTS asaas_sync_estado (
  empresa_id            uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente','sincronizado','erro')),
  motivo                text NULL,                 -- por que entrou na fila (plano_editado, plano_trocado, capacidade, ...)
  valor_alvo            numeric(10,2) NULL,        -- valor mensal que a assinatura DEVE ter (forward-only)
  valor_sincronizado    numeric(10,2) NULL,        -- último valor efetivamente aplicado no Asaas
  asaas_subscription_id text NULL,                 -- snapshot do id da assinatura (auditoria)
  tentativas            integer NOT NULL DEFAULT 0,
  ultimo_erro           text NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_asaas_sync_estado_status ON asaas_sync_estado (status);

-- ── Auditoria de tentativas (imutável, append-only) ─────────────────────────
CREATE TABLE IF NOT EXISTS asaas_sync_tentativas (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id            uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  acao                  text NOT NULL,             -- 'criar' | 'atualizar_valor' | 'pular' | 'erro'
  valor_antes           numeric(10,2) NULL,
  valor_depois          numeric(10,2) NULL,
  resultado             text NOT NULL,             -- 'ok' | 'erro' | 'pulado'
  ambiente              text NOT NULL DEFAULT 'sandbox', -- registra o ambiente (nunca 'production' nesta frente)
  payload_resumo        text NULL,                 -- resumo SEM segredo/PII (ex.: "subId=... value=299.90")
  erro                  text NULL,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_asaas_sync_tentativas_empresa ON asaas_sync_tentativas (empresa_id, criado_em DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: tabelas de PLATAFORMA (só backend com service key / super-admin). Mesmo
-- modelo de planos/promocoes — sem RLS aqui; revisar se um dia forem expostas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO PÓS-MIGRATION (somente leitura)
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('asaas_sync_estado','asaas_sync_tentativas')
--   ORDER BY table_name;
--   SELECT (SELECT count(*) FROM asaas_sync_estado) estado,
--          (SELECT count(*) FROM asaas_sync_tentativas) tentativas;  -- 0,0
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (seguro enquanto vazias)
--   DROP TABLE IF EXISTS asaas_sync_tentativas;
--   DROP TABLE IF EXISTS asaas_sync_estado;
-- ─────────────────────────────────────────────────────────────────────────────
