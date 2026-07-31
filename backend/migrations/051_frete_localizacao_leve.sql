-- Rastreamento leve de viagens via app.
-- Escopo: somente viagem ativa, tenant-safe, historico operacional limitado.

CREATE TABLE IF NOT EXISTS public.frete_localizacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  frete_id UUID NOT NULL REFERENCES public.fretes(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m NUMERIC(8,2) NULL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'app_foreground_service',
  CHECK (captured_at <= now() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_frete_localizacoes_empresa_frete_captured
  ON public.frete_localizacoes (empresa_id, frete_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_frete_localizacoes_retencao
  ON public.frete_localizacoes (received_at);

CREATE TABLE IF NOT EXISTS public.frete_ultima_localizacao (
  frete_id UUID PRIMARY KEY REFERENCES public.fretes(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m NUMERIC(8,2) NULL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'app_foreground_service'
);

CREATE INDEX IF NOT EXISTS idx_frete_ultima_localizacao_empresa
  ON public.frete_ultima_localizacao (empresa_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.frete_localizacao_retencao (
  frete_id UUID PRIMARY KEY REFERENCES public.fretes(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  encerrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frete_localizacao_retencao_encerrado
  ON public.frete_localizacao_retencao (encerrado_em);

ALTER TABLE public.frete_localizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frete_ultima_localizacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frete_localizacao_retencao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_localizacoes_select_tenant ON public.frete_localizacoes;
CREATE POLICY frete_localizacoes_select_tenant ON public.frete_localizacoes
  FOR SELECT USING (
    public.rls_is_super_admin()
    OR (public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
    OR motorista_id = auth.uid()
  );

DROP POLICY IF EXISTS frete_ultima_localizacao_select_tenant ON public.frete_ultima_localizacao;
CREATE POLICY frete_ultima_localizacao_select_tenant ON public.frete_ultima_localizacao
  FOR SELECT USING (
    public.rls_is_super_admin()
    OR (public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
    OR motorista_id = auth.uid()
  );

DROP POLICY IF EXISTS frete_localizacao_retencao_select_tenant ON public.frete_localizacao_retencao;
CREATE POLICY frete_localizacao_retencao_select_tenant ON public.frete_localizacao_retencao
  FOR SELECT USING (
    public.rls_is_super_admin()
    OR (public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
  );

CREATE OR REPLACE FUNCTION public.purge_frete_localizacoes_vencidas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removidas INTEGER;
BEGIN
  INSERT INTO public.frete_localizacao_retencao (frete_id, empresa_id, encerrado_em)
  SELECT DISTINCT f.id, f.empresa_id, now()
    FROM public.fretes f
    JOIN public.frete_localizacoes fl ON fl.frete_id = f.id
   WHERE f.status IN ('finalizado', 'cancelado')
  ON CONFLICT (frete_id) DO NOTHING;

  DELETE FROM public.frete_localizacoes fl
  USING public.frete_localizacao_retencao r
  WHERE r.frete_id = fl.frete_id
    AND r.encerrado_em < now() - INTERVAL '30 days';

  GET DIAGNOSTICS removidas = ROW_COUNT;

  DELETE FROM public.frete_localizacao_retencao r
  WHERE r.encerrado_em < now() - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.frete_localizacoes fl WHERE fl.frete_id = r.frete_id
    );

  RETURN removidas;
END;
$$;
