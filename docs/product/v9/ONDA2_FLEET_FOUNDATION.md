# ONDA 2 — Fleet Foundation / FLEET-A + Fleet-B

> Status: `FLEET_A_FOUNDATION_DEPLOYED`; `FLEET_FINAL_TECHNICAL_CLOSURE_CLOSED_IN_PRODUCTION`; `OWNER_VISUAL_VALIDATION=PENDING`.

## Escopo

Fleet-A criou e implantou a fundacao backend/db para frota:

- `fleet_assets`;
- `vehicle_compositions`;
- `vehicle_composition_members`;
- `driver_vehicle_assignments`;
- `freight_vehicle_assignments`;
- `asset_documents`;
- `odometer_events`;
- `tires`;
- `tire_installations`;
- `tire_events`;
- `maintenance_events`.

O modelo e `FLEET/COMPOSITION-CENTRIC`: ativo/composicao e o eixo fisico; motorista e vinculo temporal. O modelo legado de `fretes` continua funcionando e a migration nao reescreve dados legados.

## Migration Gate

- `MIGRATION_REQUIRED=true`
- `MIGRATION_FILE=backend/migrations/074_fleet_foundation.sql`
- `MIGRATION_074_SHA256=a01ab82c7f7db1b2bb9eebb24db367b02a2d0aa1545f0259f065a110ea1cfec3`
- `MIGRATION_PRODUCTION_APPLIED=true`
- `MIGRATION_074_TRACKING=20260822142407 074_fleet_foundation`
- `PR449_MERGE_SHA=d682d4ed958929d46cbd556a118d71fa5c04c2bc`
- `BACKEND_DEPLOY_ID=e2615ac7-4cdb-498e-ba5f-de8f64300a83`
- `BACKEND_DEPLOY_SHA=d682d4ed958929d46cbd556a118d71fa5c04c2bc`
- `MIGRATION_FILE_FINAL=backend/migrations/075_fleet_operational_closure.sql`
- `MIGRATION_075_SHA256=6ae16676e6b67142ca0faaa78b92d65a512c67966b5ed35448148189bdf078fc`
- `MIGRATION_075_TRACKING=20260823012050 075_fleet_operational_closure`
- `MIGRATION_075_PAYLOAD_MODEL=VERIFIED_SOURCE_TEXT_TRANSFER`
- `PR453_MERGE_SHA=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`
- `BACKEND_DEPLOY_ID_FINAL=ee860618-4307-4e5a-8d61-7a12862f5e2d`
- `BACKEND_DEPLOY_SHA_FINAL=787cdcbbc927ca8ff621173b24df1fa0fa1d5126`
- `RAILWAY_REPLICAS=1`
- `PRODUCTION_HEALTH=/health 200`
- `PRODUCTION_SMOKE=/fleet/assets 401 sem auth`

Gate executado antes da aplicacao:

- confirmar hash exato acima;
- aplicar em ambiente novo/fresh;
- aplicar em upgrade 073 -> 074;
- validar RLS, grants, FKs, checks e indices unicos parciais;
- validar FKs compostas `(id, empresa_id)` para impedir referencia cross-tenant;
- confirmar que nao ha rewrite/backfill automatico de dados legados;
- confirmar que `fretes` legado continua operando sem Fleet.

Postchecks de producao:

- 11 tabelas Fleet presentes com RLS habilitado;
- 32 indices esperados presentes;
- 21 constraints compostas esperadas presentes;
- 11 policies tenant-aware presentes;
- `anon` sem privilegios nas tabelas Fleet;
- `authenticated` e `service_role` com grants previstos;
- todas as novas tabelas Fleet iniciaram com `COUNT=0`;
- DML de governanca/catalogo: 1 funcionalidade `fleet` + 7 mapeamentos de plano `incluida`;
- entitlement projetado apos apply: `included=17`, `optional=0`, `unavailable=17`, `unknown=0`;
- nenhum backfill, asset, composition, assignment, pneu, manutencao, odometro ou documento real criado.

Postchecks da migration 075:

- 14 colunas esperadas presentes em `asset_documents`, `driver_vehicle_assignments` e `tires`;
- constraints `asset_documents_contract_version_chk`, `asset_documents_file_size_chk`, `asset_documents_source_chk`, `driver_assignments_source_chk` e `tires_unit_empresa_fk` presentes;
- índices `asset_documents_contract_status_idx`, `driver_vehicle_assignments_handoff_request_key` e `tires_empresa_unit_status_idx` presentes;
- RPC `fleet_driver_handoff` presente como `SECURITY DEFINER`, `search_path=public`, sem execute para `PUBLIC`/`anon`/`authenticated` e com execute apenas para `service_role`;
- bucket `fretes-documentos` confirmado privado;
- backfill de pneus esperado/real: `0/0`;
- Fleet counts preservados em 0 para `fleet_assets`, `vehicle_compositions`, `asset_documents`, `tires` e `driver_assignments`;
- backend legado permaneceu compatível após apply, antes do merge: `/health` 200 e `/fleet/assets` 401 sem auth.

## Authority

Fleet usa a regra congelada:

`ENTITLEMENT AND PERMISSION AND SCOPE`

