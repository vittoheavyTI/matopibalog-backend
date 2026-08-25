# Matopiba Log — MASTER LEDGER V9 (RBV9-1)

> **Fonte permanente do backlog.** Cada item tem ID estável `RBV9-INV-NNN`. Nenhum item pode desaparecer.
> Regras (D-030): `DONE`/`IMPLEMENTED_VALIDATED` = feito e validado; `DEFERRED` = adiado conscientemente; **DEFERRED nunca é DONE**.
> Ao abrir subfrentes (ex.: FROTA → FROTA-E1/E2/E3), o pai só fecha quando **todos** os filhos estiverem DONE ou DEFERRED explicitamente.

**Legenda de camadas:** `B` backend · `W` web · `A` app · `D` banco · `P` produção. → `✓` presente · `~` parcial · `✗` ausente · `—` n/a.
**Status:** `IMPL_VAL` (implementado+validado) · `IMPL_NV` (implementado, não validado visualmente) · `PARTIAL` · `BROKEN` · `STUB` · `ROADMAP` (só roadmap) · `DEFERRED` · `TECH_DEBT` · `UNKNOWN`.

_Evidência coletada em 2026-08-19 (ver [FORENSIC_BASELINE](./FORENSIC_BASELINE.md))._

---

## IDENTITY & AUTH

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-001 | Login JWT (web httpOnly cookie / app Bearer) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | CLAUDE.md, produção UP |
| RBV9-INV-002 | SEC-1 sessões revogáveis (access curto + refresh rotativo) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `auth_sessions`(54), `auth_refresh_tokens`(112), migration 062 |
| RBV9-INV-003 | SEC-1 auditoria append-only de auth | IMPL_VAL | ✓ — — ✓ ✓ | `auth_event_audit`(128) |
| RBV9-INV-004 | Credencial GPS escopada (tracking) | IMPL_VAL | ✓ — ✓ ✓ ✓ | `frete_tracking_credenciais`(30), PR #414; `TRACKING_SCOPED_CREDENTIAL_ENABLED` OFF |
| RBV9-INV-005 | Rate limiting por usuário (fallback IP) | IMPL_VAL | ✓ — — — ✓ | PR #376 |
| RBV9-INV-006 | Recuperação/redefinição de senha + senha temporária | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `RedefinirSenha.tsx`, `senhaTemporaria` |
| RBV9-INV-007 | SSO OIDC / Microsoft Entra ID / App Roles | ROADMAP | ✗ ✗ ✗ ✗ ✗ | 0 tabelas, 0 env identidade externa · D-031 |
| RBV9-INV-008 | SCIM provisioning / SAML / JIT | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-031 (evolução) |
| RBV9-INV-009 | Break-glass local obrigatório (com Entra) | ROADMAP | ✗ — — — — | D-031 |

## ORG SCOPE (grupos / filiais / regiões)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-010 | Grupos empresariais + empresa-grupo | PARTIAL | ✓ ~ ✗ ✓ ✓ | migration 067; `grupos_empresariais`(0) — schema vivo, **0 dados** |
| RBV9-INV-011 | Unidades/regiões operacionais | PARTIAL | ✓ ~ ✗ ✓ ✓ | 067; tabelas 0 linhas |
| RBV9-INV-012 | Memberships local/regional/global | PARTIAL | ✓ ~ ✗ ✓ ✓ | `usuario_operacional_memberships`(0) |
| RBV9-INV-013 | Enforcement automático de escopo | DEFERRED | ✓ — — ✓ ~ | **desativado por segurança** · gate `OPERATIONAL_SCOPE_ENFORCEMENT_GATE` |
| RBV9-INV-014 | Perfis Gerente Filial/Regional/Nacional | ROADMAP | ✗ ✗ ✗ ~ ✗ | escopo existe; papéis formais não |

## PERMISSIONS & ENTITLEMENTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-015 | Níveis auth (verifyToken/isAdmin/isSuperAdmin) + tenant | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | middlewares/auth.js, tenant.js |
| RBV9-INV-016 | Catálogo de funcionalidades + entitlements por plano | IMPL_VAL | ✓ ✓ — ✓ ✓ | `funcionalidades`(21), `plano_funcionalidades`(111), migration 060 |
| RBV9-INV-017 | Overrides por empresa (`empresa_funcionalidades`) | PARTIAL | ✓ ~ — ✓ ✓ | tabela existe, **0 linhas** |
| RBV9-INV-018 | Templates de permissão editáveis por empresa + overrides individuais | IMPL_VAL | ✓ ✓ ✓ ✓ ~ | **P2 CLOSED técnico**: migration 072 **aplicada+rastreada** (`20260821043352`); backend `e718eb3` implantado no Railway (`SUCCESS`, 1 réplica, health 200) e frontend `e718eb3` publicado. `permission_templates`/`permission_template_permissions`/`user_permission_overrides` + `usuarios.permission_template_id`; registry canônico (28 chaves) + resolver único (precedência invariant→entitlement→override→template→default-deny); RPCs guardadas de governança (último admin); API `/admin/permissions/*`; web "Perfis e Permissões" (perfis + exceções por usuário). D-006. App device validation: `DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1`. |
| RBV9-INV-019 | Permissões `freight.create` / `freight.finish` separadas | IMPL_VAL | ✓ ✓ ✓ ✓ ~ | **P2 CLOSED técnico**: `freight.finish` reescrito via resolver (bypass autônomo + dual-read `pode_finalizar_viagem` preservados → efetivo antes=depois); `freight.create` passa a exigir `requirePermission` (fecha auto-criação por motorista; motorista default=false). App gate por efetivo. D-010. |
| RBV9-INV-020 | Financeiro atribuível (nunca automático) | IMPL_VAL | ✓ ✓ ✓ ✓ ~ | **P2 CLOSED técnico**: `finance.operational.*` só por template/override explícito (nunca automático); visibilidade financeira do motorista (`commission_only`/`plus_base`/`full`) com **redação no backend** (getAll/getById); autônomo=full (preserva dono). D-008. |
| RBV9-INV-021 | Governança portal cliente (ERP/SSO='em_breve', Estrutura gate real) | IMPL_VAL | ✓ ✓ — ✓ ✓ | migration 069 (aplicada), PR #422 |

