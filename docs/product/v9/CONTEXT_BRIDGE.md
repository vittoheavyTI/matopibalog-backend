# Matopiba Log — CONTEXT BRIDGE V9

> **Handoff compacto.** Leia este arquivo primeiro ao retomar em outro chat/agente. Os detalhes estão nos 4 documentos linkados no fim.
> Atualizado: **2026-08-22** (E1.5A closed em produção + Fleet-A em PR aguardando migration gate).

---

## O que é

**Matopiba Log** — SaaS de gestão de transportadoras (transportadoras, fazendas com frota própria, caminhoneiros autônomos). Monorepo `vittoheavyTI/matopibalog-backend`:
- **Backend:** Node.js + Express (`backend/`) — Railway
- **Web:** React 19 + Vite + Tailwind 4 (`painel_web/`) — GitHub Pages
- **App:** Flutter (`app_android/`)
- **Banco/Auth:** Supabase PostgreSQL 17

## Estado atual (verificado)

| | |
|---|---|
| `origin/main` | **`9d65a85`** (docs close E1.5A pós-deploy). Marcos anteriores: `3cda272` (PR #447 / E1.5A), `a005457` (PR #446 / E1.4B), `1744d59` (PR #444 / E1.4A), `b695102` (PR #441 / E1.3), `d9e0c30` (PR #442 / close P2 pós-Railway), `e718eb3` (PR #440 / P2), `569fde7` (PR #437 / hotfix Onda 1). |
| Deploy produção | Railway `matopibalog-backend` deploy `079a7600-e7b5-463e-aa15-e895486f89f1` **SUCCESS** (`commitHash=3cda272`, `numReplicas=1`) |
| Health | **HTTP 200** `{"status":"UP"}` em `https://api.matopibalog.com.br/health` |
| Banco | Supabase `rjahjogidyndphdxevom` · 69 tabelas públicas · RLS 100% |
| Asaas | **DESARMADO**: sem `ASAAS_API_KEY`, provider=fake, production=false, allowlist vazia, outbox=false, `billing_outbox`=0. **Não reativar sem autorização.** |
| Crons | 3 (faturas mensal, expirarTrials dry-run, inadimplência dry-run) — todos SUCCESS/inertes |

## Direção do produto (congelada em DECISIONS.md)

Matopiba vira **frota/operação-centric** (D-001): o eixo é o **veículo/composição** (D-002/D-003), motorista tem **vínculo temporal**. Toda feature passa a ser avaliada também por **quanto trabalho humano evita**; happy path deve ser automático/guiado e atenção humana fica nas exceções. Frota/pneus/manutenção, Operation Campaign, Operation Orchestrator, planejamento+dispatch, Route Intelligence, Portal do Embarcador, rede de parceiros, ERP Integration Hub, AI Provider Gateway, modo assistido voice/multimodal e SSO/Entra ID são a expansão. Realtime, verificabilidade e performance são requisitos **sistêmicos**. Financeiro operacional do cliente é **separado** do financeiro SaaS. Nenhum backlog desaparece (`DEFERRED ≠ DONE`).

## O que existe vs o que é novo (resumo)

- **Maduro/vivo (REUSE_AS_IS):** auth/SEC-1, entitlements por plano, SaaS billing/Asaas/contratos/promoções, ePOD/ocorrências, rastreamento leve, notificações/push, relatórios PDF com branding.
- **Refatorar/ativar:** lançamentos (audit-safe + realtime), separação financeira, ORG_SCOPE (grupos/filiais existem mas **inertes, 0 dados**), permissões (templates+overrides), auditoria unificada.
- **NEW (0 no banco):** **Frota/Veículos/Composições/Pneus/Manutenção**, Planejamento/Dispatch, Route Intelligence, Embarcador/Parceiros/Marketplace, ERP Hub, SSO/Entra.

## Macrofrente atual

**`CURRENT_MACROFRONT = ONDA2_FLEET_FOUNDATION`**. P2 = CLOSED; E1.3 = CLOSED em produção; E1.4A = CLOSED em produção; **E1.4B = CODE CLOSED** no PR #446 (`MERGE_SHA=a00545770e88c6d13d7d6158b66077e973ba89d8`); **E1.5A = CLOSED em produção** no PR #447 (`MERGE_SHA=3cda272ec49154d77d62eed95976fef18bbd24f0`). Onda 1 = tecnicamente CLOSED (ver §Estado da Onda 1); validação de aparelho no `MOBILE_RELEASE_TRAIN_M1`.

**P2 — Permissões (templates+overrides) CLOSED técnico.** Migration **072** (aditiva/idempotente, hash `4069b0e0…46ce5`) foi **aplicada+rastreada em produção** (`20260821043352`) e o backend **e718eb36103de1aea233e2a868cf37b7b4f51e38** foi implantado no Railway após regularização do billing (`DEPLOYMENT=987c7a52-b240-4bd4-a855-24318ba8c72b`, `SUCCESS`, `numReplicas=1`, health 200). Frontend P2 no GitHub Pages também está em `e718eb3`. Pós-deploy read-only: `/health` 200; `/auth/me`, `/admin/permissions/templates` e `/realtime/stream` sem auth retornam 401; logs novos sem 500/uncaught/unhandled/permission/RLS inesperado. Sanity P2: templates provisionados sem `stable_key` duplicada por empresa; usuários ativos com `permission_template_id`; governança efetiva preservada no recorte operacional; Asaas permaneceu inerte (`ASAAS_API_KEY` ausente, allowlist vazia, outbox off). App: código P2 pronto, mas **validação física = `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`** (**DEFERRED ≠ PASS**). `P2_TECHNICAL_STATUS=CLOSED`.

**E1.3 — Separação financeira operacional x SaaS CLOSED.** PR #441 foi mergeado (`MERGE_SHA=b69510230a03d9d5dd6a4d1d71cbf5c1b64802b2`) e deployado em produção no Railway (`DEPLOYMENT=de93df0c-8524-4a50-8be1-5bfb7130bcc3`, `SUCCESS`, `numReplicas=1`) e no GitHub Pages (`Deploy to GitHub Pages` success no mesmo SHA). Validação: Backend CI, Frontend CI e SEC-1 Browser E2E verdes em PR e `main`; backend local `1631/1631`; web local `116/116` + `tsc -b && vite build`; health 200; `/auth/me`, `/admin/permissions/templates` e `/realtime/stream` sem auth retornam 401; logs HTTP 5xx novos vazios. Boundary D-035: `Dashboard.tsx` operacional não renderiza KPIs SaaS nem busca `/painel-admin/empresas`; MRR/trial/inadimplência ficam em `PainelVisaoGeral` (`/painel-administrativo/visao-geral`, `SuperAdminRoute`) com a mesma fonte e regra histórica `suspenso`/`bloqueado`/`expirado`. `E13_IMPLEMENTED_IN_PR=true`; `E13_DEPLOYED=true`; `E13_PRODUCTION_VALIDATED=true`.

**E1.4A — Documents foundation/security/web CLOSED.** OWNER MIGRATION GATE executado em 2026-08-22: migration 073 aplicada uma vez via `apply_migration` apos hash autorizado `7368bcd80009f1a21b42170d56d99f976dbca3a7aa0534ecb4d14c3f0e7dde91`, tracking confirmado (`20260822041647 073_documents_foundation_security_web`), counts preservados (`frete_documentos 16->16`, `frete_epod_evidencias 10->10`, `frete_ocorrencia_evidencias 0->0`, novas tabelas 0). PR #444 mergeado (`MERGE_SHA=1744d59bfd6e731452e85fbb01d3c2daa482a6a9`); Railway deploy `96453b4b-5052-43bd-be22-ec1ab4afd078` SUCCESS (`numReplicas=1`, healthcheck `/health`), GitHub Pages publicado no mesmo SHA, main checks verdes. Entrega: contrato v2 para `outro`, idempotencia via `client_request_id`, auditoria upload/cancel, fundacao de participantes com RLS e preview web PDF/imagem via signed URL curta. `comprovantes` legado permaneceu publico/intocado; sem backfill/storage write/env/Asaas. `E14A_TECHNICAL_STATUS=CLOSED`; `E14_OVERALL_STATUS=OPEN_E1.4B_PENDING`; app/device validation fica no `MOBILE_RELEASE_TRAIN_M1`.

**E1.4B — Mobile document experience CODE CLOSED.** PR #446 mergeado em `main` (`MERGE_SHA=a00545770e88c6d13d7d6158b66077e973ba89d8`); checks de `main` verdes para Flutter CI, App CI Flutter Android e GitHub Pages. Entrega mobile sobre a foundation 073: viewer interno PDF/imagem no app, signed URL curta com refresh em expiração, temp file isolado/cleanup de antigos, scanner on-device multipagina, review com reorder/remove/retake, PDF local, contrato v2 de `outro` na UI e upload idempotente/resiliente com `client_request_id` estável em documentos/ePOD. Sem backend schema change, sem migration 074, sem Storage direto pelo app, sem Asaas, sem APK/Play Store. `RECIPIENT_SIGNER_UI=DEFERRED_FUTURE_B2`; `DEVICE_VALIDATION=DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`.

**E1.5A — Verifiability, Diagnostics & Recovery Foundation CLOSED em produção.** PR #447 mergeado (`MERGE_SHA=3cda272ec49154d77d62eed95976fef18bbd24f0`); Railway deploy `079a7600-e7b5-463e-aa15-e895486f89f1` SUCCESS (`commitHash=3cda272`, `numReplicas=1`); GitHub Pages publicado; CI main verde (Backend, SEC-1, GitHub Pages). Validação local final: backend `1656/1656`, web `116/116`, `tsc -b && vite build`. Smokes produção read-only: `/health` 200, `/admin/diagnostics` sem auth 401, `/admin/permissions/templates` sem auth 401; logs recentes sem 5xx novo. Entrega transversal sem IA/autonomia: contexto canônico de correlação (`request_id`, `correlation_id`, `operation_id`, `causation_id`), envelope sanitizado de evento/evidência, registry de invariantes, verifier, findings estruturados, repair playbook engine com `execute=DISABLED_BY_POLICY`, dry-run e primeira superfície read-only Super Admin (`/admin/diagnostics`). Reusa modelos vivos (`auth_event_audit`, `lancamento_eventos`, `frete_documento_eventos`, `billing_outbox`, webhook/outbox/reconcile) sem criar sistema paralelo. Sem migration 074, sem persistência nova de runs/findings, sem production write, sem env/secret, sem Asaas. Persistência histórica de runs/findings/playbook traces fica para decisão futura.

**Onda 2 / Fleet-A — Domain/Foundation em PR, NÃO mergear antes do migration gate.** Branch `feature/onda2-fleet-foundation`; base `origin/main@9d65a85`; migration `074_fleet_foundation.sql` (`SHA256=24f8da26e115917c9a13dc620ad2e963acb8ac30f9b054423cf329b9ee00ccb8`) cria schema aditivo para `fleet_assets`, composições, vínculos temporais, documentos de ativo, odômetro, pneus e manutenção. API core `/fleet/*` usa `fleet.view`/`fleet.manage` ativos com entitlement `fleet`, `verificarPlano` e escopo operacional resolvido por request. Legado `fretes` preservado: sem `ALTER TABLE public.fretes`, sem backfill inventado, sem reescrita de fotos/KM. `MIGRATION_PRODUCTION_APPLIED=false`; `PRODUCTION_WRITES_FLEET=0`; `PRODUCTION_DEPLOYS_FLEET=0`.

A **RBV9 — Rebaseline V9** (docs-only) está **concluída** e inclui o **patch fiscal V9** (domínio `FISCAL_INVOICING`, decisões D-036..D-041, ledger FISC-001..020, track NFS-e). **Nenhum código/dado/env de produção alterado por estes docs.**

### Nota fiscal (não bloqueante)

Adequação de **CNAE/CNPJ/regime** do owner corre **em paralelo** e **NÃO bloqueia** o desenvolvimento técnico (`CNAE_BLOCKS_TECH_DEVELOPMENT=false`; `FISCAL_TECH_BUILD_ALLOWED=true`). O que fica bloqueado é a **emissão fiscal real** e o **go-live comercial pago** — gates `FISCAL_LEGAL_ENTITY_GATE` e `COMMERCIAL_PAID_GO_LIVE_GATE`. Entidade jurídica atual = **provisória**; troca futura = **cutover** (D-041). Certificado = `DEFERRED`.

## Como retomar em outro chat

1. Leia este arquivo + [DECISIONS](./DECISIONS.md).
2. Para o backlog completo com IDs estáveis → [MASTER_LEDGER](./MASTER_LEDGER.md) (`RBV9-INV-NNN`).
3. Para o plano de execução → [ROADMAP](./ROADMAP.md) (ondas, arquitetura-alvo, gap analysis, gates).
4. Para evidências detalhadas do estado real → [FORENSIC_BASELINE](./FORENSIC_BASELINE.md).
5. **Antes de implementar:** confirmar precedência (produção real > banco > repo/main > deploy > testes > docs). Verificar que algo "está implementado" no banco/deploy, não só no doc.

## Estado da Onda 1 (CLOSED — técnica)

> **Política mobile V9 (decisão do owner 2026-08-20):** validações que dependem de aparelho **não bloqueiam** o roadmap. `ONDA1_TECHNICAL_STATUS = CLOSED` · `ONDA1_APP_CODE_IMPLEMENTED = true` · `ONDA1_APP_DEVICE_VALIDATION = DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1` (**DEFERRED ≠ DONE**). Toda mudança Flutter é acumulada no trem de release **`MOBILE_RELEASE_TRAIN_M1`** (ver ROADMAP e itens `MOBILE-M1-NNN` no MASTER_LEDGER); o APK oficial sai por **Codemagic** — não se gera APK intermediário por macrofrente.

**Onda 1 · Realtime + Lançamentos audit-safe — CONCLUÍDA TECNICAMENTE E EM PRODUÇÃO (E1.6A + E1.7 incluídas).** `STATUS = ONDA1_REALTIME_LANCAMENTOS_DEPLOYED_AWAITING_OWNER_VISUAL_VALIDATION` (histórico da entrega inicial). PR #435 **MERGEADO** (`MERGE_SHA=f43f009`; base 4fe8e62). **Migration 070 APLICADA e RASTREADA** em produção (`schema_migrations`: `20260820033844 070_lancamentos_audit_safe_realtime`) via mecanismo canônico (`apply_migration`) — **0 escrita de dado de negócio** (PRE=POST: despesas 98 / abastecimentos 46 / vales 18; `lancamento_eventos`=0). Deploy backend Railway SUCCESS (`f43f009`, health 200, SSE anon 401, `/realtime/stats` anon 401, CORS preflight aceita `X-Client-Platform`, logs sem erro novo, `numReplicas=1`). Frontend GitHub Pages SUCCESS (bundle novo). App: código pronto/CI verde; sem pipeline de loja (compat legada preserva o APK antigo). Asaas inerte (nenhuma mudança de env).

**E1.6A (release safety, sem reabrir auditoria):** (1) **compat do APK legado** — observação/descrição obrigatória só para clientes NOVOS (header `X-Client-Platform`); legado não é quebrado (RBV9-INV-108, DEFERRED_REMOVAL). (2) **SSE connection safety** — limites por usuário/empresa + release no disconnect + `/realtime/stats` (super-admin). (3) **single-instance confirmado** no Railway (`numReplicas=1`) → bus in-memory permitido no escopo atual (RBV9-INV-107). (4) mutation coverage: creates/updates/transições publicam SSE; delete administrativo em cascata = recovery por refetch. Evento é invalidação (refetch canônico), nunca reverte a UI.

**E1.7 (hotfix + release do app, PR #437, `MERGE_SHA=569fde7`):** (1) **Migration 071 APLICADA e RASTREADA** em produção (`schema_migrations`: `20260820040645 071_lancamento_status_cancelado_check`) — o CHECK de `status` de despesas/abastecimentos/vales passou a aceitar `cancelado` (a 070 adicionou as colunas de cancelamento mas não relaxou o CHECK → cancelamento retornava 500). ADITIVA/idempotente (superset do conjunto anterior), **0 escrita de dado de negócio**. **Reconciliação source-of-truth:** repo `backend/migrations/071_...sql` SHA256 `e6f3b7a4…d623fe` ≡ CHECK observado em prod (`{aprovado,pendente,rejeitado,finalizado,cancelado}` nas 3 tabelas); 070+071 rastreadas; **nenhum terceiro hotfix SQL**. (2) **SSE na tela de detalhe do frete no app** (`detalhe_viagem_screen`) — antes só a home tinha realtime; agora a tela de detalhe também refaz o fetch canônico ao receber evento, sem esperar o poll de 60s. (3) **PROCESS-001** (`HOTFIX_071_APPLIED_BEFORE_OWNER_MIGRATION_GATE`) registrado no [MASTER_LEDGER](./MASTER_LEDGER.md) §PROCESS: a 071 foi aplicada durante o diagnóstico ANTES do PR verde e sem gate próprio → **CLOSED_WITH_CORRECTIVE_ACTION** (toda migration futura, inclusive hotfix, exige arquivo+hash+PR/CI+precheck+`OWNER_MIGRATION_GATE`+`apply_migration`+tracking+pós-check; em incidente crítico sem CI possível, **parar e pedir `HOTFIX_PRODUCTION_GATE`**). (4) **Pós-check prod (read-only):** health 200, SSE anon 401, `/realtime/stats` anon 401, `numReplicas=1`, logs sem erro novo de cancel/RPC/constraint/SSE/CORS/500 (só o ENOENT benigno pré-existente de `painel_web/dist` — SPA no GH Pages). Ledger sanity: eventos `created/approved/rejected` com actor/source/tenant/frete coerentes, 0 duplicata anômala, trigger append-only ativo; registros existentes preservados. **Código do app pronto** (mesmo pipeline: `flutter build apk --release`, assinado com a chave debug, sem secret novo; APK oficial via Codemagic). **Validação física do realtime no aparelho = `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`** (itens `MOBILE-M1-001`/`MOBILE-M1-002`) — **não bloqueia** as próximas macrofrentes. Onda 1 = **tecnicamente CLOSED**.

## Próximo passo recomendado

Próximo passo recomendado: concluir o PR **FLEET-A Domain/Foundation** e parar em `READY_FOR_OWNER_MIGRATION_GATE_FLEET`; não aplicar DDL em produção sem gate explícito.

## Hard stops permanentes

Não reativar Asaas production, não escrever em produção, não ativar enforcement de escopo, não migrar infra — cada um tem gate próprio (ver DECISIONS §Gates). Este handoff não autoriza nenhuma dessas ações.

---

**Documentos canônicos V9:** [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)
