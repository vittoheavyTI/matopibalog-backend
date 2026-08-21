# Matopiba Log — ROADMAP V9

> Contém: **Arquitetura-alvo V9** (RBV9-4) · **Gap Analysis** (RBV9-3) · **Roadmap em ondas** (macrofrente → épico → fatia → dependências → gates).
> Baseado no estado real de 2026-08-19 ([FORENSIC_BASELINE](./FORENSIC_BASELINE.md)) e nas decisões congeladas ([DECISIONS](./DECISIONS.md)).

---

## Parte A — Arquitetura-alvo V9 (RBV9-4)

Autorização efetiva em todo o sistema = **ENTITLEMENT (plano) AND PERMISSION (papel/override) AND SCOPE (grupo/região/filial)**. Matopiba é sempre a autoridade final de permissões (mesmo com Entra ID).

### Domínios lógicos e boundaries

| Domínio | Responsabilidade | Depende de | Estado hoje |
|---------|------------------|-----------|-------------|
| **IDENTITY** | Autenticação, sessões, SSO/Entra, break-glass | — | SEC-1 vivo; SSO ROADMAP |
| **ORG_SCOPE** | Grupo → Região → Filial → Operação; memberships | IDENTITY | schema vivo, inerte |
| **PERMISSIONS/ENTITLEMENTS** | Templates + overrides + invariantes; funcionalidades por plano | IDENTITY, ORG_SCOPE | entitlements vivos; templates ROADMAP |
| **FLEET** | Ativos, composições, documentos de ativo, odômetro, pneus, manutenção | ORG_SCOPE | **NEW (0)** |
| **DRIVERS** | Motoristas, vínculo temporal a veículos, visibilidade financeira | FLEET, PERMISSIONS | cadastro vivo; vínculo NEW |
| **FREIGHT_PLANNING** | Oportunidade → custo/rota previstos → aprovação | FLEET, ROUTE, ORG_SCOPE | **NEW (0)** |
| **DISPATCH** | Designação direta / oferta a elegíveis; lock concorrência-safe | PLANNING, DRIVERS, FLEET | **NEW (0)** |
| **FREIGHT_EXECUTION** | Frete aprovado → check-in/out (KM+foto) → execução → fechamento | DISPATCH, DOCUMENTS, LAUNCHES | frete vivo; check-in/out NEW |
| **DOCUMENTS** | Doc por frete/motorista/ativo; scanner; viewer PDF-first; assinaturas | STORAGE, PERMISSIONS | por-frete vivo; direções/ativo NEW |
| **LAUNCHES** | Despesa/abastecimento/vale/adiantamento; append/audit-safe; realtime | FREIGHT_EXECUTION, AUDIT | vivo; estados/realtime PARTIAL |
| **MAINTENANCE** | Preventiva/corretiva, OS, peças, tempo parado | FLEET | **NEW (0)** |
| **FINANCE_OPERATIONAL** | Receita/comissão/resultado/recebíveis/centro de custo do cliente | FREIGHT_EXECUTION, LAUNCHES, FLEET | parcial; separar de SaaS |
| **SAAS_BILLING** | Plano/trial/proposta/fatura/pagamento/inadimplência/MRR/churn | CONTRACTS, IDENTITY | maduro; Asaas desarmado |
| **FISCAL_INVOICING** | NFS-e: entidade jurídica/perfil fiscal → outbox → provider → DPS → NFSE → reconcile → XML/DANFSe → e-mail/portal | SAAS_BILLING (evento), certificado, fiscal provider | **NEW (0)**; CNAE/regime em paralelo (não bloqueia dev) |
| **CONTRACTS** | Template versionado → snapshot → PDF → assinatura → imutável | SAAS_BILLING, signature provider | vivo (interno); provider externo ROADMAP |
| **SHIPPER** | Portal do embarcador: demanda/cotação/proposta/seleção | PARTNER_NETWORK, boundaries | **NEW (0)** |
| **PARTNER_NETWORK** | Rede privada (Lite/Cliente); snapshots compartilhados sem acesso a tenant | SHIPPER, ORG_SCOPE | **NEW (0)** |
| **ERP_INTEGRATION** | Modelo canônico + outbox + adapters + external_id + retry + reconcile | FREIGHT_EXECUTION, FINANCE | **NEW (0)** (integração custom parcial) |
| **AUDIT** | Eventos unificados (entity/action/actor/source/metadata) + Envelope Digital | todos | fragmentado; unificação ROADMAP |
| **REPORTING** | PDFs como produto (Envelope, fechamento, espelho, histórico) | AUDIT, FLEET, FINANCE | branding vivo; produtos-alvo ROADMAP |
| **NOTIFICATIONS** | Interno + push + realtime | IDENTITY | vivo |

