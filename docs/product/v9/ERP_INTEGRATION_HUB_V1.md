# ERP Integration Hub V1 — E3.7A Reentry

> Estado neste PR: `E37A_REENTRY_IMPLEMENTATION_DRAFT`
> Base: `origin/main` consolidada `4089f2124e82e30f3e008d74f63b9ad6b04fb6de`
> Fonte historica tecnica: PR #490, head `51961d3e46b066d59cbb6497aa470f079b0f3137`
> Estrategia: `NEW_REENTRY_BRANCH_FROM_CURRENT_MAIN_AND_TRANSPLANT_ERP_DELTA`

E3.7A entrega somente a fundacao tecnica do ERP Integration Hub. O PR #490 permanece
`OPEN_DRAFT_HOLD` e nao e baseline: o codigo foi reintroduzido em nova branch baseada
na `main` atual, preservando os fechamentos S1/S2/S3/S4, DB-SEC-1 e Stabilization Wave V1.

## Escopo

E3.7A e provider-agnostic, schema-free, read-only no endpoint HTTP e production-inert.
Nao entrega ERP real, adapter de fornecedor, credencial, webhook, UI de configuracao,
outbox persistente, mapa persistente de identidade externa, ativacao comercial ou E3.7B.

Invariantes desta fatia:

| Invariante | Valor |
|---|---|
| `MIGRATION_REQUIRED` | `false` |
| `SCHEMA_CHANGE` | `false` |
| `ERP_PROVIDER_REAL` | `false` |
| `ERP_EXTERNAL_CALLS` | `0` |
| `PRODUCTION_BUSINESS_WRITES` | `0` |
| `ERP_SECRETS` | `0` |
| `E37B_SCOPE` | `OUT_OF_SCOPE` |

## Arquitetura

O dominio Matopiba continua separado de qualquer schema/API de fornecedor (D-023):

```text
DOMINIO -> ENVELOPE CANONICO -> OUTBOX CONTRACT -> PROVIDER GATEWAY -> ADAPTER FUTURO
```

Nesta fatia o gateway so permite `disabled` e `fake`. Qualquer modo desconhecido ou real
falha de forma segura para disabled, sem caminho HTTP externo.

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

E3.7A nao adiciona SQL, RPC, `SECURITY DEFINER`, grants, RLS, tabela, funcao ou migration.
A unica leitura de banco da rota e read-only em `funcionalidades`, para refletir honestamente
o estado tecnico de `integracoes_erp`.

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

Esta branch pode ficar tecnicamente pronta para merge quando focused tests, backend full,
SEC-1 aplicavel e CI do HEAD exato estiverem verdes. Mesmo nesse caso, o estado final esperado
e `HUMAN_E37A_REENTRY_MERGE_DEPLOY_AUTH_REQUIRED`: nao marcar Ready, nao mergear e nao deployar
sem autorizacao humana posterior.