## FREIGHT EXECUTION (frete atual)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-022 | CRUD de fretes + isolamento multi-tenant | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `fretes`(63) |
| RBV9-INV-023 | Frete tonelada/km + odômetro (modalidade) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | migration 019 |
| RBV9-INV-024 | Tetos de sanidade de valores de frete | IMPL_VAL | ✓ — — ✓ ✓ | migration 032, PRs #291/#292 |
| RBV9-INV-025 | Rentabilidade por viagem (read-only) | IMPL_VAL | ✓ ✓ — ✓ ✓ | PR #381, `Rentabilidade.tsx` |
| RBV9-INV-026 | Check-in/Check-out formal (KM+foto pelo motorista) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-011/D-012 |
| RBV9-INV-027 | Snapshot de composição+motorista no frete | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de FLEET |
| RBV9-INV-028 | Handoff de motorista durante a viagem | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | Handoff temporal de motorista fechado tecnicamente em produção pela Fleet final closure: migration 075 rastreada (`20260823012050 075_fleet_operational_closure`), RPC `fleet_driver_handoff` `SECURITY DEFINER` com `search_path=public`, execução negada a `PUBLIC`/`anon`/`authenticated` e concedida somente a `service_role`. Snapshot/check-in/out formal do frete permanece em RBV9-INV-026/027. Owner visual validation pendente. |

