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

## Gates registrados

| Gate | Critério de liberação |
|------|-----------------------|
| `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE` | Reativar Asaas Production só com nova autorização explícita + allowlist única + runbook. Estado atual: **DESARMADO** (ver FORENSIC_BASELINE §Billing/Asaas). |
| `INFRA_MIGRATION_GATE` (D-028) | 1–3 clientes/pilotos reais próximos de produção + benchmark de latência/custo/operação. |
| `OPERATIONAL_SCOPE_ENFORCEMENT_GATE` | Enforcement automático de escopo P1 (grupos/filiais) está **desativado por segurança**; ativar só com dados operacionais reais + gate. |

---

_Ver também: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
