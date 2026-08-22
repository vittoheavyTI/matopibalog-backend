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
- `MIGRATION_074_SHA256=24f8da26e115917c9a13dc620ad2e963acb8ac30f9b054423cf329b9ee00ccb8`
- `MIGRATION_PRODUCTION_APPLIED=false`

Precheck esperado antes de qualquer aplicacao futura:

- confirmar hash exato acima;
- aplicar em ambiente novo/fresh;
- aplicar em upgrade 073 -> 074;
- validar RLS, grants, FKs, checks e indices unicos parciais;
- confirmar que nao ha rewrite/backfill automatico de dados legados;
- confirmar que `fretes` legado continua operando sem Fleet.

## Authority

Fleet usa a regra congelada:

`ENTITLEMENT AND PERMISSION AND SCOPE`

- Entitlement tecnico/comercial: funcionalidade `fleet`.
- Permissions ativas: `fleet.view`, `fleet.manage`, ambas scoped e sem `futureModule`.
- Scope: rotas `/fleet/*` resolvem escopo operacional e o service valida unidade/tenant antes de consultar ou escrever.

## Boundaries

- Asset docs usam `document_category='VEHICLE_DOCUMENT'`.
- Odometro novo nasce em `odometer_events`, preservando fotos/KM legados em `fretes`.
- Pneus e manutencao entram como fundacao de dados, sem analytics avancada.
- Nenhum dado financeiro operacional e duplicado; custos futuros devem se conectar ao dominio financeiro existente.
- Sem Asaas, sem env/secret, sem production write e sem production deploy para Fleet.

## Validacao Local

- Fleet focused tests: PASS.
- Backend full: PASS no checkpoint antes do fechamento do PR; reexecutar apos qualquer mudanca na migration ou service.
- PG/local DB: exige ambiente Supabase/Postgres local configurado; se indisponivel, manter gate owner para aplicacao controlada.

