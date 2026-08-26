# Matopiba Log — DECISÕES CONGELADAS V9

> Fonte única das decisões de produto/arquitetura da Rebaseline V9.
> Cada decisão tem ID permanente. **Não reabrir na auditoria.**
> Data de congelamento: **2026-08-19** (macrofrente RBV9).
> Precedência quando houver contradição: produção real > banco > repo/main > deploy > testes > docs V9 > arquitetura anterior > relatórios antigos > memória.

Legenda de impacto: **DOMÍNIO** (muda modelo de dados) · **UX** · **SEGURANÇA** · **ARQ** (arquitetura) · **PROCESSO**.

---

## Direção geral do produto

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-001 | 2026-08-19 | Matopiba é **operação/frota-centric**, não motorista-centric. | O eixo do negócio é o ativo físico e a operação, não a pessoa do motorista. | DOMÍNIO/ARQ |
| D-002 | 2026-08-19 | **Veículo/composição** é o eixo físico principal; motorista tem **vínculos temporais** com veículos/composições. | Motorista não é dono da placa; troca de veículo/handoff é normal. | DOMÍNIO |
| D-003 | 2026-08-19 | **Composição veicular** é entidade própria. | Cavalo + reboque(s)/dolly/implemento formam a unidade operante. | DOMÍNIO |
| D-004 | 2026-08-19 | **Autônomo** usa o mesmo domínio, com **UX simplificada**. | Um só modelo de dados; simplifica manutenção e evolução. | UX/ARQ |
| D-005 | 2026-08-19 | **Pneus** entram no primeiro release relevante de Frota. | Custo/km de pneu é dor real do agro/transporte. | DOMÍNIO |

## Permissões, escopo e financeiro

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-006 | 2026-08-19 | Permissões = **templates editáveis por empresa** + **overrides individuais** + **invariantes de segurança do SaaS**. | Flexibilidade por cliente sem abrir mão de invariantes. | SEGURANÇA/DOMÍNIO |
| D-007 | 2026-08-19 | Dashboard operacional **não mostra financeiro empresarial** por padrão. | Operador não precisa/deve ver resultado da empresa. | UX/SEGURANÇA |
| D-008 | 2026-08-19 | Financeiro é **atribuível** (dedicado, gerente+financeiro, operador+financeiro, ou personalizado). **Nunca conceder financeiro automaticamente por ausência de funcionário.** | Fail-closed em permissão sensível. | SEGURANÇA |
| D-009 | 2026-08-19 | Visibilidade financeira do motorista é **configurável pela empresa**. Default = mínimo/comissão própria. Modos futuros: `commission_only`, `commission_plus_base`, `full_freight_financial`. | Cada empresa decide o quanto o motorista vê. | DOMÍNIO/UX |

## Frete: criação, execução e check-in/out

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-010 | 2026-08-19 | Criar e finalizar frete são permissões distintas: `freight.create`, `freight.finish`. | Separação de responsabilidades. | SEGURANÇA/DOMÍNIO |
| D-011 | 2026-08-19 | Quando o **operador** cria o frete, **KM/foto não pertencem ao formulário do operador**. Motorista faz **CHECK-IN** (KM inicial + foto odômetro) e **CHECK-OUT** (KM final + foto odômetro) conforme regra. | Evidência de odômetro pertence a quem está no veículo. | DOMÍNIO/UX |
| D-012 | 2026-08-19 | Motorista **pode visualizar** o frete antes do check-in, mas ações que dependem do início ficam **bloqueadas**. | Transparência sem permitir ação prematura. | UX |

## Documentos

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-013 | 2026-08-19 | Documento **empresa→motorista** e **motorista→empresa** são fluxos **distintos**. | Direções têm regras e destinatários diferentes. | DOMÍNIO |
| D-014 | 2026-08-19 | Tipo de documento **"Outro" exige nome/descrição obrigatória**. | Auditabilidade. | UX/DOMÍNIO |
| D-015 | 2026-08-19 | Documentos retornados podem ter **múltiplos recebedores/assinantes**. Não limitar a uma pessoa. | Realidade de assinaturas coletivas. | DOMÍNIO |
| D-016 | 2026-08-19 | App **visualiza PDF/documento primeiro**; salvar/compartilhar/abrir externo são ações **posteriores**. | Ver antes de exportar. | UX |