- Entitlement tecnico/comercial: funcionalidade `fleet`.
- Permissions ativas: `fleet.view`, `fleet.manage`, ambas scoped e sem `futureModule`.
- Scope: rotas `/fleet/*` resolvem escopo operacional e o service valida unidade/tenant antes de consultar ou escrever.
- Tenant consistency: a migration tambem cria indices unicos `(id, empresa_id)` e FKs compostas nos relacionamentos Fleet para que o banco rejeite referencias cross-tenant mesmo quando o backend usa `service_role`.

## Boundaries

- Asset docs usam `document_category='VEHICLE_DOCUMENT'`.
- Odometro novo nasce em `odometer_events`, preservando fotos/KM legados em `fretes`.
- Pneus e manutencao entram como fundacao de dados, sem analytics avancada.
- Nenhum dado financeiro operacional e duplicado; custos futuros devem se conectar ao dominio financeiro existente.
- Sem Asaas e sem env/secret. Migration 075 foi DDL/backfill controlado; backfill real de dado operacional foi 0 e smokes nao fizeram escrita de negócio.
- `FLEET_OVERALL_TECHNICAL_STATUS=CLOSED`: Fleet-B entrega a primeira experiencia web operacional, upload/preview de documento de ativo, handoff temporal e estoque de pneus por unidade. Fluxos mobile, analytics avancada de pneus/manutencao, cancelamento/substituicao audit-safe de documentos de ativo e validacao visual do owner seguem pendentes.

## Fleet-B — experiencia operacional web

Fleet-B transforma a fundacao em uma superficie web utilizavel em `/frota`, preservando autoridade `ENTITLEMENT AND PERMISSION AND SCOPE`:

- rota web `/frota` protegida por `PermissionRoute permission="fleet.view"`;
- acoes de escrita exibidas apenas com `fleet.manage`;
- menu do cliente mostra "Frota" somente para quem tem `fleet.view`;
- backend adiciona `/fleet/overview` e leituras/acoes guiadas para ativos, composicoes, vinculo temporal de motorista, pneus, manutencao, odometro e documentos de ativo;
- backend adiciona upload/preview de documentos de ativo com signed URL curta sobre o bucket privado `fretes-documentos`;
- backend adiciona `fleet_driver_handoff` para transferencia temporal de motorista entre ativo/composicao, com idempotencia por `request_id`;
- pneus passam a carregar `unidade_operacional_id` para estoque por unidade;
- experiencia organizada por Resumo Operacional, Pendencias, Composicoes, Ativos, Pneus e Manutencoes;
- empty state orienta cadastrar o primeiro ativo e montar composicao;
- erros de conflitos/FKs/checks de frota sao traduzidos para mensagens operacionais;
- documentos de ativo gravam metadados/versionamento em `asset_documents` e arquivo no bucket privado; o app mobile e o cancelamento/substituicao audit-safe ficam fora desta fatia;
- legado de `fretes` permanece intacto, sem backfill e sem fabricacao de ativos/composicoes historicas.

Fechamento production:

- `MIGRATION_075_CREATED=true`
- `MIGRATION_075_APPLIED=true`
- `MIGRATION_075_TRACKED=true`
- `PRODUCTION_BUSINESS_WRITES=0`
- `PRODUCTION_STORAGE_WRITES=0`
- `ENV_CHANGED=false`
- `ASAAS_TOUCHED=false`
- `OWNER_VISUAL_VALIDATION=PENDING`

## Validacao Local

- Fleet focused tests: PASS.
- Backend full apos Fleet final closure: PASS `1669/1669`.
- Web build apos Fleet-B: PASS `tsc -b && vite build`.
- Web Vitest apos Fleet-B: PASS `118/118`.
- SEC-1 / main CI: PASS no GitHub Actions.
- PG tests: PASS `163/163`.
- Backend full Fleet-A checkpoint: PASS `1664/1664` no checkpoint de certificacao G0.
- PG CI: `backend/tests-pg/fleet_foundation_074.pgtest.mjs` cobre aplicacao 073 -> 074, idempotencia da 074, RLS/grants, FKs tenant-safe, integridade temporal e concorrencia em Postgres 16 efemero.
- Produção final: Railway deploy `ee860618-4307-4e5a-8d61-7a12862f5e2d` SUCCESS, GitHub Pages SUCCESS, `/health` 200, `/fleet/assets` 401 sem auth, logs novos sem erro.

## Processo 075

A primeira tentativa de `apply_migration` da 075 falhou por divergencia de payload (`TTEXT`) em relacao ao Git blob autorizado (`TEXT`). O erro ocorreu antes de tracking e antes de objetos 075; a fonte versionada tinha `source_ttext_count=0` e hash correto. A segunda e final tentativa foi autorizada com `VERIFIED_SOURCE_TEXT_TRANSFER` do full file read no HEAD `200a3ad993df8c09c12b369f385e1920dea593ab` e resultou em `SUCCESS`.

- `PROCESS_INCIDENT=MIGRATION_075_APPLY_PAYLOAD_DIVERGED_FROM_GIT_BLOB`
- `PROCESS_CORRECTIVE_ACTION=PROCESS-MIGRATION-PAYLOAD-001 CLOSED_WITH_CORRECTIVE_ACTION`
- `QUERY_MANUALLY_EDITED=false`
- `QUERY_RECONSTRUCTED=false`
- `QUERY_SOURCE_EQUIVALENCE=PASS`
