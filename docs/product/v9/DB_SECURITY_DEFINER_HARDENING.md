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
