# E3.8 — Auditoria Unificada + Envelope Digital

Status neste PR: `E38_IMPLEMENTED_AWAITING_CI_AND_PRODUCTION_MIGRATION_GATE`.

## Baseline

- `origin/main`: `ca5ac312778d7af3368ec0fd286ed679e28320de`
- E3.7B: fechado em `main` pelo PR #500, `MERGE_SHA=ca5ac312778d7af3368ec0fd286ed679e28320de`
- Migration 084: aplicada exatamente uma vez em producao (`20261008152836 084_erp_integration_hub_operational_core`)
- PR #490: permanece `OPEN_DRAFT_HOLD`, intocado
- PR #501: DRAFT

## Findings Independentes — Correções Aplicadas

`INDEPENDENT_REVIEW_FINDINGS_FROZEN=true`.

1. **`E38-IR-BLOCKER-001` (DB Invariant Deferrable Constraint Trigger)**:
   - Removido uso de GUC/session flag `app.e38_formal_envelope_authorized`.
   - Implementado trigger de restrição postergada (`DEFERRABLE INITIALLY DEFERRED`) `trg_e38_check_frete_finalizado_envelope` em `public.fretes`.
   - No COMMIT, verifica que existe exatamente 1 envelope formal em `public.frete_envelopes_digitais` para o frete finalizado.
   - Qualquer `UPDATE` direto ou `INSERT` com `status='finalizado'` falha no `COMMIT` para qualquer role (incluindo `service_role`).

2. **`E38-IR-HIGH-001` (Redação Financeira Universal para Usuários Internos)**:
   - `redigirEnvelopeSeAplicavel` aplica a autoridade `finance.operational.view` a todos os usuários internos (`admin`, `gerente`, `operador`).
   - Super-admin mantém autoridade total.
   - Sem permissão financeira, campos brutos (`valor_frete`, `valor_tonelada_km`, `toneladas`, `modalidade_calculo`) são expurgados de `frete_snapshot`, `financial_snapshot` é esvaziado (`{}`), tanto no nível raiz quanto recursivamente dentro de `payload`.
   - Motoristas mantêm isolamento e redação por política de comissão (`driverFinancialVisibility`).

3. **`E38-IR-HIGH-002` (Matriz Real de Fontes de Auditoria — 15 Fontes)**:
   - Contagem real auditada: exatamente 15 tabelas de eventos de domínio mapeadas no read model unificado.
   - Diferenciação estrita entre a matriz global de fontes e a timeline filtrada por frete.

4. **`E38-IR-HIGH-003` (Filtro por Entidade no SQL antes do LIMIT e Paginação por Cursor)**:
   - A função `listar_auditoria_unificada` recebe `p_entity_type` e `p_entity_id`.
   - Fontes de frete são filtradas diretamente no SQL antes de aplicar `LIMIT` e ordenação.
   - Paginação determinística via cursor `(occurred_at DESC, event_id DESC)`.

5. **`E38-IR-MEDIUM-001` (Precisão de Evidência e Grants)**:
   - Identificadores de evento seguem o padrão determinístico `<source_kind>:<source_record_id>`.
   - Removidos grants redundantes e desnecessários na migration 085.

## Matriz de Fontes de Auditoria (15 Fontes Verificadas)

| # | Tabela Fonte | Domínio | Participa em Timeline de Frete? |
|---|---|---|---|
| 1 | `frete_envelopes_digitais` | Fechamento formal de frete | Sim (`frete_id`) |
| 2 | `lancamento_eventos` | Despesas, abastecimentos, vales | Sim (`frete_id` / `entity_id`) |
| 3 | `fretes_financeiro_auditoria` | Auditoria financeira de fretes | Sim (`frete_id`) |
| 4 | `frete_documento_eventos` | Documentos e canhotos de frete | Sim (`frete_id`) |
| 5 | `erp_outbox` | Outbox de integrações ERP | Sim (`aggregate_id` / `entity_id`) |
| 6 | `permission_change_events` | Alterações de permissões e RBAC | Não (Global / Usuário) |
| 7 | `operational_scope_auditoria` | Escopo operacional de unidades | Não (Global / Unidade) |
| 8 | `auth_event_audit` | Sessões e autenticação | Não (Global / Auth UID) |
| 9 | `billing_outbox` | Faturamento e cobrança | Sim (se referenciar frete) |
| 10 | `contrato_eventos` | Contratos comerciais | Sim (se vinculado ao frete) |
| 11 | `partner_network_events` | Rede de parceiros e transportadoras | Não (Global / Parceiro) |
| 12 | `campaign_exceptions` | Exceções de campanhas | Sim (se frete vinculado) |
| 13 | `funcionalidade_auditoria` | Auditoria de features | Não (Global / Feature) |
| 14 | `odometer_events` | Eventos de odômetro | Sim (`frete_id`) |
| 15 | `maintenance_events` | Manutenção de veículos | Não (Veículo / Frota) |

## Gates

Esta frente cria a migration `085_unified_audit_digital_envelope.sql`. Após CI verde, o próximo estado seguro e obrigatório é:

`HUMAN_E38_PRODUCTION_MIGRATION_AUTH_REQUIRED`

Não aplicar migration em produção, não marcar Ready, não mergear, não deployar, não criar envelope real em produção, não executar backfill ou fazer escrita de negócio sem gate explícito.
