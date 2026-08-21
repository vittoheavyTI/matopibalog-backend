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
