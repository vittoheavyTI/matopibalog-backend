-- Migration 082: Partner Network V1 — E3.6A (rede privada de parceiros)
--
-- RBV9-INV-082 · D-025 (rede privada antes de marketplace) · D-026 (Lite/Client
-- com fronteira estrita de tenant).
--
-- O QUE ESTA MIGRATION RESOLVE
--
-- A transportadora precisa pedir capacidade a parceiros que ela mesma escolheu,
-- sem que isso vire um marketplace e sem que o parceiro entre no tenant dela.
--
-- O RISCO CENTRAL, e a razão da forma abaixo: `middlewares/tenant.js` deriva
-- `req.empresa_id` de `usuarios.empresa_id`. Inserir o parceiro como usuário
-- interno lhe daria o tenant inteiro do solicitante — fretes, motoristas,
-- financeiro. Por isso a identidade externa vive em tabela própria, SEM
-- `empresa_id`, e o acesso existe apenas enquanto houver relacionamento ativo e
-- um share explícito.
--
-- É a mesma lição da E3.5 (Portal do Embarcador), aplicada de novo — e a
-- estrutura reusa aquele padrão de convite endurecido.
--
-- ADITIVA. Nenhuma tabela existente é alterada em forma ou dado. Nenhum DML de
-- negócio. As únicas linhas escritas são técnicas: registro da funcionalidade e
-- concessão de permissão aos templates baseline (nunca ao Operador).

BEGIN;

-- =====================================================================
-- 1. ORGANIZAÇÃO PARCEIRA — a identidade LÓGICA
-- =====================================================================
--
-- Deliberadamente SEM `empresa_id`: a organização é a contraparte, não uma
-- extensão do tenant do solicitante. Quem amarra org ↔ solicitante é
-- `partner_relationships`, e é lá que mora a privacidade.
--
-- Lite vs Client é DERIVADO de `linked_empresa_id`, não uma coluna à parte:
-- estado duplicado é estado que diverge. NULL = Lite (sem tenant Matopiba);
-- preenchido = Client (tem tenant próprio, que continua sendo dele).
--
-- É isto que torna a conversão Lite → Client possível sem reescrever histórico
-- (§13): oportunidades e respostas apontam para a ORGANIZAÇÃO, nunca para a
-- forma dela.
CREATE TABLE IF NOT EXISTS public.partner_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  documento text NULL,                    -- CNPJ/CPF informado, SEM validação de vínculo
  linked_empresa_id uuid NULL REFERENCES public.empresas(id) ON DELETE SET NULL,
  -- Quem cadastrou a organização. Serve para auditoria; NÃO é autoridade de
  -- acesso (isso é o relacionamento).
  criado_por_empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  criado_por_usuario_id uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- §14: o vínculo com uma empresa Matopiba é sempre explícito e verificado.
  -- Uma organização nunca pode apontar para a empresa que a cadastrou — isso
  -- seria a empresa virando parceira de si mesma, o que só acontece por engano
  -- de auto-link.
  CONSTRAINT partner_org_nao_e_o_proprio_criador
    CHECK (linked_empresa_id IS NULL OR linked_empresa_id <> criado_por_empresa_id)
);

CREATE INDEX IF NOT EXISTS partner_organizations_criador_idx
  ON public.partner_organizations (criado_por_empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS partner_organizations_linked_idx
  ON public.partner_organizations (linked_empresa_id)
  WHERE linked_empresa_id IS NOT NULL;

-- =====================================================================
-- 2. RELACIONAMENTO PRIVADO — a autoridade de acesso
-- =====================================================================
--
-- "Privado" é isto: a empresa A só enxerga a rede dela porque só existem linhas
-- dela. Não há diretório, não há busca global, não há descoberta.
CREATE TABLE IF NOT EXISTS public.partner_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  partner_organization_id uuid NOT NULL REFERENCES public.partner_organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  apelido text NULL,                       -- como o solicitante chama este parceiro
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ativado_em timestamptz NULL,
  revogado_em timestamptz NULL,
  revogado_por uuid NULL,
  revogado_motivo text NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- Uma relação por par. Reconvidar reaproveita a linha em vez de criar histórico
  -- paralelo para o mesmo parceiro lógico (§10).
  CONSTRAINT partner_relationships_par_unico UNIQUE (empresa_id, partner_organization_id)
);

