# DB-SEC-1 — Supabase/Postgres SECURITY DEFINER hardening

Data: 2026-10-06

Branch: `security/db-security-definer-hardening`
Base: `origin/main` em `eae16cc11f28acf889f1ca219ecf1e81808b642f`

## Findings congelados

`FINDINGS_FROZEN=true`

### DBSEC-BLOCKER-01 — ANON_CAN_EXECUTE_EXPIRAR_TRIALS

EVIDENCE: `public.expirar_trials()` é `SECURITY DEFINER`, faz `UPDATE public.empresas`, não tinha `search_path` fixo e tinha `EXECUTE` para `PUBLIC`, `anon`, `authenticated` e `service_role`.

ATTACK_SURFACE: `/rest/v1/rpc/expirar_trials` podia ser chamado sem login.

INTENDED_CALLERS: backend/service role ou job controlado, nunca browser anon/authenticated.

CURRENT_GRANTS: `PUBLIC`, `anon`, `authenticated`, `service_role`.

DESIRED_GRANTS: `service_role`.

COMPATIBILITY_RISK: baixo para produto, porque o repo não chama essa função no cliente; risco operacional se algum job legado externo depender de anon/authenticated, o que seria o próprio defeito.

FIX_PLAN: fixar `search_path`, revogar `PUBLIC/anon/authenticated`, manter `service_role`.

### DBSEC-BLOCKER-02 — ANON_CAN_EXECUTE_LOCATION_PURGE

EVIDENCE: `public.purge_frete_localizacoes_vencidas()` é `SECURITY DEFINER`, faz `INSERT` em retenção e `DELETE` em localização, e tinha `EXECUTE` para `PUBLIC`, `anon`, `authenticated` e `service_role`.

ATTACK_SURFACE: `/rest/v1/rpc/purge_frete_localizacoes_vencidas` podia ser chamado sem login.

INTENDED_CALLERS: backend/service role de manutenção. O backend chama via service role em `freteLocalizacaoController`.

CURRENT_GRANTS: `PUBLIC`, `anon`, `authenticated`, `service_role`.

DESIRED_GRANTS: `service_role`.

COMPATIBILITY_RISK: baixo se backend usa service role; alto se alguém dependesse de chamada pública, que não é contrato aceitável.

FIX_PLAN: reafirmar `search_path`, revogar `PUBLIC/anon/authenticated`, manter `service_role`.

### DBSEC-HIGH-01 — SECURITY_DEFINER_PUBLIC_EXECUTE_LEGACY_HELPERS

EVIDENCE: `empresa_ativa(uuid)`, `empresa_id()`, `is_admin()`, `is_super_admin()` e `verificar_limite_motoristas()` eram `SECURITY DEFINER` com grants herdados de `PUBLIC` para `anon/authenticated`. `empresa_id()` e `is_super_admin()` ainda aparecem em policies de `public.configuracoes`; `verificar_limite_motoristas()` é trigger de `public.motoristas`.

ATTACK_SURFACE: RPCs públicas em schema exposto.

INTENDED_CALLERS: `empresa_id()` e `is_super_admin()` precisam de `authenticated` para policies legadas; as demais não têm caller cliente comprovado e/ou são trigger/backend-only.

CURRENT_GRANTS: `PUBLIC`, `anon`, `authenticated`, `service_role` nas funções legadas expostas.

DESIRED_GRANTS: `empresa_id()` e `is_super_admin()` com `authenticated, service_role`; demais service_role-only.

COMPATIBILITY_RISK: médio em `configuracoes` se `authenticated` fosse removido; por isso será preservado ali.

FIX_PLAN: preservar grants necessários de RLS/policy, remover anon/PUBLIC e fixar `search_path`.

### DBSEC-HIGH-02 — MUTABLE_SEARCH_PATH_ON_PUBLIC_FUNCTIONS

EVIDENCE: Security Advisor reportou 25 funções `public` com `search_path` mutável, incluindo legacy definer functions, trigger functions da Partner Network e RPCs P1.