## Lançamentos, auditoria e realtime

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-017 | 2026-08-19 | Lançamentos precisam de **realtime web↔app**. | Operação depende de estado propagado sem refresh manual. | ARQ/UX |
| D-018 | 2026-08-19 | **Observação/motivo obrigatória** nas operações em que a auditoria exigir contexto. | Rastreabilidade. | DOMÍNIO |
| D-019 | 2026-08-19 | Lançamentos **nunca são apagados** para esconder histórico. Estados: `pendente`, `aprovado`, `rejeitado`, `cancelado/estornado`. Cancelamento exige **motivo + ator**. | Append/audit-safe. | DOMÍNIO/SEGURANÇA |
| D-020 | 2026-08-19 | Toda riqueza de campos coletada no app deve estar **disponível no painel/relatórios**. | Nada coletado pode ficar invisível. | DOMÍNIO/UX |
| D-021 | 2026-08-19 | Toda ação relevante registra `actor_user_id`, `role`, `timestamp`, `source`, `reason/metadata` quando aplicável. | Base de auditoria uniforme. | SEGURANÇA/DOMÍNIO |
| D-022 | 2026-08-19 | **Envelope Digital** é a unidade formal de fechamento do frete. | Consolidação única e imutável do frete. | DOMÍNIO |

## Plataforma, integrações e infra

| ID | Data | Decisão | Razão curta | Impacto |
|----|------|---------|-------------|---------|
| D-023 | 2026-08-19 | **ERP = Integration Hub**: modelo canônico + adapters + external IDs + idempotência + retry + reconciliação. | Nunca acoplar o domínio a um ERP específico. | ARQ |
| D-024 | 2026-08-19 | **Portal do Embarcador** é módulo/produto. | Frente de receita e de rede. | DOMÍNIO/ARQ |
| D-025 | 2026-08-19 | **Rede privada de parceiros/cotação precede marketplace público.** | Menor risco; valida o modelo antes de abrir. | ARQ/PROCESSO |
| D-026 | 2026-08-19 | **Parceiro Lite** responde cotações/operações compartilhadas **sem acesso ao tenant** do embarcador. **Parceiro Cliente** também administra a própria frota. | Boundaries de tenant rígidos. | SEGURANÇA/ARQ |
| D-027 | 2026-08-19 | **Performance/realtime** são requisitos **sistêmicos** (não features pontuais). | Qualidade percebida e operabilidade. | ARQ |
| D-028 | 2026-08-19 | **Migração para Hostinger NÃO ocorre agora.** Gate `INFRA_MIGRATION_GATE`: avaliar com ~1–3 clientes/pilotos próximos de produção, comparando métricas/latência/custo/operabilidade. | Decisão de infra guiada por dados reais. | PROCESSO |
| D-029 | 2026-08-19 | **Relatórios/PDF = produto**, não impressão de tela. | Diferencial e evidência formal. | UX/DOMÍNIO |
| D-030 | 2026-08-19 | **Nenhum backlog desaparece.** `DONE` = feito e validado; `DEFERRED` = adiado conscientemente. **DEFERRED nunca é DONE.** | Governança de escopo. | PROCESSO |

---

## D-031 — Microsoft Entra ID / Active Directory (arquitetura-alvo)

**Data:** 2026-08-19 · **Impacto:** ARQ/SEGURANÇA

