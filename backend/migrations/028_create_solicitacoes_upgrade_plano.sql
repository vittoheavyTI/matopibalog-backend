-- 028_create_solicitacoes_upgrade_plano.sql
-- Frente #8-C (Billing v2 / Macrofrente 1): infraestrutura de solicitação de
-- UPGRADE de plano (cobrança AVULSA, sandbox). PR 1 — fundação estrutural.
--
-- O QUE ESTA TABELA REPRESENTA:
--   A INTENÇÃO de trocar de plano, registrada ANTES do pagamento. É a ponte
--   entre a fatura de upgrade e o plano pretendido. empresas.plano_id NÃO muda
--   aqui — só no webhook, quando a fatura vinculada (fatura_id) virar 'pago'
--   (PR 3). Assim nunca se libera plano antes do pagamento confirmado.
--
-- GARANTIAS:
--   * ADITIVA: cria uma tabela NOVA; NÃO altera empresas/faturas/planos/usuarios;
--   * idempotente (CREATE TABLE/INDEX IF NOT EXISTS);
--   * sem RLS nesta frente (acesso via backend/service_role, igual padrão de
--     `faturas` hoje) — RLS defense-in-depth fica para frente futura;
--   * sem trigger de atualizado_em (a aplicação seta na escrita, como o resto
--     do schema).
--
-- Rodar UMA vez no Supabase SQL Editor (manual; NÃO aplicada por código).

CREATE TABLE IF NOT EXISTS solicitacoes_upgrade_plano (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Apagou a empresa → solicitações somem junto (nunca órfãs).
  empresa_id           uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Plano de origem: só histórico. Se o plano sumir, preserva a solicitação.
  plano_atual_id       uuid NULL     REFERENCES planos(id)  ON DELETE SET NULL,
  -- Plano de destino: não deixar apagar um plano que é alvo de solicitação.
  plano_novo_id        uuid NOT NULL REFERENCES planos(id)  ON DELETE RESTRICT,
  -- Fatura de upgrade vinculada (preenchida pelo endpoint no PR 2). O webhook
  -- (PR 3) resolve a solicitação a partir dela. Preserva auditoria se a fatura
  -- for removida.
  fatura_id            uuid NULL     REFERENCES faturas(id) ON DELETE SET NULL,
  -- Espelho/diagnóstico do payment no Asaas (não é a chave de resolução).
  asaas_payment_id     text NULL,
  status               text NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente','pago','cancelado','expirado','falhou')),
  -- Snapshots para auditoria/histórico (faturas não guardam plano).
  valor_snapshot       numeric(10,2) NULL,
  plano_nome_snapshot  text NULL,
  -- Dedupe de duplo-submit (mesma técnica de faturas, migration 021).
  client_request_id    text NULL,
  -- Autoria: apagar o usuário não bloqueia nem apaga a solicitação.
  criado_por           uuid NULL     REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  pago_em              timestamptz NULL
);

-- IDEMPOTÊNCIA PRINCIPAL: no máximo UMA solicitação pendente por (empresa, plano
-- novo). Segunda tentativa para o mesmo plano reutiliza a solicitação/fatura.
CREATE UNIQUE INDEX IF NOT EXISTS ux_solic_upgrade_empresa_plano_pendente
  ON solicitacoes_upgrade_plano (empresa_id, plano_novo_id)
  WHERE status = 'pendente';

-- Dedupe por chave de idempotência do cliente (só quando preenchida).
CREATE UNIQUE INDEX IF NOT EXISTS ux_solic_upgrade_client_request_id
  ON solicitacoes_upgrade_plano (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Uma solicitação por fatura: o webhook resolve fatura→solicitação sem ambiguidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_solic_upgrade_fatura_id
  ON solicitacoes_upgrade_plano (fatura_id)
  WHERE fatura_id IS NOT NULL;

-- Consulta comum: solicitações de uma empresa por status.
CREATE INDEX IF NOT EXISTS idx_solic_upgrade_empresa_status
  ON solicitacoes_upgrade_plano (empresa_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (executar manualmente se precisar reverter — enquanto vazia):
--   DROP TABLE IF EXISTS solicitacoes_upgrade_plano;
--   (os índices caem junto com a tabela; nada a limpar em empresas/faturas/planos)
-- ─────────────────────────────────────────────────────────────────────────────
