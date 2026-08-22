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

### Direção estratégica V9 — automação verificável

Toda feature passa a ser avaliada também por **quanto trabalho humano evita**. O happy path deve ser automático ou guiado; atenção humana fica concentrada em exceções e decisões. Matopiba evolui em quatro níveis: **SYSTEM_OF_RECORD → SYSTEM_OF_CONTROL → SYSTEM_OF_ACTION → SYSTEM_OF_INTELLIGENCE**. A camada horizontal `E1.5_VERIFIABILITY_DIAGNOSTICS_RECOVERY_FOUNDATION` prepara essa evolução sem entregar autonomia opaca: correlação, evidência, invariantes, verifier, findings, dry-run e playbooks vêm antes de AI Agent Platform, Operation Campaign, Operation Orchestrator e modo assistido voice/multimodal.

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
- **E1.3 Separação financeira** (RBV9-INV-055, D-035): ✅ **CLOSED em produção** — PR #441 mergeado (`MERGE_SHA=b69510230a03d9d5dd6a4d1d71cbf5c1b64802b2`) após P2; backend Railway `de93df0c-8524-4a50-8be1-5bfb7130bcc3` **SUCCESS** (`commitHash=b695102`, `numReplicas=1`) e frontend GitHub Pages publicado no mesmo SHA. Auditoria congelada: backend operacional **já não toca** tabelas SaaS (separado no nível de service); regra "quais fretes contam" **já centralizada** (`agregacaoFinanceiraFretes`, receita realizada = só `finalizado`). **Backend boundary = DONE:** fonte ÚNICA das regras de **status de lançamento** (`STATUS_LANCAMENTO_EFETIVADO` = aprovado/finalizado; `STATUS_LANCAMENTO_NAO_COMPOE` = cancelado/rejeitado) no helper canônico, eliminando literais repetidos em dashboard/relatórios/rentabilidade/acerto (zero mudança de comportamento; testes de equivalência). **Web boundary = DONE (F-04):** `Dashboard.tsx` operacional não renderiza KPIs **SaaS** super-admin; MRR/trial/inadimplência permanecem em `PainelVisaoGeral` (`/painel-administrativo/visao-geral`, `SuperAdminRoute`) com a mesma fonte `/painel-admin/empresas` e regra histórica de inadimplência (`suspenso`/`bloqueado`/`expirado`). Validação: backend `1631/1631`, web `116/116`, `tsc -b && vite build`, CI main verde (Backend, Frontend, SEC-1, GitHub Pages), health 200, smokes anon 401, logs 5xx novos vazios. Estado: `E13_IMPLEMENTED_IN_PR=true`; `E13_DEPLOYED=true`; `E13_PRODUCTION_VALIDATED=true`. Ver [E1.3_SEPARACAO_FINANCEIRA](./E1.3_SEPARACAO_FINANCEIRA.md).
- **E1.4 Scanner + viewer PDF-first** (RBV9-INV-044/047, D-016): **E1.4A CLOSED em producao** — PR #444 mergeado (`MERGE_SHA=1744d59bfd6e731452e85fbb01d3c2daa482a6a9`), migration 073 aplicada+rastreada (`20260822041647 073_documents_foundation_security_web`, SHA256 `7368bcd80009f1a21b42170d56d99f976dbca3a7aa0534ecb4d14c3f0e7dde91`), backend Railway `96453b4b-5052-43bd-be22-ec1ab4afd078` SUCCESS (`commitHash=1744d59`, `numReplicas=1`) e frontend GitHub Pages publicado no mesmo SHA. **E1.4B CODE CLOSED**: PR #446 mergeado (`MERGE_SHA=a00545770e88c6d13d7d6158b66077e973ba89d8`) com viewer interno PDF/imagem antes de salvar/compartilhar/abrir fora, scanner on-device multipagina, reorder/remove/retake, PDF local, `client_request_id` estavel para retry em documentos/ePOD e contrato v2 de `outro` consumido pelo app. Sem migration 074, sem escrita de producao, sem APK e sem mudanca de storage/policy. `E14_OVERALL_TECHNICAL_IMPLEMENTATION=CLOSED`; device validation permanece no `MOBILE_RELEASE_TRAIN_M1`. Ver [E1.4A_DOCUMENTS_FOUNDATION_SECURITY_WEB](./E1.4A_DOCUMENTS_FOUNDATION_SECURITY_WEB.md) e [E1.4B_MOBILE_DOCUMENT_EXPERIENCE](./E1.4B_MOBILE_DOCUMENT_EXPERIENCE.md).
- **P2 Permissões templates+overrides** (RBV9-INV-018/019/020, D-006/D-008/D-010) — ✅ **CLOSED técnico**: migration **072 aplicada+rastreada** em produção (`20260821043352`), backend **e718eb3** implantado no Railway após billing resolvido, frontend **e718eb3** publicado, health 200, smokes anon 401, logs sem erro novo, sanity de templates/governança sem drift inesperado. Templates por empresa + overrides individuais + visibility policy do motorista; resolver único; RPCs guardadas de governança; API `/admin/permissions/*`; web "Perfis e Permissões"; app gate por efetivo. `freight.create`/`freight.finish` e financeiro atribuível separados; redação financeira no backend. Validação física do app: `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`.
- **E1.5 Verifiability, Diagnostics & Recovery Foundation** (RBV9-INV-087/088/109, D-044..D-054): ✅ **E1.5A CLOSED em produção** — PR #447 mergeado (`MERGE_SHA=3cda272ec49154d77d62eed95976fef18bbd24f0`), backend Railway `079a7600-e7b5-463e-aa15-e895486f89f1` **SUCCESS** (`commitHash=3cda272`, `numReplicas=1`) e GitHub Pages publicado no mesmo SHA. Fundação horizontal sem IA/autonomia: contexto canônico de correlação (`request_id`, `correlation_id`, `operation_id`, `causation_id`), envelope sanitizado de evento/evidência, registry de invariantes, verifier, findings estruturados, playbooks com `execute=DISABLED_BY_POLICY`, dry-run e primeira superfície read-only Super Admin (`/admin/diagnostics`). Validação: backend `1656/1656`, web `116/116`, `tsc -b && vite build`, CI `main` verde (Backend, SEC-1, GitHub Pages), health 200, smokes anon 401, logs 5xx novos vazios. Sem migration 074, sem persistência nova de findings/runs, sem repair production.
- **E1.6 Paridade painel↔app** (RBV9-INV-054, D-020): ✅ **entregue** (abastecimento: arla/odômetro/preço-litro/observação; observação obrigatória no create web+app). UX/máscaras/sidebar (RBV9-INV-098/099) seguem pendentes.
- **E1.7 Hotfix + release do app** (PR #437, `MERGE_SHA=569fde7`): ✅ **DEPLOYADO** — **migration 071 aplicada+rastreada** (`20260820040645`, CHECK de `status` aceita `cancelado` → corrige 500 no cancelamento; aditiva/idempotente, reconciliada com o repo, SHA256 `e6f3b7a4…d623fe`) + **SSE na tela de detalhe do frete no app** (`detalhe_viagem_screen`). Desvio de processo registrado (**PROCESS-001**, `CLOSED_WITH_CORRECTIVE_ACTION`). **Artefato do app preparado** (mesmo pipeline: `flutter build apk --release` assinado com chave debug, sem secret novo).
- **Dependências:** E1.5 Verifiability antes da Onda 2 pesada. **Estado:** Onda 1 (E1.1/E1.2/E1.3/E1.6 + E1.6A + E1.7) **DEPLOYADA em produção e tecnicamente CLOSED** (PR #435 `f43f009` + hotfix PR #437 `MERGE_SHA=569fde7` + PR #441 `MERGE_SHA=b695102` + PR #444 `MERGE_SHA=1744d59`, migrations 070+071+072+073 aplicadas/rastreadas conforme seus gates, CI verde, sem regressão). `ONDA1_TECHNICAL_STATUS=CLOSED`; `ONDA1_APP_DEVICE_VALIDATION=DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` (itens `MOBILE-M1-001/002`; **não bloqueia** o roadmap). **P2 = `CLOSED`; E1.4A = `CLOSED`; E1.4B = `CODE_CLOSED`; E1.5A = `CLOSED_IN_PRODUCTION`**. Próxima macrofrente autorizada: `ONDA2_FLEET_FOUNDATION`.

### MOBILE_RELEASE_TRAIN_M1 _(trem de release do app — transversal)_

> **Política (owner, 2026-08-20):** mudanças Flutter **não geram APK por macrofrente** e **não bloqueiam** o roadmap. Cada macrofrente: implementa Flutter, roda `analyze`/`test`/`build` em CI quando aplicável, mantém compatibilidade e **registra aqui** as validações físicas pendentes. O APK oficial consolidado sai por **Codemagic** (`codemagic.yaml`, workflow `android-release` → `app-release.apk`, assinado com a chave debug, sem secret novo) num ponto de release definido pelo owner. **Não instalar Android SDK / não habilitar Windows Developer Mode / não validar aparelho fora do trem.** `DEFERRED ≠ DONE`.

| ID | Item mobile a validar no APK consolidado | Origem | Status |
|----|------------------------------------------|--------|--------|
| MOBILE-M1-001 | Realtime da **tela de detalhe do frete** (`detalhe_viagem_screen`) atualiza sozinho no aparelho (sem pull-to-refresh, sem reabrir, sem esperar o poll de 60s) | Onda 1 · E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-002 | Ciclo **web↔app** de lançamentos: criar no app → web sem refresh; aprovar/rejeitar/**cancelar** no web → app atualiza e cancelado permanece visível | Onda 1 · E1.2/E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-003 | Enforcement de permissões V9 no app: `freight.finish`, visibilidade financeira do motorista e refresh de perfil/override após novo login | P2 · E1.5 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-004 | Viewer interno de documentos PDF/imagem antes de salvar/compartilhar/abrir externamente | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-005 | Scanner on-device multipagina com review, reorder, remove, retake e geração de PDF local | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-006 | Upload de documentos/ePOD com `client_request_id` estável, retry seguro e replay idempotente | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-007 | Fluxo preview-first com ações secundárias de salvar/compartilhar/abrir fora após prévia | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-008 | App Version Policy e in-app update: latest/recommended/minimum version, severity, release notes, update oficial Play (`flexible`/`immediate`) | E1.5/D-053 | `ROADMAP_NOT_IMPLEMENTED` |

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
- **E3.0 Operation Campaign / Escoamento Assistido** — unidade de planejamento de escoamento sobre múltiplos fretes; depende de E1.5 + FLEET.
- **E3.1 Operation Orchestrator** — orquestrador determinístico separado de IA; propõe ações sobre Campaign/Freight Planning com invariantes verificáveis.
- **E3.2 Planejamento/aprovação de frete** (RBV9-INV-029, §7).
- **E3.3 Route Intelligence (provider abstraction)** (RBV9-INV-030, D-032).
- **E3.4 Dispatch (designação + oferta a elegíveis)** (RBV9-INV-031/032, D-033).
- **E3.5 Portal do Embarcador** (RBV9-INV-081, D-024).
- **E3.6 Rede privada de parceiros** (RBV9-INV-082, D-025/D-026).
- **E3.7 ERP Integration Hub + census de prospects** (RBV9-INV-085/086, D-023).
- **E3.8 Auditoria unificada + Envelope Digital** (RBV9-INV-088/089, D-021/D-022) + relatórios-alvo (RBV9-INV-091, D-029).
- **Dependências:** E3.0→E3.4; E3.5→E3.6. **Gate:** boundaries de tenant provados.

### ONDA 4 — Escala
- Marketplace público (RBV9-INV-083); AI Agent progressivo (**AI-0** tools/provider foundation → **AI-1** read-only/copilot → **AI-2** drafts → **AI-3** confirmed actions → **AI-4** limited supervised autonomy); modo assistido voice/multimodal; SSO/Entra→SCIM/SAML (RBV9-INV-007/008); inteligência (custo/km, previsões da própria frota); **infra dedicada** sob `INFRA_MIGRATION_GATE` (D-028).

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

**E1.5 Verifiability, Diagnostics & Recovery Foundation**, antes da expansão pesada da Onda 2.

**Por quê:** (1) verificabilidade é transversal e reduz retrabalho antes de FLEET/Operation Campaign/Dispatch; (2) automações futuras precisam explicar `what/why/evidence/result`; (3) repair e IA futura só podem avançar sobre tools determinísticas, dry-run e política de risco; (4) a fundação atual é read-only e não exige migration/produção.

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