- Fase inicial: **SSO via OIDC**, identidade corporativa, mapeamento de **App Roles/grupos** → usuário Matopiba + Role Template Matopiba + Scope Matopiba.
- Perfis relevantes: Operador, Embarcador, Gerente de Frota, Gerente de Filial, Gerente Regional, Gerente Nacional, Financeiro, Administrador.
- **Não inferir permissão crítica** por jobTitle/e-mail/domínio. Mapeamento **explícito tenant-by-tenant**. Escopo por grupo/empresa/região/filial. **Matopiba continua autoridade de permissões.**
- Evolução: JIT provisioning → SCIM (user/group provisioning/deprovisioning) → SAML se enterprise exigir. **Break-glass local obrigatório.**
- **Proibido como arquitetura:** LDAP público; exigir Domain Admin; segredo AD no frontend.

## D-032 — Route Intelligence (provider abstraction)

**Data:** 2026-08-19 · **Impacto:** ARQ

- **Nunca acoplar o domínio a Google/TomTom/outro.** Introduzir camada de provider.
- Funções-alvo: distância, tempo, rota, restrições truck/comercial, dimensões/peso quando suportado, pedágios, alternativas, combustível/custos previstos.
- Combustível inicial = distância ÷ média configurada da composição; evolução = histórico real da própria frota.

## D-033 — Disponibilidade / Despacho (estilo Uber)

**Data:** 2026-08-19 · **Impacto:** DOMÍNIO/ARQ

- Frete aprovado → candidatos elegíveis → oferta no app → aceitar/recusar/expirar → **primeiro aceite válido vence** com **lock concorrência-safe** → atribuição → auditoria.
- Dois modos: **(A) designação direta** e **(B) oferta para elegíveis**.
- Elegibilidade futura: filial, região, disponibilidade, permissão, vínculo, veículo/composição, documentos, status operacional.

## D-034 — Contratos (domínio próprio, separado de Termos/Privacidade)

**Data:** 2026-08-19 · **Impacto:** DOMÍNIO/ARQ

- Tipos: trial, comercial, aditivo, upgrade, add-on, rescisão. Contrato trial **pode ser opcional** por negócio/empresa.
- Fluxo: template versionado → snapshot com dados da empresa → PDF → assinatura Matopiba → assinatura cliente → **PDF assinado imutável** → disponível ao cliente.
- **Signature Provider abstraction** (não improvisar assinatura própria como arquitetura final).

## D-035 — Separação de domínios financeiros

**Data:** 2026-08-19 · **Impacto:** DOMÍNIO/UX

- **Financeiro operacional do cliente** (frete, receita, comissão, abastecimento, despesa, vale, adiantamento, resultado, recebíveis, veículo, filial, centro de custo) é **distinto** do **Financeiro SaaS Matopiba** (cliente, plano, trial, proposta, contrato, assinatura SaaS, fatura SaaS, pagamento, inadimplência, add-on, upgrade, conversão, MRR, churn).
- Não misturar os dois domínios em páginas/dashboards/services. Não inventar KPI sem fonte real.

---

## Patch fiscal V9 — NFS-e / entidade jurídica (D-036..D-041)

> **Nota de numeração (importante).** A macrofrente RBV9 previa "adicionar D-031..D-036 fiscais". Na aplicação, os IDs **D-031..D-035 já estavam congelados** com decisões não-fiscais (Entra ID, Route Intelligence, Dispatch, Contratos, Separação financeira). Para **não sobrescrever decisão congelada** (D-030 — nenhum backlog/decisão desaparece), as 6 decisões fiscais foram atribuídas aos próximos IDs livres **D-036..D-041**. Mapeamento: fiscal-1→**D-036**, fiscal-2→**D-037**, fiscal-3→**D-038**, fiscal-4→**D-039**, fiscal-5→**D-040**, fiscal-6→**D-041**. O conteúdo é idêntico ao pedido; apenas o inteiro do ID mudou.

### D-036 — Automação de NFS-e para receita SaaS elegível

**Data:** 2026-08-20 · **Impacto:** DOMÍNIO/ARQ

- Toda **receita SaaS elegível** do Matopiba terá automação de **NFS-e**: emissão, reconciliação, **XML/DANFSe**, armazenamento, **portal** e **e-mail** ao cliente.
- Domínio próprio `FISCAL_INVOICING`, **separado** de `FINANCE_OPERATIONAL` e de `SAAS_BILLING`.