**Regras de boundary chave:** (1) Financeiro operacional do cliente **nunca** se mistura com financeiro SaaS (D-035). (2) Parceiro/embarcador **nunca** acessa o tenant do outro; compartilhamento é por **snapshot** (D-026). (3) ERP acoplado só via **modelo canônico** + adapter (D-023). (4) Route/Signature/Payment/Identity externos entram por **provider abstraction** (D-032/D-034/D-031). Nenhuma migration é escrita nesta macrofrente.

---

## Parte B — Gap Analysis (RBV9-3)

Comparação: histórico/V8 × sistema real × alvo V9. Classificação de cada capacidade.

| Capacidade | Classificação | Risco de regressão | Dependências |
|-----------|---------------|--------------------|--------------|
| Auth/SEC-1/sessões/tracking credential | **REUSE_AS_IS** | Baixo | — |
| Entitlements por plano | **REUSE_AS_IS** | Baixo | — |
| SAAS Billing / Asaas / contratos / promoções | **REUSE_AS_IS** | Baixo (manter desarmado) | gate financeiro |
| ePOD / ocorrências / rastreamento leve / notificações | **REUSE_AS_IS** | Baixo | — |
| Relatórios PDF (branding) | **REUSE_AS_IS** | Baixo | — |
| Lançamentos (despesa/abast/vale) | **REUSE_WITH_REFACTOR** | Médio | estados audit-safe + realtime |
| Frete atual → execução com check-in/out | **REUSE_WITH_REFACTOR** | Médio | FLEET, permissões create/finish |
| ORG_SCOPE (grupos/filiais) | **MIGRATE_ADDITIVELY** (ativar inerte) | Médio | dados reais + gate enforcement |
| Entitlements → templates+overrides por empresa | **MIGRATE_ADDITIVELY** | Médio | PERMISSIONS |
| Financeiro operacional × SaaS (separação) | **REUSE_WITH_REFACTOR** | Médio | auditoria de KPIs/services |
| Auditoria unificada + Envelope Digital | **REUSE_WITH_REFACTOR** → parte NEW | Médio | AUDIT model |
| Realtime sistêmico | **REPLACE** (polling → push/subscription) | Médio | infra realtime |
| Scanner do app | **REUSE_WITH_REFACTOR** | Baixo | viewer PDF-first |
| Frota/Veículos/Composições/Pneus/Manutenção | **NEW** | — | ORG_SCOPE |
| Planejamento/Route Intelligence/Dispatch | **NEW** | — | FLEET |
| Embarcador/Rede de parceiros/Marketplace | **NEW** | — | boundaries |
| ERP Integration Hub | **NEW** | — | modelo canônico |
| SSO/Entra ID/SCIM/SAML | **NEW** | — | IDENTITY provider |

**Contagem:** REUSE_AS_IS = **6** · REUSE_WITH_REFACTOR = **6** · MIGRATE_ADDITIVELY = **2** · REPLACE = **1** · NEW = **6**.

---

## Parte C — Roadmap em ondas

Ordem ajustada por dependência técnica objetiva: FLEET é pré-requisito de PLANNING/DISPATCH/MAINTENANCE, então precede a expansão. Realtime e qualidade vêm antes por serem transversais.

### ONDA 0 — Rebaseline / dívida / baseline _(esta macrofrente + fechamento)_
- **RBV9** (este PR docs-only): inventário, decisões, ledger, arquitetura, roadmap, handoff. **← ATUAL**
- Coletar Supabase advisors (TD-06/RBV9-INV-104); investigar tracking da migration 068 (L-02); higiene de repo (TD-05).
- **Gate de saída:** owner aprova a Rebaseline V9. Nenhuma escrita de produção.

