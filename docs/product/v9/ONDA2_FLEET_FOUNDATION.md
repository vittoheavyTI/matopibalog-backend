# ONDA 2 — Fleet Foundation / FLEET-A + Fleet-B

> Status: `FLEET_A_FOUNDATION_DEPLOYED`; `FLEET_B_OPERATIONAL_EXPERIENCE_IMPLEMENTED_IN_PR`.

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
- `RAILWAY_REPLICAS=1`
- `PRODUCTION_HEALTH=/health 200`
- `PRODUCTION_SMOKE=/fleet/assets 401; /fleet/compositions 401 sem auth`

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
- Sem Asaas, sem env/secret e sem escrita de dado operacional Fleet em producao.
- `FLEET_OVERALL_STATUS=FLEET_B_OPERATIONAL_EXPERIENCE_IMPLEMENTED_IN_PR`: Fleet-B entrega a primeira experiencia web operacional sem migration 075. Fluxos mobile, analytics avancada de pneus/manutencao e validacao visual do owner seguem pendentes.

## Fleet-B — experiencia operacional web

Fleet-B transforma a fundacao em uma superficie web utilizavel em `/frota`, preservando autoridade `ENTITLEMENT AND PERMISSION AND SCOPE`:

- rota web `/frota` protegida por `PermissionRoute permission="fleet.view"`;
- acoes de escrita exibidas apenas com `fleet.manage`;
- menu do cliente mostra "Frota" somente para quem tem `fleet.view`;
- backend adiciona `/fleet/overview` e leituras/acoes guiadas para ativos, composicoes, vinculo temporal de motorista, pneus, manutencao, odometro e documentos de ativo;
- experiencia organizada por Resumo Operacional, Pendencias, Composicoes, Ativos, Pneus e Manutencoes;
- empty state orienta cadastrar o primeiro ativo e montar composicao;
- erros de conflitos/FKs/checks de frota sao traduzidos para mensagens operacionais;
- documentos de ativo nesta fatia registram referencia/caminho em `asset_documents`; sem Storage/env novo e sem upload direto para producao;
- legado de `fretes` permanece intacto, sem backfill e sem fabricacao de ativos/composicoes historicas.

Sem migration nova:

- `MIGRATION_075_CREATED=false`
- `PRODUCTION_DDL_WRITES=0`
- `PRODUCTION_BUSINESS_WRITES=0`
- `ENV_CHANGED=false`
- `ASAAS_TOUCHED=false`
- `OWNER_VISUAL_VALIDATION=PENDING`

## Validacao Local

- Fleet focused tests: PASS.
- Backend full apos Fleet-B: PASS `1665/1665`.
- Web build apos Fleet-B: PASS `tsc -b && vite build`.
- Web Vitest apos Fleet-B: PASS `118/118`.
- SEC-1 local: SKIPPED pela configuracao Playwright local (`1 skipped`, sem falha).
- PG CI: nao requerido nesta fatia porque nao houve schema/migration 075.
- Backend full Fleet-A checkpoint: PASS `1664/1664` no checkpoint de certificacao G0.
- PG CI: `backend/tests-pg/fleet_foundation_074.pgtest.mjs` cobre aplicacao 073 -> 074, idempotencia da 074, RLS/grants, FKs tenant-safe, integridade temporal e concorrencia em Postgres 16 efemero.
- PG/local DB: exige ambiente Supabase/Postgres local configurado; se indisponivel, manter gate owner para aplicacao controlada.