### D-037 — Entidade jurídica emissora configurável e versionada

**Data:** 2026-08-20 · **Impacto:** DOMÍNIO/ARQ

- A **entidade jurídica emissora/prestadora** é **configurável, versionada por vigência e substituível**. Não hard-coded no billing/fiscal.
- Trata-se apenas como `CURRENT_LEGAL_ENTITY=provisória` e `FUTURE_LEGAL_ENTITY=cutover planejado` — sem registrar dados pessoais desnecessários de titularidade.

### D-038 — Marca independente da entidade jurídica

**Data:** 2026-08-20 · **Impacto:** ARQ/UX

- A marca **Matopiba Log** é **independente** da entidade jurídica que emite/cobra. Troca de CNPJ não muda a marca.

### D-039 — Snapshot fiscal imutável por operação

**Data:** 2026-08-20 · **Impacto:** DOMÍNIO/SEGURANÇA

- Contratos, cobranças e documentos fiscais **preservam snapshot** da entidade jurídica **efetivamente utilizada** naquela operação. Histórico nunca é reescrito.

### D-040 — Regime tributário como perfil fiscal versionado

**Data:** 2026-08-20 · **Impacto:** DOMÍNIO/ARQ

- Regime tributário é **perfil fiscal versionado**. A arquitetura deve suportar **SIMEI → Simples Nacional/ME** sem reescrever billing/fiscal.

### D-041 — Cutover controlado de entidade jurídica

**Data:** 2026-08-20 · **Impacto:** ARQ/PROCESSO

- Troca futura de CNPJ/entidade usa **cutover controlado** (payment provider account, fiscal provider, contratos, certificado e vigência desacoplados). **Histórico nunca é reescrito.**

### Flags fiscais de execução (RBV9 fiscal patch)

| Flag | Valor | Significado |
|------|-------|-------------|
| `FISCAL_TECH_BUILD_ALLOWED` | **true** | Construir arquitetura/código fiscal é autorizado. |
| `FISCAL_ARCHITECTURE_ALLOWED` | **true** | Modelagem/abstração fiscal autorizada. |
| `TRIAL_TECHNICAL_ALLOWED` | **true** | Trial técnico autorizado. |
| `CNAE_BLOCKS_TECH_DEVELOPMENT` | **false** | Adequação CNAE/CNPJ do owner corre em paralelo; **não bloqueia** desenvolvimento técnico. |
| `CERTIFICATE_PURCHASE` | **DEFERRED** | Compra de certificado adiada. |

---

## Permissões V9 (P2 — templates+overrides)

### D-042 — `freight.create` do motorista fechado por padrão (tightening de segurança)
`POST /fretes` era acessível a qualquer usuário autenticado (motorista podia auto-criar frete para si). A P2 passa a exigir `requirePermission('freight.create')`: **admin/operador têm por padrão; motorista = false**. Isto **fecha um gap de autorização** (Section 23 permite mudança de efetivo quando é correção de segurança **explicitamente relatada** — é o caso). Empresas que queiram permitir podem ligar `freight.create` no template Motorista ou via override individual. `ENTRA_ROLE_TEMPLATE_MAPPING = FUTURE` (o template tem `stable_key` estável para mapear App Role/Group do Entra no futuro).

### D-043 — Visibilidade financeira do motorista é VISIBILITY POLICY (não permission); autônomo = full
`driver_financial_visibility_mode ∈ {commission_only, commission_plus_base, full_freight_financial}`, default **commission_only**, com **redação no backend** (omite `valor_frete`/bruto; expõe `comissao_valor`). Não é substituto de permission. **Motorista de empresa `autonomo` = `full_freight_financial` por padrão** (é o próprio dono e sempre viu o financeiro completo → preserva o efetivo); override individual ainda vence. Precedência de permissões congelada: **PLATFORM_INVARIANT → ENTITLEMENT → USER_OVERRIDE → COMPANY_TEMPLATE → DEFAULT_DENY**; scope verificado após o efetivo; permissão nunca expande scope.

