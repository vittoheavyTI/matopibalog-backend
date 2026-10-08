# E3.8 — Auditoria Unificada + Envelope Digital

Status neste PR: `E38_IMPLEMENTED_AWAITING_CI_AND_PRODUCTION_MIGRATION_GATE`.

## Baseline

- `origin/main`: `ca5ac312778d7af3368ec0fd286ed679e28320de`
- E3.7B: fechado em `main` pelo PR #500, `MERGE_SHA=ca5ac312778d7af3368ec0fd286ed679e28320de`
- Migration 084: aplicada exatamente uma vez em producao (`20261008152836 084_erp_integration_hub_operational_core`)
- PR #490: permanece `OPEN_DRAFT_HOLD`, intocado

## Findings congelados

`E38_AUDIT_FINDINGS_FROZEN=true`.

O sistema ja tinha ledgers fortes, mas fragmentados. A E3.8 nao copia todo o historico para uma nova tabela global; cria um read model normalizador que preserva provenance e consulta as fontes existentes quando elas existem. Historico sem ator, motivo ou correlacao continua como legado/desconhecido, sem fabricacao.

## Source matrix

| Fonte | Dominio | Autoridade | Completude historica | Normalizacao |
|---|---|---|---|---|
| `frete_envelopes_digitais` | fechamento de frete | envelope formal imutavel | completa para fechamentos novos | `formal_digital_envelope` |
| `lancamento_eventos` | despesas/abastecimentos/vales | ledger append-only | completa desde 070 | `domain_ledger` |
| `fretes_financeiro_auditoria` | correcao financeira legado | ledger service-role-only | completa desde 065 | `domain_ledger` |
| `permission_change_events` | permissoes | ledger append-only | completa desde 072 | `security_permission_ledger` |
| `auth_event_audit` | auth/sessoes | ledger append-only | completa desde 062; campos sensiveis redigidos | `security_auth_ledger` |
| `contrato_eventos` | contratos comerciais | cadeia/eventos contratuais | parcial/legado para ator nulo | `commercial_contract_ledger` |
| `erp_outbox` | integracoes ERP | outbox operacional | completa desde 084, sem provider real | `integration_outbox` |

## Envelope digital

O envelope digital formal e snapshot persistido em `frete_envelopes_digitais`, com `payload`, `frete_snapshot`, `financial_snapshot`, `audit_summary`, ator, fonte, `request_id`, correlacao e `sealed_at`. A tabela e RLS `FORCE`, `service_role` tem somente `SELECT/INSERT`, e trigger bloqueia `UPDATE/DELETE`.

Fechamentos novos usam a RPC `e38_finalize_frete_with_envelope`, que faz lock do frete, altera `status='finalizado'` e insere o envelope na mesma transacao. A trigger `trg_e38_guard_frete_finalizado_envelope` bloqueia qualquer update direto para `finalizado` fora da RPC.

Fretes ja finalizados antes da E3.8 nao recebem backfill automatico; sao classificados como `LEGACY_NO_FORMAL_ENVELOPE`.

## Read model

`listar_auditoria_unificada(...)` retorna eventos normalizados com:

- `event_id` deterministico por fonte/linha
- `source_kind` e `source_record_id`
- `entity_type`/`entity_id`
- `actor_user_id`/`actor_role`
- `occurred_at`, `action`, `reason`, `metadata`
- `authority_class`
- `historical_completeness`

A funcao e dinamica: uma fonte ausente no banco de teste ou em instalacao parcial nao quebra a leitura; ela simplesmente nao contribui eventos.

## Gates

Esta frente cria a migration `085_unified_audit_digital_envelope.sql`. Portanto, apos CI verde, o proximo estado seguro e:

`HUMAN_E38_PRODUCTION_MIGRATION_AUTH_REQUIRED`

Nao aplicar migration, marcar Ready, mergear, deployar, criar envelope real, executar backfill ou fazer escrita de negocio sem gate explicito.
