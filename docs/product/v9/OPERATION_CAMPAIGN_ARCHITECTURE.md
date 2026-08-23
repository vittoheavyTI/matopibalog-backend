# ONDA 3 - Operation Campaign / Operacao de Escoamento

> Status: `CAMPAIGN_AUDIT_FINDINGS_FROZEN=true`; `ARCHITECTURE_ONLY=true`; `NO_PRODUCTION_DDL=true`; `NO_CAMPAIGN_IMPLEMENTATION=true`.
> Baseline auditado em 2026-08-23 sobre `origin/main=988bf3e5e8831f4833255e38293581002c052f88`.

## Objetivo

Operation Campaign representa um objetivo operacional de escoamento, nao um agrupamento simples de fretes. O usuario declara demanda, restricoes e recursos; o Matopiba gera plano, cenarios, capacidade necessaria, pendencias e excecoes sob aprovacao humana.

A unidade de trabalho deixa de ser "criar frete manualmente" e passa a ser "declarar objetivo operacional e coordenar execucao".

## Baseline

- `FLEET_OVERALL_TECHNICAL_STATUS=CLOSED`.
- `MIGRATION_074=APPLIED+TRACKED`.
- `MIGRATION_075=APPLIED+TRACKED`.
- `MIGRATION_075_TRACKING=20260823012050 075_fleet_operational_closure`.
- `PR453_MERGE_SHA=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`.
- `DOCS_PR=454 MERGED`.
- `PROCESS_002=CLOSED_WITH_CORRECTIVE_ACTION`.
- `PRODUCTION_HEALTH=200`.
- `OWNER_VISUAL_VALIDATION=PENDING`.
- Campaign tables em producao: `0`.
- Ultima migration real no repo: `075_fleet_operational_closure.sql`.
- Proxima migration proposta, sem criar nesta execucao: `076_operation_campaign_foundation.sql`.

## Auditoria Delta

| Domain | Current authority | Tables | Backend | Web | Realtime | Permissions | Scope | Reusability | Gaps |
|---|---|---|---|---|---|---|---|---|---|
| `FREIGHT` | `fretes` e `fretesController` | `fretes`, `freight_vehicle_assignments` | `/fretes`, `freteService` | telas atuais de frete/torre/relatorios | parcial via SSE para lancamentos e app detalhe | `freight.view/create/manage/finish` | `unidade_operacional_id` | `REUSE_WITH_ADAPTER` | Campaign refs ausentes; origem/destino textuais; produto/cargo sem autoridade canonica |
| `FLEET_ASSET` | `fleet_assets` | `fleet_assets` | `/fleet/assets` | `/frota` | nao dedicado | `fleet.view/manage` + entitlement `fleet` | por unidade | `REUSE_AS_CAPACITY_INPUT` | capacidade so em `useful_capacity_kg`; regras de compatibilidade por produto ainda faltam |
| `VEHICLE_COMPOSITION` | `vehicle_compositions` + members | `vehicle_compositions`, `vehicle_composition_members` | `/fleet/compositions` | `/frota` | nao dedicado | `fleet.view/manage` | por unidade | `REUSE_AS_PRIMARY_CAPACITY` | capacidade de composicao deve ser calculada por membros/metadata; nao hardcode |
| `DRIVER` | `usuarios`/`motoristas` | `usuarios`, `motoristas` | fretes/fleet services | motoristas e frota | app recebe eventos indiretos | `drivers.*`, `freight.*`, `fleet.*` | motorista tem unidade | `REUSE` | disponibilidade temporal por agenda/campaign ainda nao existe |
| `DRIVER_ASSIGNMENT` | vinculo temporal Fleet | `driver_vehicle_assignments` | `/fleet/driver-assignments`, `/fleet/driver-handoffs` | `/frota` | nao dedicado | `fleet.manage` | target asset/composition | `REUSE_AS_AVAILABILITY_INPUT` | precisa consulta temporal para janela de Campaign |
| `FREIGHT_VEHICLE_ASSIGNMENT` | snapshot/vinculo frete x recurso | `freight_vehicle_assignments` | `/fleet/freight-assignments` | detalhe Fleet | nao dedicado | `fleet.manage` | frete e target | `REUSE_FOR_MATERIALIZED_FREIGHT` | Campaign ainda nao referencia planned trip/plan version |
| `DOCUMENTS` | por frete e por ativo | `frete_documentos`, `asset_documents`, eventos/ePOD/ocorrencias | `/fretes/:id/documentos`, `/fleet/assets/:id/documents` | documentos e frota | indireto | `documents.*`, `fleet.*` | por frete/asset | `REUSE_WITH_CAMPAIGN_CHECKLIST` | documentos de Campaign e checklist/template ainda nao existem |
| `MAINTENANCE` | eventos de frota | `maintenance_events` | `/fleet/maintenance` | `/frota` | nao dedicado | `fleet.*` | asset unit | `REUSE_AS_ELIGIBILITY_SIGNAL` | regra objetiva de blocker/warning precisa ser implementada |
| `TIRES` | estoque/instalacao/eventos | `tires`, `tire_installations`, `tire_events` | `/fleet/tires` | `/frota` | nao dedicado | `fleet.*` | tire unit | `REUSE_AS_WARNING_SIGNAL` | tire blockers so quando houver regra objetiva |
| `ODOMETER` | legado no frete + eventos Fleet | `fretes.km_*`, `odometer_events` | fretes + `/fleet/odometer-events` | app/web | detalhe app | `freight.finish`, `fleet.*` | frete/asset | `REUSE` | check-in/out formal do frete ainda roadmap |
| `LAUNCHES` | despesas/abast/vales audit-safe | `despesas`, `abastecimentos`, `vales`, `lancamento_eventos` | workflow + controllers | financeiro/acerto | SSE vivo | `launch.*` | frete/motorista | `REUSE_AS_ACTUAL_COST` | Campaign estimates nao devem duplicar actuals |
| `OPERATIONAL_FINANCE` | helper financeiro operacional | fretes/lancamentos | `agregacaoFinanceiraFretes` | dashboard/relatorios | indireto | `finance.operational.*` | operacional | `REUSE_AS_ACTUAL_FINANCE` | cost estimate da Campaign precisa ficar separado de actual |
| `VERIFIABILITY` | E1.5 code foundation | code-only + ledgers existentes | verifier/invariants/correlation | diagnostics read-only | nao engine proprio | super-admin diag | global/read-only | `REUSE_AS_CAMPAIGN_VERIFIER` | persistencia de runs/findings ainda futura |