---

## Verificabilidade, automação guiada e IA

### D-044 — Toda feature é avaliada também pela carga de trabalho humano evitada
Toda funcionalidade nova deve responder, além de valor/risco/custo: **quanto trabalho o sistema evita que o usuário precise fazer?** Happy path deve ser automático ou guiado; atenção humana fica concentrada em exceções e decisões.

### D-045 — Automação importante precisa ser verificável e explicável
Automação relevante deve expor `what/why/evidence/result`: o que foi verificado, por que a decisão foi tomada, quais evidências foram usadas e qual resultado foi produzido. Automação opaca não vira autoridade.

### D-046 — IA não é authority; IA atua somente via tools Matopiba
Modelos de IA não decidem permissão, escopo, tenant, dinheiro, fiscal, segurança ou mutação crítica. IA futura só poderá agir chamando tools Matopiba que aplicam as mesmas regras determinísticas do sistema.

### D-047 — Tools de IA usam entitlement, permission, scope, invariants e risk policy
Toda tool futura consumida por IA deve obedecer **ENTITLEMENT AND PERMISSION AND SCOPE**, validar invariantes objetivas e respeitar política de risco/confirmação. IA nunca eleva risco nem amplia escopo.

### D-048 — Repair Playbooks seguem CHECK → DIAGNOSE → DRY_RUN → REPAIR → VERIFY → AUDIT
Correções assistidas devem ter contrato explícito, dry-run antes de mutação, idempotência declarada, política de confirmação, estratégia de rollback/compensação quando aplicável e auditoria da execução. Reparos de produção ficam bloqueados por gate até decisão específica.

### D-049 — Operation Campaign será unidade de planejamento de escoamento
`Operation Campaign` é a futura unidade de planejamento para múltiplos fretes de uma safra/janela de escoamento, acima do frete individual e antes de dispatch/execução.

### D-050 — Operation Orchestrator é determinístico e separado do modelo de IA
O orquestrador operacional futuro calcula planos/ações por regras determinísticas e invariantes auditáveis. IA pode auxiliar proposta/explicação, mas não substitui o orquestrador como autoridade.

### D-051 — AI Provider Gateway evita acoplamento a provider/modelo específico
Qualquer integração futura com IA deve passar por gateway/provider abstraction, com troca de provider/modelo sem reescrever domínio, permissões ou auditoria.

### D-052 — Modo Assistido voice/multimodal é direção oficial de acessibilidade
Voice/multimodal é direção oficial para reduzir esforço do usuário, principalmente em app/campo. Deve respeitar o mesmo modelo de permissão, confirmação e evidência.

### D-053 — App Version Policy precede maturidade de distribuição Google Play
Antes de depender de Play Store como canal maduro, o produto precisa de política de versão: versão mínima suportada, versão recomendada, severidade, notas de release e update in-app oficial (`flexible`/`immediate`).

### D-054 — E1.5 é a fundação horizontal de verificabilidade, diagnóstico e recuperação
Antes da expansão pesada da Onda 2, Matopiba deve ter contratos canônicos para correlação, envelope de evento/evidência, invariantes, verifier, findings, playbooks, dry-run e superfície read-only de diagnóstico.

---

## Operation Campaign / Operacao de Escoamento

### D-055 — Campaign e objetivo operacional versionado, nao agrupamento de fretes
`Operation Campaign` representa demanda/restricoes/recursos e existe antes dos fretes executaveis. Frete continua sendo a autoridade de execucao; Campaign coordena plano, cenarios, aprovacao, progresso e excecoes.

### D-056 — Planejamento e execucao sao dominios separados
Campaign gera `plan_version`, `scenario` e `planned_trip` antes de materializar frete. Plano aprovado e imutavel; replanejamento cria nova versao e preserva fretes ja executados.

