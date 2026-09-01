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

-- Chaves compostas que as FKs de share e resposta vão referenciar. É o que impede,
-- NO BANCO, que um share aponte para um relacionamento de outro solicitante —
-- checagem de aplicação sozinha não basta para invariante cross-tenant (§65).
CREATE UNIQUE INDEX IF NOT EXISTS partner_relationships_id_empresa_key
  ON public.partner_relationships (id, empresa_id);

-- A identidade COMPLETA do relacionamento: id + empresa + organização.
--
-- Sem ela, era possível montar um destinatário com o `relationship_id` do parceiro
-- X e o `partner_organization_id` do parceiro Y, dentro da mesma empresa. Isso
-- não é detalhe: a autorização EXTERNA resolve o destinatário por
-- `partner_organization_id`, então o parceiro Y leria — e responderia — uma
-- oportunidade endereçada ao X.
CREATE UNIQUE INDEX IF NOT EXISTS partner_relationships_identidade_key
  ON public.partner_relationships (id, empresa_id, partner_organization_id);

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

-- HIGH-15 — MULTI-NETWORK LOGIN.
--
-- Índice NÃO-ÚNICO, e isso é a decisão, não um descuido.
--
-- Uma pessoa pode ser parceira de mais de uma transportadora com o MESMO e-mail:
-- a rede é privada de cada solicitante, e nada obriga o mundo lá fora a manter
-- uma caixa de entrada por cliente. Tornar `auth_user_id` único globalmente
-- faria o segundo convite legítimo colidir contra o primeiro — a rede da
-- empresa B negando acesso porque a empresa A convidou antes.
--
-- `PARTNER_MULTI_NETWORK_LOGIN_V1=EXPLICIT_CONTEXT_SELECTION`: várias linhas
-- por identidade são LEGÍTIMAS, e cada uma nasce de um convite explícito daquela
-- organização. O que NÃO existe é vínculo automático: nada aqui liga duas
-- organizações por e-mail, CNPJ, nome ou domínio.
CREATE INDEX IF NOT EXISTS partner_portal_users_auth_idx
  ON public.partner_portal_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

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

  -- Procedência (interna, nunca exposta).
  --
  -- `plan_version_id` é NOT NULL de propósito (`SHARE_REQUIRES_APPROVED_PLAN_VERSION`).
  -- O residual canônico só existe quando há plano aprovado — `getCampaignProgress`
  -- devolve progresso zerado sem ele. Um share sem versão de plano seria um pedido
  -- que ninguém consegue provar depois: não dá para dizer qual plano gerou aquele
  -- número, nem detectar que ele foi superado. Sem autoridade de fonte não há como
  -- distinguir "atual" de "obsoleto", e a segurança de replan vira palavra.
  campaign_id uuid NOT NULL,
  plan_version_id uuid NOT NULL,
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
    CHECK (janela_inicio IS NULL OR janela_fim IS NULL OR janela_fim >= janela_inicio),

  -- HIGH-05.3: a campanha citada precisa ser DESTA empresa. Um `campaign_id` de
  -- outro tenant no corpo da requisição não pode virar uma oportunidade.
  CONSTRAINT partner_opportunities_campanha_boundary_fk
    FOREIGN KEY (campaign_id, empresa_id)
    REFERENCES public.operation_campaigns (id, empresa_id) ON DELETE CASCADE,

  -- HIGH-05.4: e a versão do plano precisa ser DAQUELA campanha, na mesma empresa.
  -- Sem isto, a versão do plano da campanha X poderia ficar registrada como
  -- procedência de uma oportunidade da campanha Y — e a prova de obsolescência
  -- passaria a apontar para o lugar errado.
  CONSTRAINT partner_opportunities_plano_boundary_fk
    FOREIGN KEY (plan_version_id, campaign_id, empresa_id)
    REFERENCES public.campaign_plan_versions (id, campaign_id, empresa_id) ON DELETE RESTRICT
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
  -- A tripla, não o par: o destinatário só existe se relacionamento, empresa e
  -- organização forem os mesmos da relação. É esta FK que impede um parceiro de
  -- ser endereçado no lugar de outro dentro da mesma empresa.
  CONSTRAINT partner_recipients_relationship_boundary_fk
    FOREIGN KEY (relationship_id, empresa_id, partner_organization_id)
    REFERENCES public.partner_relationships (id, empresa_id, partner_organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS partner_recipients_org_idx
  ON public.partner_opportunity_recipients (partner_organization_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS partner_recipients_oportunidade_idx
  ON public.partner_opportunity_recipients (opportunity_id);

CREATE UNIQUE INDEX IF NOT EXISTS partner_recipients_id_empresa_key
  ON public.partner_opportunity_recipients (id, empresa_id);

-- Identidade completa do destinatário: id + empresa + oportunidade.
--
-- Sem ela, uma resposta podia citar o destinatário da oportunidade A e o
-- `opportunity_id` da B (mesma empresa) — e ficaria registrada como resposta a um
-- pedido que nunca foi endereçado àquele parceiro.
CREATE UNIQUE INDEX IF NOT EXISTS partner_recipients_identidade_key
  ON public.partner_opportunity_recipients (id, empresa_id, opportunity_id);

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

  -- A tripla amarra resposta → destinatário → oportunidade numa coisa só. As duas
  -- FKs separadas de antes permitiam combinar o destinatário de um pedido com o
  -- id de outro pedido da mesma empresa — e a resposta ficaria registrada contra
  -- uma oportunidade que nunca foi endereçada àquele parceiro.
  CONSTRAINT partner_responses_recipient_boundary_fk
    FOREIGN KEY (recipient_id, empresa_id, opportunity_id)
    REFERENCES public.partner_opportunity_recipients (id, empresa_id, opportunity_id) ON DELETE CASCADE,

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

-- Append-only NO BANCO (HIGH-07), inclusive para o service_role — que é quem a
-- API usa. Um log de auditoria que o próprio processo auditado pode reescrever
-- não é auditoria; é anotação.
CREATE OR REPLACE FUNCTION public.partner_network_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'partner_network_event_append_only'
    USING HINT = 'Eventos de rede são história: registre um evento novo em vez de alterar o anterior.';
END;
$fn$;

DROP TRIGGER IF EXISTS partner_network_events_imutavel ON public.partner_network_events;
CREATE TRIGGER partner_network_events_imutavel
  BEFORE UPDATE OR DELETE ON public.partner_network_events
  FOR EACH ROW EXECUTE FUNCTION public.partner_network_event_append_only();

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


-- =====================================================================
-- 11. RPCs TRANSACIONAIS — a autoridade das mutações
-- =====================================================================
--
-- POR QUE ESTAS FUNÇÕES EXISTEM.
--
-- A versão anterior fazia "resolve → confere → insere" em chamadas separadas.
-- Entre a conferência e a escrita cabe qualquer coisa: uma revogação, um
-- replanejamento, o vencimento do prazo, ou simplesmente a outra aba do mesmo
-- parceiro. Isso é TOCTOU, e o efeito não é teórico — é uma resposta gravada
-- depois de o acesso já ter sido cortado.
--
-- Aqui a decisão inteira acontece numa transação, com os registros travados na
-- ordem em que serão lidos. E as funções recebem a MENOR identidade possível:
-- nada de `empresa_id` ou `opportunity_id` vindo do cliente — tudo é derivado no
-- banco a partir do que já está gravado.
--
-- `SECURITY DEFINER` com `search_path` fixo e EXECUTE apenas para service_role:
-- o Partner Lite nunca fala com o banco direto.

-- ── 11.1 Criar convite (relacionamento + convite + evento, ou nada) ────────────
CREATE OR REPLACE FUNCTION public.partner_network_create_invitation(
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_nome text,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_documento text DEFAULT NULL,
  p_apelido text DEFAULT NULL
)
RETURNS TABLE (out_relationship_id uuid, out_partner_organization_id uuid, out_invitation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_rel uuid;
  v_inv uuid;
BEGIN
  IF p_empresa_id IS NULL OR coalesce(btrim(p_nome), '') = '' OR coalesce(btrim(p_email), '') = '' THEN
    RAISE EXCEPTION 'partner_invite_dados_invalidos';
  END IF;
  IF coalesce(btrim(p_token_hash), '') = '' OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'partner_invite_token_invalido';
  END IF;

  -- §14: nada de vínculo automático a empresa existente. A organização nasce
  -- Lite; virar Cliente é ato explícito, fora desta fatia.
  INSERT INTO public.partner_organizations (nome, documento, criado_por_empresa_id, criado_por_usuario_id)
  VALUES (btrim(p_nome), nullif(btrim(coalesce(p_documento, '')), ''), p_empresa_id, p_actor_user_id)
  RETURNING id INTO v_org;

  INSERT INTO public.partner_relationships (empresa_id, partner_organization_id, status, apelido, criado_por)
  VALUES (p_empresa_id, v_org, 'INVITED', nullif(btrim(coalesce(p_apelido, '')), ''), p_actor_user_id)
  RETURNING id INTO v_rel;

  INSERT INTO public.partner_invitations (relationship_id, empresa_id, email, token_hash, expires_at, criado_por)
  VALUES (v_rel, p_empresa_id, lower(btrim(p_email)), p_token_hash, p_expires_at, p_actor_user_id)
  RETURNING id INTO v_inv;

  -- HIGH-07: o evento faz parte da mesma decisão. Se ele falhar, o convite não
  -- existiu — é o que separa auditoria de anotação otimista.
  INSERT INTO public.partner_network_events
    (empresa_id, entity_type, entity_id, action, actor_user_id, source, metadata)
  VALUES (p_empresa_id, 'relationship', v_rel, 'relationship_invited', p_actor_user_id, 'web',
          jsonb_build_object('partner_organization_id', v_org, 'email', lower(btrim(p_email))));

  RETURN QUERY SELECT v_rel AS out_relationship_id, v_org AS out_partner_organization_id, v_inv AS out_invitation_id;
END;
$fn$;

-- ── 11.2 Preflight do convite (HIGH-09) — resolve SEM consumir ────────────────
--
-- POR QUE ESTA FUNÇÃO EXISTE, e por que ela não pode ser "só um SELECT".
--
-- A ativação toca dois mundos: o Supabase Auth (identidade) e este banco
-- (domínio). A ordem anterior era: ler o e-mail do convite → criar/provar a
-- identidade → consumir o convite. Isso deixava dois furos.
--
-- 1. A leitura magra não olhava NADA além do e-mail. Um convite expirado, de um
--    relacionamento revogado ou suspenso chegava até a criação da identidade no
--    Auth — ou seja, um token morto ainda produzia uma conta nova em produção.
--    Conta que não autoriza nada é inofensiva, mas criá-la é efeito colateral
--    externo disparado por credencial inválida, e isso é superfície gratuita.
--
-- 2. Sem o `relationship_id` e a organização em mãos ANTES, a camada de serviço
--    não tinha como saber a que rede o convite pertencia sem consumir o convite.
--
-- Esta função devolve a identidade ALVO e a fronteira do convite sem tocar em
-- nada: `SELECT` puro, sem `FOR UPDATE`, sem UPDATE. Quem consome é a 11.3, na
-- transação dela, revalidando tudo de novo — o preflight ACELERA a recusa, nunca
-- substitui a decisão.
--
-- `out_email` é a AUTORIDADE de identidade: quem ativa é quem foi convidado.
CREATE OR REPLACE FUNCTION public.partner_network_preflight_invitation(
  p_token_hash text
)
RETURNS TABLE (
  out_email text,
  out_relationship_id uuid,
  out_partner_organization_id uuid,
  out_empresa_id uuid,
  out_relationship_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv public.partner_invitations%ROWTYPE;
  v_rel public.partner_relationships%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_token_hash), '') = '' THEN
    RAISE EXCEPTION 'partner_invite_indisponivel';
  END IF;

  SELECT * INTO v_inv FROM public.partner_invitations WHERE token_hash = p_token_hash;

  -- Mensagem ÚNICA para "não existe", "já usado" e "expirado". Distinguir os
  -- três só interessa a quem sonda tokens.
  IF NOT FOUND OR v_inv.status <> 'PENDENTE' OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'partner_invite_indisponivel';
  END IF;

  SELECT * INTO v_rel FROM public.partner_relationships WHERE id = v_inv.relationship_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_invite_inconsistente';
  END IF;

  -- A MESMA matriz da 11.3, deliberadamente. Um preflight que aceitasse o que a
  -- ativação nega (ou o contrário) seria uma segunda autoridade divergindo da
  -- primeira — exatamente a classe de erro que o HIGH-09 é.
  --
  -- `ACTIVE` passa junto com `INVITED` porque o reconvite legítimo existe: uma
  -- segunda pessoa da MESMA organização parceira recebe convite próprio, e o
  -- relacionamento já está ativo desde a primeira. Aceitar aqui e recusar lá
  -- (ou vice-versa) tornaria o segundo acesso impossível de conceder.
  IF v_rel.status = 'REVOKED' THEN
    RAISE EXCEPTION 'partner_relationship_revogado';
  END IF;
  IF v_rel.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'partner_relationship_suspenso';
  END IF;

  RETURN QUERY SELECT v_inv.email AS out_email,
                      v_rel.id AS out_relationship_id,
                      v_rel.partner_organization_id AS out_partner_organization_id,
                      v_rel.empresa_id AS out_empresa_id,
                      v_rel.status AS out_relationship_status;
END;
$fn$;

-- ── 11.3 Ativar convite (só DEPOIS da prova de identidade no Auth) ────────────
--
-- A prova de posse da conta acontece ANTES desta função, na camada de serviço.
-- Se ela falhar, esta RPC nem é chamada e o convite continua pendente — que é
-- exatamente o requisito: senha errada não pode queimar o convite.
CREATE OR REPLACE FUNCTION public.partner_network_activate_invitation(
  p_token_hash text,
  p_auth_user_id uuid,
  p_nome text DEFAULT NULL
)
RETURNS TABLE (out_partner_user_id uuid, out_partner_organization_id uuid, out_email text, out_relationship_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv   public.partner_invitations%ROWTYPE;
  v_rel   public.partner_relationships%ROWTYPE;
  v_user  uuid;
BEGIN
  IF coalesce(btrim(p_token_hash), '') = '' OR p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'partner_activate_dados_invalidos';
  END IF;

  -- Trava o convite antes de qualquer decisão: duas ativações simultâneas
  -- serializam aqui, e só uma encontra o convite PENDENTE.
  SELECT * INTO v_inv
  FROM public.partner_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_invite_indisponivel';
  END IF;
  IF v_inv.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'partner_invite_indisponivel';
  END IF;
  IF v_inv.expires_at <= now() THEN
    UPDATE public.partner_invitations SET status = 'EXPIRADO' WHERE id = v_inv.id;
    RAISE EXCEPTION 'partner_invite_indisponivel';
  END IF;

  SELECT * INTO v_rel
  FROM public.partner_relationships
  WHERE id = v_inv.relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_invite_inconsistente';
  END IF;

  -- Matriz de estado explícita (§8). Um convite de relacionamento revogado não
  -- ressuscita o acesso, e um suspenso não vira ativo em silêncio: quem suspendeu
  -- precisa reativar deliberadamente.
  IF v_rel.status = 'REVOKED' THEN
    RAISE EXCEPTION 'partner_relationship_revogado';
  END IF;
  IF v_rel.status = 'SUSPENDED' THEN
    RAISE EXCEPTION 'partner_relationship_suspenso';
  END IF;

  INSERT INTO public.partner_portal_users (partner_organization_id, email, nome, auth_user_id, status)
  VALUES (v_rel.partner_organization_id, v_inv.email, nullif(btrim(coalesce(p_nome, '')), ''), p_auth_user_id, 'ATIVO')
  ON CONFLICT (partner_organization_id, lower(email)) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        nome = coalesce(EXCLUDED.nome, public.partner_portal_users.nome)
  RETURNING id INTO v_user;

  UPDATE public.partner_invitations
     SET status = 'ACEITO', aceito_em = now(), aceito_por_partner_user_id = v_user
   WHERE id = v_inv.id;

  IF v_rel.status = 'INVITED' THEN
    UPDATE public.partner_relationships
       SET status = 'ACTIVE', ativado_em = now(), atualizado_em = now()
     WHERE id = v_rel.id;

    INSERT INTO public.partner_network_events
      (empresa_id, entity_type, entity_id, action, actor_partner_user_id, source, metadata)
    VALUES (v_rel.empresa_id, 'relationship', v_rel.id, 'relationship_activated', v_user, 'partner_portal', '{}'::jsonb);
  END IF;

  RETURN QUERY SELECT v_user AS out_partner_user_id, v_rel.partner_organization_id AS out_partner_organization_id,
                      v_inv.email AS out_email, v_rel.id AS out_relationship_id;
END;
$fn$;

-- ── 11.4 Registrar resposta (a decisão inteira, travada) ──────────────────────
--
-- Recebe só `p_recipient_id` e a identidade externa. Empresa, oportunidade,
-- relacionamento e campanha são DERIVADOS aqui — o cliente não tem como
-- influenciar nenhum deles.
--
-- A ASSINATURA DE RETORNO MUDOU (HIGH-13), por isso o DROP: `CREATE OR REPLACE`
-- não altera o tipo de retorno de uma função existente.
DROP FUNCTION IF EXISTS public.partner_network_submit_response(
  uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, text, text, text);

CREATE OR REPLACE FUNCTION public.partner_network_submit_response(
  p_recipient_id uuid,
  p_partner_organization_id uuid,
  p_partner_user_id uuid,
  p_situacao text,
  p_capacidade numeric DEFAULT NULL,
  p_unidade text DEFAULT NULL,
  p_disponivel_de timestamptz DEFAULT NULL,
  p_disponivel_ate timestamptz DEFAULT NULL,
  p_nota text DEFAULT NULL,
  p_client_request_id text DEFAULT NULL,
  p_origem text DEFAULT 'partner_portal'
)
RETURNS TABLE (out_result text, out_response_id uuid, out_revisao integer, out_idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rec        public.partner_opportunity_recipients%ROWTYPE;
  v_rel_status text;
  v_op         public.partner_opportunities%ROWTYPE;
  v_plano      text;
  v_ator_org   uuid;
  v_ator_st    text;
  v_existente  public.partner_opportunity_responses%ROWTYPE;
  v_revisao    integer;
  v_id         uuid;
BEGIN
  IF p_recipient_id IS NULL OR p_partner_organization_id IS NULL THEN
    RAISE EXCEPTION 'partner_response_dados_invalidos';
  END IF;

  -- A ORDEM ABAIXO É A SEGURANÇA (HIGH-12), e o que ela conserta é sutil.
  --
  -- A versão anterior resolvia a idempotência PRIMEIRO: se `client_request_id`
  -- já existisse para aquele destinatário, devolvia a resposta e retornava —
  -- antes de conferir organização, relacionamento, estado ou prazo.
  --
  -- Isso transformava um id de requisição conhecido numa chave-mestra de
  -- leitura. Quem tivesse visto um `client_request_id` (o próprio parceiro
  -- revogado ontem, ou outro parceiro da mesma empresa) obtinha 200 com o id e a
  -- revisão da resposta — depois da revogação, com a organização errada, com a
  -- fonte já obsoleta ou com o prazo vencido. Um replay não pode ser mais
  -- poderoso que a chamada original.
  --
  -- Agora AUTORIZAÇÃO vem inteira antes, e a idempotência é o último passo: ela
  -- decide apenas se ESTA escrita repete uma anterior, nunca se o ator pode
  -- estar aqui.

  -- 1/2. Trava o destinatário e confere que ele é DESTA organização.
  SELECT * INTO v_rec
  FROM public.partner_opportunity_recipients
  WHERE id = p_recipient_id
  FOR UPDATE;

  IF NOT FOUND OR v_rec.partner_organization_id <> p_partner_organization_id THEN
    RAISE EXCEPTION 'partner_response_destinatario_invalido';
  END IF;

  -- 3/4. Relacionamento travado e ATIVO. Ordem estável (destinatário →
  -- relacionamento → oportunidade) para não criar deadlock entre respostas
  -- concorrentes.
  SELECT status INTO v_rel_status
  FROM public.partner_relationships
  WHERE id = v_rec.relationship_id
  FOR UPDATE;

  IF v_rel_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'partner_response_relacionamento_inativo';
  END IF;

  -- 5. ATOR (§9). `p_partner_user_id` não é um rótulo de auditoria que o
  -- chamador preenche à vontade: é quem assina a resposta. Sem esta checagem, um
  -- uuid arbitrário — ou o id de um usuário de OUTRA organização parceira —
  -- ficaria gravado como autor, e o evento de auditoria apontaria para a pessoa
  -- errada. Auditoria com autor forjável não é auditoria.
  IF coalesce(p_origem, 'partner_portal') = 'partner_portal' THEN
    IF p_partner_user_id IS NULL THEN
      RAISE EXCEPTION 'partner_response_ator_invalido';
    END IF;
    SELECT partner_organization_id, status INTO v_ator_org, v_ator_st
    FROM public.partner_portal_users
    WHERE id = p_partner_user_id;
    IF NOT FOUND
       OR v_ator_st <> 'ATIVO'
       OR v_ator_org IS DISTINCT FROM p_partner_organization_id THEN
      RAISE EXCEPTION 'partner_response_ator_invalido';
    END IF;
  ELSE
    -- `partner_client` está fora da E3.6A: o parceiro que também é cliente
    -- Matopiba responderia autenticado no PRÓPRIO tenant, e essa fronteira não
    -- foi desenhada nesta fatia. A coluna existe para não reescrever a tabela
    -- depois; a porta continua fechada até haver decisão.
    RAISE EXCEPTION 'partner_response_origem_nao_suportada';
  END IF;

  -- 6/7. Oportunidade travada e CURRENT.
  SELECT * INTO v_op
  FROM public.partner_opportunities
  WHERE id = v_rec.opportunity_id
  FOR UPDATE;

  IF NOT FOUND OR v_op.estado <> 'CURRENT' THEN
    RAISE EXCEPTION 'partner_response_oportunidade_nao_current';
  END IF;

  -- 8. Prazo.
  IF v_op.prazo_resposta IS NOT NULL AND v_op.prazo_resposta <= now() THEN
    RAISE EXCEPTION 'partner_response_prazo_encerrado';
  END IF;

  -- 9. FONTE AINDA ATUAL (HIGH-03, segunda camada): mesmo que a marcação
  -- assíncrona de obsolescência falhe, a versão de plano que gerou o residual é
  -- conferida AQUI, na mesma transação.
  SELECT status INTO v_plano
  FROM public.campaign_plan_versions
  WHERE id = v_op.plan_version_id AND campaign_id = v_op.campaign_id AND empresa_id = v_op.empresa_id
  FOR SHARE;

  IF v_plano IS DISTINCT FROM 'APPROVED' THEN
    -- HIGH-13 — POR QUE ISTO RETORNA EM VEZ DE LEVANTAR EXCEÇÃO.
    --
    -- A versão anterior marcava `STALE_SOURCE`, inseria o evento e então dava
    -- `RAISE EXCEPTION`. O RAISE aborta a transação: as duas escritas anteriores
    -- eram desfeitas junto. O comentário prometia "marca o estado para a próxima
    -- leitura já chegar honesta" e o banco não guardava absolutamente nada — a
    -- auto-correção não existia, e a oportunidade seguia CURRENT para sempre,
    -- recusando cada resposta com o mesmo erro e sem nunca contar por quê.
    --
    -- Resultado ESTRUTURADO: a transação COMMITA com o estado e o evento
    -- persistidos, e ZERO resposta inserida. O serviço converte `SOURCE_STALE`
    -- em HTTP 409 — a recusa continua sendo recusa, mas agora ela deixa rastro.
    UPDATE public.partner_opportunities
       SET estado = 'STALE_SOURCE', estado_motivo = 'source_plan_superseded', estado_em = now()
     WHERE id = v_op.id AND estado = 'CURRENT';

    IF FOUND THEN
      INSERT INTO public.partner_network_events
        (empresa_id, entity_type, entity_id, action, actor_partner_user_id, source, reason, metadata)
      VALUES (v_op.empresa_id, 'opportunity', v_op.id, 'opportunity_stale_source', p_partner_user_id, 'system',
              'plano_da_fonte_nao_esta_mais_aprovado', '{}'::jsonb);
    END IF;

    RETURN QUERY SELECT 'SOURCE_STALE'::text AS out_result, NULL::uuid AS out_response_id,
                        NULL::integer AS out_revisao, false AS out_idempotent;
    RETURN;
  END IF;

  IF p_situacao NOT IN ('AVAILABLE', 'PARTIALLY_AVAILABLE', 'DECLINED') THEN
    RAISE EXCEPTION 'partner_response_situacao_invalida';
  END IF;

  IF p_situacao <> 'DECLINED' THEN
    IF p_capacidade IS NULL OR p_capacidade <= 0 THEN
      RAISE EXCEPTION 'partner_response_capacidade_invalida';
    END IF;
    IF p_capacidade > v_op.quantidade THEN
      RAISE EXCEPTION 'partner_response_capacidade_acima_da_lacuna';
    END IF;
    -- §30: mesma unidade do pedido. Nada de conversão inventada.
    IF p_unidade IS DISTINCT FROM v_op.quantidade_unidade THEN
      RAISE EXCEPTION 'partner_response_unidade_divergente';
    END IF;
  END IF;

  -- 10. IDEMPOTÊNCIA — o último passo, e só agora.
  --
  -- Chegar aqui já significa: destinatário desta organização, relacionamento
  -- ativo, ator legítimo, oportunidade CURRENT, prazo aberto, fonte aprovada. O
  -- `client_request_id` decide apenas se esta escrita repete uma anterior.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existente
    FROM public.partner_opportunity_responses
    WHERE recipient_id = p_recipient_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN QUERY SELECT 'OK'::text AS out_result, v_existente.id AS out_response_id,
                          v_existente.revisao AS out_revisao, true AS out_idempotent;
      RETURN;
    END IF;
  END IF;

  -- 11. Com o destinatário travado, a próxima revisão é determinística: duas
  -- revisões simultâneas serializam em vez de colidir no índice único.
  SELECT coalesce(max(r.revisao), 0) + 1 INTO v_revisao
  FROM public.partner_opportunity_responses r
  WHERE r.recipient_id = p_recipient_id;

  INSERT INTO public.partner_opportunity_responses (
    recipient_id, empresa_id, opportunity_id, revisao, situacao,
    capacidade_quantidade, capacidade_unidade, disponivel_de, disponivel_ate, nota,
    respondido_por_partner_user_id, origem, client_request_id
  ) VALUES (
    p_recipient_id, v_rec.empresa_id, v_rec.opportunity_id, v_revisao, p_situacao,
    CASE WHEN p_situacao = 'DECLINED' THEN NULL ELSE p_capacidade END,
    CASE WHEN p_situacao = 'DECLINED' THEN NULL ELSE p_unidade END,
    p_disponivel_de, p_disponivel_ate, nullif(btrim(coalesce(p_nota, '')), ''),
    p_partner_user_id, coalesce(p_origem, 'partner_portal'), p_client_request_id
  )
  RETURNING id INTO v_id;

  INSERT INTO public.partner_network_events
    (empresa_id, entity_type, entity_id, action, actor_partner_user_id, source, metadata)
  VALUES (
    v_rec.empresa_id, 'response', v_id,
    CASE WHEN p_situacao = 'DECLINED' THEN 'response_declined'
         WHEN v_revisao > 1 THEN 'response_revised'
         ELSE 'response_submitted' END,
    p_partner_user_id, coalesce(p_origem, 'partner_portal'),
    jsonb_build_object('revisao', v_revisao, 'situacao', p_situacao)
  );

  RETURN QUERY SELECT 'OK'::text AS out_result, v_id AS out_response_id,
                      v_revisao AS out_revisao, false AS out_idempotent;
END;
$fn$;

-- ── 11.5 Compartilhar lacuna (oportunidade + destinatários + evento) ──────────
--
-- A matemática do residual continua em `campaignProgressService`; esta função
-- não recalcula planejamento. O que ela faz é gravar tudo de uma vez e
-- REVALIDAR a procedência: empresa, campanha, plano aprovado e relacionamentos.
CREATE OR REPLACE FUNCTION public.partner_network_share_gap(
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_plan_version_id uuid,
  p_cargo text,
  p_quantidade numeric,
  p_unidade text,
  p_relationship_ids uuid[],
  p_origem_resumo text DEFAULT NULL,
  p_destino_resumo text DEFAULT NULL,
  p_janela_inicio timestamptz DEFAULT NULL,
  p_janela_fim timestamptz DEFAULT NULL,
  p_mensagem text DEFAULT NULL,
  p_prazo_resposta timestamptz DEFAULT NULL,
  p_client_request_id text DEFAULT NULL
)
RETURNS TABLE (out_opportunity_id uuid, out_destinatarios integer, out_idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prev      public.partner_opportunities%ROWTYPE;
  v_ids       uuid[];
  v_pedidos   integer;
  v_elegiveis integer;
  v_op        uuid;
  v_plano     text;
  v_n         integer;
BEGIN
  IF p_empresa_id IS NULL OR p_campaign_id IS NULL OR p_plan_version_id IS NULL THEN
    RAISE EXCEPTION 'partner_share_dados_invalidos';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 OR coalesce(btrim(p_unidade), '') = '' THEN
    RAISE EXCEPTION 'partner_share_quantidade_invalida';
  END IF;

  -- HIGH-14, primeiro passo: NORMALIZAR a lista pedida.
  --
  -- Nulos fora, duplicatas colapsadas e ordem por id. A ordenação não é
  -- cosmética: é ela que dá a ordem estável de lock mais abaixo, e é o que
  -- impede dois shares concorrentes com listas em ordens diferentes de travarem
  -- um ao outro em sentidos opostos.
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM unnest(coalesce(p_relationship_ids, ARRAY[]::uuid[])) AS x
  WHERE x IS NOT NULL;

  v_pedidos := coalesce(array_length(v_ids, 1), 0);
  IF v_pedidos = 0 THEN
    RAISE EXCEPTION 'partner_share_sem_destinatarios';
  END IF;

  -- AUTORIDADE BÁSICA ANTES DA IDEMPOTÊNCIA (§15). Sem isto, um
  -- `client_request_id` conhecido devolvia a oportunidade anterior sem que
  -- campanha e plano desta chamada fossem sequer olhados.
  PERFORM 1 FROM public.operation_campaigns
   WHERE id = p_campaign_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_share_campanha_invalida';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_prev
    FROM public.partner_opportunities
    WHERE empresa_id = p_empresa_id AND client_request_id = p_client_request_id
    FOR UPDATE;
    IF FOUND THEN
      -- MESMA CHAVE, INTENÇÃO DIFERENTE → CONFLITO, nunca a resposta antiga.
      --
      -- Devolver silenciosamente o share anterior quando a campanha ou o plano
      -- mudaram é pior que um erro: o operador vê "compartilhado" e acredita que
      -- pediu capacidade para a campanha nova. Ele não pediu — e vai descobrir
      -- quando a carga não for coberta. Idempotência responde "esta é a mesma
      -- requisição?"; se a intenção difere, a resposta é não.
      IF v_prev.campaign_id IS DISTINCT FROM p_campaign_id
         OR v_prev.plan_version_id IS DISTINCT FROM p_plan_version_id THEN
        RAISE EXCEPTION 'partner_share_idempotency_conflict';
      END IF;
      SELECT count(*)::int INTO v_n
      FROM public.partner_opportunity_recipients WHERE opportunity_id = v_prev.id;
      RETURN QUERY SELECT v_prev.id AS out_opportunity_id, v_n AS out_destinatarios, true AS out_idempotent;
      RETURN;
    END IF;
  END IF;

  -- A versão citada precisa ser a APROVADA daquela campanha, nesta empresa.
  SELECT status INTO v_plano
  FROM public.campaign_plan_versions
  WHERE id = p_plan_version_id AND campaign_id = p_campaign_id AND empresa_id = p_empresa_id
  FOR SHARE;

  IF v_plano IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'partner_share_plano_nao_aprovado';
  END IF;

  -- HIGH-14 — TRAVAR TODOS OS PEDIDOS, EM ORDEM, ANTES DE DECIDIR.
  --
  -- Sem `empresa_id` no WHERE de propósito: travamos exatamente os ids que o
  -- operador pediu, inclusive um que não seja dele. A validação vem logo abaixo;
  -- travar antes é o que serializa este share contra uma revogação concorrente,
  -- em vez de deixar as duas transações lerem o mesmo estado antigo.
  PERFORM id FROM public.partner_relationships
   WHERE id = ANY(v_ids)
   ORDER BY id
   FOR UPDATE;

  -- `SHARE_RECIPIENT_POLICY_V1=ALL_REQUESTED_OR_FAIL`.
  --
  -- A versão anterior filtrava com `WHERE status='ACTIVE'` no próprio INSERT e
  -- seguia adiante se sobrasse pelo menos um destinatário. Pedir [A, B, C] com B
  -- revogado compartilhava com A e C, devolvia 201 e informava "2 destinatários"
  -- — um número que ninguém lê como "faltou o B". O operador acreditava ter
  -- pedido capacidade a três parceiros e tinha pedido a dois; a lacuna que ele
  -- achava coberta continuava aberta, e a descoberta vinha tarde.
  --
  -- Compartilhamento parcial é ambíguo por natureza: não dá para distinguir "o
  -- operador quis mesmo B" de "B foi cortado no meio". Então a operação é
  -- exatamente o que foi pedido, ou não é nada.
  SELECT count(*)::int INTO v_elegiveis
  FROM public.partner_relationships
  WHERE id = ANY(v_ids)
    AND empresa_id = p_empresa_id
    AND status = 'ACTIVE';

  IF v_elegiveis <> v_pedidos THEN
    -- Mensagem única para "não existe", "é de outra empresa" e "não está ativo":
    -- dizer qual dos três seria confirmar a existência de relacionamento alheio.
    RAISE EXCEPTION 'partner_share_destinatario_indisponivel';
  END IF;

  INSERT INTO public.partner_opportunities (
    empresa_id, campaign_id, plan_version_id, cargo_descricao,
    origem_resumo, destino_resumo, quantidade, quantidade_unidade,
    janela_inicio, janela_fim, mensagem, prazo_resposta, criado_por, client_request_id
  ) VALUES (
    p_empresa_id, p_campaign_id, p_plan_version_id, p_cargo,
    p_origem_resumo, p_destino_resumo, p_quantidade, p_unidade,
    p_janela_inicio, p_janela_fim, nullif(btrim(coalesce(p_mensagem, '')), ''),
    p_prazo_resposta, p_actor_user_id, p_client_request_id
  )
  RETURNING id INTO v_op;

  -- Todos os pedidos já foram provados elegíveis acima, sob lock. Este INSERT
  -- não filtra mais nada: filtrar aqui era exatamente o que produzia o share
  -- silenciosamente parcial.
  INSERT INTO public.partner_opportunity_recipients
    (opportunity_id, empresa_id, relationship_id, partner_organization_id)
  SELECT v_op, p_empresa_id, r.id, r.partner_organization_id
  FROM public.partner_relationships r
  WHERE r.id = ANY(v_ids);

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Rede de segurança: se por qualquer razão a contagem divergir do pedido, a
  -- transação inteira volta atrás. Um pedido que chegou à metade da rede não
  -- pode ficar no banco parecendo completo.
  IF v_n <> v_pedidos THEN
    RAISE EXCEPTION 'partner_share_destinatario_indisponivel';
  END IF;

  INSERT INTO public.partner_network_events
    (empresa_id, entity_type, entity_id, action, actor_user_id, source, metadata)
  VALUES (p_empresa_id, 'opportunity', v_op, 'opportunity_shared', p_actor_user_id, 'web',
          jsonb_build_object('campaign_id', p_campaign_id, 'destinatarios', v_n,
                             'quantidade', p_quantidade, 'unidade', p_unidade));

  RETURN QUERY SELECT v_op AS out_opportunity_id, v_n AS out_destinatarios, false AS out_idempotent;
END;
$fn$;

-- ── 11.6 Transição de estado do relacionamento (HIGH-11) ─────────────────────
--
-- POR QUE ISTO PRECISOU VIRAR RPC.
--
-- A camada de serviço fazia `UPDATE relationship` e, DEPOIS, `registrarEvento()`
-- — duas chamadas, duas transações. O UPDATE commitava sozinho. Se o INSERT do
-- evento falhasse (tabela cheia, conexão caída, o trigger append-only reagindo a
-- qualquer coisa), o acesso do parceiro já tinha sido cortado e não havia
-- registro de quando nem por quem.
--
-- Isso derruba justamente a promessa que a auditoria existe para sustentar. Uma
-- revogação sem evento é uma decisão de segurança que a empresa não consegue
-- provar depois — e "provar depois" é o único uso de um log de auditoria.
--
-- A MÁQUINA DE ESTADOS VIVE AQUI, no banco, não só no JavaScript:
--
--   INVITED   → ACTIVE     (SOMENTE pela ativação de convite — 11.3)
--   INVITED   → REVOKED
--   ACTIVE    → SUSPENDED | REVOKED
--   SUSPENDED → ACTIVE | REVOKED
--   REVOKED   → terminal
--
-- `INVITED → ACTIVE` não passa por aqui de propósito: ativar sem prova de posse
-- da conta seria conceder acesso por PATCH. E `REVOKED` é terminal porque
-- reativar por UPDATE desfaria uma revogação sem passar por convite nem por
-- prova de que o outro lado ainda controla a conta.
CREATE OR REPLACE FUNCTION public.partner_network_set_relationship_status(
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_relationship_id uuid,
  p_novo_status text,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (out_relationship_id uuid, out_status text, out_inalterado boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rel    public.partner_relationships%ROWTYPE;
  v_acao   text;
  v_motivo text;
BEGIN
  IF p_empresa_id IS NULL OR p_relationship_id IS NULL THEN
    RAISE EXCEPTION 'partner_status_dados_invalidos';
  END IF;
  IF p_novo_status NOT IN ('ACTIVE', 'SUSPENDED', 'REVOKED') THEN
    RAISE EXCEPTION 'partner_status_invalido';
  END IF;

  -- Tenant no WHERE, não numa checagem depois: um relacionamento de outra
  -- empresa simplesmente não existe para esta chamada.
  SELECT * INTO v_rel
  FROM public.partner_relationships
  WHERE id = p_relationship_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_nao_encontrado';
  END IF;

  -- Já está no estado pedido: nada muda e nada é auditado. Registrar um evento
  -- aqui inventaria uma decisão que ninguém tomou.
  IF v_rel.status = p_novo_status THEN
    RETURN QUERY SELECT v_rel.id, v_rel.status, true;
    RETURN;
  END IF;

  IF NOT (
       (v_rel.status = 'INVITED'   AND p_novo_status = 'REVOKED')
    OR (v_rel.status = 'ACTIVE'    AND p_novo_status IN ('SUSPENDED', 'REVOKED'))
    OR (v_rel.status = 'SUSPENDED' AND p_novo_status IN ('ACTIVE', 'REVOKED'))
  ) THEN
    IF v_rel.status = 'REVOKED' THEN
      RAISE EXCEPTION 'partner_relacionamento_revogado_terminal';
    END IF;
    RAISE EXCEPTION 'partner_transicao_invalida';
  END IF;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  UPDATE public.partner_relationships
     SET status = p_novo_status,
         atualizado_em = now(),
         ativado_em    = CASE WHEN p_novo_status = 'ACTIVE'  THEN now() ELSE ativado_em END,
         revogado_em   = CASE WHEN p_novo_status = 'REVOKED' THEN now() ELSE revogado_em END,
         revogado_por  = CASE WHEN p_novo_status = 'REVOKED' THEN p_actor_user_id ELSE revogado_por END,
         revogado_motivo = CASE WHEN p_novo_status = 'REVOKED' THEN v_motivo ELSE revogado_motivo END
   WHERE id = v_rel.id;

  v_acao := CASE p_novo_status
              WHEN 'ACTIVE'    THEN 'relationship_activated'
              WHEN 'SUSPENDED' THEN 'relationship_suspended'
              ELSE                  'relationship_revoked'
            END;

  -- MESMA TRANSAÇÃO. Se este INSERT falhar, a mudança de estado não aconteceu.
  INSERT INTO public.partner_network_events
    (empresa_id, entity_type, entity_id, action, actor_user_id, source, reason, metadata)
  VALUES (p_empresa_id, 'relationship', v_rel.id, v_acao, p_actor_user_id, 'web', v_motivo,
          jsonb_build_object('de', v_rel.status, 'para', p_novo_status));

  RETURN QUERY SELECT v_rel.id, p_novo_status, false;
END;
$fn$;

-- ── 11.7 Retirar oportunidade (HIGH-11) ──────────────────────────────────────
--
-- Mesmo defeito, mesmo remédio: `UPDATE estado='WITHDRAWN'` seguido de
-- `registrarEvento()` deixava o pedido retirado sem registro de retirada se o
-- segundo passo falhasse. Retirar é a operação que encerra um compromisso com o
-- parceiro; ela precisa de prova tanto quanto a revogação.
CREATE OR REPLACE FUNCTION public.partner_network_withdraw_opportunity(
  p_empresa_id uuid,
  p_actor_user_id uuid,
  p_opportunity_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (out_opportunity_id uuid, out_estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_op     public.partner_opportunities%ROWTYPE;
  v_motivo text;
BEGIN
  IF p_empresa_id IS NULL OR p_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'partner_withdraw_dados_invalidos';
  END IF;

  SELECT * INTO v_op
  FROM public.partner_opportunities
  WHERE id = p_opportunity_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_oportunidade_indisponivel';
  END IF;

  -- Só um pedido VIVO pode ser retirado. Retirar o que já foi retirado, superado
  -- ou encerrado produziria um segundo evento de retirada para o mesmo fato.
  IF v_op.estado NOT IN ('CURRENT', 'STALE_SOURCE') THEN
    RAISE EXCEPTION 'partner_oportunidade_indisponivel';
  END IF;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  UPDATE public.partner_opportunities
     SET estado = 'WITHDRAWN', estado_motivo = v_motivo, estado_em = now()
   WHERE id = v_op.id;

  INSERT INTO public.partner_network_events
    (empresa_id, entity_type, entity_id, action, actor_user_id, source, reason, metadata)
  VALUES (p_empresa_id, 'opportunity', v_op.id, 'opportunity_withdrawn', p_actor_user_id, 'web', v_motivo,
          jsonb_build_object('de', v_op.estado));

  RETURN QUERY SELECT v_op.id, 'WITHDRAWN'::text;
END;
$fn$;

-- ── 11.8 Marcar fonte obsoleta (chamado pelo caminho canônico de replan) ──────
CREATE OR REPLACE FUNCTION public.partner_network_mark_source_stale(
  p_empresa_id uuid,
  p_campaign_id uuid,
  p_motivo text DEFAULT 'replan',
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.partner_opportunities
    WHERE empresa_id = p_empresa_id AND campaign_id = p_campaign_id AND estado = 'CURRENT'
    FOR UPDATE
  LOOP
    UPDATE public.partner_opportunities
       SET estado = 'STALE_SOURCE', estado_motivo = p_motivo, estado_em = now()
     WHERE id = v_id;

    INSERT INTO public.partner_network_events
      (empresa_id, entity_type, entity_id, action, actor_user_id, source, reason, metadata)
    VALUES (p_empresa_id, 'opportunity', v_id, 'opportunity_stale_source', p_actor_user_id, 'system', p_motivo, '{}'::jsonb);

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

-- O Partner Lite nunca fala com o banco: quem executa é o service role da API.
REVOKE ALL ON FUNCTION public.partner_network_create_invitation(uuid, uuid, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_preflight_invitation(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_activate_invitation(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_submit_response(uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_share_gap(uuid, uuid, uuid, uuid, text, numeric, text, uuid[], text, text, timestamptz, timestamptz, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_set_relationship_status(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_withdraw_opportunity(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_network_mark_source_stale(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.partner_network_create_invitation(uuid, uuid, text, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_preflight_invitation(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_activate_invitation(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_submit_response(uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_share_gap(uuid, uuid, uuid, uuid, text, numeric, text, uuid[], text, text, timestamptz, timestamptz, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_set_relationship_status(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_withdraw_opportunity(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_network_mark_source_stale(uuid, uuid, text, uuid) TO service_role;

COMMIT;
