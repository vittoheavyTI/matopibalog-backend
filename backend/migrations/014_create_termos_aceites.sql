-- Migration 014: Base LGPD — Termos versionados e Aceites auditáveis
-- Rodar no Supabase SQL Editor.
--
-- Escopo deste PR (PR-1 da frente LGPD):
--   * cria as tabelas `termos` e `termos_aceites`;
--   * adiciona índices e constraints (inclusive índice único parcial de "1 ativo por tipo");
--   * insere seeds RASCUNHO/INATIVOS (ativo = false) para os 4 tipos de termo.
-- NÃO publica termo (nenhum ativo = true), NÃO cria gate/rota/frontend/app,
-- NÃO altera tabelas existentes e NÃO bloqueia nenhum usuário.

-- sha256() é nativo no Postgres 11+, mas pgcrypto garante disponibilidade do digest.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tabela: termos (documentos legais versionados) ─────────────────────────
CREATE TABLE IF NOT EXISTS termos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo             VARCHAR(50) NOT NULL,
  versao           INTEGER NOT NULL DEFAULT 1,
  titulo           VARCHAR(200) NOT NULL,
  conteudo         TEXT NOT NULL,
  conteudo_hash    VARCHAR(64) NOT NULL,
  resumo           TEXT,
  base_legal       VARCHAR(100),
  obrigatorio_para TEXT[] NOT NULL DEFAULT '{admin,motorista}'::text[],
  ativo            BOOLEAN NOT NULL DEFAULT false,
  publicado_em     TIMESTAMPTZ,
  created_by       UUID REFERENCES usuarios(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT termos_tipo_check CHECK (tipo IN (
    'termos_uso',
    'politica_privacidade',
    'termo_motorista',
    'consentimento_documentos'
  )),
  CONSTRAINT termos_tipo_versao_unique UNIQUE (tipo, versao)
);

CREATE INDEX IF NOT EXISTS idx_termos_tipo ON termos(tipo);

-- No máximo UMA versão ativa por tipo (índice único PARCIAL — não é constraint).
CREATE UNIQUE INDEX IF NOT EXISTS uq_termo_ativo_por_tipo
  ON termos(tipo) WHERE ativo = true;

-- ─── Tabela: termos_aceites (registro auditável e imutável de aceites) ───────
CREATE TABLE IF NOT EXISTS termos_aceites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  termo_id      UUID NOT NULL REFERENCES termos(id) ON DELETE CASCADE,
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id    UUID REFERENCES empresas(id) ON DELETE SET NULL,
  tipo          VARCHAR(50) NOT NULL,
  versao        INTEGER NOT NULL,
  conteudo_hash VARCHAR(64) NOT NULL,
  aceito        BOOLEAN NOT NULL DEFAULT true,
  aceito_em     TIMESTAMPTZ DEFAULT NOW(),
  ip            VARCHAR(45),
  user_agent    TEXT,
  origem        VARCHAR(20) NOT NULL DEFAULT 'web',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT termos_aceites_origem_check CHECK (origem IN ('web', 'app')),
  CONSTRAINT termos_aceites_termo_usuario_unique UNIQUE (termo_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_termos_aceites_usuario ON termos_aceites(usuario_id);
CREATE INDEX IF NOT EXISTS idx_termos_aceites_termo   ON termos_aceites(termo_id);
CREATE INDEX IF NOT EXISTS idx_termos_aceites_empresa ON termos_aceites(empresa_id);

-- ─── Seeds: 4 termos v1, TODOS RASCUNHO/INATIVOS (ativo = false) ─────────────
-- conteudo_hash é derivado do próprio conteúdo via sha256, evitando divergência.
-- ON CONFLICT torna o seed idempotente (re-rodar não duplica).
INSERT INTO termos (tipo, versao, titulo, conteudo, conteudo_hash, resumo, base_legal, obrigatorio_para, ativo)
SELECT
  t.tipo,
  1,
  t.titulo,
  t.conteudo,
  encode(sha256(t.conteudo::bytea), 'hex'),
  t.resumo,
  t.base_legal,
  t.obrigatorio_para,
  false
FROM (VALUES
  (
    'termos_uso',
    'Termos de Uso',
    '[RASCUNHO — NÃO PUBLICADO] Termos de Uso da plataforma Matopiba Log. Texto jurídico a ser definido e revisado antes da publicação.',
    '[RASCUNHO] Regras de uso da plataforma.',
    'execucao_contrato',
    ARRAY['admin','motorista']::text[]
  ),
  (
    'politica_privacidade',
    'Política de Privacidade',
    '[RASCUNHO — NÃO PUBLICADO] Política de Privacidade (LGPD) da Matopiba Log. Finalidades, retenção e contato do responsável/DPO a serem definidos antes da publicação.',
    '[RASCUNHO] Como tratamos seus dados pessoais.',
    'transparencia',
    ARRAY['admin','motorista']::text[]
  ),
  (
    'termo_motorista',
    'Termo de Adesão do Motorista',
    '[RASCUNHO — NÃO PUBLICADO] Termo de Adesão do Motorista. Condições de adesão, responsabilidades e direitos do motorista. Texto a ser definido antes da publicação.',
    '[RASCUNHO] Adesão e responsabilidades do motorista.',
    'execucao_contrato',
    ARRAY['motorista']::text[]
  ),
  (
    'consentimento_documentos',
    'Consentimento para Documentos',
    '[RASCUNHO — NÃO PUBLICADO] Consentimento para envio e armazenamento de documentos. Ao aceitar, o motorista autoriza o tratamento dos seguintes documentos e dados pessoais: CNH; CPF; CRLV e documentos do veículo e carreta; comprovante de residência; dados bancários; comprovantes operacionais (ex.: despesas e abastecimentos). Texto a ser revisado antes da publicação.',
    '[RASCUNHO] Autorização para coleta de documentos do motorista.',
    'consentimento',
    ARRAY['motorista']::text[]
  )
) AS t(tipo, titulo, conteudo, resumo, base_legal, obrigatorio_para)
ON CONFLICT (tipo, versao) DO NOTHING;

-- ─── RLS: deny-by-default (proteção de dados pessoais/auditáveis) ────────────
-- Como `termos_aceites` guarda dados pessoais e trilha de auditoria, as tabelas
-- nascem com RLS habilitado e SEM política permissiva: clientes com anon/JWT
-- não conseguem ler/escrever direto. O backend usa service_role (BYPASSRLS),
-- então continua operando normalmente por trás da API.
ALTER TABLE termos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE termos_aceites  ENABLE ROW LEVEL SECURITY;

-- Policies deny-all idempotentes (CREATE POLICY não tem IF NOT EXISTS em todas
-- as versões — consultamos pg_policies antes de criar).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'termos'
      AND policyname = 'termos_deny_all'
  ) THEN
    CREATE POLICY termos_deny_all ON termos
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'termos_aceites'
      AND policyname = 'termos_aceites_deny_all'
  ) THEN
    CREATE POLICY termos_aceites_deny_all ON termos_aceites
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