### D-057 — Planner V1 e deterministico e baseado em snapshot de recursos
Mesmos inputs, snapshot e rules version produzem o mesmo plano. O planner usa Fleet real como fonte de capacidade, salva assumptions suficientes para replay e gera relatorio verificavel com demanda, capacidade, warnings e demanda nao alocada.

### D-058 — Materializacao em fretes exige aprovacao e idempotencia
Viagens planejadas so viram `fretes` apos aprovacao explicita. Materializacao em lote deve ser transacional ou reconciliavel, com idempotencia por planned trip/request; e proibido loop frontend que crie dezenas de fretes sem reconciliacao.

### D-059 — Campaign tem authorization propria
Campaign deve nascer com entitlement `operation_campaign` e permissions estaveis `campaign.view`, `campaign.create`, `campaign.plan`, `campaign.approve`, `campaign.dispatch` e `campaign.manage`, sempre sob `ENTITLEMENT AND PERMISSION AND SCOPE`. Fleet permission nao autoriza Campaign por implicacao.

### D-060 — Campaign pode ser multi-unidade somente dentro do escopo efetivo
Uma Campaign pode envolver multiplas origens/unidades quando o usuario tem escopo regional/global correspondente. Tenant vem do contexto autenticado; `empresa_id` e obrigatorio e FKs compostas protegem referencias cross-tenant.

### D-061 — Route, partner, shipper, dispatch e IA ficam em boundaries explicitos
Campaign-A nao integra provider de rota, marketplace, parceiro real, portal do embarcador, dispatch por oferta ou AI Agent. RouteProvider, Partner Network, Shipper Portal, Dispatch e AI tools sao contratos futuros; nenhum deles vira authority do planner inicial.

### D-062 — Operation Campaign tem entitlement tecnico proprio e mapping comercial diferido
`CAMPAIGN_ENTITLEMENT_KEY=operation_campaign`. Campaign nao e subfeature implicita de Fleet, Freight ou Reports. Autorizacao futura = **ENTITLEMENT AND PERMISSION AND SCOPE**. `OPERATION_CAMPAIGN_COMMERCIAL_MAPPING=DEFERRED_SEPARATE_COMMERCIAL_DECISION`; seeds comerciais de producao ficam `DEFAULT_DENY / NOT MAPPED` ate decisao comercial explicita.

### D-063 — Campaign-A termina em Approved Plan, sem materializar fretes
`CAMPAIGN_A_END_STATE=APPROVED_PLAN`. Campaign-A inclui dominio, schema, demanda, locations, plan versions, scenarios, planned trips, resource snapshot, planner deterministico V1, aprovacao, permissions/scope/entitlement contract, verificabilidade e UX web inicial de create/review. Exclui materializacao de fretes, criacao massiva de fretes, dispatch, ofertas a motoristas, execution tracking, progresso baseado em fretes reais e replanning apos execucao; esses itens ficam para Campaign-B.

### D-064 — Campaign multi-unidade e suportada sob escopo efetivo completo
`CAMPAIGN_MULTI_UNIT_V1=SUPPORTED_WITH_ALL_UNITS_IN_EFFECTIVE_SCOPE`. Campaign pode envolver uma ou varias unidades operacionais se o usuario tiver scope efetivo sobre todas. A autoridade continua sendo entitlement + permission + scope; nao usar roles hardcoded. O schema nao deve depender de uma unica `operation_campaigns.unidade_operacional_id` como autoridade exclusiva se isso quebrar multi-unidade.

### D-065 — Parallel Execution V1 usa tres writers isolados e um reviewer read-only
`PARALLEL_EXECUTION_V1=3_WRITER_AGENTS_PLUS_1_READ_ONLY_REVIEWER_PLUS_OWNER_ORCHESTRATOR`. Batch V1 prepara Agent A (`CAMPAIGN_A_WRITER`), Agent B (`MOBILE_M1_WRITER`), Agent C (`SYSTEMIC_QUALITY_WRITER`) e Agent R (`PARALLEL_INTEGRATION_REVIEWER`). Main nao e workspace de desenvolvimento; branches/worktrees isolados sao obrigatorios; reviewer nao escreve produto.