## Gaps De Dados

| Capability | Status | Nota |
|---|---|---|
| canonical cargo/product | `MISSING` | `fretes` nao tem produto/carga canonica; Campaign precisa `cargo_name/product_ref` inicial textual controlado. |
| quantity/weight | `PARTIAL` | `fretes.toneladas` existe apenas para modalidade `tonelada_km`; Campaign precisa quantidade alvo propria. |
| unit precision | `MISSING` | definir `quantity_unit` e `numeric(14,3)` para toneladas/kg/viagens/volume. |
| location model | `PARTIAL` | frete usa `origem`/`destino` texto; ORG_SCOPE tem unidades, mas nao endereco/geocode operacional normalizado. |
| composition capacity | `PARTIAL` | asset tem `useful_capacity_kg`; composition capacity deve vir de composicao/membros, nao constante. |
| availability | `PARTIAL` | assignments e maintenance sao temporais; nao existe calendario/reserva de Campaign. |
| route/distance | `MISSING` | sem provider; V1 deve aceitar distancia manual/opcional. |
| driver availability | `PARTIAL` | motorista ativo + assignment; falta indisponibilidade calendario. |
| campaign docs | `MISSING` | documentos de frete/ativo existem; checklist/documento de Campaign ainda nao. |

## Modelo De Autoridade

- `FREIGHT_AUTHORITY=fretes + fretesController + freight permissions`.
- `FLEET_AUTHORITY=fleet_assets + vehicle_compositions + fleetService`.
- `DRIVER_AUTHORITY=usuarios/motoristas + driver_vehicle_assignments`.
- `DOCUMENT_AUTHORITY=frete_documentos + asset_documents; campaign documents separados no futuro`.
- `QUANTITY_WEIGHT_AUTHORITY=Campaign demand/plan para target/planned; frete finalizado para actual executado`.
- `LOCATION_AUTHORITY=campaign_locations V1; fretes atuais mantem origem/destino textual materializado`.
- `FINANCIAL_AUTHORITY=FINANCE_OPERATIONAL para actual; Campaign armazena estimate/assumptions somente`.
- `REALTIME_AUTHORITY=Backend Node SSE + realtimeBus abstraction`.
- `VERIFIABILITY_AUTHORITY=E1.5 verifier/invariant registry/event envelope`.

