-- 056_add_contratos_obrigatorio.sql
-- Marca contratos/aditivos como OBRIGATÓRIOS para efeito do gate operacional.
-- Regra: só contrato OBRIGATÓRIO e PENDENTE de assinatura bloqueia escritas
-- operacionais do tenant. Default FALSE => aplicar esta migration NÃO passa a
-- bloquear nenhum contrato existente (opt-in explícito, sem efeito retroativo).
-- Idempotente e deploy-safe. Apenas estrutural (sem UPDATE/DELETE).

ALTER TABLE public.contratos_comerciais
  ADD COLUMN IF NOT EXISTS obrigatorio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contratos_comerciais.obrigatorio IS
  'Quando true, o contrato/aditivo é obrigatório: se pendente de assinatura, bloqueia escritas operacionais do tenant (gate de contrato). Default false = não bloqueia. Login/perfil/contratação/assinatura/faturas/regularização/suporte/logout permanecem liberados; super-admin nunca é bloqueado.';

CREATE INDEX IF NOT EXISTS idx_contratos_obrigatorio_pendente
  ON public.contratos_comerciais (empresa_id)
  WHERE obrigatorio = true
    AND status IN (
      'aguardando_assinatura',
      'pronto_assinatura',
      'aguardando_assinatura_cliente',
      'aguardando_assinatura_matopiba'
    );