### D-066 — Migration 076 fica em single-flight com Agent A; docs canonicos tem owner unico
`MIGRATION_076_OWNER=AGENT_A`; `076_operation_campaign_foundation.sql` fica reservado para Campaign-A. Agent B e Agent C nao tem autoridade de schema e nao podem criar/alterar migrations 076/077/078. `PRODUCTION_SCHEMA_WRITER_COUNT<=1`, `PRODUCTION_DDL_MAX_CONCURRENT=1` e `PRODUCTION_SENSITIVE_WRITE_MAX_CONCURRENT=1`. `CANONICAL_DOC_OWNER=ORCHESTRATOR/INTEGRATOR` para `DECISIONS`, `ROADMAP`, `MASTER_LEDGER` e `CONTEXT_BRIDGE`.

### D-067 — Ler um perfil para atribuir e editar o que ele significa são autoridades diferentes
`ASSIGN_PROFILE_AUTHORITY=users.manage`; `EDIT_PROFILE_AUTHORITY=permissions.manage`. Listar perfis atribuíveis, criar usuário com um perfil e trocar o perfil de alguém exigem `users.manage`. Alterar **o que um perfil concede** continua exigindo `permissions.manage`, e `routes/permissions.js` não foi afrouxado. Separar as duas coisas é o que permite delegar a formação da equipe sem entregar a matriz de permissões junto.

### D-068 — Não-escalação por contenção, nunca por lista de perfis proibidos
`PROFILE_ASSIGNMENT_RULE=CONTAINMENT_IN_ACTOR_EFFECTIVE_PERMISSIONS`. Um ator só atribui perfil cujas permissões efetivas estejam contidas nas dele — regra única, conferida na listagem **e** na gravação. Deliberadamente **não** existe lista de perfis "perigosos": uma regra que dependa de enumerar exceções erra em silêncio no dia em que a empresa criar um perfil novo. Consequências aceitas: administrador de verdade **pode** delegar administração (o conjunto dele contém o do template); gerente com `users.manage` **não** vê nem atribui Administrador ou Financeiro. Filtro de tela não é controle de acesso — a lista chega filtrada e é reconferida no servidor.

### D-069 — `usuarios.tipo` é classe de conta, não papel
`USER_TIPO_SEMANTICS=ACCOUNT_CLASS_NOT_ROLE`. Todo usuário interno nasce com `tipo='admin'` e a autoridade vive em `permission_template_id`. O motivo é concreto: `isAdmin` exige `role === 'admin'` e guarda **21 pontos de rota**, então gravar `tipo='operador'` criaria alguém que não abre nem o dashboard, com o rótulo legado vencendo a permissão efetiva. **Não deletar `tipo` às cegas.** Corolário operacional: enquanto `isAdmin` for role-based, o ponteiro de template não pode ficar nulo — por isso a criação de usuário é atômica (falha ao atribuir o perfil desfaz usuário + identidade Auth), e não "melhor esforço". Dívida em `RBV9-INV-110`.

### D-070 — Escopo operacional não entra no modal de usuário enquanto não houver unidade configurada
`TEAM_SCOPE_IN_USER_MODAL=DEFERRED_UNTIL_UNITS_EXIST`. Produção tem 0 grupos, 0 unidades e 0 memberships: forçar um seletor de escopo vazio seria inventar uma pergunta sem resposta. O modelo canônico (`usuario_operacional_memberships`, `estrutura_operacional.gerenciar`) segue sendo a autoridade e a atribuição continua na tela de Estrutura Operacional. Quando existir empresa com unidades configuradas, o seletor entra no modal — decisão registrada, não implementada às cegas.

