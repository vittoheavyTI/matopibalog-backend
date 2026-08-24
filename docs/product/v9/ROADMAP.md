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
| **FLEET** | Ativos, composições, documentos de ativo, odômetro, pneus, manutenção | ORG_SCOPE | **FLEET technical closure CLOSED em produção; owner visual validation pendente** |
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
| Frota/Veículos/Composições/Pneus/Manutenção | **REUSE_AS_IS** | Baixo | ORG_SCOPE |
| Planejamento/Operation Campaign/Route Intelligence/Dispatch | **NEW** | — | FLEET + Verifiability |
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

> **Estado técnico atual (2026-08-23):** Mobile M1 foi mergeado no PR #458 (`MERGE_SHA=a257e0f6b50e1d7d9f6f64113df768cdc6f7339f`) e está `MOBILE_M1_TECHNICAL_STATUS=CLOSED`. As validações físicas/listagem Play permanecem deferidas ao owner/trem de publicação, sem reabrir o fechamento técnico.

| ID | Item mobile a validar no APK consolidado | Origem | Status |
|----|------------------------------------------|--------|--------|
| MOBILE-M1-001 | Realtime da **tela de detalhe do frete** (`detalhe_viagem_screen`) atualiza sozinho no aparelho (sem pull-to-refresh, sem reabrir, sem esperar o poll de 60s) | Onda 1 · E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-002 | Ciclo **web↔app** de lançamentos: criar no app → web sem refresh; aprovar/rejeitar/**cancelar** no web → app atualiza e cancelado permanece visível | Onda 1 · E1.2/E1.7 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-003 | Enforcement de permissões V9 no app: `freight.finish`, visibilidade financeira do motorista e refresh de perfil/override após novo login | P2 · E1.5 | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-004 | Viewer interno de documentos PDF/imagem antes de salvar/compartilhar/abrir externamente | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-005 | Scanner on-device multipagina com review, reorder, remove, retake e geração de PDF local | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-006 | Upload de documentos/ePOD com `client_request_id` estável, retry seguro e replay idempotente | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-007 | Fluxo preview-first com ações secundárias de salvar/compartilhar/abrir fora após prévia | E1.4B | `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` |
| MOBILE-M1-008 | App Version Policy e in-app update: latest/recommended/minimum version, severity, release notes, update oficial Play (`flexible`/`immediate`) | E1.5/D-053 | `TECHNICAL_CLOSED_PR_458_PLAY_PUBLICATION_DEFERRED` |

_Itens mobile de macrofrentes futuras (ex.: enforcement de `freight.create`/`freight.finish` e visibilidade financeira do motorista da P2) entram nesta seção como `MOBILE-M1-NNN`._

### ONDA 2 — Fundação Frota
- **FLEET-A Domain/Foundation**: ✅ **CLOSED em produção** — migration 074 aplicada uma vez via `apply_migration` e rastreada (`20260822142407 074_fleet_foundation`, SHA256 `a01ab82c7f7db1b2bb9eebb24db367b02a2d0aa1545f0259f065a110ea1cfec3`), PR #449 mergeado (`MERGE_SHA=d682d4ed958929d46cbd556a118d71fa5c04c2bc`) e backend Railway `e2615ac7-4cdb-498e-ba5f-de8f64300a83` SUCCESS (`commitHash=d682d4ed958929d46cbd556a118d71fa5c04c2bc`, `numReplicas=1`). Cria ativos, composições, vínculos temporais, documentos de ativo, odômetro, pneus e manutenção; backend expõe API core `/fleet/*` com `ENTITLEMENT AND PERMISSION AND SCOPE`; legado de `fretes` preservado sem backfill. Smokes read-only: `/health` 200, `/fleet/assets` 401 sem auth, `/fleet/compositions` 401 sem auth. Ver [ONDA2_FLEET_FOUNDATION](./ONDA2_FLEET_FOUNDATION.md).
- **FLEET-B Operational Experience / Final Technical Closure**: ✅ **CLOSED em produção** — migration 075 aplicada via `apply_migration` com `VERIFIED_SOURCE_TEXT_TRANSFER` do blob autorizado (`20260823012050 075_fleet_operational_closure`, SHA256 `6ae16676e6b67142ca0faaa78b92d65a512c67966b5ed35448148189bdf078fc`), após primeira tentativa falhar por divergência de payload (`TTEXT`) sem efeito parcial. PR #453 mergeado (`MERGE_SHA=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`), backend Railway `ee860618-4307-4e5a-8d61-7a12862f5e2d` SUCCESS (`commitHash=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`, `numReplicas=1`) e GitHub Pages no mesmo SHA. Web `/frota` protegido por `fleet.view`, ações por `fleet.manage`, asset document upload/preview via bucket privado `fretes-documentos`, handoff temporal via RPC `fleet_driver_handoff` service-role-only e pneus com escopo de unidade operacional. Validação: backend `1669/1669`, web `118/118`, PG `163/163`, CI main verde, `/health` 200, `/fleet/assets` 401 sem auth, logs novos sem erro. `OWNER_VISUAL_VALIDATION=PENDING`.
- **E2.1 fleet_assets + composições + membros** (RBV9-INV-033/034, D-001..D-003): foundation coberta por FLEET-A em produção; primeira UX operacional coberta por Fleet-B.
- **E2.2 Vínculo temporal motorista↔composição + handoff** (RBV9-INV-035/028, D-002): vínculo motorista↔ativo/composição coberto por FLEET-A, exposto em Fleet-B e fechado tecnicamente em produção com `fleet_driver_handoff`; snapshot/check-in/out formal do frete fica em E2.3.
- **E2.3 Snapshot de composição no frete + check-in/out** (RBV9-INV-026/027, D-011/D-012): `freight_vehicle_assignments` coberto por FLEET-A; visibilidade operacional inicial em Fleet-B; check-in/out formal fica posterior.
- **E2.4 Documentos de ativo + vencimentos** (RBV9-INV-036/048, D-013): `asset_documents` fechado tecnicamente com contrato versionado, upload real para bucket privado `fretes-documentos`, signed preview e alertas; cancelamento/substituição audit-safe fica diferido.
- **E2.5 Pneus** (RBV9-INV-038, D-005): fundação + experiência operacional fechadas tecnicamente; `tires.unidade_operacional_id` aplicado, backfill esperado/real `0/0`, estoque por unidade e instalação preservados. Analytics/custo por km/alertas avançados posteriores.
- **E2.6 Manutenção** (RBV9-INV-039): fundação de eventos coberta por FLEET-A; Fleet-B registra e lista preventiva/corretiva no painel operacional. Experiência avançada de oficina fica posterior.
- **E2.7 Ativar ORG_SCOPE com dados reais** (RBV9-INV-010..013) sob `OPERATIONAL_SCOPE_ENFORCEMENT_GATE`.
- **Dependências:** E2.1 é raiz de tudo. **Gate:** migração **aditiva** (nunca destrutiva); frete atual continua funcionando.

### ONDA 3 — Expansão
- **E3.0 Operation Campaign / Operação de Escoamento** — ✅ **Campaign-A CLOSED técnico em produção**: PR #457 mergeado (`FINAL_HEAD=45079e8151cde514bc4577dccb656c14419df35e`, `MERGE_SHA=32d8fe3e8824d1a8bc5be89ad6f5cdf86ae5c316`) após reconciliação com `main`; Railway deploy `5c858732-f34e-443c-b6b7-68306331e852` SUCCESS no mesmo SHA e GitHub Pages/main CI verdes. Migration 076 aplicada/rastreada exatamente uma vez (`20260823111859 076_operation_campaign_foundation`, SHA256 `C7CA4533B9A26B5CCDB04EA9C9913B986432ECC17E8D76D07F302F21C3EFCD94`). Migration 077 aplicada/verificada exatamente uma vez (`20260823220632 077_operation_campaign_076_payload_reconciliation`, SHA256 `11C5D07AC4A2E03DBCA738945C5CF37EEB73370738E4C7B06ADEA8B7025AB5E1`) reconciliou somente `campaign_exceptions_plan_campaign_fk` para o FK canônico `(plan_version_id, campaign_id, empresa_id)`. Escopo Campaign-A encerra em `APPROVED_PLAN`; `CAMPAIGN_A_FREIGHT_WRITES=0`; sem dispatch, sem materialização de fretes e sem mapping comercial.
- **E3.0B Operation Campaign-B / Materialization linkage** — ✅ **CLOSED em produção (takeover Claude 2026-08-24)**: PR #464 mergeado (`FINAL_HEAD=32c447352c59b61d3ff99bb37ef338305b7582b4`, `MERGE_SHA=139105d523e9023b616f340a40d6697d7b0e4444`) após reconciliação com main (`27e48e5`, único drift = #465 Command Center, zero overlap). Migration **078 aplicada/rastreada exatamente uma vez** (`20260824013400 078_operation_campaign_materialization`, SHA256 `5DEA792CA98FE28D8A68320F80BCB92A93B240360F9A552A2F261993193543DB`): cria `campaign_trip_freights` (vínculo plano aprovado→frete canônico), 1 tabela + 5 índices + 4 FKs compostas tenant-safe + RLS/grants canônicos, `PRODUCTION_BUSINESS_WRITES=0`. Materialização reusa o criador canônico de fretes (`freightCreationService`, paridade preservada + notificação no controller), idempotência por UUID determinístico/planned_trip + replay, revalidação de escopo/tenant/motorista/recurso/assignment, rota `materialize` sob `entitlement operation_campaign ∧ campaign.manage ∧ scope ∧ tenant-servidor`. Sem dispatch. CI 8/8 verde (inclui PG 076→077→078 real). Security reviews: RLS_GRANTS_SAFE_AS_DESIGNED, INTERNAL_ROLE_ADAPTER_SAFE, FREIGHT_CREATE_PARITY_PASS, CRASH_WINDOW_RECONCILABLE. `DISPATCH_IMPLEMENTED=false`. Owner visual validation pendente.
- **E3.0C Operation Campaign-C / Operational progress + dispatch readiness** — ✅ **CLOSED em produção**: PR #469 mergeado (`FINAL_HEAD=e9aab06`, `MERGE_SHA=95fcded985470d059519008562a99fdb8dac3fd1`), sem drift contra `main` (base = HEAD, 0 commits atrás). Sem migration, `SCHEMA_CHANGES=0`. `campaignProgressService` projeta progresso read-only (trips/quantidade em toneladas/saúde/exceções/replanejamento) a partir do plano aprovado + `campaign_trip_freights` + status canônico do Frete, com mapeamento CONGELADO Frete→bucket de execução (`freightExecutionStatus.js`: status desconhecido nunca vira `IN_EXECUTION`/`COMPLETED`, sempre `UNKNOWN`) e sem dupla contagem (cada viagem cai em exatamente 1 bucket). `dispatchEligibilityService` — motor determinístico de elegibilidade por viagem planejada, espelhando os bloqueios da materialização canônica; capacidade só compara quando ambos os lados são conhecidos; documentos/manutenção só avisam; **compatibilidade de rota sempre `UNKNOWN`** (Route Intelligence V1 sem restrição de caminhão); sem score mágico; bounded/sem N+1. Novas rotas `GET .../progress` (`campaign.view`) e `GET .../eligibility` (`campaign.manage`). Torre de Controle ganha `campaign_attention` (reusa a mesma autoridade, capability-gated `can_view_campaign`, nunca expõe financeiro, defensivo). Sinal realtime best-effort (`freightRealtimeSignal.js`, reusa o SSE bus existente) ao finalizar/cancelar frete. Tool de IA `operation.campaign.progress` read-only (sem PII, sem financeiro, sempre com evidência). Web: seção "Execução da campanha" em `OperationCampaigns.tsx` (cards de progresso, banner de replanejamento, tabela de viagens, drawer de elegibilidade), reusando o hook SSE existente com refresh debounced + polling de 60s como fallback; deep link do frete usa o contrato `?frete=<id>` já estabelecido. Validação: backend `1793/1793` (0 fail, inclui 46 novas suítes deste PR), web `26/26` arquivos / `135/135` testes (0 fail, rodado 2x completo para confirmar estabilidade sob paralelismo), build `tsc -b && vite build` sem erros, CI 3/3 verde (Backend/Frontend/SEC-1), deploy Railway `585549fa-5d3d-4e70-899a-4b3727d753a4` SUCCESS + GitHub Pages no mesmo SHA, `/health` 200, `/operation-campaigns/:id/progress` e `/eligibility` 401 sem auth, Torre 401 sem auth, `/ai/chat` 401 sem auth, logs sem erro novo. `CAMPAIGN_PROGRESS=DONE`; `DISPATCH_READINESS=DONE`; `REAL_DISPATCH_IMPLEMENTED=false`; `OFFER_SYSTEM_IMPLEMENTED=false`; `PRODUCTION_BUSINESS_WRITES=0`; `AI_WRITE_TOOLS=0`. Benchmark formal 10/100/500 viagens **não medido** (sem harness de carga disponível nesta sessão) — evidência estrutural: contagem de query é O(1) em relação a N (batch via `.in()`, sem loop por viagem). Owner visual validation pendente. Ver [CAMPAIGN_C_OPERATIONAL_PROGRESS](./CAMPAIGN_C_OPERATIONAL_PROGRESS.md).
- **E3.0A Systemic Quality / Reports + Performance** — ✅ **CLOSED em produção**: PR #459 mergeado (`MERGE_SHA=35b840281a711bc2a0264358662e548cc6ecc1fa`) corrigiu agregação limite-safe em relatórios (`rentabilidade` filtra cancelados antes do limite; `acerto-motoristas` busca finalizados antes do limite). Sem migration, sem Campaign, sem Flutter. Railway deploy `f81f64f0-2809-4619-82e3-1d833b33b697` SUCCESS; main CI Backend/SEC-1/GitHub Pages verde; `/health` 200.
- **E3.1 Operation Orchestrator** — arquitetura congelada como orquestrador determinístico, separado de IA; pipeline `OBJECTIVE → NORMALIZE → VALIDATE → RESOURCE_SNAPSHOT → CAPACITY_PLAN → TRIP_PLAN → SCENARIOS → HUMAN_APPROVAL → DISPATCH_READY → FREIGHT_MATERIALIZATION → EXECUTION → VERIFY → REPLAN/EXCEPTIONS`.
- **E3.2 Planejamento/aprovação de frete** (RBV9-INV-029, §7): passa pelo plano Campaign antes de materializar fretes; approval por `campaign.approve`, não role hardcoded.
- **E3.3 Route Intelligence V1 (provider abstraction)** (RBV9-INV-030, D-032) — ✅ **CLOSED em produção (2026-08-24)**: PR #467 mergeado (`MERGE_SHA=0fcf9a66fe286a7f4b80dc20878324bab532d8ce`). `RouteProviderGateway` provider-agnostic (`ROUTE_PROVIDER_MODE` default **disabled**/manual-safe; `fake` p/ testes; adapter HTTP OSRM-compatível pronto sem key/ativação), estimativa read-only (distância/duração/pedágio + combustível/custo input-dependentes; `unknown≠zero`; restrição de caminhão `UNAVAILABLE` em V1), fallback manual, `POST /route-intelligence/estimate` + capabilities sob auth+tenant+`freight.view` (frete-context sem IDOR), tool IA `route.estimate` (provider inalterado/inerte) e página web `/rota`. Sem schema, sem secret, sem provider real, sem env change, 0 chamadas externas em produção. Google/TomTom/tráfego/cache persistente/overwrite de KM/integração Campaign planned-trip ficam deferidos.
- **E3.4 Dispatch (designação + oferta a elegíveis)** (RBV9-INV-031/032, D-033): Campaign decide necessidade; Dispatch decide executor. **Elegibilidade (RBV9-INV-032) e prontidão (`dispatch readiness`) entregues pelo Campaign-C** (leitura determinística — quem está elegível agora, sem ofertar/designar). Oferta/aceite concorrência-safe (RBV9-INV-031, designação/oferta real) permanece ROADMAP.
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

## Próxima macrofrente de implementação recomendada

**Próximo passo recomendado:** Campaign-B materialization (078) e Campaign-C progress/dispatch readiness **fechados**. Falta, como próxima fatia deliberada: **Dispatch real** (RBV9-INV-031 — designação/oferta/aceite concorrência-safe), que exige decisão de produto própria (Uber-like vs. designação direta) **e nova migration + owner gate** — não é um passo schema-free como as fatias anteriores. Frente concluída em paralelo: `ROUTE_INTELLIGENCE_V1` (provider-agnostic, sem schema/secret/provider real).

**Por quê:** (1) Campaign-A fechou o domínio, planner, versionamento, aprovação, permissões, escopo e web inicial; (2) Campaign-B fechou a ponte plano→frete (materialização idempotente); (3) Campaign-C fechou a leitura de progresso e elegibilidade determinística, base necessária para qualquer decisão de dispatch; (4) o próximo risco real passa a ser de **produto e escrita** (quem decide o executor, como trava concorrência, o que acontece se ninguém aceitar) — por isso exige gate do owner antes de código, diferente das fatias read-only anteriores.

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md) · [PARALLEL_EXECUTION_BOARD](./PARALLEL_EXECUTION_BOARD.md)_