CREATE INDEX IF NOT EXISTS partner_relationships_empresa_idx
  ON public.partner_relationships (empresa_id, status, criado_em DESC);

-- Chave composta que as FKs de share e resposta vão referenciar. É o que impede,
-- NO BANCO, que um share aponte para um relacionamento de outro solicitante —
-- checagem de aplicação sozinha não basta para invariante cross-tenant (§65).
CREATE UNIQUE INDEX IF NOT EXISTS partner_relationships_id_empresa_key
  ON public.partner_relationships (id, empresa_id);

-- =====================================================================
-- 3. IDENTIDADE EXTERNA (Partner Lite)
-- =====================================================================
--
-- SEM `empresa_id`. Esta é a linha que separa "parceiro" de "usuário interno".
CREATE TABLE IF NOT EXISTS public.partner_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_organization_id uuid NOT NULL REFERENCES public.partner_organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  nome text NULL,
  auth_user_id uuid NULL,                  -- identidade no Supabase Auth, quando ativada
  status text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','BLOQUEADO')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_portal_users_org_email_key
  ON public.partner_portal_users (partner_organization_id, lower(email));

-- =====================================================================
-- 4. CONVITE — mesmo padrão endurecido do Portal do Embarcador
-- =====================================================================
--
-- Token de alta entropia, guardado apenas como HASH. O valor puro existe uma vez
-- na resposta da criação e nunca é persistido, logado ou colocado em metadata.
CREATE TABLE IF NOT EXISTS public.partner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES public.partner_relationships(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE','ACEITO','EXPIRADO','REVOGADO')),
  expires_at timestamptz NOT NULL,
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aceito_em timestamptz NULL,
  aceito_por_partner_user_id uuid NULL REFERENCES public.partner_portal_users(id) ON DELETE SET NULL,
  -- O convite não pode pertencer a um relacionamento de outra empresa.
  CONSTRAINT partner_invitations_relationship_boundary_fk
    FOREIGN KEY (relationship_id, empresa_id)
    REFERENCES public.partner_relationships (id, empresa_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_invitations_token_key
  ON public.partner_invitations (token_hash);

-- Um convite pendente por (relacionamento, e-mail). Índice PARCIAL: convites
-- passados não bloqueiam um reconvite legítimo.
CREATE UNIQUE INDEX IF NOT EXISTS partner_invitations_pendente_key
  ON public.partner_invitations (relationship_id, lower(email))
  WHERE status = 'PENDENTE';

CREATE INDEX IF NOT EXISTS partner_invitations_empresa_idx
  ON public.partner_invitations (empresa_id, status, criado_em DESC);

-- =====================================================================
-- 5. OPORTUNIDADE — o snapshot imutável
-- =====================================================================
--
-- Imutável de propósito: o parceiro responde ao que foi compartilhado, não ao
-- estado corrente de um tenant que ele não pode ler. Endpoints externos nunca
-- fazem read-through.
--
-- A procedência fica aqui (campanha, versão do plano, demanda) para PROVA — e
-- não vai no payload externo.
CREATE TABLE IF NOT EXISTS public.partner_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,

  -- Procedência (interna, nunca exposta)
  campaign_id uuid NOT NULL REFERENCES public.operation_campaigns(id) ON DELETE CASCADE,
  plan_version_id uuid NULL REFERENCES public.campaign_plan_versions(id) ON DELETE SET NULL,
  snapshot_version integer NOT NULL DEFAULT 1 CHECK (snapshot_version >= 1),

  -- Conteúdo compartilhável (§28). Quantidade e unidade vêm do residual canônico
  -- do campaignProgressService — jamais convertidas entre unidades.
  cargo_descricao text NOT NULL,
  origem_resumo text NULL,
  destino_resumo text NULL,
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  quantidade_unidade text NOT NULL CHECK (length(btrim(quantidade_unidade)) > 0),
  janela_inicio timestamptz NULL,
  janela_fim timestamptz NULL,
  restricoes text NULL,
  mensagem text NULL,
  prazo_resposta timestamptz NULL,

  -- Estado do compartilhamento (§31). O snapshot não muda; o ESTADO muda.
  estado text NOT NULL DEFAULT 'CURRENT'
    CHECK (estado IN ('CURRENT','SUPERSEDED','WITHDRAWN','STALE_SOURCE')),
  estado_motivo text NULL,
  estado_em timestamptz NULL,
  superseded_by_id uuid NULL REFERENCES public.partner_opportunities(id) ON DELETE SET NULL,

  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  client_request_id text NULL,

  CONSTRAINT partner_opportunities_janela_coerente
    CHECK (janela_inicio IS NULL OR janela_fim IS NULL OR janela_fim >= janela_inicio)
);

CREATE INDEX IF NOT EXISTS partner_opportunities_empresa_idx
  ON public.partner_opportunities (empresa_id, estado, criado_em DESC);
CREATE INDEX IF NOT EXISTS partner_opportunities_campanha_idx
  ON public.partner_opportunities (campaign_id, criado_em DESC);

-- Idempotência do compartilhamento (§37): repetir o mesmo pedido converge para a
-- mesma oportunidade em vez de criar duas. Parcial, como na migration 018.
CREATE UNIQUE INDEX IF NOT EXISTS partner_opportunities_client_request_key
  ON public.partner_opportunities (empresa_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS partner_opportunities_id_empresa_key
  ON public.partner_opportunities (id, empresa_id);

-- Imutabilidade no BANCO, não só na disciplina do serviço. Só os campos de
-- ESTADO podem mudar depois de criada; o conteúdo compartilhado e a procedência
-- são congelados. Sem isto, "snapshot imutável" seria uma promessa de comentário.
CREATE OR REPLACE FUNCTION public.partner_opportunity_congelar_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
     OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.cargo_descricao IS DISTINCT FROM OLD.cargo_descricao
     OR NEW.origem_resumo IS DISTINCT FROM OLD.origem_resumo
     OR NEW.destino_resumo IS DISTINCT FROM OLD.destino_resumo
     OR NEW.quantidade IS DISTINCT FROM OLD.quantidade
     OR NEW.quantidade_unidade IS DISTINCT FROM OLD.quantidade_unidade
     OR NEW.janela_inicio IS DISTINCT FROM OLD.janela_inicio
     OR NEW.janela_fim IS DISTINCT FROM OLD.janela_fim
     OR NEW.restricoes IS DISTINCT FROM OLD.restricoes
     OR NEW.mensagem IS DISTINCT FROM OLD.mensagem
     OR NEW.prazo_resposta IS DISTINCT FROM OLD.prazo_resposta
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
  THEN
    RAISE EXCEPTION 'partner_opportunity_snapshot_imutavel'
      USING HINT = 'Retire e compartilhe uma nova oportunidade em vez de reescrever o snapshot.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_opportunities_congelar ON public.partner_opportunities;
CREATE TRIGGER partner_opportunities_congelar
  BEFORE UPDATE ON public.partner_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.partner_opportunity_congelar_snapshot();

-- =====================================================================
-- 6. DESTINATÁRIOS — quem recebeu o quê
-- =====================================================================
--
-- Cada destinatário lê APENAS a própria linha. É isso que impede um parceiro de
-- enumerar os outros convidados da mesma oportunidade (§17).
CREATE TABLE IF NOT EXISTS public.partner_opportunity_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.partner_opportunities(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  relationship_id uuid NOT NULL REFERENCES public.partner_relationships(id) ON DELETE CASCADE,
  partner_organization_id uuid NOT NULL REFERENCES public.partner_organizations(id) ON DELETE CASCADE,
  visualizado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_recipients_unico UNIQUE (opportunity_id, relationship_id),

  -- As duas FKs compostas são o coração do isolamento: o destinatário só pode
  -- ligar uma oportunidade e um relacionamento QUE PERTENÇAM À MESMA EMPRESA.
  -- Sem elas, um id trocado no corpo da requisição atravessaria tenants.
  CONSTRAINT partner_recipients_oportunidade_boundary_fk
    FOREIGN KEY (opportunity_id, empresa_id)
    REFERENCES public.partner_opportunities (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT partner_recipients_relationship_boundary_fk
    FOREIGN KEY (relationship_id, empresa_id)
    REFERENCES public.partner_relationships (id, empresa_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS partner_recipients_org_idx
  ON public.partner_opportunity_recipients (partner_organization_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS partner_recipients_oportunidade_idx
  ON public.partner_opportunity_recipients (opportunity_id);

CREATE UNIQUE INDEX IF NOT EXISTS partner_recipients_id_empresa_key
  ON public.partner_opportunity_recipients (id, empresa_id);

-- =====================================================================
-- 7. RESPOSTAS — append-only
-- =====================================================================
--
-- Revisão nunca sobrescreve: cada envio é uma linha nova com `revisao`
-- incremental, e a resposta atual é a projeção determinística da maior revisão.
-- Guardar só o último valor perderia exatamente o que auditoria precisa ver.
--
-- SEM QUALQUER CAMPO DE PREÇO (§34). Não há autoridade canônica de preço entre
-- solicitante e parceiro, e inventar uma aqui criaria um número sem dono.
CREATE TABLE IF NOT EXISTS public.partner_opportunity_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.partner_opportunity_recipients(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.partner_opportunities(id) ON DELETE CASCADE,
  revisao integer NOT NULL CHECK (revisao >= 1),

  situacao text NOT NULL
    CHECK (situacao IN ('AVAILABLE','PARTIALLY_AVAILABLE','DECLINED')),
  capacidade_quantidade numeric(14,3) NULL CHECK (capacidade_quantidade IS NULL OR capacidade_quantidade > 0),
  capacidade_unidade text NULL,
  disponivel_de timestamptz NULL,
  disponivel_ate timestamptz NULL,
  nota text NULL,

  respondido_por_partner_user_id uuid NULL REFERENCES public.partner_portal_users(id) ON DELETE SET NULL,
  respondido_por_usuario_id uuid NULL,     -- Partner Client responde autenticado no PRÓPRIO tenant
  origem text NOT NULL DEFAULT 'partner_portal'
    CHECK (origem IN ('partner_portal','partner_client')),
  client_request_id text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_responses_revisao_unica UNIQUE (recipient_id, revisao),

  CONSTRAINT partner_responses_recipient_boundary_fk
    FOREIGN KEY (recipient_id, empresa_id)
    REFERENCES public.partner_opportunity_recipients (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT partner_responses_oportunidade_boundary_fk
    FOREIGN KEY (opportunity_id, empresa_id)
    REFERENCES public.partner_opportunities (id, empresa_id) ON DELETE CASCADE,

  -- Recusa não declara capacidade; disponibilidade declara. Sem isto, caberia uma
  -- resposta "DECLINED com 500 ton", que não quer dizer nada.
  CONSTRAINT partner_responses_capacidade_coerente CHECK (
    (situacao = 'DECLINED' AND capacidade_quantidade IS NULL AND capacidade_unidade IS NULL)
    OR (situacao <> 'DECLINED' AND capacidade_quantidade IS NOT NULL AND capacidade_unidade IS NOT NULL)
  ),
  CONSTRAINT partner_responses_janela_coerente
    CHECK (disponivel_de IS NULL OR disponivel_ate IS NULL OR disponivel_ate >= disponivel_de)
);

CREATE INDEX IF NOT EXISTS partner_responses_oportunidade_idx
  ON public.partner_opportunity_responses (opportunity_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS partner_responses_recipient_idx
  ON public.partner_opportunity_responses (recipient_id, revisao DESC);

CREATE UNIQUE INDEX IF NOT EXISTS partner_responses_client_request_key
  ON public.partner_opportunity_responses (recipient_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Append-only no banco: revisão criada não se altera nem se apaga.
CREATE OR REPLACE FUNCTION public.partner_response_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'partner_response_append_only'
    USING HINT = 'Envie uma revisão nova em vez de alterar ou apagar a anterior.';
END;
$$;

DROP TRIGGER IF EXISTS partner_responses_imutavel ON public.partner_opportunity_responses;
CREATE TRIGGER partner_responses_imutavel
  BEFORE UPDATE OR DELETE ON public.partner_opportunity_responses
  FOR EACH ROW EXECUTE FUNCTION public.partner_response_append_only();

-- =====================================================================
-- 8. EVENTOS — auditoria append-only (padrão de lancamento_eventos)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.partner_network_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  entity_type text NOT NULL
    CHECK (entity_type IN ('relationship','invitation','opportunity','recipient','response')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'relationship_invited','relationship_activated','relationship_suspended','relationship_revoked',
    'opportunity_shared','opportunity_superseded','opportunity_withdrawn','opportunity_stale_source',
    'response_submitted','response_revised','response_declined'
  )),
  actor_user_id uuid NULL,
  actor_partner_user_id uuid NULL,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','app','api','system','partner_portal')),
  reason text NULL,
  -- Nunca recebe token, hash de token nem dado pessoal além do já compartilhado.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_network_events_empresa_idx
  ON public.partner_network_events (empresa_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS partner_network_events_entidade_idx
  ON public.partner_network_events (entity_type, entity_id, occurred_at DESC);

-- =====================================================================
-- 9. RLS — backend-mediado, como todo o resto do produto
-- =====================================================================
--
-- RLS habilitado SEM policy permissiva e SEM grant: o acesso é exclusivamente
-- pelo service role da API. Em especial, o Partner Lite NUNCA consulta tabela
-- direto (§66).
ALTER TABLE public.partner_organizations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_relationships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_portal_users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_invitations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_opportunities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_opportunity_recipients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_opportunity_responses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_network_events           ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.partner_organizations          FROM anon, authenticated;
REVOKE ALL ON public.partner_relationships          FROM anon, authenticated;
REVOKE ALL ON public.partner_portal_users           FROM anon, authenticated;
REVOKE ALL ON public.partner_invitations            FROM anon, authenticated;
REVOKE ALL ON public.partner_opportunities          FROM anon, authenticated;
REVOKE ALL ON public.partner_opportunity_recipients FROM anon, authenticated;
REVOKE ALL ON public.partner_opportunity_responses  FROM anon, authenticated;
REVOKE ALL ON public.partner_network_events         FROM anon, authenticated;

-- =====================================================================
-- 10. DML TÉCNICO — funcionalidade e permissões
-- =====================================================================
--
-- `partner_network` entra como funcionalidade DESLIGADA comercialmente:
-- nenhuma empresa recebe override, e nenhum plano a inclui. É
-- DEFERRED_DEFAULT_DENY (§41) — quem decide o mapeamento comercial é o owner,
-- noutra frente.
INSERT INTO public.funcionalidades
  (codigo, nome, descricao_publica, categoria, modulo, status_ciclo_vida,
   modelo_cobranca, ativo, visivel_publicamente, ordem_exibicao)
SELECT 'partner_network',
       'Rede de parceiros',
       'Rede privada de parceiros: compartilhe lacunas de capacidade das suas campanhas e receba a disponibilidade declarada.',
       'operacao', 'rede_parceiros',
       'disponivel',
       'incluso', true, false, 240
WHERE NOT EXISTS (SELECT 1 FROM public.funcionalidades WHERE codigo = 'partner_network');

-- Permissões nos templates baseline. Administrador e Gerente de Frota recebem as
-- operacionais; Operador NÃO recebe nada aqui (§43) — a empresa pode delegar
-- depois pelo template editável, que é o ponto de ter template editável.
INSERT INTO public.permission_template_permissions (template_id, permission_key, allowed)
SELECT t.id, p.chave, true
FROM public.permission_templates t
CROSS JOIN (VALUES
  ('partner_network.view'),
  ('partner_network.manage'),
  ('partner_network.share'),
  ('partner_network.respond')
) AS p(chave)
WHERE t.stable_key IN ('administrador','gerente_frota')
  AND NOT EXISTS (
    SELECT 1 FROM public.permission_template_permissions x
    WHERE x.template_id = t.id AND x.permission_key = p.chave
  );

COMMIT;