## Entidade E Schema V1 Propostos

`PROPOSED_SCHEMA_V1=operation_campaigns, campaign_locations, campaign_demands, campaign_plan_versions, campaign_plan_scenarios, campaign_planned_trips, campaign_approvals, campaign_exceptions`.

### `operation_campaigns`

Raiz do objetivo operacional. Campos conceituais: `id`, `empresa_id`, `reference_code`, `name`, `description`, `cargo_name`, `status`, `planning_status`, `execution_status`, `priority`, `planned_start`, `planned_end`, `timezone`, `created_by`, `approved_plan_version_id`, `cancelled_by`, `cancelled_at`, `cancellation_reason`, `metadata`, `created_at`, `updated_at`.

### `campaign_locations`

Origem/destino normalizados por Campaign. Campos: `id`, `empresa_id`, `campaign_id`, `kind` (`origin|destination`), `name`, `location_type`, `unidade_operacional_id`, `address_text`, `latitude`, `longitude`, `time_window_start`, `time_window_end`, `target_quantity`, `priority`, `constraints`, `created_at`.

Justificativa: Campaign precisa multi-origem e pode futuramente multi-destino. Nao usar uma unica coluna texto como autoridade.

### `campaign_demands`

Demanda mensuravel por campanha/local/produto. Campos: `id`, `empresa_id`, `campaign_id`, `origin_location_id`, `destination_location_id`, `cargo_name`, `target_quantity numeric(14,3)`, `quantity_unit`, `planned_quantity`, `allocated_quantity`, `executed_quantity`, `metadata`.

V1 suporta toneladas como unidade principal, mas nao fecha a arquitetura para kg/volume/viagens.

### `campaign_plan_versions`

Versao imutavel do plano. Campos: `id`, `empresa_id`, `campaign_id`, `version_number`, `status`, `rules_version`, `resource_snapshot`, `assumptions`, `constraints`, `result_summary`, `generated_by`, `generated_at`, `approved_by`, `approved_at`, `superseded_by`.

Planejamento aprovado nunca e mutado; replan cria nova versao.

### `campaign_plan_scenarios`

Cenarios dentro de uma versao. Campos: `id`, `empresa_id`, `plan_version_id`, `scenario_key`, `label`, `strategy`, `capacity_gap_quantity`, `capacity_gap_trips`, `warnings`, `score_metadata`.

V1 deve incluir pelo menos `own_capacity_only`; parceiro externo fica como gap estruturado, nao integracao.

### `campaign_planned_trips`

Viagens planejadas antes de virar frete. Campos: `id`, `empresa_id`, `campaign_id`, `plan_version_id`, `scenario_id`, `origin_location_id`, `destination_location_id`, `planned_quantity numeric(14,3)`, `quantity_unit`, `required_capacity_kg`, `candidate_asset_id`, `candidate_composition_id`, `candidate_driver_id`, `planned_departure_at`, `planned_arrival_at`, `status`, `constraint_metadata`, `materialized_frete_id`, `materialized_at`, `client_request_id`.

Planned trip nao e frete; materializacao e passo explicito.

### `campaign_approvals`

Registro append/audit-safe de decisao. Campos: `id`, `empresa_id`, `campaign_id`, `plan_version_id`, `action`, `actor_user_id`, `reason`, `metadata`, `occurred_at`.

Approval por permission, nao role hardcoded.

### `campaign_exceptions`

Fila de atencao e bloqueios/warnings. Campos: `id`, `empresa_id`, `campaign_id`, `plan_version_id`, `planned_trip_id`, `exception_type`, `severity`, `status`, `evidence`, `acknowledged_by`, `resolved_by`, `resolution_reason`, `created_at`, `updated_at`.

Categorias iniciais: `INSUFFICIENT_CAPACITY`, `NO_DRIVER`, `VEHICLE_UNAVAILABLE`, `DOCUMENT_BLOCK`, `MAINTENANCE_CONFLICT`, `WINDOW_RISK`, `UNASSIGNED_TRIP`, `EXECUTION_DELAY`, `FREIGHT_CANCELLED`.

