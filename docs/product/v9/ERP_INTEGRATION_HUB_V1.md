# ERP Integration Hub V1 — E3.7A Closed / E3.7B Operational Core

> Estado E3.7A: `CLOSED_IN_MAIN`
> Estado E3.7B neste PR: `IMPLEMENTATION_DRAFT_AWAITING_PRODUCTION_MIGRATION_AUTH`
> Base E3.7B: `origin/main` consolidada `26a4abc9cb78e6244a6d656555c12c0d379af059`
> E3.7A: PR #499 `FINAL_HEAD=168597561aaf27f9dafdbf6a498d2ac29cf5b1b6`, `MERGE_SHA=26a4abc9cb78e6244a6d656555c12c0d379af059`
> Fonte historica tecnica: PR #490, head `51961d3e46b066d59cbb6497aa470f079b0f3137`
> PR #490: `OPEN_DRAFT_HOLD_DO_NOT_TOUCH`

E3.7A fechou em `main` a fundacao tecnica do ERP Integration Hub. O PR #490 permanece
`OPEN_DRAFT_HOLD` e nao e baseline: o codigo foi reintroduzido em nova branch baseada
na `main` consolidada, preservando S1/S2/S3/S4, DB-SEC-1 e Stabilization Wave V1.

E3.7B adiciona o nucleo operacional persistente: outbox transacional, claim atomico,
reconcile-before-resend persistido e mapa de identidade externa. Esta fatia ainda nao
foi aplicada em producao: migration 084 para em gate humano explicito.

## Escopo

E3.7A e provider-agnostic, schema-free, read-only no endpoint HTTP e production-inert.
E3.7B continua sem ERP real, adapter de fornecedor, credencial, webhook, UI de
configuracao, ativacao comercial, chamada externa ou wiring de evento de negocio.

Invariantes desta fatia:

| Invariante | Valor |
|---|---|
| `E37A_MIGRATION_REQUIRED` | `false` |
| `E37A_SCHEMA_CHANGE` | `false` |
| `E37B_MIGRATION_REQUIRED` | `true` |
| `E37B_MIGRATION` | `084_erp_integration_hub_operational_core.sql` |
| `PRODUCTION_MIGRATION_APPLIED` | `false` |
| `ERP_PROVIDER_REAL` | `false` |
| `ERP_EXTERNAL_CALLS` | `0` |
| `PRODUCTION_BUSINESS_WRITES` | `0` |
| `ERP_SECRETS` | `0` |
| `BUSINESS_EVENT_WIRING` | `0` |

## Arquitetura

O dominio Matopiba continua separado de qualquer schema/API de fornecedor (D-023):

```text
DOMINIO -> ENVELOPE CANONICO -> OUTBOX CONTRACT -> PROVIDER GATEWAY -> ADAPTER FUTURO
```

O gateway so permite `disabled` e `fake`. Qualquer modo desconhecido ou real
falha de forma segura para disabled, sem caminho HTTP externo.

E3.7B adiciona persistencia backend-mediated:

- `erp_outbox`: evento logico, dedupe por provider/tenant/event, fingerprint de intencao,
  lease, claim token, limites de tentativa, `SEND`/`RECONCILE`, estados terminais e
  sanitizacao de falha.
- `erp_external_identity_mappings`: vinculo por tenant/provider/entity type, com unique
  interno e externo, idempotencia e rebind auditavel.
- RPCs `SECURITY DEFINER` service-role-only para enqueue, claim, success/failure,
  reconcile, bind e rebind.

## Superficie HTTP

`GET /erp-hub/status` e superficie interna, montada no `server.js` atual da `main` antes dos
portais externos. A autoridade e:

```text
verifyToken
AND verificarEmpresa
AND requirePermission('integracoes_erp.gerenciar')
```

Nao ha autoridade por `role`, `tipo` ou `isAdmin`. Enquanto `integracoes_erp` estiver
tecnicamente `em_breve`/nao disponivel, o entitlement nega antes de override/template.
Super-admin continua autoridade de plataforma para diagnostico inerte.

