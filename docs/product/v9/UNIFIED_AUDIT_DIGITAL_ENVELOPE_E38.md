# E3.8 — Auditoria Unificada + Envelope Digital

Status: `CLOSED` / `ATIVO_PROD`.
`E38_UNIFIED_AUDIT=ATIVO_PROD`
`E38_DIGITAL_ENVELOPE=ATIVO_PROD`
`E38_TECHNICALLY_CLOSED=true`

## Baseline e Estado Final de Produção

- `main` baseline / commit de merge: `f1d92f17a180401e5ebc814a23974294c5fc4f60`
- PR #505: `MERGED=true`, `MERGE_SHA=f1d92f17a180401e5ebc814a23974294c5fc4f60`
- Railway backend production deploy:
  - `DEPLOYMENT_ID=4a93ab5f-e3cf-4eca-9ed5-650b26ca3915`
  - `DEPLOYMENT_STATUS=SUCCESS`
  - `DEPLOYED_SHA=f1d92f17a180401e5ebc814a23974294c5fc4f60`
  - Backend: `ONLINE`
- Auth Strict Invariants (preservados e ativos):
  - `authMode=strict`, `AUTH_REQUIRE_SESSION=true`, `AUTH_ALLOW_LEGACY_TOKENS=false`, `webIdleTtlSeconds=1800`
- Migration state em produção:
  - 085: `APPLIED=true`, `REGISTERED=true`, `version=20261009125633`, `name=085_unified_audit_digital_envelope`
  - 087: `APPLIED=true`, `REGISTERED=true`, `version=20261010172936`, `name=087_auth_sessions_per_client_idle`
  - 086: `APPLIED=true`, `REGISTERED=true`, `version=20261011204500`, `name=086_e38_formal_envelope_enforcement`
  - Statement canônico da migration 086: 2289 bytes, SHA-256 `24aa3763cf7f1050bc83f28c4ade627409fc112b04964922b23359bdaa9ea6b0`, Git blob `5d2b21ae94d4345becebbbd8c4dcfc0a064a68ec`, `statement_count=1`.
  - Sequência real de rollout (intencional, sem renumeração): `085 -> 087 -> backend E3.8 deploy -> 086`.
- PRs relacionados:
  - PR #505: `MERGED`
  - PR #501: `OPEN`, `DRAFT`, histórico/superado (intocado)
  - PR #490: `OPEN`, `DRAFT`, `HOLD` (intocado)

## Decisão de Rollout Seguro em Duas Fases (Two-Phase Staged Rollout)

Para evitar deadlocks entre banco e código (onde o banco pré-E3.8 não suporta envelope e a migration bloqueia finalizações antigas), a entrega foi dividida em duas migrations:

1. **Fase A — Migration `085_unified_audit_digital_envelope.sql` (Foundation / Backward-Compatible) — APLICADA E REGISTRADA EM PRODUÇÃO**:
   - Cria a tabela `frete_envelopes_digitais`.
   - Cria a RPC canônica `e38_finalize_frete_with_envelope`.
   - Cria a função de leitura `listar_auditoria_unificada`.
   - RLS, triggers append-only do envelope, índices e grants mínimos para `service_role`.
   - **NÃO instala constraint trigger na tabela fretes**. Finalizações legadas diretas continuavam funcionando.

2. **Fase B — Migration `086_e38_formal_envelope_enforcement.sql` (Post-Deploy Enforcement) — APLICADA E REGISTRADA EM PRODUÇÃO**:
   - Instala a função `e38_check_frete_finalizado_envelope()` e o constraint trigger `trg_e38_check_frete_finalizado_envelope` (`DEFERRABLE INITIALLY DEFERRED`) em `public.fretes`.
   - Revoga privilégios EXECUTE de `PUBLIC`, `anon` e `authenticated` nas funções auxiliares (`frete_envelopes_digitais_append_only`, `e38_jsonb_pick_existing`), concedendo exclusivamente a `service_role`.
   - Ativa a restrição estrita `NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true`.
   - Aplicada exclusivamente após o deploy do backend E3.8 sob gate específico de migration autorizado pelo OWNER.

## Sequência Concluída de Rollout e Fechamento

