# E3.8 — Auditoria Unificada + Envelope Digital

Status neste PR: `HUMAN_E38_PRODUCTION_MIGRATION_085_FOUNDATION_AUTH_REQUIRED`.

## Baseline

- `origin/main`: `ca5ac312778d7af3368ec0fd286ed679e28320de`
- E3.7B: fechado em `main` pelo PR #500, `MERGE_SHA=ca5ac312778d7af3368ec0fd286ed679e28320de`
- Migration 084: aplicada exatamente uma vez em producao (`20261008152836 084_erp_integration_hub_operational_core`)
- PR #490: permanece `OPEN_DRAFT_HOLD`, intocado
- PR #501: DRAFT

## Decisão de Rollout Seguro em Duas Fases (Two-Phase Staged Rollout)

Para evitar deadlocks entre banco e código (onde o banco pré-E3.8 não suporta envelope e a migration bloqueia finalizações antigas), o PR #501 divide a entrega em duas migrations:

1. **Fase A — Migration `085_unified_audit_digital_envelope.sql` (Foundation / Backward-Compatible)**:
   - Cria a tabela `frete_envelopes_digitais`.
   - Cria a RPC canônica `e38_finalize_frete_with_envelope`.
   - Cria a função de leitura `listar_auditoria_unificada`.
   - RLS, triggers append-only do envelope, índices e grants mínimos para `service_role`.
   - **NÃO instala constraint trigger na tabela fretes**. Finalizações legadas diretas continuam funcionando.

2. **Fase B — Migration `086_e38_formal_envelope_enforcement.sql` (Post-Deploy Enforcement)**:
   - Instala a função `e38_check_frete_finalizado_envelope()` e o constraint trigger `trg_e38_check_frete_finalizado_envelope` (`DEFERRABLE INITIALLY DEFERRED`) em `public.fretes`.
   - Ativa a restrição estrita `NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true`.
   - **Apenas aplicada após o deploy do código E3.8 em produção**.

## Sequência Canônica de Rollout

1. Apply migration `085` (Foundation) em produção.
2. Postcheck da `085`.
3. Ready + Merge do PR #501.
4. Auto-deploy normal do backend E3.8.
5. Validação read-only e verificação de que todos os fluxos de finalização chamam a RPC canônica.
6. Gate humano para autorização da migration `086`.
7. Apply migration `086` (Enforcement) em produção.
8. Postcheck do enforcement.
9. Fechamento da frente E3.8.

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

## Gates e Próximo Passo

O PR #501 permanece em **DRAFT**. O próximo gate humano é exclusivamente para a foundation 085:

`FINAL_STATUS = HUMAN_E38_PRODUCTION_MIGRATION_085_FOUNDATION_AUTH_REQUIRED`

A migration 086 só será autorizada após o deploy da versão do backend em produção.