## State Machines

### Campaign

| From | To | Permission | Preconditions | Reason | Idempotency | Side effects |
|---|---|---|---|---|---|---|
| none | `DRAFT` | `campaign.create` | entitlement + scope | optional | `client_request_id` | create objective |
| `DRAFT` | `PLANNING` | `campaign.plan` | valid demand/location | no | plan command id | snapshot resources |
| `PLANNING` | `READY_FOR_REVIEW` | system via service | generated plan has result | no | plan version unique | exceptions/warnings |
| `READY_FOR_REVIEW` | `APPROVED` | `campaign.approve` | current plan not stale or stale accepted by policy | yes | approval action unique | records approval |
| `APPROVED` | `DISPATCH_READY` | `campaign.dispatch` | selected trips valid | optional | materialization request | enables materialization |
| `DISPATCH_READY` | `IN_EXECUTION` | system/service | at least one frete materialized/active | no | derived | progress starts |
| `IN_EXECUTION` | `COMPLETED` | `campaign.manage` | remaining = 0 and no open blockers | optional | completion action | final progress snapshot |
| any active | `CANCELLED` | `campaign.manage` | reason required | yes | cancel action unique | cancels/supersedes non-materialized trips only |

### Plan Version

`DRAFT -> GENERATED -> READY_FOR_REVIEW -> APPROVED -> SUPERSEDED`.

Alternative terminal: `REJECTED`. A Campaign nao volta para `DRAFT` quando um plano e refeito; ela ganha nova plan version.

### Exception

`OPEN -> ACKNOWLEDGED -> RESOLVED` ou `OPEN/ACKNOWLEDGED -> DISMISSED`, sempre com ator, motivo e evidencia quando aplicavel.

## Planner V1

- `CAPACITY_SOURCE_OF_TRUTH=vehicle_compositions` quando composicao existir; fallback para `fleet_assets.useful_capacity_kg` somente para ativo individual compatível.
- `PLANNING_ALGORITHM_V1=deterministic_greedy_planner`.
- `MULTI_ORIGIN_ALLOCATION_V1`: ordenar origens por prioridade, janela mais cedo, ordem de criacao e id como tie-breaker; alocar recursos elegiveis por maior capacidade util, menor conflito e id como tie-breaker.
- Calculo inicial: `required_trips = ceil(target_quantity_kg / usable_capacity_kg)`, ajustado por origem, capacidade do recurso, partial final trip e janela.
- Sem solver sofisticado no primeiro release. O plano e human-adjustable com motivo/auditoria.

## Snapshot, Stale Plan E Reserva

- `RESOURCE_SNAPSHOT_MODEL`: cada plan version salva assumptions compactas: recursos candidatos, capacidades usadas, status, janelas, documentos/maintenance blockers, rule version e timestamp. Nao copia tabelas inteiras.
- `STALE_PLAN_POLICY`: antes de aprovar e antes de materializar, revalidar status/capacidade/assignment/documentos/manutencao. Divergencia HARD bloqueia e exige replan; divergencia WARNING exige aceite consciente.
- `RESERVATION_POLICY=NO_HARD_RESERVATION_IN_CAMPAIGN_A`. Campaign-A planeja sem bloquear recurso; Campaign-B pode introduzir soft reservation se conflitos reais justificarem.

## Materializacao Em Frete

- `FREIGHT_MATERIALIZATION_MODEL=approved_plan_selected_trips_to_fretes`.
- Frete continua autoridade de execucao. Campaign nunca substitui `fretes`.
- Frete materializado deve gravar referencias equivalentes a `campaign_id`, `plan_version_id`, `planned_trip_id` em futura migration.
- `MATERIALIZATION_IDEMPOTENCY`: chave unica por `planned_trip_id` e `client_request_id`.
- `MATERIALIZATION_ATOMICITY`: usar RPC transacional ou batch command reconciliavel; nunca loop frontend `POST /fretes` por viagem.
- Grandes campanhas: chunk de materializacao com status por lote; evitar payload gigante e transacao unica para 500 viagens quando desnecessario.

## Progress E Replanning