Tokens externos com `token_kind` nao entram na superficie interna: `shipper_portal`,
`partner_portal` e qualquer token_kind futuro sao recusados antes de tenant resolution,
permission resolution ou leitura de `funcionalidades`.

## Contratos

- Envelope canonico fechado, versionado e JSON-safe.
- Chaves sensiveis sao rejeitadas/sanitizadas antes de truncamento.
- `event_id` e identidade da ocorrencia logica; fingerprint de intencao e guarda de conflito.
- Outbox e contrato in-memory: lease, claim token, reconcile-before-resend e terminal states.
- `FAILED` sem evidencia nao e retry-safe; so evidencia explicita `retry_safe=true` libera reenvio.
- Identidade externa e isolada por tenant, provider e entity type, com conflitos fail-closed.
- Diagnostico nunca reporta `connected`, `syncing` ou `active` enquanto nao houver provider real.

## DB-SEC-1

E3.7A nao adicionou SQL, RPC, `SECURITY DEFINER`, grants, RLS, tabela, funcao ou migration.

E3.7B adiciona a migration 084 com RLS habilitado nas duas tabelas, sem grant direto para
`anon`, `authenticated` ou `PUBLIC`, e com execute das funcoes `erp_%` revogado desses
roles. As RPCs tem `search_path` fixo e sao mediadas pelo backend via service role.

## E3.7B findings congelados

| Finding | Status |
|---|---|
| `ERP37B-INFO-001` | Auditoria read-only encontrou divergencia historica de tracking: a migration 068 nao aparece no registry de producao, mas seus efeitos existem (`iniciar_aquisicao_comercial_v2` e check constraint de origem). Nao bloqueia a 084; registrar como achado de processo. |
| `ERP37B-HIGH-001` | Fechado neste PR: outbox persistente tem `FOR UPDATE SKIP LOCKED`, claim token, lease, stale-claim guard e terminal `succeeded` imutavel. |
| `ERP37B-HIGH-002` | Fechado neste PR: falha/lease ambiguo nao autoriza resend cego; caminho padrao e `RECONCILE`, resend so com evidencia `retry_safe`. |
| `ERP37B-MEDIUM-001` | Fechado neste PR: identity map persistente e isolado por tenant/provider/entity type, com rebind collision-safe. |
| `ERP37B-MEDIUM-002` | Fechado neste PR: diagnostico HTTP reporta persistencia honestamente e mantem runners desabilitados. |

## Findings congelados e fechamento

| Finding | Fechamento neste PR |
|---|---|
| `ERP-REENTRY-HIGH-001` | Mount `/erp-hub` aplicado sobre `server.js` atual da `main`, sem transplantar o arquivo historico. |
| `ERP-REENTRY-HIGH-002` | Teste HTTP direto cobre tokens externos `shipper_portal`, `partner_portal` e token_kind futuro antes de tenant/permission/read ERP. |
| `ERP-REENTRY-MEDIUM-001` | Docs reconciliados a partir dos documentos atuais da `main`; S1/S2/S3/S4/DB-SEC-1/Wave V1 preservados. |
| `ERP-REENTRY-MEDIUM-002` | Novo PR deve ter metadata propria e verdadeira; PR #490 nao e alterado. |
| `ERP-REENTRY-MEDIUM-003` | Bateria atual da branch baseada em `main` deve ser executada e registrada no PR. |
| `ERP-REENTRY-LOW-001` | `MIGRATION_REQUIRED=false` e `SCHEMA_CHANGE=false` registrados explicitamente. |

## Estado operacional

E3.7A esta fechada em `main`.

E3.7B pode ficar tecnicamente pronta para PR draft quando focused tests, backend full,
SEC-1 aplicavel e CI do HEAD exato estiverem verdes. Mesmo nesse caso, o estado final esperado
e `HUMAN_E37B_PRODUCTION_MIGRATION_AUTH_REQUIRED`: nao aplicar migration 084 em producao,
nao marcar Ready, nao mergear e nao deployar sem autorizacao humana posterior.
