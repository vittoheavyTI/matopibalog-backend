# SEC-1 — PROPOSTA (design-only) — Garantia forte de credencial única por (session+device)

> **STATUS: SOMENTE PROJETO.** Nada aqui foi criado como arquivo de migration nem aplicado.
> NÃO aplicar DDL no Supabase, NÃO deployar, NÃO mergear. Requer autorização explícita futura.
> Numbering proposto = **065** (a 063 continua reservada ao #416; a 064 é a base das tabelas).

## Problema
Garantir o invariante **≤ 1 credencial de rastreamento ATIVA por `(session_id, device_id)`**.
Um `UNIQUE(session_id, device_id) WHERE revoked_at IS NULL` **sozinho** quebra o fluxo atual
(`INSERT nova → revoga anterior`), pois o INSERT da nova colide com a anterior ainda ativa. E
`revoga → depois INSERT` **fora de transação** pode deixar o tracking sem credencial se o INSERT
falhar. Solução: **operação DB atômica (RPC transacional)** + **índice único parcial** como backstop,
com **serialização por (session,device)** para concorrência determinística.

## Garantia em 3 camadas
1. **Flutter** — single-flight/guard (já implementado neste HEAD): evita emissões concorrentes/desnecessárias.
2. **Backend** — passa a chamar a RPC transacional (troca dos 3 statements best-effort atuais). Envia
   SOMENTE o `credential_hash` (HMAC); o token aberto **nunca** vai ao banco.
3. **Postgres** — a RPC (revoga+insere+escopo em 1 commit) + o índice parcial garantem o invariante final.

## Preflight READ-ONLY (rodar ANTES; abortar a migration se retornar linhas)
```sql
SELECT session_id, device_id, COUNT(*) AS ativas
FROM public.frete_tracking_credenciais
WHERE revoked_at IS NULL
GROUP BY session_id, device_id
HAVING COUNT(*) > 1;
```
Se houver linhas → **NÃO criar o índice** (falha segura). **Sem cleanup destrutivo automático.**
Estado conhecido pós-E2E = 0 ativas; revalidar no gate futuro.

## DDL proposta (065 — NÃO criar/aplicar)
```sql
-- 065_tracking_credencial_unicidade.sql  (PROPOSTA — NÃO APLICAR)
-- Aditiva sobre a 064; reversível; não altera dados. NÃO reutiliza 063 (#416).

-- (A) Backstop estrutural: no máximo 1 ativa por (session,device).
CREATE UNIQUE INDEX IF NOT EXISTS uq_frete_tracking_cred_ativa_por_sessao_device
  ON public.frete_tracking_credenciais (session_id, device_id)
  WHERE revoked_at IS NULL;

-- (B) RPC transacional. SECURITY DEFINER + search_path fixo. Recebe só o HASH.
CREATE OR REPLACE FUNCTION public.emitir_tracking_credencial(
  p_empresa_id     uuid,
  p_motorista_id   uuid,
  p_session_id     uuid,
  p_device_id      text,
  p_credential_hash text,
  p_expires_at     timestamptz,
  p_max_expires_at timestamptz
) RETURNS TABLE (credencial_id uuid, fretes_escopo integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_n integer;
BEGIN
  IF p_session_id IS NULL OR p_device_id IS NULL OR p_credential_hash IS NULL
     OR p_empresa_id IS NULL OR p_motorista_id IS NULL THEN
    RAISE EXCEPTION 'tracking_params_invalidos';
  END IF;

  -- Serializa emissões concorrentes da MESMA operação (session+device) na transação.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_device_id, 0));

  -- Snapshot IMUTÁVEL das viagens ATIVAS agora (dentro da transação = consistente).
  CREATE TEMP TABLE _escopo ON COMMIT DROP AS
    SELECT id FROM public.fretes
     WHERE empresa_id = p_empresa_id AND motorista_id = p_motorista_id
       AND status IN ('ativo','em_viagem','em_andamento')
     LIMIT 4;
  SELECT COUNT(*) INTO v_n FROM _escopo;
  IF v_n = 0 THEN RAISE EXCEPTION 'tracking_trip_inactive'; END IF;

  -- 1º REVOGA a anterior ativa (libera o índice parcial); 2º INSERE a nova (mesmo commit).
  UPDATE public.frete_tracking_credenciais
     SET revoked_at = now(), revoked_reason = 'reemitida_substituida', updated_at = now()
   WHERE session_id = p_session_id AND device_id = p_device_id AND revoked_at IS NULL;

  INSERT INTO public.frete_tracking_credenciais
    (empresa_id, motorista_id, session_id, device_id, credential_hash, issued_at, expires_at, max_expires_at)
  VALUES (p_empresa_id, p_motorista_id, p_session_id, p_device_id, p_credential_hash, now(), p_expires_at, p_max_expires_at)
  RETURNING id INTO v_id;

  INSERT INTO public.frete_tracking_credencial_fretes (credencial_id, frete_id)
    SELECT v_id, id FROM _escopo;

  RETURN QUERY SELECT v_id, v_n;
END;
$$;

-- (C) Grants: só o backend (service_role) executa. anon/authenticated não.
REVOKE ALL ON FUNCTION public.emitir_tracking_credencial(uuid,uuid,uuid,text,text,timestamptz,timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.emitir_tracking_credencial(uuid,uuid,uuid,text,text,timestamptz,timestamptz) TO service_role';
  END IF;
END $$;
```

## Concorrência — plano de prova (pgtest, Postgres real, 2 conexões)
- Conn A e Conn B, ambas `BEGIN`, ambas chamam a RPC para o MESMO `session_id`+`device_id`
  (mesmo `now()`/timestamp se necessário).
- O `pg_advisory_xact_lock` serializa: A adquire → revoga(nada)/insere C1/escopo (lock até commit);
  B espera. A `COMMIT` → B adquire → revoga C1 (agora ativa) → insere C2 → `COMMIT`.
- **Asserção:** `COUNT(*) WHERE revoked_at IS NULL AND session_id=X AND device_id=Y = 1` (só C2).
- Backstop: se dois INSERTs de "ativa" corressem sem o lock, o índice parcial gera `unique_violation`
  numa delas → comportamento semântico recuperável (a RPC pode reintentar revoga+insere), nunca 2 ativas.
- Rodar no runner existente `backend/tests-pg` (multi-conexão), sem tocar Supabase.

## Segurança / invariantes preservados
- **hash-only**: a RPC recebe `p_credential_hash`, nunca o token aberto.
- **scope snapshot imutável**: capturado na transação; nova viagem futura exige **nova emissão**
  SEC-1 autenticada (a RPC só escopa as ativas do momento). **renew NÃO amplia escopo** (renew é outra rota, CAS).
- **anti-resurrection / device binding / session revocation / multi-trip / max lifetime**: inalterados
  (a validação/telemetria e as revogações por sessão/frete continuam como na 064).
- **SECURITY DEFINER + `search_path` fixo** (mitiga o lint `function_search_path_mutable`); EXECUTE só a service_role.
- RLS das tabelas (064) permanece ENABLE+FORCE; a RPC roda como definer.

## Idempotência / Rollback / Impacto
- DDL idempotente (`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
- **Rollback não destrutivo:** `DROP FUNCTION IF EXISTS ...; DROP INDEX IF EXISTS public.uq_frete_tracking_cred_ativa_por_sessao_device;` (rows preservadas).
- **Impacto na 064:** nenhum no schema; puramente aditivo (índice + função sobre as tabelas da 064).

## Mudança de backend associada (FUTURA — não neste gate)
`trackingCredentialService.emitir` passaria a `supabase.rpc('emitir_tracking_credencial', {...})`
com o `credential_hash` calculado no backend (o token aberto continua só no `TrackingDelivery`).
Remove os 3 statements best-effort atuais. **Só após a migration autorizada e aplicada.**

## Autorização
**Somente projeto.** Não criar o arquivo `065_...sql`, não aplicar DDL, não alterar o backend
para usar a RPC até nova autorização explícita.