ATTACK_SURFACE: resolução de nomes dependente do role/session search_path.

INTENDED_CALLERS: varia por função; P1 e Partner/maintenance são backend service_role; triggers disparam pelo banco; helpers RLS são policy helpers.

CURRENT_GRANTS: P1 já service_role-only; triggers Partner estavam abertos por default; legacy definer functions abertas por default.

DESIRED_GRANTS: mínimo por categoria, sem mudar comportamento lógico.

COMPATIBILITY_RISK: baixo para `ALTER FUNCTION ... SET search_path`, desde que objetos estejam schema-qualified ou em `public`.

FIX_PLAN: `search_path=public, pg_catalog` nas funções auditadas.

### DBSEC-HIGH-03 — FUTURE_FUNCTIONS_DEFAULT_PUBLIC_EXECUTE

EVIDENCE: `pg_default_acl` mostrou default privileges de funções em `public` concedendo `EXECUTE` a `anon`, `authenticated` e `service_role` para owners `postgres` e `supabase_admin`.

ATTACK_SURFACE: novas funções criadas em `public` podem nascer como RPC pública sem grant explícito.

INTENDED_CALLERS: funções futuras devem nascer default-deny e grants devem ser explícitos por migration.

CURRENT_GRANTS: default `EXECUTE` para `anon/authenticated/service_role`.

DESIRED_GRANTS: default sem `PUBLIC/anon/authenticated`; `service_role` preservado para backend-only.

COMPATIBILITY_RISK: médio para futuras migrations se esquecerem grants explícitos; desejado por segurança.

FIX_PLAN: nao alterar default privileges em producao nesta macrofrente. A prevencao futura fica em CI por guard pos-migration que inspeciona o estado final de `public` e falha se surgir funcao exposta fora da allowlist explicita.

### DBSEC-BLOCKER-DEFAULT-PRIV-01 — EPHEMERAL_DEFAULT_ACL_FIXTURE_DOES_NOT_MATCH_PRODUCTION_AND_GLOBAL_DEFAULT_REVOKE_HAS_CROSS_SCHEMA_BLAST_RADIUS

EVIDENCE: producao possui default ACLs de funcao por schema para owners `postgres` e `supabase_admin`, incluindo `public`, e tambem schemas de plataforma como `extensions`, `graphql`, `graphql_public`, `realtime`, `storage` e outros.

ATTACK_SURFACE: a fixture efemera anterior nao reproduzia default ACLs por schema de producao; a tentativa de usar `ALTER DEFAULT PRIVILEGES FOR ROLE ...` global teria efeito em funcoes futuras de todos os schemas criados pelo owner, nao apenas `public`.

INTENDED_CALLERS: DB-SEC-1 deve endurecer apenas as funcoes `public` auditadas e prevenir regressao futura por CI, sem alterar defaults globais nem schemas de plataforma.

CURRENT_GRANTS: default ACLs de producao permanecem fora do escopo da migration 083.

DESIRED_GRANTS: funcoes `public` auditadas com grants explicitos e `search_path` fixo; funcoes futuras em `public` bloqueadas por guard pos-migration se ficarem abertas indevidamente.

COMPATIBILITY_RISK: alto para revoke global, porque ultrapassa o escopo DB-SEC-1 e pode afetar comportamento futuro de schemas geridos pela plataforma.

FIX_PLAN: `DEFAULT_PRIVILEGES_GLOBAL_CHANGE=REJECTED` por `CROSS_SCHEMA_PLATFORM_BLAST_RADIUS`; `FUTURE_PUBLIC_FUNCTION_GUARD=POST_MIGRATION_PG_CI_DEFAULT_DENY`.

## Decisao R2

`DEFAULT_PRIVILEGES_GLOBAL_CHANGE=REJECTED`

`FUTURE_PUBLIC_FUNCTION_GUARD=POST_MIGRATION_PG_CI_DEFAULT_DENY`

