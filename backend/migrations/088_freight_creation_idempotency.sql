-- 088_freight_creation_idempotency.sql
--
-- Idempotencia persistente para POST /fretes, escopada por tenant.
-- A migration e aditiva: linhas e clientes legados permanecem com ambas as
-- colunas NULL. Nenhum backfill e executado.

ALTER TABLE public.fretes
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS creation_intent_hash text;

-- IF NOT EXISTS sozinho esconderia drift de tipo/default/nullability. Falhar
-- explicitamente e mais seguro do que aceitar uma estrutura com o mesmo nome.
DO $$
DECLARE
  v_client_type oid;
  v_client_not_null boolean;
  v_client_has_default boolean;
  v_hash_type oid;
  v_hash_not_null boolean;
  v_hash_has_default boolean;
BEGIN
  SELECT atttypid, attnotnull, atthasdef
    INTO v_client_type, v_client_not_null, v_client_has_default
    FROM pg_attribute
   WHERE attrelid = 'public.fretes'::regclass
     AND attname = 'client_request_id'
     AND NOT attisdropped;

  SELECT atttypid, attnotnull, atthasdef
    INTO v_hash_type, v_hash_not_null, v_hash_has_default
    FROM pg_attribute
   WHERE attrelid = 'public.fretes'::regclass
     AND attname = 'creation_intent_hash'
     AND NOT attisdropped;

  IF v_client_type IS DISTINCT FROM 'uuid'::regtype
     OR v_client_not_null
     OR v_client_has_default THEN
    RAISE EXCEPTION '088 drift: client_request_id must be nullable uuid without default';
  END IF;

  IF v_hash_type IS DISTINCT FROM 'text'::regtype
     OR v_hash_not_null
     OR v_hash_has_default THEN
    RAISE EXCEPTION '088 drift: creation_intent_hash must be nullable text without default';
  END IF;
END $$;

DO $$
DECLARE
  v_definition text;
  v_normalized text;
  v_expected constant text :=
    'checkclient_request_idisnullandcreation_intent_hashisnullorclient_request_idisnotnullandcreation_intent_hashisnotnullandcreation_intent_hash~''^[0-9a-f]{64}$''';
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fretes_creation_intent_pair_check'
       AND conrelid = 'public.fretes'::regclass
  ) THEN
    ALTER TABLE public.fretes
      ADD CONSTRAINT fretes_creation_intent_pair_check
      CHECK (
        (client_request_id IS NULL AND creation_intent_hash IS NULL)
        OR (
          client_request_id IS NOT NULL
          AND creation_intent_hash IS NOT NULL
          AND creation_intent_hash ~ '^[0-9a-f]{64}$'
        )
      ) NOT VALID;
  END IF;

  SELECT pg_get_constraintdef(oid)
    INTO v_definition
    FROM pg_constraint
   WHERE conname = 'fretes_creation_intent_pair_check'
     AND conrelid = 'public.fretes'::regclass
     AND contype = 'c';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION '088 drift: fretes_creation_intent_pair_check is missing or is not CHECK';
  END IF;

  v_normalized := replace(
    regexp_replace(lower(v_definition), '[[:space:]()]', '', 'g'),
    '::text',
    ''
  );
  IF v_normalized NOT IN (v_expected, v_expected || 'notvalid') THEN
    RAISE EXCEPTION '088 drift: unexpected fretes_creation_intent_pair_check definition: %', v_definition;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fretes_empresa_client_request
  ON public.fretes (empresa_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

DO $$
DECLARE
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_key_count integer;
  v_columns text[];
  v_predicate text;
BEGIN
  SELECT i.indisunique,
         i.indisvalid,
         i.indisready,
         i.indnkeyatts,
         ARRAY(
           SELECT pg_get_indexdef(i.indexrelid, positions.key_position, true)
             FROM generate_series(1, i.indnkeyatts) AS positions(key_position)
            ORDER BY positions.key_position
         ),
         regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '[[:space:]()]', '', 'g')
    INTO v_unique, v_valid, v_ready, v_key_count, v_columns, v_predicate
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.ux_fretes_empresa_client_request')
     AND i.indrelid = 'public.fretes'::regclass;

  IF NOT FOUND
     OR NOT v_unique
     OR NOT v_valid
     OR NOT v_ready
     OR v_key_count <> 2
     OR v_columns IS DISTINCT FROM ARRAY['empresa_id', 'client_request_id']::text[]
     OR v_predicate IS DISTINCT FROM 'client_request_idisnotnull' THEN
    RAISE EXCEPTION
      '088 drift: ux_fretes_empresa_client_request must be a valid partial unique index on (empresa_id, client_request_id)';
  END IF;
END $$;

ALTER TABLE public.fretes
  VALIDATE CONSTRAINT fretes_creation_intent_pair_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fretes_creation_intent_pair_check'
       AND conrelid = 'public.fretes'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION '088 drift: fretes_creation_intent_pair_check was not validated';
  END IF;
END $$;

-- Rollback anterior ao deploy do backend:
--   DROP INDEX IF EXISTS public.ux_fretes_empresa_client_request;
--   ALTER TABLE public.fretes
--     DROP CONSTRAINT IF EXISTS fretes_creation_intent_pair_check,
--     DROP COLUMN IF EXISTS creation_intent_hash,
--     DROP COLUMN IF EXISTS client_request_id;