1. Migration `085` (Foundation) aplicada e registrada em produção (`version=20261009125633`).
2. Migration `087` (Auth Session Idle) aplicada e registrada em produção (`version=20261010172936`).
3. PR #505 reentrando E3.8 revisado, testado e aprovado com 11/11 CI checks verdes.
4. Ready + Merge do PR #505 em `main` no commit `f1d92f17a180401e5ebc814a23974294c5fc4f60`.
5. Auto-deploy do backend E3.8 no Railway (`4a93ab5f-e3cf-4eca-9ed5-650b26ca3915`, SUCCESS, ONLINE).
6. Postcheck read-only pós-deploy confirmando saúde e integridade operacional.
7. Gate 3 aprovado pelo OWNER para aplicação da migration 086.
8. Migration `086` (Enforcement) aplicada e registrada em produção (`version=20261011204500`, SHA-256 `24aa3763cf7f1050bc83f28c4ade627409fc112b04964922b23359bdaa9ea6b0`).
9. Postcheck do enforcement e das ACLs de funções auxiliares (service_role-only).
10. Preservação dos 51 fretes históricos finalizados sem envelope formal (`LEGACY_NO_FORMAL_ENVELOPE`, sem backfill).
11. Macrofrente E3.8 tecnicamente fechada em produção (`E38_TECHNICALLY_CLOSED=true`).

## Resolução dos Findings Wave 2

`INDEPENDENT_REVIEW_WAVE2_FINDINGS_FROZEN=true`.

1. **`E38-IR-BLOCKER-002` (Unsafe DB-First & Code-First Rollout Deadlock)**:
   - Resolvido pela separação em 085 (Foundation) e 086 (Enforcement).

2. **`E38-IR-BLOCKER-003` / `E38-IR-HIGH-007` (Paridade Estrita de Schema de Produção)**:
   - Todas as 14 tabelas ativas no read model unificado foram corrigidas para os nomes exatos de coluna da produção:
     - `frete_documento_eventos`: `evento`, `actor_id`, `created_at`.
     - `permission_change_events`: `action`, `actor_user_id`, `target_type`, `target_id`, `permission_key`, `before_value`, `after_value`, `occurred_at`.
     - `operational_scope_auditoria`: `grupo_id`, `unidade_operacional_id`, `membership_id`, `actor_user_id`, `action`, `reason`, `request_id`, `created_at`.
     - `auth_event_audit`: `event`, `usuario_id`, `resultado`, `motivo`, `ip_hash`, `user_agent`, `created_at`.
     - `billing_outbox`: `event_type`, `dedupe_key`, `status`, `attempts`, `max_attempts`, `processed_at`, `created_at`.
     - `partner_network_events`: `entity_type`, `entity_id`, `action`, `actor_user_id`, `actor_partner_user_id`, `source`, `reason`, `metadata`, `occurred_at`.
     - `campaign_exceptions`: `campaign_id`, `plan_version_id`, `planned_trip_id`, `exception_type`, `severity`, `status`, `acknowledged_by`, `resolved_by`, `resolution_reason`, `created_at`.
     - `odometer_events`: `asset_id`, `frete_id`, `event_type`, `reading_km`, `source`, `recorded_by`, `occurred_at`.
     - `maintenance_events`: `asset_id`, `maintenance_type`, `category`, `status`, `work_order`, `odometer_km`, `notes`, `created_by`, `created_at`.
     - `funcionalidade_auditoria`: Omitida (`DEFERRED_SOURCE_NO_SAFE_TENANT_AUTHORITY`) por ausência de `empresa_id` direto.
   - `SOURCE_SCHEMA_CONTRACT_MISMATCHES=0`.

3. **`E38-IR-HIGH-005` (PATCH Finalization Bypasses Freight Finish)**:
   - Rota `PATCH /fretes/:id` com `status='finalizado'` exige permissão efetiva `freight.finish` além de `freight.manage`.

4. **`E38-IR-HIGH-006` (Timeline Domain Field Authority & Redaction)**:
   - Read model SQL projeta metadata mínima e segura.
   - Controller filtra campos de domínios restritos se o chamador não possuir as permissões específicas (`finance.operational.view`, `documents.view`, `fleet.view`).

5. **`E38-IR-MEDIUM-002` (Contagem Real de Fontes e Timeline Matrix)**:
   - `ACTUAL_GLOBAL_SOURCE_COUNT = 14`.
   - `FREIGHT_TIMELINE_SOURCE_COUNT = 6` (`frete_envelopes_digitais`, `lancamento_eventos`, `fretes_financeiro_auditoria`, `frete_documento_eventos`, `erp_outbox`, `odometer_events`).

## Matriz Global de Fontes de Auditoria (14 Fontes Ativas)

