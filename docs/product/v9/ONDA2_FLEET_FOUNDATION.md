# ONDA 2 — Fleet Foundation / FLEET-A

> Status em PR: `READY_FOR_OWNER_MIGRATION_GATE_FLEET`.

## Escopo

Fleet-A cria a fundacao backend/db para frota sem aplicar DDL em producao:

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

O modelo e `FLEET/COMPOSITION-CENTRIC`: ativo/composicao e o eixo fisico; motorista e vinculo temporal. O modelo legado de `fretes` continua funcionando e a migration nao altera `public.fretes`.

## Migration Gate

- `MIGRATION_REQUIRED=true`
- `MIGRATION_FILE=backend/migrations/074_fleet_foundation.sql`
- `MIGRATION_074_SHA256=a01ab82c7f7db1b2bb9eebb24db367b02a2d0aa1545f0259f065a110ea1cfec3`
- `MIGRATION_PRODUCTION_APPLIED=false`

Precheck esperado antes de qualquer aplicacao futura:

- confirmar hash exato acima;
- aplicar em ambiente novo/fresh;
- aplicar em upgrade 073 -> 074;
- validar RLS, grants, FKs, checks e indices unicos parciais;
- validar FKs compostas `(id, empresa_id)` para impedir referencia cross-tenant;
- confirmar que nao ha rewrite/backfill automatico de dados legados;
- confirmar que `fretes` legado continua operando sem Fleet.

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
- Sem Asaas, sem env/secret, sem production write e sem production deploy para Fleet.

## Validacao Local

- Fleet focused tests: PASS.
- Backend full: PASS `1664/1664` no checkpoint de certificacao G0.
- PG CI: `backend/tests-pg/fleet_foundation_074.pgtest.mjs` cobre aplicacao 073 -> 074, idempotencia da 074, RLS/grants, FKs tenant-safe, integridade temporal e concorrencia em Postgres 16 efemero.
- PG/local DB: exige ambiente Supabase/Postgres local configurado; se indisponivel, manter gate owner para aplicacao controlada.