`MIGRATION_DEFAULT_PRIVILEGES_CHANGE=0`

`PLATFORM_SCHEMA_CHANGE=0`

Migration 083 nao afirma modificar default privileges em producao. A superficie de mudanca fica limitada a `ALTER FUNCTION`, `REVOKE EXECUTE` e `GRANT EXECUTE` das funcoes `public` auditadas.

## Decisão sobre não-findings

- `rls_empresa_id()`, `rls_is_company_admin()` e `rls_is_super_admin()` não são bug por terem `authenticated EXECUTE`: elas são dependência direta de várias policies RLS. O hardening preserva esse contrato e remove apenas `PUBLIC/anon`.
- `CREATE` no schema `public` já está fechado para `PUBLIC`, `anon` e `authenticated`.
- PR #490, ERP, Asaas, S2 e S3 ficam fora de escopo.

## Fechamento em produção

`FINAL_STATUS=DB_SECURITY_DEFINER_HARDENING_CLOSED`

`PRODUCTION_MIGRATION_APPLIED=true`

`PRODUCTION_MIGRATION_REAPPLY=0`

`PRODUCTION_BUSINESS_WRITES=0`

`PRODUCTION_CRON_TOUCHES=0`

### Autoridade de código

- PR funcional: `#494`
- Head aprovado: `843b8c4395cf3ad592a3db27f9142e37b52d12c5`
- Merge em `main`: `e31bfc3b470c0b513989fff5dd469688a84bede6`
- Migration em `main`: `backend/migrations/083_security_definer_hardening.sql`
- SHA256 aprovado da migration em `main`: `394FD5350345EDBB13B64EDF53BA6541252DEBEF7FFA819B0A3BA0552BA7C834`

### Produção Supabase

Registry de produção confirmou exatamente uma aplicação:

- `version=20261007124559`
- `name=083_security_definer_hardening`
- `matching_count=1`

Post-check read-only confirmou:

- `search_path_missing=0`
- `public_execute_open=0`
- `anon_execute_open=0`
- `authenticated_unexpected_execute=0`
- `authenticated_expected_only=true`, restrito a `empresa_id`, `is_super_admin`, `rls_empresa_id`, `rls_is_company_admin` e `rls_is_super_admin`

O advisor de segurança deixou de reportar os achados-alvo:

- `function_search_path_mutable=0`
- `anon_security_definer_function_executable=0`

Residuais conhecidos e fora do escopo DB-SEC-1:

- `authenticated_security_definer_function_executable=5`, apenas nos helpers RLS/legados preservados por contrato.
- `rls_enabled_no_policy`, já existente em tabelas backend-mediated/default-deny.
- `auth_leaked_password_protection`, configuração de Auth fora desta macrofrente.
- `dispatch_claim_planned_trip` permanece sem `EXECUTE` para `service_role` por design histórico da 079: é função interna, sem grant a ninguém, chamada de dentro das RPCs públicas de dispatch.

### CI, deploy e smoke

CI de `main` no merge `e31bfc3b470c0b513989fff5dd469688a84bede6` ficou verde:

- Backend CI
- Frontend/Playwright SEC-1 HTTPS same-site
- Postgres 16 - DB security definer 083
- suites PG 067, 075-079, 082 e matriz RPC
- `build-and-deploy`

Railway produção:

- Projeto: `scintillating-magic`
- Serviço backend: `matopibalog-backend`
- Deployment: `80f70c5e-498d-45b9-aa08-941d9aebbf08`
- Commit: `e31bfc3b470c0b513989fff5dd469688a84bede6`
- Status: `SUCCESS`
- Réplicas: `running=1`, `crashed=0`, `total=1`
- Warnings/criticals: `0/0`

Smoke read-only:

- `GET /health` -> `200`, `status=UP`
- `GET /abastecimentos` sem credencial -> `401`, `Token não fornecido.`

Nenhum smoke criou usuário, empresa, fatura, frete, parceiro, convite ou documento.