| # | Tabela Fonte | Domínio | Participa em Timeline de Frete? |
|---|---|---|---|
| 1 | `frete_envelopes_digitais` | Fechamento formal de frete | Sim (`frete_id`) |
| 2 | `lancamento_eventos` | Despesas, abastecimentos, vales | Sim (`frete_id`) |
| 3 | `fretes_financeiro_auditoria` | Auditoria financeira de fretes | Sim (`frete_id`) |
| 4 | `frete_documento_eventos` | Documentos de frete | Sim (`frete_id`) |
| 5 | `erp_outbox` | Integrações ERP | Sim (`aggregate_id` / `entity_id`) |
| 6 | `permission_change_events` | Gestão de permissões RBAC | Não (Global / Usuário) |
| 7 | `operational_scope_auditoria` | Escopo operacional de filiais | Não (Global / Unidade) |
| 8 | `auth_event_audit` | Sessões e segurança de auth | Não (Global / Usuário) |
| 9 | `billing_outbox` | Faturamento SaaS | Não (Global / Empresa) |
| 10 | `contrato_eventos` | Contratos comerciais | Não (Global / Contrato) |
| 11 | `partner_network_events` | Rede de transportadoras parceiras | Não (Global / Parceiro) |
| 12 | `campaign_exceptions` | Exceções de campanhas operacionais | Não (Global / Campanha) |
| 13 | `odometer_events` | Eventos de odômetro | Sim (`frete_id`) |
| 14 | `maintenance_events` | Manutenção de frota | Não (Global / Veículo) |

## Estado Final de Enforcement (Migration 086)

A migration `086_e38_formal_envelope_enforcement` está aplicada e registrada em produção (`version=20261011204500`, 2289 bytes, SHA-256 `24aa3763cf7f1050bc83f28c4ade627409fc112b04964922b23359bdaa9ea6b0`, Git blob `5d2b21ae94d4345becebbbd8c4dcfc0a064a68ec`, `statement_count=1`).

- **Constraint Trigger**: `trg_e38_check_frete_finalizado_envelope` em `public.fretes`
  - `exists = true`
  - `DEFERRABLE = true`
  - `INITIALLY_DEFERRED = true`
  - Restrição ativa: `NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE = true`
- **Função Verificadora**: `public.e38_check_frete_finalizado_envelope()`
  - `SECURITY DEFINER = true`
  - `search_path = public,pg_temp`
  - ACL de execução: `PUBLIC=false`, `anon=false`, `authenticated=false`, `service_role=true`
- **Funções Auxiliares**:
  - `public.e38_jsonb_pick_existing(jsonb,text[])`: `PUBLIC=false`, `anon=false`, `authenticated=false`, `service_role=true`
  - `public.frete_envelopes_digitais_append_only()`: `PUBLIC=false`, `anon=false`, `authenticated=false`, `service_role=true`
- **RPC Canônica de Finalização**:
  - `public.e38_finalize_frete_with_envelope(...)`: `PUBLIC=false`, `anon=false`, `authenticated=false`, `service_role=true`

## Dados Históricos e Escopo Prospectivo

- No postcheck de fechamento da macrofrente:
  - Total de envelopes formais (`frete_envelopes_digitais`): **0**
  - Fretes históricos finalizados sem envelope formal: **51**
- **Preservação intencional**: Esses 51 registros históricos foram intencionalmente preservados sem backfill (`LEGACY_NO_FORMAL_ENVELOPE`). Não houve backfill histórico.
- **Enforcement prospectivo**: O enforcement da 086 é estritamente prospectivo — qualquer `INSERT` com status já finalizado ou qualquer transição de status para `finalizado` exige exatamente um envelope formal emitido na mesma transação.

## Status de Fechamento da Macrofrente E3.8

- `E38_UNIFIED_AUDIT = ATIVO_PROD`
- `E38_DIGITAL_ENVELOPE = ATIVO_PROD`
- `MIGRATION_085 = APPLIED_REGISTERED`
- `MIGRATION_086 = APPLIED_REGISTERED`
- `MIGRATION_087 = APPLIED_REGISTERED`
- `E38_TECHNICALLY_CLOSED = true`
- `PR505 = MERGED` (`MERGE_SHA = f1d92f17a180401e5ebc814a23974294c5fc4f60`)
- `PR501 = OPEN_DRAFT` (superado pelo PR #505, intocado)
- `PR490 = OPEN_DRAFT_HOLD` (intocado)