- `PROGRESS_SOURCE_OF_TRUTH`: planned vem de `campaign_planned_trips`; dispatched/materialized vem das refs de frete; in transit vem de fretes ativos; delivered/completed vem de fretes finalizados; actual quantity vem da quantidade canonica do frete finalizado quando existir, senao exige gap/ajuste.
- Evitar double count por planned_trip materializado uma unica vez.
- `REPLANNING_MODEL`: replan cria nova plan version para demanda restante. Fretes ja criados ou executados nao sao reescritos.
- Se quantidade planejada != realizada, Campaign mostra planned, actual e variance; nao altera target historico silenciosamente.

## Authorization

- `PROPOSED_ENTITLEMENT=operation_campaign`.
- Entitlement nao existe hoje em producao; deve ser criado pela futura 076 com politica comercial conservadora.
- `PROPOSED_PERMISSIONS=campaign.view, campaign.create, campaign.plan, campaign.approve, campaign.dispatch, campaign.manage`.
- `campaign.plan` monta ou recalcula plano.
- `campaign.approve` aprova plan version.
- `campaign.dispatch` libera/materializa viagens aprovadas.
- `campaign.manage` cancela/completa/ajusta operacao.
- `SCOPE_MODEL`: Campaign pode atravessar multiplas unidades quando o usuario tiver escopo regional/global correspondente. Usar association/scope por locations/resources, nao uma unica `unidade_operacional_id` na raiz como autoridade exclusiva.
- `TENANT_MODEL`: `empresa_id` obrigatorio em todas as tabelas; tenant vem do auth/contexto backend, nunca do payload como authority; FKs compostas `(id, empresa_id)` quando referenciar recursos.

## Boundaries

- `PLANNING_ENGINE_BOUNDARY=OPERATION_ORCHESTRATOR_DETERMINISTIC`, sem LLM.
- `DISPATCH_BOUNDARY`: Campaign decide necessidade e prepara viagens; Dispatch decide quem executa. Offer-to-eligible/first valid acceptance atomico fica para Campaign-B/B2.
- `ROUTE_INTELLIGENCE_BOUNDARY`: `RouteProvider` futuro, sem Google/TomTom agora. V1 funciona com distancia manual/opcional e route metadata nulo.
- `PARTNER_NETWORK_BOUNDARY`: Campaign produz `capacity_gap`; parceiro/rede resolve depois. Parceiros nao entram no tenant do embarcador.
- `SHIPPER_PORTAL_BOUNDARY`: futuro pode originar/acompanhar Campaign por snapshot compartilhado; nao criar agora.
- `AI_AGENT_BOUNDARY`: IA coleta intencao, explica plano e chama tools normais com confirmacao; nao escreve DB diretamente, nao inventa capacidade e nao ignora approval.
- `WORKFLOW_ENGINE_POLICY=NOT_NOW`: state machines explicitas + services; jobs/outbox apenas quando necessario.
- `OUTBOX_POLICY`: sem `campaign_outbox` em Campaign-A salvo se materializacao/route async exigir efeito externo.

## Verifiability

`PROPOSED_INVARIANTS`:

- `campaign.target.non_negative.v1`.
- `campaign.plan.quantity_balanced.v1`.
- `campaign.trip.tenant_consistency.v1`.
- `campaign.trip.capacity_not_exceeded.v1`.
- `campaign.approved_plan.version_consistency.v1`.
- `campaign.materialization.idempotency.v1`.
- `campaign.progress.no_double_count.v1`.
- `campaign.stale_plan.revalidated_before_materialization.v1`.

`PLANNING_VERIFICATION_MODEL`: todo plano gerado produz relatorio com `INPUTS`, `ASSUMPTIONS`, `CONSTRAINTS`, `RESULT`, `WARNINGS`, `UNALLOCATED_DEMAND` e `RESOURCE_SNAPSHOT`.

`CORRELATION_AUDIT_MODEL`: reusar E1.5 (`request_id`, `correlation_id`, `operation_id`, `causation_id`) e event envelope canônico. Eventos SSE candidatos: `campaign.created`, `campaign.plan.generated`, `campaign.plan.approved`, `campaign.trip.materialized`, `campaign.progress.changed`, `campaign.exception.created`, `campaign.completed`.

## UX Futura

Create Campaign guiado:

1. O que precisa transportar?
2. Quanto?
3. De onde?
4. Para onde?
5. Ate quando?
6. Quais restricoes?
7. Planejar.

Dashboard Campaign:

