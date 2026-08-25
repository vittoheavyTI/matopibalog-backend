# Matopiba Log V9 - Parallel Execution Board V1

> Status: `PARALLEL_EXECUTION_BOARD_V1_EXECUTED=true`; `CAMPAIGN_A_TECHNICAL_STATUS=CLOSED`; `MOBILE_M1_TECHNICAL_STATUS=CLOSED`; `SYSTEMIC_QUALITY_TECHNICAL_STATUS=CLOSED`; `PORTAL_COMMERCIAL_V2=CLOSED`; `AI_COPILOT_V1=CLOSED`; `OPERATION_COMMAND_CENTER_V2=CLOSED`; `CAMPAIGN_B_TECHNICAL_STATUS=CLOSED`; `ROUTE_INTELLIGENCE_V1=CLOSED`; `CAMPAIGN_C_TECHNICAL_STATUS=CLOSED`; `PORTAL_A_TECHNICAL_STATUS=CLOSED`; `PORTAL_B_TECHNICAL_STATUS=CLOSED`; `E3_5_STATUS=TECHNICALLY_CLOSED`.
> Takeover 2026-08-24: Codex indisponível até 2026-08-30 → Claude assumiu `CAMPAIGN_B_COMPLETION` (PR #464 mergeado, migration 078 aplicada uma vez), depois `ROUTE_INTELLIGENCE_V1` (PR #467) e `CAMPAIGN_C_PROGRESS_AND_DISPATCH_READINESS` (PR #469, sem migration) fora do modelo de 3 writers paralelos (execução sequencial, solo), atuando como `CANONICAL_DOC_INTEGRATOR` temporário. Current main após Campaign-C: `95fcded985470d059519008562a99fdb8dac3fd1`.
> Base original: `PARALLEL_BATCH_V1_BASE_SHA=cdf6b4ca62d84d2cb651ff2de0a8134c5bc2a715` (`origin/main`, PR #455 Operation Campaign architecture frozen). Current reconciled main after Campaign-A closure: `32d8fe3e8824d1a8bc5be89ad6f5cdf86ae5c316`.

## Objetivo

Preparar a execucao paralela da proxima onda sem iniciar implementacao. Este board congela ownership, branches, worktrees, zonas proibidas, authority de migration, gates, dependencias, ordem de integracao e contrato de handoff para tres writer agents isolados e um reviewer/integrator read-only.

## Owner Decisions Congeladas

| Campo | Valor congelado | Efeito |
|---|---|---|
| `CAMPAIGN_ENTITLEMENT_KEY` | `operation_campaign` | Campaign tem entitlement tecnico proprio; nao herda autorizacao de Fleet, Freight ou Reports por implicacao. |
| `OPERATION_CAMPAIGN_COMMERCIAL_MAPPING` | `DEFERRED_SEPARATE_COMMERCIAL_DECISION` | Seeds comerciais de producao ficam `DEFAULT_DENY / NOT MAPPED` ate decisao comercial explicita. |
| `CAMPAIGN_A_END_STATE` | `APPROVED_PLAN` | Campaign-A termina com plano aprovado e verificavel, pronto para materializacao futura; nao escreve `fretes`. |
| `CAMPAIGN_MULTI_UNIT_V1` | `SUPPORTED_WITH_ALL_UNITS_IN_EFFECTIVE_SCOPE` | Campaign pode envolver uma ou varias unidades, desde que o usuario tenha scope efetivo sobre todas elas. |

Autorizacao futura de Campaign = `ENTITLEMENT AND PERMISSION AND SCOPE`. Nao usar role hardcoded como autoridade.

## Modelo De Execucao

- `PARALLEL_EXECUTION_V1=3_WRITER_AGENTS_PLUS_1_READ_ONLY_REVIEWER_PLUS_OWNER_ORCHESTRATOR`.
- `PARALLEL_WRITER_LIMIT=3`.
- `CANONICAL_DOC_OWNER=ORCHESTRATOR/INTEGRATOR`.
- `PRODUCTION_SCHEMA_WRITER_COUNT<=1`.
- `PRODUCTION_SCHEMA_MAX_CONCURRENT=1`.
- `PRODUCTION_SENSITIVE_WRITE_MAX_CONCURRENT=1`.
- `MAIN_POLICY=main_nao_e_workspace_de_desenvolvimento`.

Writers A/B/C nao editam normalmente os documentos canonicos `docs/product/v9/ROADMAP.md`, `MASTER_LEDGER.md`, `CONTEXT_BRIDGE.md` e `DECISIONS.md`. Mudancas canonicas passam pelo orchestrator/integrator.

## Execution Board

| Batch | Agent | Macrofront | Branch | Worktree | Base SHA | Schema authority | Status | PR | Migration | Gate | Integration order |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V1 | `AGENT_A_NAME=CAMPAIGN_A_WRITER` | Campaign-A foundation | `feature/operation-campaign-foundation` | `worktree-campaign-a` | reconciled with `4faa735b5b1760fb159fbf9436f7d8eef0665b0e` | `MIGRATION_076_OWNER=AGENT_A`; `MIGRATION_077_OWNER=CAMPAIGN_A_WRITER` | `CLOSED_IN_PRODUCTION` | #457 merged (`32d8fe3e8824d1a8bc5be89ad6f5cdf86ae5c316`) | 076 applied/tracked once; 077 applied/tracked once (`20260823220632`) | Gate 077 executed and closed; no 078 authorization | Merged/deployed after 077, CI and read-only smokes |
| V1 | `AGENT_B_NAME=MOBILE_M1_WRITER` | Mobile Release Train M1 | `feature/mobile-release-train-m1` | `worktree-mobile-m1` | `cdf6b4ca62d84d2cb651ff2de0a8134c5bc2a715` | `NONE` | `CLOSED_TECHNICAL` | #458 merged (`a257e0f6b50e1d7d9f6f64113df768cdc6f7339f`) | `NONE_ALLOWED` | Physical validation/Play publication deferred | Merged before A; backend overlap reconciled safely |
| V1 | `AGENT_C_NAME=SYSTEMIC_QUALITY_WRITER` | Reports/performance/systemic quality | `feature/systemic-quality-reports-performance` | `worktree-systemic-quality` | `a257e0f6b50e1d7d9f6f64113df768cdc6f7339f` | `NONE` | `CLOSED_IN_PRODUCTION` | #459 merged (`35b840281a711bc2a0264358662e548cc6ecc1fa`) | `NONE_ALLOWED` | No schema required | Railway deploy `f81f64f0-2809-4619-82e3-1d833b33b697` SUCCESS |
| V1 | `AGENT_R_NAME=PARALLEL_INTEGRATION_REVIEWER` | Cross-front review/integration | read-only | read-only | `cdf6b4ca62d84d2cb651ff2de0a8134c5bc2a715` | `NONE` | `COMPLETED` | review only | `NONE_ALLOWED` | No product writes | Reviewed integration order through Campaign-A closure |

## Agent Ownership

### Agent A - Campaign-A Writer

Owns Campaign-A domain, schema, planner, approval, verifiability, permissions/scope integration and initial web create/review UX.

Owned areas:

- Campaign backend domain/routes/controllers/services.
- Campaign database schema and PG tests.
- Campaign web pages/components for create/review/approve.
- Campaign verifier rules and evidence contracts.
- Campaign permission, entitlement and scope integration.

Allowed end state: `APPROVED_PLAN`. Agent A must not materialize freight, bulk-create `fretes`, implement dispatch offers, execution tracking, progress from real freights, or replanning after execution.

Forbidden areas: Campaign-B, freight bulk materialization, dispatch offers, partner network, RouteProvider vendor integration, AI agent, Flutter Campaign, billing, Asaas, fiscal. No production migration without separate owner gate.

### Agent B - Mobile M1 Writer

Owns Flutter/mobile release train M1, mobile test infra, Codemagic config when needed, app version/update client UX and existing M1 experiences.

Schema authority: `AGENT_B_SCHEMA_AUTHORITY=NONE`. Agent B cannot create/alter schema, edit migration 076, apply DDL, or implement Campaign backend. If schema is needed, stop the subitem and report `MIGRATION_REQUEST_PENDING`.

### Agent C - Systemic Quality Writer

Owns reports, PDF/report parity, performance, N+1, pagination, query efficiency, systemic diagnostics, read-only verifier coverage, benchmark harness and operational quality.

Schema authority: `AGENT_C_SCHEMA_AUTHORITY=NONE`. Agent C cannot create migrations or alter tables. If schema is needed, document/defer and do not create 077.

Forbidden areas: Campaign schema/planner, Flutter ownership, billing/fiscal/Asaas, Freight authority rewrite.

### Agent R - Parallel Integration Reviewer

Read-only reviewer/integrator. May read all branches/PRs, inspect diffs, CI, migrations and dependencies, run isolated read-only checks/tests, produce review and recommend merge order.

Cannot edit implementation, fix code, create migration, commit product code, force push, or resolve conflicts silently.

## File Ownership Matrix

| Area/file family | Owner | Shared/critical policy |
|---|---|---|
| `docs/product/v9/DECISIONS.md` | Orchestrator/Integrator | Writers do not edit during normal implementation. |
| `docs/product/v9/ROADMAP.md` | Orchestrator/Integrator | Updated after integration, not inside writer scope. |
| `docs/product/v9/MASTER_LEDGER.md` | Orchestrator/Integrator | Canonical backlog status remains serial. |
| `docs/product/v9/CONTEXT_BRIDGE.md` | Orchestrator/Integrator | Handoff updated by integrator only. |
| Campaign backend/domain/web/tests | Agent A | B/C must not implement Campaign backend or schema. |
| Flutter/app release train | Agent B | A/C must not own Flutter M1. A must not build Campaign mobile in Batch V1. |
| Reports/performance/diagnostics | Agent C | C does not build Campaign reports in Batch V1. |
| Permission resolver/core | Shared critical | Serialize edits; if multiple agents need it, extract common PR or owner gate. |
| Verifier framework core | Shared critical | Serialize edits; Campaign-specific rules may live under Agent A ownership. |
| Freight core authority | No writer owner in Batch V1 | Keep stable; Campaign-A avoids Freight mutation because end state is approved plan. |
| Fleet authority | Stable dependency | Campaign-A may read/use Fleet; no opportunistic refactor. |

## Authority Collision Matrix

| Authority | Batch V1 rule |
|---|---|
| Campaign schema | Agent A only. |
| Migration 076 | Reserved to Agent A: `076_operation_campaign_foundation.sql`. |
| Migration 077/078 | Not available to B/C in Batch V1. |
| Production DDL | Max one concurrent writer; owner gate required. |
| Production sensitive writes | Max one concurrent sensitive writer; owner gate required. |
| Permission resolver/core | Shared critical; serialize if touched. |
| Verifier core | Shared critical; serialize if touched. |
| Freight core | Stable; no Batch V1 owner. |
| Billing/Asaas | Forbidden in Batch V1. |
| Fiscal | Forbidden in Batch V1; not a fourth writer. |

## Dependency Graph

```text
Fleet/Freight authority (stable) -> Campaign-A reads capacity/scope inputs
E1.5 Verifiability (stable) -> Campaign-A adds Campaign rules
Existing backend contracts -> Mobile M1 consumes existing APIs
Stable domains -> Systemic Quality improves reports/perf without Campaign-specific work
Agent R -> observes A/B/C and recommends integration order
```

Campaign-A has no dependency on B/C. Mobile M1 has no dependency on Campaign-A. Systemic Quality has no Campaign-specific dependency.

## Migration Single-Flight

- `MIGRATION_RESERVED=076_operation_campaign_foundation.sql`.
- `MIGRATION_076_OWNER=AGENT_A`.
- `PRODUCTION_SCHEMA_WRITER_COUNT<=1`.
- Agent B/C cannot create 076/077/078.
- Schema need outside Agent A becomes `MIGRATION_REQUEST_PENDING`.
- Even Agent A has no automatic production migration authority.

Future production flow for 076:

1. Code and tests complete in Agent A branch.
2. PG/local/CI pass.
3. PR review complete.
4. Migration hash/source frozen.
5. G0 precheck complete.
6. Owner migration gate explicit.
7. Apply once via verified source text.
8. Tracking and schema postcheck complete.
9. Merge/deploy only after gates pass.

Process rule: `PROCESS-002` applies to all future production migrations. Full-file read, source hash, signature validation, no manual SQL reconstruction, apply once, tracking and postcheck.

## Drift And Merge Policy

Before each writer PR merge, fetch main and record:

- `BASE_SHA`.
- `CURRENT_MAIN`.
- `OWN_HEAD`.
- `DIRTY_STATE`.

Classify drift as one of:

- `NO_RELEVANT_DRIFT`.
- `SAFE_REBASE_REQUIRED`.
- `CONTRACT_REVIEW_REQUIRED`.
- `BLOCKING_CONFLICT`.

Rebase/merge main only when authorized by future prompt and conflict-free; rerun affected tests after any base movement. Integration order is dependency-aware, not chronological. B or C may merge before A. A may wait on migration gate.

## Review Checkpoints

- After each agent findings/scope pass.
- Before each PR merge.
- Before migration 076 owner gate.
- After all Batch V1 merges.

Agent R watches API contracts, permissions, entitlement assumptions, schema assumptions, shared types, storage contracts, realtime event changes and verifier framework collisions.

## Cross-Front Final Testing

Final integration should include:

- Backend full suite.
- Web full suite/build.
- Flutter validation for touched mobile scope.
- PG suite where applicable.
- SEC-1.
- Read-only production smoke.

## Completion Contract

Each writer must report:

```text
AGENT=
MACROFRONT=
BASE_SHA=
FINAL_HEAD=
PR=
FILES_CHANGED=
SHARED_CORE_FILES_CHANGED=
MIGRATION_REQUIRED=
MIGRATION_FILE=
TESTS=
CI=
BLOCKERS=
HIGHS=
MEDIUMS=
DEFERRED=
PRODUCTION_WRITES=
ENV_CHANGED=
ASAAS_TOUCHED=
READY_FOR_INTEGRATION_REVIEW=
```

## Stop Contract

Any writer must stop and report before continuing if it hits:

- Scope expansion beyond assigned macrofront.
- Schema conflict or need outside assigned authority.
- Security authority unclear.
- Tenant/scope boundary unclear.
- Unexpected production write.
- Shared-core collision that cannot be isolated.

## Prompt Pack Registry

Prompt IDs are reserved, but implementation prompts are not generated in this execution:

- `PROMPT_A=CAMPAIGN_A_IMPLEMENTATION`.
- `PROMPT_B=MOBILE_M1_IMPLEMENTATION`.
- `PROMPT_C=SYSTEMIC_QUALITY_IMPLEMENTATION`.
- `PROMPT_R=PARALLEL_INTEGRATION_REVIEWER`.

## Status

- `AGENT_A_STATUS=CLOSED_IN_PRODUCTION`.
- `AGENT_B_STATUS=CLOSED_TECHNICAL`.
- `AGENT_C_STATUS=CLOSED_IN_PRODUCTION`.
- `AGENT_R_STATUS=COMPLETED`.
- `OWNER_VISUAL_VALIDATION=PENDING`.
- `BLOCKERS_OPEN=0`.
- `HIGHS_OPEN=0`.
- `NEXT_STATUS=SHIPPER_PORTAL_V1_TECHNICALLY_CLOSED` (Campaign-B materialization, Campaign-C progress/eligibility/readiness, Route Intelligence V1, Dispatch V1, Operation Orchestrator V1 (E3.1/E3.2), Campaign-D e **E3.5 Portal do Embarcador — PORTAL-A** concluídos e em produção. PORTAL-A: PR #475 `MERGE_SHA=91a52353`, migration 080 aplicada uma única vez, 0 linha de negócio, **sem rota de portal exposta** — é fundação de domínio/fronteira. **PORTAL-B** (acesso externo, revisão auditável, acompanhamento, documentos/comprovantes) **fechado em produção**: PR #477 `MERGE_SHA=75a39d0a`, migration 081 aplicada uma única vez, `BUSINESS_DML=0`; a superfície HTTP do portal agora existe e responde `401` sem credencial. Falta apenas a validação visual do owner. E3.5 = `TECHNICALLY_CLOSED`; Partner Network/Marketplace seguem fora de escopo. Ver [DISPATCH_V1](./DISPATCH_V1.md), [OPERATION_ORCHESTRATOR_V1](./OPERATION_ORCHESTRATOR_V1.md), [CAMPAIGN_D_REPLAN_ROUTE_MULTI_ORIGIN](./CAMPAIGN_D_REPLAN_ROUTE_MULTI_ORIGIN.md) e [SHIPPER_PORTAL_V1](./SHIPPER_PORTAL_V1.md)).