### D-071 — O modal de Novo Frete é o padrão de formulário do painel
`UX_FORM_001=FREIGHT_MODAL_PATTERN_V1`. O padrão já aprovado pelo owner (cabeçalho e rodapé fixos, corpo com rolagem própria, ação primária sempre visível) foi extraído para `ModalFormulario.tsx` e é o alvo de convergência das telas de cadastro. O **Frete não foi refatorado**: o modal dele vive num arquivo de 2.000+ linhas entrelaçado com cálculo de valor de frete e comissão, e extraí-lo para arrumar uma tela de cadastro seria mexer no fluxo de receita da transportadora. O shell reproduz o comportamento; a convergência dos três fica como limpeza técnica (`RBV9-INV-111`), não dívida de produto.

### D-072 — Autoridade de produto é permissão efetiva; classe de conta não autoriza
`PRODUCT_AUTHORIZATION_SOURCE=EFFECTIVE_PERMISSION`. Nenhuma rota, controller ou serviço pode usar `role==='admin'` (ou `tipo`) para decidir **se** alguém pode agir. A cadeia canônica para ação de tenant é `verifyToken + verificarEmpresa + verificarPlano (quando aplicável) + requirePermission(...) + escopo (quando aplicável)`. Autoridade de plataforma continua em `isSuperAdmin`, separada e não enfraquecida. E não se substitui um gate de papel por outro gate de papel: se nenhuma permissão existente representa a rota, a decisão é escolher a **menor** permissão canônica — nunca criar um `admin.access` guarda-chuva. A auditoria que fechou isto (`RBV9-INV-110`) não encontrou **nenhum** caso que exigisse "administrador da empresa" como conceito próprio.

### D-073 — Quando dois caminhos levam à mesma ação, a autoridade vive na ação
`AUTHORIZATION_AT_THE_TRANSITION_NOT_THE_ROUTE`. As rotas `/aprovar`, `/rejeitar` e `/cancelar` exigiam corretamente `launch.approve`/`reject`/`cancel`, mas o `PATCH /:id` — guardado por `launch.create` — delegava para a mesma transição, que checava só a classe de conta. Um Operador aprovava lançamento pela porta lateral. A regra geral: quando duas superfícies convergem para o mesmo efeito, a checagem pertence ao ponto de convergência, e transição sem permissão mapeada é **negada por construção**, não liberada por omissão. Ver `RBV9-INV-110`.

### D-074 — Chave técnica de permissão não é informação de usuário
`TEAM_UX_001=REMOVE_RAW_PERMISSION_KEYS_FROM_NORMAL_LIST`. A lista de equipe mostra **Perfil de acesso**; exceção individual aparece como indicador humano ("2 ajustes de acesso") que **qualifica o perfil**, sem citar chave. O detalhe do que foi ajustado vive na tela canônica de Perfis e Permissões, sob `permissions.manage` — e não se cria um segundo editor para isso. Quando não há informação humana útil além do perfil, a coluna é **removida sem substituição**: menos coluna útil é melhor que redundância decorativa.
---

## Gates registrados

| Gate | Critério de liberação |
|------|-----------------------|
| `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE` | Reativar Asaas Production só com nova autorização explícita + allowlist única + runbook. Estado atual: **DESARMADO** (ver FORENSIC_BASELINE §Billing/Asaas). |
| `INFRA_MIGRATION_GATE` (D-028) | 1–3 clientes/pilotos reais próximos de produção + benchmark de latência/custo/operação. |
| `OPERATIONAL_SCOPE_ENFORCEMENT_GATE` | Enforcement automático de escopo P1 (grupos/filiais) está **desativado por segurança**; ativar só com dados operacionais reais + gate. |
| `FISCAL_LEGAL_ENTITY_GATE` | **BLOCKED_PENDING_CNAE_AND_ACCOUNTING_ALIGNMENT.** Emissão fiscal real depende de adequação de CNAE/regime + alinhamento contábil do owner. Desenvolvimento/arquitetura fiscal **liberados**; emissão **real** bloqueada. |
| `COMMERCIAL_PAID_GO_LIVE_GATE` | **BLOCKED_BY_FISCAL_LEGAL_ENTITY_GATE.** Go-live comercial pago (cobrança + NFS-e reais) só após liberar `FISCAL_LEGAL_ENTITY_GATE` **e** `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`. |

---

_Ver também: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