- header com objetivo, target, progresso, janela e status;
- `Precisa da sua atencao`;
- progresso;
- plano;
- viagens ativas;
- origens;
- capacidade;
- excecoes.

O sistema deve explicar com evidencia: capacidade insuficiente, motoristas em conflito, documentos pendentes, manutencao, janela de risco e demanda nao alocada.

## Test Strategy

- PG: tenant/RLS, scope, state machines, versioning, approval, idempotency, concurrency, replan, materialization.
- Backend: determinismo do planner, calculo de capacidade, multi-origem, permissions, entitlements, scope, integracao com frete legado e erros amigaveis.
- Web: guided create, plan review, approval, attention, progress, exceptions, zero-state.
- Property tests: soma planejada, nao negativo, capacidade nao excedida, ids unicos, determinismo com mesmo input/snapshot, replan preserva executado.
- Performance harness futuro: 10, 100 e 500 planned trips, sem inventar benchmark antes de medir.

## Threat Matrix

| Risk | Severity | Mitigation |
|---|---|---|
| tenant escape/cross-unit resource | `HIGH` | `empresa_id` em tudo, FKs compostas, scope por recurso/local e backend enforcement |
| approval bypass | `HIGH` | `campaign.approve`, plan version state, audit append-only |
| stale plan approval | `HIGH` | revalidacao antes de approval/materialization |
| duplicate freights on retry | `HIGH` | idempotency por planned trip/request e RPC/batch reconciliavel |
| capacity invented by UI/AI | `HIGH` | capacity source from Fleet snapshot, AI not authority |
| double count progress | `MEDIUM` | one planned_trip -> one materialized frete; actual from frete finalizado |
| route provider failure | `MEDIUM` | manual distance fallback; route optional |
| external partner tenant leakage | `HIGH` | partner receives snapshot/offer, never tenant access |

## Slices

### CAMPAIGN-A

`DOMAIN + PLANNING + VERSIONING + APPROVAL + VERIFIABILITY`.

Inclui schema 076, state machines, planner deterministic V1, capacity calculation, multi-origin demand, plan versions/scenarios, approval, permissions, scope, entitlement, invariants, backend API e web create/review inicial.

Nao inclui materializacao massiva em fretes reais se a seguranca exigir separar. Se materializacao minima entrar em A, deve ser idempotente e atras de approval.

### CAMPAIGN-B

`MATERIALIZATION + DISPATCH PREP + OPERATIONAL UX + EXECUTION/PROGRESS`.

Inclui bulk materialization, refs em fretes, assignment/dispatch-ready, progress, exceptions, replanning, realtime e dashboard operacional. Dispatch offers atomicos podem virar B2 se ficarem grandes.

## Owner Decisions

`OWNER_DECISION_REQUIRED_1`

Question: Entitlement comercial `operation_campaign` nasce incluido para os mesmos planos que `fleet` ou como add-on/opcional?

Options: `same_as_fleet` (recommended para primeiro piloto), `optional_paid`, `enterprise_only`.

Impact: muda seed de plano na migration 076, mas nao bloqueia arquitetura.

`OWNER_DECISION_REQUIRED_2`

Question: Campaign-A deve materializar fretes ou parar em approved plan?

Options: `approved_plan_only` (recommended), `include_minimal_materialization`, `defer_all_materialization_to_B`.

Impact: controla tamanho/risco da primeira implementation.

`OWNER_DECISION_REQUIRED_3`

Question: Multi-unidade no primeiro release fica permitido para usuarios regionais/globais?

Options: `allow_with_scope` (recommended), `single_unit_only`, `global_only`.

Impact: afeta schema de associations e UX de selecao.

## Status

- `BLOCKERS=0`.
- `HIGHS=0` para arquitetura; riscos altos foram modelados com mitigacao antes de implementation.
- `MEDIUMS`: product/cargo authority, location normalization, composition capacity aggregation, route fallback, owner visual validation.
- `LOWS`: naming final de UI, relatorio PDF futuro.
- `MIGRATION_REQUIRED=true`.
- `PROPOSED_MIGRATION=076_operation_campaign_foundation.sql`.
- `NO_PRODUCTION_DDL=true`.
- `NEXT_STATUS=READY_FOR_OWNER_CAMPAIGN_ARCHITECTURE_DECISIONS`.
