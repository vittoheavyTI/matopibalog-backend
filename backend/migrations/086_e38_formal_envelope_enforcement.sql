-- 086_e38_formal_envelope_enforcement.sql
--
-- E3.8 (Phase B): Enforcement of formal digital envelope on freight finalization.
--
-- AVISO: Esta migration ativa a restricao estrita NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true
-- via constraint trigger DEFERRABLE INITIALLY DEFERRED na tabela public.fretes.
--
-- DEVE SER APLICADA SOMENTE APOS O BACKEND E3.8 ESTAR IMPLANTADO EM PRODUCAO.
-- Nao duplicar a foundation da 085.

CREATE OR REPLACE FUNCTION public.e38_check_frete_finalizado_envelope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.status = 'finalizado' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'finalizado') THEN
    SELECT count(*)
      INTO v_count
      FROM public.frete_envelopes_digitais e
     WHERE e.frete_id = NEW.id
       AND e.empresa_id = NEW.empresa_id
       AND e.envelope_type = 'formal_freight_closure';

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'E38_FINALIZED_WITHOUT_FORMAL_ENVELOPE: frete % deve possuir exatamente 1 envelope formal selado na mesma transacao (encontrados: %)', NEW.id, v_count
        USING errcode = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.e38_check_frete_finalizado_envelope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e38_check_frete_finalizado_envelope() TO service_role;

DROP TRIGGER IF EXISTS trg_e38_guard_frete_finalizado_envelope ON public.fretes;
DROP TRIGGER IF EXISTS trg_e38_check_frete_finalizado_envelope ON public.fretes;
CREATE CONSTRAINT TRIGGER trg_e38_check_frete_finalizado_envelope
  AFTER INSERT OR UPDATE OF status ON public.fretes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.e38_check_frete_finalizado_envelope();
