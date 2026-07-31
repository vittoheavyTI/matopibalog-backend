-- Estados operacionais sanitizados da sessao de localizacao.
-- Nao armazena coordenadas; permite Torre/Home distinguirem permissao, GPS e conexao.

CREATE TABLE IF NOT EXISTS public.frete_localizacao_estado (
  frete_id UUID PRIMARY KEY REFERENCES public.fretes(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  motorista_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  estado TEXT NOT NULL CHECK (estado IN (
    'aguardando_primeira',
    'atualizada',
    'interrompida',
    'gps_desativado',
    'permissao_nao_concedida',
    'sem_conexao',
    'rastreamento_encerrado'
  )),
  detalhe TEXT NULL CHECK (detalhe IS NULL OR length(detalhe) <= 160),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_localizacao_em TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_frete_localizacao_estado_empresa
  ON public.frete_localizacao_estado (empresa_id, atualizado_em DESC);

CREATE INDEX IF NOT EXISTS idx_frete_localizacao_estado_motorista
  ON public.frete_localizacao_estado (motorista_id, atualizado_em DESC);

ALTER TABLE public.frete_localizacao_estado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frete_localizacao_estado_select_tenant ON public.frete_localizacao_estado;
CREATE POLICY frete_localizacao_estado_select_tenant ON public.frete_localizacao_estado
  FOR SELECT USING (
    public.rls_is_super_admin()
    OR (public.rls_is_company_admin() AND empresa_id = public.rls_empresa_id())
    OR motorista_id = auth.uid()
  );