## FREIGHT PLANNING & DISPATCH

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-029 | Planejamento/oportunidade → aprovação → designação | IMPL_VAL | ✓ ✓ ✓ ✓ ~ | **Campaign-A CLOSED técnico em produção** no PR #457 (`FINAL_HEAD=45079e8151cde514bc4577dccb656c14419df35e`, `MERGE_SHA=32d8fe3e8824d1a8bc5be89ad6f5cdf86ae5c316`, Railway `5c858732-f34e-443c-b6b7-68306331e852` SUCCESS). Migration 076 aplicada/rastreada uma vez (`20260823111859`, SHA256 `C7CA4533B9A26B5CCDB04EA9C9913B986432ECC17E8D76D07F302F21C3EFCD94`); 077 aplicada/rastreada uma vez (`20260823220632`, SHA256 `11C5D07AC4A2E03DBCA738945C5CF37EEB73370738E4C7B06ADEA8B7025AB5E1`) corrigiu somente o FK canônico. Escopo fechado em `APPROVED_PLAN`: sem materialização de fretes, sem dispatch e sem mapping comercial (`CAMPAIGN_A_FREIGHT_WRITES=0`). **Campaign-B materialization CLOSED em produção** (takeover Claude 2026-08-24, PR #464 `MERGE_SHA=139105d523e9023b616f340a40d6697d7b0e4444`): migration **078 aplicada/rastreada uma vez** (`20260824013400`, SHA256 `5DEA792CA98FE28D8A68320F80BCB92A93B240360F9A552A2F261993193543DB`) criou `campaign_trip_freights` (vínculo plano aprovado→frete canônico) com `PRODUCTION_BUSINESS_WRITES=0`; materialização reusa `freightCreationService` (paridade + notificação), idempotente + reconciliável, sob entitlement∧campaign.manage∧scope∧tenant; sem dispatch. **Campaign-C progress + dispatch readiness CLOSED em produção** (PR #469, `MERGE_SHA=95fcded985470d059519008562a99fdb8dac3fd1`): `campaignProgressService` projeta progresso read-only (viagens/quantidade em toneladas/saúde/exceções/replanejamento) a partir do plano aprovado + `campaign_trip_freights` + status canônico do Frete, com mapeamento CONGELADO Frete→bucket de execução (status desconhecido nunca vira `IN_EXECUTION`/`COMPLETED`, sempre `UNKNOWN`) e sem dupla contagem; Torre de Controle ganha `campaign_attention` (reusa a mesma autoridade, capability-gated, sem financeiro); web ganha a seção "Execução da campanha" em `OperationCampaigns.tsx`. `CAMPAIGN_PROGRESS=DONE`. Dispatch real (oferta/aceite) **CLOSED** — ver RBV9-INV-031. **Operation Orchestrator V1 (E3.1/E3.2) CLOSED em produção** (`docs/product/v9/OPERATION_ORCHESTRATOR_V1.md`): auditoria prévia confirmou que o pipeline determinístico completo já existia (normalize/validate/resource-snapshot/capacity-plan/trip-plan/scenario/approval/materialization/dispatch/execution/verify, inclusive o sinal advisory de replanejamento do Campaign-C) — nada foi reconstruído. Esta frente fechou só o que faltava: `next_action` determinístico (`operationOrchestratorService.deriveNextAction`, composição pura sobre sinais já existentes, sem regra nova) e um fluxo guiado único (`POST /operation-campaigns/objective`) que substitui os 4 passos desconectados (criar campanha → salvar locais/demanda de 1 origem/1 destino fixos → gerar plano → aprovar) por um único objetivo (nome, carga, quantidade, origem, destino). Web: card "Nova campanha" + "Salvar base" + botão avulso "Gerar plano" viram um formulário único, com banner "O que fazer agora" e correção de um bug real (reabrir campanha aprovada não recarregava o plano). **Campaign-D (Orchestrator Completion V1) CLOSED em produção** (`docs/product/v9/CAMPAIGN_D_REPLAN_ROUTE_MULTI_ORIGIN.md`): fecha os 3 itens deferidos pelo Orchestrator V1. **Replan pós-aprovação** — `campaignReplanService` classifica cada viagem da versão aprovada corrente em EXECUTED/COMMITTED/CANCELLED/UNCOMMITTED/UNKNOWN (UNKNOWN bloqueia o replan inteiro para revisão humana), calcula residual = meta − executado − comprometido por demanda, e gera a nova versão SÓ sobre o residual reaproveitando o mesmo planejador determinístico; `approvePlan` (mesmo endpoint) agora supera a versão antiga ANTES de promover a nova, reaproveitando os índices únicos já existentes da migration 076 (`campaign_plan_versions_one_approved_key`) — **sem migration nova**, provado com 2 testes reais contra Postgres 16 (rejeição da ordem errada + 2 conexões concorrentes executando a ordem certa nunca deixam 0 nem 2 versões `APPROVED`). Fechou também um gap real: RPCs de Dispatch não verificavam se o plano informado ainda era o aprovado corrente — corrigido na aplicação (`dispatchService.assertCurrentApprovedPlan`), mesma regra que a materialização já usava. **Route Intelligence integrada ao planejamento** — origem/destino já conhecidos alimentam `routeEstimateService.estimateRoute` automaticamente (bounded/deduplicado), provider continua `disabled` em produção, `PRODUCTION_ROUTE_PROVIDER_CALLS=0`. **Multi-origem no fluxo guiado** — `origins[]` com quantidade própria por origem, total sempre derivado. Schema-free (`MIGRATION_REQUIRED=false`). |
| RBV9-INV-030 | Route Intelligence (provider abstraction, pedágio, combustível previsto) | IMPL_NV | ✓ ✓ ✓ ✓ ✓ | **Route Intelligence V1 CLOSED em produção** (PR #467, `MERGE_SHA=0fcf9a66fe286a7f4b80dc20878324bab532d8ce`): `RouteProviderGateway` (disabled default/fake/http-adapter pronto), estimativa read-only distância/duração/pedágio + combustível/custo input-dependentes (`unknown≠zero`; restrição caminhão `UNAVAILABLE`), fallback manual, `/route-intelligence/estimate` sob auth+tenant+`freight.view` (frete-context sem IDOR), tool IA `route.estimate` inerte, página `/rota`. Sem schema/secret/provider real/env; 0 chamadas externas. Google/TomTom/tráfego/cache/overwrite KM deferidos. |
| RBV9-INV-031 | Dispatch estilo Uber (oferta/aceite/expira, lock concorrência-safe) | IMPL_NV | ✓ ✓ ✓ ✓ ~ | **D-033 implementada.** **Dispatch V1 CLOSED em produção** (owner execution 2026-08-24, PR #471 `MERGE_SHA=16418114480f7afe650efbb493e1c2ccb0450b16`). Migration **079 aplicada/rastreada exatamente uma vez** (`20260824164023`, SHA256 `A5F7CB3722E297A45842DE0C0813B9AE6B0248C5AB49D7F1317391EBA199D3C9`), aplicação única sob `MIGRATION_APPLY_MAX_ATTEMPTS=1`: cria `dispatch_rounds`/`dispatch_offers`, RPCs `SECURITY DEFINER` service_role-only (`dispatch_claim_planned_trip` interna sem GRANT algum, confirmado em produção), RLS com `authenticated`=SELECT-only, `PRODUCTION_BUSINESS_WRITES=0` (só backfill técnico de permissão, +75 linhas). Primeiro aceite válido vence atomicamente via `pg_advisory_xact_lock` por viagem + `SELECT...FOR UPDATE` por rodada — provado com 16 testes reais contra Postgres 16 em CI (3 races: accept concorrente, cancel-vs-accept, direct-vs-offer), não mockado. Arquitetura em **duas fases deliberadas** (decisão do vencedor atômica na fase 1; materialização do frete idempotente/reaproveitada do Campaign-B na fase 2, nunca a mesma transação) — detalhe completo em [DISPATCH_V1](./DISPATCH_V1.md). `REAL_DISPATCH_IMPLEMENTED=true`, `OFFER_SYSTEM_IMPLEMENTED=true`. App Flutter validado só via CI (`OWNER_DEVICE_VALIDATION=PENDING`); owner visual validation da UI web/manager em produção pendente (P=`~`). |
| RBV9-INV-032 | Elegibilidade de candidatos (filial/região/vínculo/docs) | IMPL_VAL | ✓ ✓ ✗ ✓ ~ | **CLOSED em produção** (PR #469, `MERGE_SHA=95fcded985470d059519008562a99fdb8dac3fd1`): `dispatchEligibilityService` — motor determinístico por viagem planejada; bloqueios (motorista/recurso inativo, escopo negado, sem vínculo temporal ativo) espelham exatamente a materialização canônica; capacidade só compara quando ambos os lados são conhecidos (nunca infere); documentos/manutenção geram só aviso, nunca bloqueio fabricado; **compatibilidade de rota é sempre `UNKNOWN`** (Route Intelligence V1 não carrega restrição de caminhão — honesto, não inventado); sem score mágico (ordenação estável por categoria objetiva); bounded (top-N, default 25/máx 100), sem N+1. `GET /operation-campaigns/:id/plans/:planId/trips/:tripId/eligibility` sob `campaign.manage`. Sem app (web-only). Owner visual validation pendente. |

## FLEET (frota / veículos / composições / pneus / manutenção)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-033 | `fleet_assets` (caminhão/cavalo/reboque/dolly/implemento) | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | **FLEET technical closure em produção**: migration 074 rastreada (`20260822142407 074_fleet_foundation`) + migration 075 rastreada (`20260823012050 075_fleet_operational_closure`, SHA256 `6ae16676e6b67142ca0faaa78b92d65a512c67966b5ed35448148189bdf078fc`), PR #453 mergeado (`MERGE_SHA=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`) e backend Railway `ee860618-4307-4e5a-8d61-7a12862f5e2d` SUCCESS. Fleet-B expõe `/frota` e `/fleet/overview`, cadastro/lista de ativos, filtros por placa/identificador/tipo/status e empty state operacional. Owner visual validation pendente. |
| RBV9-INV-034 | Composições veiculares + membros | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `vehicle_compositions` + `vehicle_composition_members`, vigência temporal, uniqueness ativa por asset/par; Fleet-B lista composições, monta composição inicial e preserva authority composition-centric. |
| RBV9-INV-035 | Vínculo temporal motorista↔veículo/composição | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `driver_vehicle_assignments`, alvo exclusivo asset/composition, vigência, índices únicos ativos, colunas de correlação (`request_id`, `correlation_id`, `source`) e handoff por RPC `fleet_driver_handoff` service-role-only. |
| RBV9-INV-036 | Documentos de ativo + vencimentos | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `asset_documents` com `document_category='VEHICLE_DOCUMENT'`, contrato versionado, metadados de arquivo, upload real para bucket privado `fretes-documentos`, signed preview e alertas de vencimento. Cancelamento/substituição audit-safe fica diferido. |
| RBV9-INV-037 | Odômetro como eventos | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `odometer_events` vinculado a asset/frete, preservando campos/fotos legados de `fretes` sem rewrite/backfill; Fleet-B registra leitura manual/check-in/check-out/correção como evento novo. |
| RBV9-INV-038 | Pneus (nº de fogo, posição, KM, recapagens, custo/km) | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `tires`, `tire_installations`, `tire_events`; migration 075 adicionou `tires.unidade_operacional_id` com FK composta tenant-safe, índice `tires_empresa_unit_status_idx`, backfill esperado/real `0/0`, estoque por unidade e instalação. Analytics/custo por km/alertas avançados posteriores. |
| RBV9-INV-039 | Manutenção (preventiva/corretiva, OS, peças, tempo parado) | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `maintenance_events` com preventiva/corretiva, categoria, OS, fornecedor, custo, KM e downtime; Fleet-B registra e lista manutenção no painel operacional. Experiência avançada de oficina e owner visual validation pendentes. |

## DRIVERS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-040 | Cadastro/gestão de motoristas + limite por plano | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `motoristas`(18), PR #282 |
| RBV9-INV-041 | Visibilidade financeira do motorista configurável | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-009 |
| RBV9-INV-042 | Acerto/espelho do motorista | IMPL_VAL | ✓ ✓ ~ ✓ ✓ | `AcertoMotoristas.tsx`, `ResumoMotorista.tsx` |

## DOCUMENTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-043 | Documentos por frete (upload/storage/signed URL) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_documentos`(16), migration 026. **E1.4A CLOSED em producao**: PR #444 mergeado (`MERGE_SHA=1744d59`), migration 073 aplicada+rastreada (`20260822041647`, SHA256 `7368bcd80009f1a21b42170d56d99f976dbca3a7aa0534ecb4d14c3f0e7dde91`) adicionou contrato v2, `client_request_id`, cancelamento logico/auditoria e participantes operacionais. Counts preservados; `comprovantes` legado intocado. |
| RBV9-INV-044 | Scanner de documentos no app | IMPL_NV | ✓ ✓ ✓ ✓ ✓ | **E1.4B CODE CLOSED**: PR #446 mergeado (`MERGE_SHA=a00545770e88c6d13d7d6158b66077e973ba89d8`). Scanner on-device via `cunning_document_scanner`, multipagina, review antes do upload, reorder/remove/retake e geração local de PDF. OCR segue fora do primeiro release (`OCR_FIRST_RELEASE=false`). Validação física no aparelho fica no `MOBILE_RELEASE_TRAIN_M1`. |
| RBV9-INV-045 | Fluxos distintos empresa→motorista / motorista→empresa | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-013 |
| RBV9-INV-046 | Múltiplos recebedores/assinantes | PARTIAL | ✓ ~ ✗ ✓ ✓ | **Fundacao E1.4A em producao**: `frete_documento_participantes` criada com FKs/RLS tenant-aware e status/tipo; fluxos reais de retorno/ack/assinatura operacional seguem `FUTURE_B`. D-015 |
| RBV9-INV-047 | Viewer PDF-first no app (ver antes de exportar) | IMPL_NV | ✓ ✓ ✓ ✓ ✓ | **E1.4B CODE CLOSED**: app busca signed URL curta no backend, baixa para temp isolado, mostra preview interno PDF/imagem e só depois oferece salvar/compartilhar/abrir externamente. URLs assinadas não viram autoridade persistida; app não acessa Supabase Storage diretamente. D-016 |
| RBV9-INV-048 | Documentos por ativo (frota) | IMPL_NV | ✓ ✓ ✗ ✓ ✓ | FLEET technical closure em produção: `asset_documents` pronto para `VEHICLE_DOCUMENT`, upload real no bucket privado `fretes-documentos`, signed preview e metadados versionados (`document_contract_version`, `file_sha256`, `mime`, `tamanho_bytes`, `request_id`, `correlation_id`, `source`). App mobile e cancelamento/substituição audit-safe ficam diferidos. |

## LAUNCHES (despesas / abastecimento / vale / adiantamento)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-049 | Despesas (web+app, isolamento, idempotência) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `despesas`(98), migration 018 |
| RBV9-INV-050 | Abastecimentos / ARLA | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `abastecimentos`(46) |
| RBV9-INV-051 | Vales / adiantamentos | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `vales`(18) |
| RBV9-INV-052 | Estados append/audit-safe (pend/aprov/rej/cancel+motivo+ator) | IMPL_NV | ✓ ✓ ~ ✓ ✓ | **Onda 1 DEPLOYADO**: máquina de estados + RPC transação (CAS) + ledger `lancamento_eventos` append-only. **Migration 070 aplicada+rastreada em prod** (`20260820033844`). **Hotfix migration 071 aplicada+rastreada** (`20260820040645`, PR #437) — CHECK de `status` de despesas/abastecimentos/vales passou a aceitar `cancelado` (corrige 500 no cancelamento; ADITIVA/idempotente, superset do conjunto anterior). Aguarda validação visual. App: create; ações admin no web. |
| RBV9-INV-053 | Realtime web↔app dos lançamentos | IMPL_NV | ✓ ✓ ✓ — ✓ | **Onda 1 DEPLOYADO**: SSE autenticado (`/realtime/stream`) + `realtimeBus` + limites de conexão; web (fetch stream) e app (http stream) refazem fetch canônico. **Hotfix PR #437: SSE também na tela de detalhe do frete no app** (`detalhe_viagem_screen`) — `RealtimeService` singleton (idempotente, compartilhado com a home), filtro client-side por `freight_id`, refetch canônico com debounce, poll de 60s só como fallback, refetch no resume/reconnect, cleanup no dispose sem parar o serviço compartilhado. Polling não é mais o mecanismo principal. |
| RBV9-INV-054 | Paridade painel↔app de todos os campos coletados | IMPL_NV | ✓ ✓ ~ — ✓ | **Onda 1 DEPLOYADO**: painel exibe arla/odômetro/preço-litro/observação do abastecimento; observação obrigatória no create (web+app, transitório para cliente novo). |

## FINANCE — OPERACIONAL DO CLIENTE

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-055 | Relatórios/dashboards financeiros do cliente | IMPL_VAL | ✓ ✓ ~ ✓ ✓ | **E1.3 CLOSED em produção** (PR #441, `MERGE_SHA=b695102`): backend boundary `DONE` com helper canônico `agregacaoFinanceiraFretes` para receita/status de lançamentos; web boundary `DONE` removendo KPIs SaaS do `Dashboard` operacional e preservando MRR/trial/inadimplência em `PainelVisaoGeral` (`SuperAdminRoute`, `/painel-admin/empresas`, regra `suspenso`/`bloqueado`/`expirado`). Validação: backend 1631/1631, web 116/116 + build, CI main verde, deploy Railway/GitHub Pages, health 200. |
| RBV9-INV-056 | Auditoria de correções (fretes/faturas) | IMPL_VAL | ✓ ✓ — ✓ ✓ | `fretes_correcoes_auditoria`(5), migration 065 |
| RBV9-INV-057 | Centro de custo / filial no financeiro operacional | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de ORG_SCOPE+FLEET |

## SAAS BILLING (financeiro Matopiba)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-058 | Planos + catálogo comercial + categorias | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `planos`(9), migrations 025/038/041/045 |
| RBV9-INV-059 | Faturas + snapshot de plano + recorrência (schema) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `faturas`(25), migrations 030/031 |
| RBV9-INV-060 | Integração Asaas (sandbox + production code) | IMPL_VAL | ✓ ✓ — ✓ ~ | **desarmado**; primeiro pagamento real reconciliado e revertido |
| RBV9-INV-061 | Webhook Asaas (token fixo, idempotente) | IMPL_VAL | ✓ — — ✓ ✓ | `asaas_webhook_events`(46) |
| RBV9-INV-062 | Billing outbox + runner + reconcile | IMPL_NV | ✓ ✓ — ✓ ~ | migration 066; **runner desativado**, outbox=0 |
| RBV9-INV-063 | Upgrade/troca de plano (avulsa) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | PRs #278-#281, migration 028 |
| RBV9-INV-064 | Aquisição comercial v2 (RPC) | IMPL_VAL | ✓ ✓ — ✓ ✓ | RPC `iniciar_aquisicao_comercial_v2` **viva em prod** |
| RBV9-INV-065 | Promoções / tickets / códigos | IMPL_VAL | ✓ ✓ — ✓ ✓ | `promocoes`(1), migration 040 |
| RBV9-INV-066 | Cobrança por motorista (preço final = backend autoridade) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | PR #282 |
| RBV9-INV-067 | Notificações de inadimplência (escada D+0..D+3) | IMPL_VAL | ✓ ✓ — ✓ ✓ | cron dry-run; PRs #363-#365 |
| RBV9-INV-068 | Expiração de trial / carência | IMPL_VAL | ✓ — — ✓ ✓ | cron `radiant-warmth` dry-run; migration 047 |
| RBV9-INV-069 | Recorrência real (produção) | DEFERRED | ✓ ✓ — ✓ ✗ | validada em sandbox; produção exige autorização |
| RBV9-INV-070 | Super-admin: dashboard comercial/financeiro SaaS/trials/conversões/MRR/churn | PARTIAL | ✓ ✓ — ✓ ✓ | Painéis existem; KPIs MRR/churn a formalizar |

## FISCAL_INVOICING (NFS-e / entidade jurídica) — domínio novo (patch fiscal RBV9)

> Domínio **separado** de SAAS_BILLING e FINANCE_OPERATIONAL (D-036). Todos **NEW (0 no banco)**. IDs próprios `FISC-NNN`. Arquitetura-alvo: LEGAL_ENTITY → FISCAL_PROFILE → SAAS_BILLING_EVENT → FISCAL_OUTBOX → FISCAL_PROVIDER → DPS → NFSE → RECONCILE → XML/DANFSe → EMAIL/PORTAL. Nenhum bloqueia a Onda 1.

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| FISC-001 | Legal entity + fiscal profile (entidade configurável/versionada) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-037/D-040; 0 tabelas |
| FISC-002 | Habilitação/config fiscal por entidade | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-037 |
| FISC-003 | Política de trigger fiscal (que receita SaaS gera NFS-e) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-036 |
| FISC-004 | Fiscal provider abstraction | ROADMAP | ✗ ✗ ✗ ✗ ✗ | não acoplar a provider único · análogo a D-032 |
| FISC-005 | Adapter NFS-e Nacional | ROADMAP | ✗ ✗ ✗ ✗ ✗ | padrão nacional DPS/DANFSe |
| FISC-006 | Gestão de certificado/secret | ROADMAP | ✗ ✗ ✗ ✗ ✗ | `CERTIFICATE_PURCHASE=DEFERRED` |
| FISC-007 | DPS builder | ROADMAP | ✗ ✗ ✗ ✗ ✗ | Declaração de Prestação de Serviço |
| FISC-008 | Fiscal outbox + idempotência | ROADMAP | ✗ ✗ ✗ ✗ ✗ | análogo ao billing_outbox |
| FISC-009 | Reconcile fiscal | ROADMAP | ✗ ✗ ✗ ✗ ✗ | status/retry/reconciliação |
| FISC-010 | Armazenamento XML/DANFSe | ROADMAP | ✗ ✗ ✗ ✗ ✗ | storage imutável |
| FISC-011 | E-mail automático de NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | Resend |
| FISC-012 | Portal "Notas Fiscais" (cliente) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-036 |
| FISC-013 | Cancelamento/substituição de NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | audit-safe |
| FISC-014 | Produção Restrita (fiscal) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | `FISCAL_LEGAL_ENTITY_GATE` |
| FISC-015 | Primeiro piloto NFS-e production | ROADMAP | ✗ ✗ ✗ ✗ ✗ | gate comercial/fiscal |
| FISC-016 | Recurring billing → recurring NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de FISC-008/009 |
| FISC-017 | Super Admin Fiscal Health | ROADMAP | ✗ ✗ ✗ ✗ ✗ | observabilidade fiscal |
| FISC-018 | Legal entity cutover | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-041 |
| FISC-019 | Payment provider account por entidade | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-041; desacopla Asaas por entidade |
| FISC-020 | Fiscal profile versioning | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-040 (SIMEI→Simples/ME) |

## CONTRACTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-071 | Contratos comerciais + modelos versionados | IMPL_VAL | ✓ ✓ — ✓ ✓ | `contratos_comerciais`(8), `contrato_modelos`(8), migrations 053-058 |
| RBV9-INV-072 | Assinatura eletrônica interna (OTP/desafio) | IMPL_VAL | ✓ ✓ — ✓ ✓ | migration 055, `contrato_assinatura_desafios`(5) |
| RBV9-INV-073 | Signatários múltiplos + eventos/auditoria | IMPL_VAL | ✓ ✓ — ✓ ✓ | `contrato_signatarios`(16), `contrato_eventos`(27) |
| RBV9-INV-074 | Signature Provider abstraction (externo) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-034 |
| RBV9-INV-075 | Tipos aditivo/rescisão/trial opcional formalizados | PARTIAL | ~ ~ — ~ ~ | D-034 |

## TERMS / LGPD (distinto de Contracts)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-076 | Termos + aceites (versão/hash/IP/UA) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `termos`(4), `termos_aceites`(22) |

## EPOD & OCORRÊNCIAS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-077 | ePOD (prova de entrega) + evidências + status | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_epod`(1), migrations 048/050, PRs #369/#370 |
| RBV9-INV-078 | Ocorrências logísticas + evidências | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_ocorrencias`(1), migration 049 |

## TRACKING / TORRE DE CONTROLE

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-079 | Rastreamento leve (localizações) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_localizacoes`(964), migrations 051/052 |
| RBV9-INV-080 | Torre de Controle (web) | IMPL_NV | ✓ ✓ — ✓ ✓ | `TorreControle.tsx` (polling) |

## SHIPPER / PARTNER NETWORK

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-081 | Portal do Embarcador (demanda/cotação/proposta) | IMPL_NV | ✓ ✓ — ✓ ~ | D-024. **PORTAL-A `TECHNICALLY_CLOSED` em produção** (PR #475, `MERGE_SHA=91a52353`; migration `080_shipper_portal_foundation.sql` SHA256 `FEF45F5030930C40EEF00B7E83C2A6292D7D5C91597D85BF27ADB546418F7791` **aplicada uma única vez**, tracking `20260825005339`; 0 linha de negócio). Permanece `PARTIAL` porque PORTAL-A entrega **domínio e fronteira**, não superfície HTTP: os serviços não são importados por nenhuma rota, e a única mudança viva em runtime é `middlewares/auth.js` rejeitando `token_kind='shipper_portal'` no sistema interno. Auditoria (§10) achou 0 entidades de embarcador e o risco central: `middlewares/tenant.js` deriva `req.empresa_id` de `usuarios.empresa_id`, então criar o embarcador como usuário interno lhe daria o tenant inteiro. Modelo: identidade externa em tabelas próprias **sem `empresa_id`**; acesso só via `shipper_carrier_relationships` ativo e revogável; isolamento entre embarcadores da MESMA transportadora garantido por FKs compostas no banco (tenant sozinho não basta). Credenciais separadas simetricamente. Solicitação multi-origem com snapshot imutável e unidade única por solicitação (sem conversão kg↔ton); criação+submissão atômica em uma transação; aceite atômico via RPC + handoff idempotente ao Operation Orchestrator — operador não redigita nada. Zero grant a `anon`/`authenticated` (backend-mediado). 26 testes de fronteira + 37 PG reais. Slice C (tracking/docs/comprovantes) e Slice D (UX externa) = **PORTAL-B `TECHNICALLY_CLOSED` em produção** (owner execution 2026-08-25, PR #477 `MERGE_SHA=75a39d0a6758e50cc198a65576a909bbce59446e`; migration `081_shipper_portal_b_revision_documents.sql` SHA256 `285694FBFB4778D38EACDD5D3AC5D3DA75EA80FD462FF1A2737D69DE0711A53E` **aplicada uma única vez** sob `MIGRATION_APPLY_MAX_ATTEMPTS=1`, tracking `20260825144011`). A fidelidade da fonte foi provada no servidor **antes** do apply (digest read-only = SHA certificado) e o SQL registrado no tracking tem o mesmo hash. `PRODUCTION_BUSINESS_DML=0`; só 50 linhas técnicas de permissão (`shipper_portal.documents.share`: 25 administrador + 25 gerente_frota; **operador 0**), backfill histórico 0. PORTAL-B acrescenta: superfície HTTP externa (`/portal/embarcador`) e interna (`/shipper-inbox`) que nunca compartilham contexto; ativação de convite atômica com convergência para falha parcial entre Auth e domínio; revisão auditável append-only (a decisão é carimbada NA versão avaliada, então o aceite sempre diz a qual envio se refere); projeção de acompanhamento que reusa o mapa congelado de status e nunca fabrica progresso; e uma autoridade explícita e revogável de visibilidade de documento, que **não existia** no schema. Aceitar exige `requests.review` E `campaign.create`. Passa a `IMPL_NV` porque tudo isso **está em produção**: `/portal/embarcador/*` e `/shipper-inbox/*` respondem `401` sem credencial (antes `404`), com `/health` 200 e zero erro novo. O que ainda falta é validação **humana**: `OWNER_VISUAL_VALIDATION=PENDING` (login externo, pedido, revisão, acompanhamento, documentos/comprovantes, caixa de entrada). Certificação de produção foi **read-only**: `PRODUCTION_AUTH_USERS_CREATED=0`, `PRODUCTION_INVITATIONS_CREATED=0`, `PRODUCTION_EMAILS_SENT=0`, `PRODUCTION_BUSINESS_WRITES=0` — nenhum embarcador existe ainda. Entrega de convite = `MANUAL_LINK`; **não** há envio de e-mail. Fechar E3.5 **não** cria Partner Network, rede de cotação nem Marketplace. 31 testes de fronteira + 52 PG reais (081) + 37 PG (080) + 27 web. Cotação/proposta **deferida** (`PORTAL_QUOTE_PROPOSAL_V1B`): não há autoridade canônica de preço embarcador↔transportadora. Ver [SHIPPER_PORTAL_V1](./SHIPPER_PORTAL_V1.md). |
| RBV9-INV-082 | Rede privada de parceiros (Lite/Cliente, boundaries de tenant) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-025/D-026; Campaign produz `capacity_gap` estruturado, Partner Network resolve depois. Parceiro nunca acessa tenant do embarcador. |
| RBV9-INV-083 | Marketplace público | ROADMAP | ✗ ✗ ✗ ✗ ✗ | posterior (D-025) |

## ERP / INTEGRATION HUB

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-084 | Integração customizada (integrações genéricas, cripto at-rest) | PARTIAL | ✓ ✓ — ~ ✓ | `INTEGRATIONS_SECRET_KEY`; `integracoes.js`; sem hub canônico |
| RBV9-INV-085 | Integration Hub canônico (outbox/adapter/external_id/retry/reconcile) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-023 |
| RBV9-INV-086 | Adapters ERP (Aliare/SIAGRI, Sankhya, TOTVS, Senior, SSW, Bsoft, REST, CSV) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | census de prospects pendente |

## AUDIT / ENVELOPE DIGITAL

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-087 | Auditoria por domínio (auth, contratos, fretes, funcionalidades, escopo) | PARTIAL | ✓ ~ — ✓ ✓ | vários `*_auditoria` / `*_eventos`; não unificado |
| RBV9-INV-088 | Modelo de eventos unificado (entity/action/actor/source/metadata) | PARTIAL | ✓ ✗ ✗ ✓ ✗ | E1.5A adiciona envelope canônico em código (`event_id`, `event_type`, `domain`, `empresa_id`, `entity`, correlação, ator, source, metadata sanitizada, evidence_refs`) sem migration/persistência nova. Campaign architecture reutiliza esse envelope para `campaign.created`, `campaign.plan.generated`, `campaign.plan.approved`, `campaign.trip.materialized`, `campaign.progress.changed`, `campaign.exception.created`, `campaign.completed`. D-021/D-045/D-054/D-057. |
| RBV9-INV-089 | Envelope Digital (unidade formal de fechamento) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-022 |
| RBV9-INV-109 | Verifiability, Diagnostics & Recovery Foundation | IMPL_VAL | ✓ ✗ ✗ ✗ ✓ | **E1.5A CLOSED em produção**: PR #447 mergeado (`MERGE_SHA=3cda272`), Railway `079a7600-e7b5-463e-aa15-e895486f89f1` SUCCESS (`commitHash=3cda272`, `numReplicas=1`), CI main verde, health/smokes anon 401 e logs sem 5xx novo. Contexto canônico de correlação, registry de invariantes, verifier, findings estruturados, repair playbook engine com `execute=DISABLED_BY_POLICY`, dry-run e rota Super Admin read-only `/admin/diagnostics`. Sem migration 074, sem repair production, sem IA como authority. Persistência histórica de runs/findings fica como decisão futura. D-044..D-054 |

## REPORTING / PDF

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-090 | Relatórios PDF com branding/logo + filtros padronizados | IMPL_VAL | ✓ ✓ — ✓ ✓ | PR #366, `relatorioBranding.ts` |
| RBV9-INV-091 | Produtos de relatório-alvo (Envelope, fechamento, espelho, histórico veículo/manutenção, consumo) | PARTIAL | ✓ ✓ ✓ ✓ ~ | **Systemic Quality PR #459 CLOSED**: corrigida consistência de relatórios operacionais schema-free para impedir corte silencioso por limite antes do filtro canônico (`rentabilidade` exclui cancelados antes do limite; `acerto-motoristas` busca finalizados antes do limite). Envelope/fechamento/relatórios Campaign continuam ROADMAP e dependem de Campaign-B/Envelope. |

## NOTIFICATIONS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-092 | Notificações internas + push (Firebase) + badge/toast | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `notificacoes`(176), `push_tokens`(19), migrations 013/019/020 |

## PERFORMANCE / REALTIME (sistêmico)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-093 | Realtime sistêmico (web↔app poucos segundos) | PARTIAL | ✓ ✓ ✓ — ✗ | **Onda 1** entrega a fundação (SSE backend-mediated) para lançamentos; estender a outros domínios (notificações/torre) fica para ondas seguintes |
| RBV9-INV-094 | Baseline de performance (queries N+1, índices, payloads) | UNKNOWN | ~ ~ ~ ~ ~ | não medido; advisors não coletados (TD-06) |

## INFRA

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-095 | Deploy Railway (backend) + GitHub Pages (web) + crons | IMPL_VAL | ✓ ✓ — — ✓ | 3 crons SUCCESS; health UP |
| RBV9-INV-096 | Portabilidade / migração Hostinger | DEFERRED | — — — — — | gate `INFRA_MIGRATION_GATE` (D-028) |

## UX / PERFIL / RESPONSIVIDADE (backlog herdado)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-097 | Perfil avançado / avatar / CPF / CEP | ROADMAP | ✗ ✗ ✗ ✗ ✗ | backlog upgrade-plano |
| RBV9-INV-098 | Máscaras (CPF/telefone/placa/moeda) web+app | PARTIAL | — ~ ~ — — | branch `feat/app-rc-mascaras` |
| RBV9-INV-099 | IA de navegação/sidebar + didática | PARTIAL | — ~ — — ~ | PR #425 (aberto, não mergeado) |
| RBV9-INV-100 | Comparador de planos / vitrine de upgrade | IMPL_VAL | — ✓ ✓ — ✓ | `ComparadorPlanos.tsx`, PR #424 |

## TECH DEBT / QUALIDADE

| ID | Item | Status | Obs |
|----|------|--------|-----|
| RBV9-INV-101 | `sec1-e2e-browser` flaky | TECH_DEBT | race no refresh |
| RBV9-INV-102 | SQLs versionados antigos desatualizados | TECH_DEBT | conferir sempre o banco |
| RBV9-INV-103 | Higiene de repositório local (~450 branches, dezenas de worktrees) | TECH_DEBT | ambiente do dev |
| RBV9-INV-104 | Supabase advisors não coletados | TECH_DEBT | rodar na Onda 0/1 |
| RBV9-INV-105 | Smoke autenticado automatizado ausente | TECH_DEBT | falta conta smoke |
| RBV9-INV-106 | Tabelas legado (`documentos`, `contratos`, `modelo_contratos`) | TECH_DEBT | limpeza futura |
| RBV9-INV-107 | `REALTIME_HORIZONTAL_SCALE` — bus SSE é in-memory/single-instance | DEFERRED | Onda 1/E1.6A; **Railway confirmado `numReplicas=1` (região sfo)** → `REALTIME_BUS_IN_MEMORY_ALLOWED=true` no escopo atual. **Critério de remoção:** antes de `replicas>1`, trocar o bus por pub/sub compartilhado atrás da mesma abstração. Mitigado hoje: clientes refazem fetch no reconnect/resume. **DEFERRED ≠ DONE.** |
| RBV9-INV-108 | `LEGACY_OBSERVATION_ENFORCEMENT` — observação/descrição obrigatória é TRANSITÓRIA | DEFERRED | E1.6A; backend só exige o campo de clientes NOVOS (header `X-Client-Platform`); APK legado sem o campo NÃO é quebrado (histórico null permanece válido, sem inventar texto). **Critério de remoção:** quando existir *minimum supported app version* / forced-upgrade controlado, tornar a validação estrita para todos. **DEFERRED ≠ DONE.** |

## PROCESS / GOVERNANÇA

| ID | Item | Status | Obs |
|----|------|--------|-----|
| PROCESS-001 | `HOTFIX_071_APPLIED_BEFORE_OWNER_MIGRATION_GATE` — a migration 071 foi **aplicada em produção durante o diagnóstico do cancelamento (500), ANTES do PR #437 estar verde/mergeado e sem um `OWNER_MIGRATION_GATE` separado para a 071**. Resultado técnico saudável (aditiva/idempotente, reconciliada com o source-of-truth: repo `071_...sql` SHA256 `e6f3b7a4…d623fe` ≡ CHECK em prod; 070+071 rastreadas; sem terceiro hotfix SQL), mas é **desvio de processo**. | CLOSED_WITH_CORRECTIVE_ACTION | **NÃO rollbackar / NÃO reaplicar / NÃO alterar produção.** **Ação corretiva permanente:** toda migration de produção futura — inclusive hotfix — exige: (1) arquivo versionado; (2) hash; (3) PR/CI quando a situação permitir; (4) precheck; (5) `OWNER_MIGRATION_GATE` explícito; (6) `apply_migration` canônico; (7) tracking; (8) pós-check. Em incidente crítico onde o CI prévio não seja possível: **parar e solicitar `HOTFIX_PRODUCTION_GATE`** — nunca assumir autorização implícita de migration anterior. |
| PROCESS-002 | `MIGRATION_075_APPLY_PAYLOAD_DIVERGED_FROM_GIT_BLOB` — a primeira tentativa de apply da migration 075 falhou porque o payload manual continha assinatura `TTEXT`, divergente do arquivo versionado (`TEXT`). O Git blob autorizado estava correto (`source_ttext_count=0`) e a tentativa falhou antes de tracking/objetos novos; não houve efeito parcial. | CLOSED_WITH_CORRECTIVE_ACTION | Segunda e final tentativa autorizada executada com `VERIFIED_SOURCE_TEXT_TRANSFER` a partir do full file read no HEAD `200a3ad993df8c09c12b369f385e1920dea593ab`; `SOURCE_SHA256=6ae16676e6b67142ca0faaa78b92d65a512c67966b5ed35448148189bdf078fc`; `QUERY_MANUALLY_EDITED=false`; `QUERY_RECONSTRUCTED=false`; apply result `SUCCESS`; tracking `20260823012050 075_fleet_operational_closure`; postchecks schema/RPC/backfill/logs `PASS`. Regra permanente: payload de migration deve ser transferido de fonte verificada e reconciliado contra hash/assinaturas antes de novo apply. |
| PROCESS-003 | `PARALLEL_EXECUTION_BOARD_V1` — owner decisions pendentes de Operation Campaign congeladas e execucao paralela preparada para Batch V1 sem iniciar implementacao. | FROZEN | Modelo: 3 writer agents + 1 reviewer read-only + owner/orchestrator. `MIGRATION_076_OWNER=AGENT_A`; B/C sem schema authority; canonical docs owner = orchestrator/integrator; production DDL e writes sensiveis serializados. Ver [PARALLEL_EXECUTION_BOARD](./PARALLEL_EXECUTION_BOARD.md). |
| PROCESS-004 | `MIGRATION_076_SOURCE_PAYLOAD_PRODUCTION_DRIFT` — migration 076 foi aplicada e rastreada com sucesso em produção, mas o pós-check full catalog encontrou um drift estrutural: `campaign_exceptions_plan_campaign_fk` em produção ficou com `(plan_version_id, empresa_id)` enquanto o HEAD canônico exige `(plan_version_id, campaign_id, empresa_id)`. Não houve linha de negócio Campaign, nem correção manual, nem retry da 076. | CLOSED_WITH_CORRECTIVE_ACTION | 076 permaneceu congelada, sem reexecução/edição. Migration 077 corretiva foi aplicada uma única vez via fonte verificada (`20260823220632 077_operation_campaign_076_payload_reconciliation`, SHA256 `11C5D07AC4A2E03DBCA738945C5CF37EEB73370738E4C7B06ADEA8B7025AB5E1`) e substituiu somente esse FK para `(plan_version_id, campaign_id, empresa_id)`. Pós-check: tracking 077 único, constraint count 1, schema canônico PASS, business writes 0. Ação corretiva permanente: pós-apply de migration deve incluir assinatura full catalog production-vs-HEAD, não apenas tracking/schema_migrations. |

## MOBILE_RELEASE_TRAIN_M1 (validações físicas do app — DEFERRED, não bloqueiam roadmap)

> Política do owner (2026-08-20): mudanças Flutter não geram APK por macrofrente; o APK oficial consolidado sai por **Codemagic**. Validações que dependem de aparelho são acumuladas aqui. **`DEFERRED ≠ DONE`.** Ver ROADMAP §MOBILE_RELEASE_TRAIN_M1.

| ID | Item | Status | Obs |
|----|------|--------|-----|
| MOBILE-M1-001 | Validar **realtime da tela de detalhe** do frete no aparelho (`detalhe_viagem_screen` atualiza sozinho: sem pull-to-refresh, sem reabrir, sem esperar o poll de 60s) | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (Onda 1 · E1.7). Aguarda APK consolidado + teste físico. |
| MOBILE-M1-002 | Validar **criação/aprovação/rejeição/cancelamento** de lançamentos web↔app em APK consolidado (criar no app → web sem refresh; aprovar/rejeitar/cancelar no web → app atualiza; cancelado permanece visível) | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (Onda 1 · E1.2/E1.7). Aguarda APK consolidado + teste físico. |
| MOBILE-M1-003 | Validar no aparelho o **enforcement de permissões V9** (P2): botão finalizar frete só com `freight.finish` efetivo; **visibilidade financeira** do motorista (`commission_only` esconde o bruto do frete e mostra a comissão; `full` no autônomo); mudança de perfil/override reflete após novo login | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (P2). `analyze`/`test`/`build` do app rodam no CI/Codemagic. Aguarda APK consolidado + teste físico. |
| MOBILE-M1-004 | Validar no aparelho o **viewer interno PDF/imagem** de documentos do frete e ePOD antes de ações externas | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (E1.4B). Aguarda APK consolidado + teste físico. |
| MOBILE-M1-005 | Validar no aparelho o **scanner multipagina** com preview, reorder, remove, retake e PDF local | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (E1.4B). OCR fora do release inicial. |
| MOBILE-M1-006 | Validar no aparelho **upload resiliente/idempotente** de documentos/ePOD com retry usando o mesmo `client_request_id` | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (E1.4B). Process death completo não é prometido; retry seguro ao retornar ao fluxo é o limite do M1. |
| MOBILE-M1-007 | Validar no aparelho fluxo **preview-first** com salvar/compartilhar/abrir fora somente após prévia | DEFERRED_TO_MOBILE_RELEASE_TRAIN_M1 | Código pronto (E1.4B). Sem upload direto para Storage pelo app. |
| MOBILE-M1-008 | Definir/validar **App Version Policy e in-app update**: latest/recommended/minimum version, severity, release notes e update oficial Play (`flexible`/`immediate`) | ROADMAP_NOT_IMPLEMENTED | Direção congelada em D-053. Não implementado nesta fase; requisito antes de maturidade Google Play. |

---

### Contagem do inventário

> **Recalculado após Dispatch V1** (PR #471). Inventário: 109 (`RBV9-INV`) + 20 (`FISC`) = **129**.

- **Total de itens:** **129** (109 RBV9-INV + 20 FISC)
- **IMPLEMENTED_VALIDATED:** 47
- **IMPLEMENTED_NOT_VISUAL_VALIDATED:** 17 (inclui Fleet technical closure e RBV9-INV-031 Dispatch V1, ambos aguardando owner visual validation)
- **PARTIAL:** 13
- **ROADMAP_ONLY:** **40** (RBV9-INV-031 dispatch real sai de ROADMAP_ONLY nesta rodada — CLOSED em produção)
- **DEFERRED:** 5 (+RBV9-INV-107 realtime horizontal scale; +RBV9-INV-108 legacy observation enforcement)
- **TECH_DEBT:** 6 (itens 101-106; + achados TD no FORENSIC)
- **UNKNOWN:** 1 (perf baseline)
- **BROKEN / STUB:** 0 / 0 (impressoras = stub intencional de segurança, fora de contagem)

_Contagem por ID (autoritativa): 108 (`RBV9-INV-001..108`) + 20 (`FISC-001..020`) = **128**. A soma das categorias (45+6+15+51+5+6+1 = 129) carrega o mesmo **+1 pré-existente** do baseline original (item `RBV9-INV-094` aparece como UNKNOWN e também compõe uma faixa PARTIAL); a quirk não foi "corrigida" para não reescrever o baseline forense._

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