### ONDA 1 — Qualidade do produto atual _(transversal, baixo risco)_
- **E1.1 Realtime** (RBV9-INV-053/093, D-017/D-027): ✅ **entregue** — SSE autenticado backend-mediated (`/realtime/stream` + `realtimeBus`) para lançamentos; web (fetch stream) e app (http stream) refazem fetch canônico; reconnect/visibility/resume. Escala horizontal DEFERRED (RBV9-INV-107). _Notificações/torre ficam para ondas seguintes._
- **E1.2 Lançamentos audit-safe** (RBV9-INV-052, D-018/D-019): ✅ **DEPLOYADO** — máquina de estados + RPC transacional (row lock + CAS) + ledger append-only `lancamento_eventos` + motivo obrigatório em rejeição/cancelamento. **Migration 070 aplicada+rastreada em prod** (`20260820033844`, mecanismo canônico, 0 escrita de negócio).
- **E1.3 Separação financeira** (RBV9-INV-055, D-035): pendente (próxima).
- **E1.4 Scanner + viewer PDF-first** (RBV9-INV-044/047, D-016): pendente.
- **E1.5 Permissões templates+overrides** (RBV9-INV-018/019/020, D-006/D-008/D-010) — ✅ **P2 CLOSED técnico**: migration **072 aplicada+rastreada** em produção (`20260821043352`), backend **e718eb3** implantado no Railway após billing resolvido, frontend **e718eb3** publicado, health 200, smokes anon 401, logs sem erro novo, sanity de templates/governança sem drift inesperado. Templates por empresa + overrides individuais + visibility policy do motorista; resolver único; RPCs guardadas de governança; API `/admin/permissions/*`; web "Perfis e Permissões"; app gate por efetivo. `freight.create`/`freight.finish` e financeiro atribuível separados; redação financeira no backend. Validação física do app: `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`.
- **E1.6 Paridade painel↔app** (RBV9-INV-054, D-020): ✅ **entregue** (abastecimento: arla/odômetro/preço-litro/observação; observação obrigatória no create web+app). UX/máscaras/sidebar (RBV9-INV-098/099) seguem pendentes.
- **E1.7 Hotfix + release do app** (PR #437, `MERGE_SHA=569fde7`): ✅ **DEPLOYADO** — **migration 071 aplicada+rastreada** (`20260820040645`, CHECK de `status` aceita `cancelado` → corrige 500 no cancelamento; aditiva/idempotente, reconciliada com o repo, SHA256 `e6f3b7a4…d623fe`) + **SSE na tela de detalhe do frete no app** (`detalhe_viagem_screen`). Desvio de processo registrado (**PROCESS-001**, `CLOSED_WITH_CORRECTIVE_ACTION`). **Artefato do app preparado** (mesmo pipeline: `flutter build apk --release` assinado com chave debug, sem secret novo).
- **Dependências:** E1.5 antes de D-007/D-011. **Estado:** Onda 1 (E1.1/E1.2/E1.6 + E1.6A + E1.7) **DEPLOYADA em produção e tecnicamente CLOSED** (PR #435 `f43f009` + hotfix PR #437 `MERGE_SHA=569fde7`, migrations 070+071 aplicadas+rastreadas, CI verde, sem regressão). `ONDA1_TECHNICAL_STATUS=CLOSED`; `ONDA1_APP_DEVICE_VALIDATION=DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` (itens `MOBILE-M1-001/002`; **não bloqueia** o roadmap). **P2/E1.5 = `CLOSED`**; macrofrente atual de release = **E1.3 / PR #441**.

### MOBILE_RELEASE_TRAIN_M1 _(trem de release do app — transversal)_

> **Política (owner, 2026-08-20):** mudanças Flutter **não geram APK por macrofrente** e **não bloqueiam** o roadmap. Cada macrofrente: implementa Flutter, roda `analyze`/`test`/`build` em CI quando aplicável, mantém compatibilidade e **registra aqui** as validações físicas pendentes. O APK oficial consolidado sai por **Codemagic** (`codemagic.yaml`, workflow `android-release` → `app-release.apk`, assinado com a chave debug, sem secret novo) num ponto de release definido pelo owner. **Não instalar Android SDK / não habilitar Windows Developer Mode / não validar aparelho fora do trem.** `DEFERRED ≠ DONE`.

| ID | Item mobile a validar no APK consolidado | Origem | Status |
|----|------------------------------------------|--------|--------|
| MOBILE-M1-001 | Realtime da **tela de detalhe do frete** (`detalhe_viagem_screen`) atualiza sozinho no aparelho (sem pull-to-refresh, sem reabrir, sem esperar o poll de 60s) | Onda 1 · E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-002 | Ciclo **web↔app** de lançamentos: criar no app → web sem refresh; aprovar/rejeitar/**cancelar** no web → app atualiza e cancelado permanece visível | Onda 1 · E1.2/E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |

_Itens mobile de macrofrentes futuras (ex.: enforcement de `freight.create`/`freight.finish` e visibilidade financeira do motorista da P2) entram nesta seção como `MOBILE-M1-NNN`._

### ONDA 2 — Fundação Frota
- **E2.1 fleet_assets + composições + membros** (RBV9-INV-033/034, D-001..D-003).
- **E2.2 Vínculo temporal motorista↔composição + handoff** (RBV9-INV-035/028, D-002).
- **E2.3 Snapshot de composição no frete + check-in/out** (RBV9-INV-026/027, D-011/D-012) — usa E1.5.
- **E2.4 Documentos de ativo + vencimentos** (RBV9-INV-036/048, D-013).
- **E2.5 Pneus** (RBV9-INV-038, D-005).
- **E2.6 Manutenção** (RBV9-INV-039).
- **E2.7 Ativar ORG_SCOPE com dados reais** (RBV9-INV-010..013) sob `OPERATIONAL_SCOPE_ENFORCEMENT_GATE`.
- **Dependências:** E2.1 é raiz de tudo. **Gate:** migração **aditiva** (nunca destrutiva); frete atual continua funcionando.

### ONDA 3 — Expansão
- **E3.1 Planejamento/aprovação de frete** (RBV9-INV-029, §7).
- **E3.2 Route Intelligence (provider abstraction)** (RBV9-INV-030, D-032).
- **E3.3 Dispatch (designação + oferta a elegíveis)** (RBV9-INV-031/032, D-033).
- **E3.4 Portal do Embarcador** (RBV9-INV-081, D-024).
- **E3.5 Rede privada de parceiros** (RBV9-INV-082, D-025/D-026).
- **E3.6 ERP Integration Hub + census de prospects** (RBV9-INV-085/086, D-023).
- **E3.7 Auditoria unificada + Envelope Digital** (RBV9-INV-088/089, D-021/D-022) + relatórios-alvo (RBV9-INV-091, D-029).
- **Dependências:** E3.1→E3.3; E3.4→E3.5. **Gate:** boundaries de tenant provados.

### ONDA 4 — Escala
- Marketplace público (RBV9-INV-083); automação avançada; SSO/Entra→SCIM/SAML (RBV9-INV-007/008); inteligência (custo/km, previsões da própria frota); **infra dedicada** sob `INFRA_MIGRATION_GATE` (D-028).

---

## Parte D — Track fiscal NFS-e (patch fiscal RBV9)

> Domínio `FISCAL_INVOICING` (D-036..D-041). Arquitetura-alvo (cadeia): **LEGAL_ENTITY → FISCAL_PROFILE → SAAS_BILLING_EVENT → FISCAL_OUTBOX → FISCAL_PROVIDER → DPS → NFSE → RECONCILE → XML/DANFSe → EMAIL/PORTAL**. A entidade jurídica desacopla também: payment provider account, fiscal provider, contratos, certificado e vigência (D-041). A adequação fiscal (CNAE/regime/contador) do owner corre **em paralelo** e **não bloqueia a Onda 1**.

| Fase | Descrição | Status |
|------|-----------|--------|
| **NFSE-0A** | Diagnóstico / documentos | **COMPLETE** (este patch) |
| **NFSE-0B** | CNAE / regime / contador | **EXTERNAL_BLOCKED** (owner, em paralelo) |
| **NFSE-1** | Arquitetura / provider abstraction (FISC-001..004) | **READY** |
| **NFSE-2** | DPS / outbox / reconcile (FISC-007..009, 016) | **READY** |
| **NFSE-3** | XML / PDF / e-mail / portal (FISC-005, 010..012) | **READY** |
| **NFSE-4** | Produção Restrita (FISC-014) | **FUTURE_GATE** (`FISCAL_LEGAL_ENTITY_GATE`) |
| **NFSE-5** | Primeira NFS-e real (FISC-015) | **COMMERCIAL/FISCAL_GATE** (`COMMERCIAL_PAID_GO_LIVE_GATE`) |

**Ordem de execução:** o track fiscal é independente da Onda 1. Pode iniciar NFSE-1..3 (arquitetura/código sem emissão real) a qualquer momento sem tocar produção; NFSE-4/5 ficam atrás dos gates. Certificado (FISC-006) = `CERTIFICATE_PURCHASE=DEFERRED`.

---

## Gates de decisão (resumo)

| Gate | Bloqueia | Libera com |
|------|----------|-----------|
| `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE` | cobrança real | autorização + allowlist única + runbook |
| `OPERATIONAL_SCOPE_ENFORCEMENT_GATE` | enforcement de escopo P1 | dados operacionais reais + validação |
| `INFRA_MIGRATION_GATE` | migração Hostinger | 1–3 pilotos + benchmark latência/custo/operação |
| `FISCAL_LEGAL_ENTITY_GATE` | emissão fiscal real (NFSE-4/5) | adequação CNAE/regime + alinhamento contábil |
| `COMMERCIAL_PAID_GO_LIVE_GATE` | go-live comercial pago | `FISCAL_LEGAL_ENTITY_GATE` + `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE` |

---

## Primeira macrofrente de implementação recomendada

**ONDA 1 · E1.1 Realtime + E1.2 Lançamentos audit-safe**, seguida de **E1.5 Permissões (templates+overrides)**.

**Por quê:** (1) baixo risco e alto valor percebido imediato; (2) realtime e permissões são **transversais** e destravam D-007/D-011 antes da Frota; (3) não dependem de nenhum domínio NEW; (4) preparam o terreno para a Onda 2 (check-in/out precisa de permissões `freight.create`/`freight.finish`). Frota (Onda 2) é a maior frente estrutural, mas deve vir **após** a fundação de permissões/realtime para não retrabalhar.

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
