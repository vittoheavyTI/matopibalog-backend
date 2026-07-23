-- Migration 035: soft-cancel das faturas ABERTAS de contas de teste ARQUIVAR.
--
-- ⚠️ NÃO APLICAR AUTOMATICAMENTE. Rodar no Supabase SQL Editor SOMENTE após
-- autorização explícita, na ordem: (1) baseline read-only; (2) criar tabela de
-- auditoria; (3) snapshot; (4) UPDATE; (5) validação. As escritas (3 e 4) estão
-- COMENTADAS — descomentar só na hora de aplicar. Este arquivo é versionado para
-- revisão; NÃO é executado pelo deploy.
--
-- Contexto (go-live, classificação de contas 2026-07-23):
--   * Camada 1 (limpeza billing mínima). NÃO mexe em empresas, usuários, dados
--     operacionais, customer/assinatura Asaas. Só faturas ABERTAS de contas
--     classificadas como ARQUIVAR.
--   * ALVO EXPLÍCITO por fatura_id (padrão da migration 033): as 4 faturas
--     abertas de autônomos de teste. Keepers (Empresa Alfa, José, SANDBOX 01,
--     INFRA TRANSP TESTE, E2E EMPRESA TESTE BASICO, Transportadora Bravo) NÃO
--     estão na lista — impossível entrarem.
--   * FATURAS PAGAS NUNCA ENTRAM: baseline confirmou pagas=0 em todas ARQUIVAR;
--     e o UPDATE filtra status IN ('pendente','vencido').
--   * Os 4 alvos têm asaas_id (cobrança SANDBOX). Só a fatura LOCAL vira
--     'cancelado'; o Asaas NÃO é tocado (fora de escopo; é sandbox).
--   * Sem DELETE. Só status muda. valor, asaas_id, origem, snapshot intactos.
--   * Idempotente: UNIQUE(fatura_id, acao) + ON CONFLICT DO NOTHING no snapshot;
--     UPDATE só pega status aberto (reexecução após cancelar = 0 linhas).

-- ============================================================================
-- 1. TABELA DE AUDITORIA (DDL idempotente). Espelha fretes_correcoes_auditoria
--    (migration 033). Segura para rodar: CREATE TABLE IF NOT EXISTS.
-- ============================================================================
CREATE TABLE IF NOT EXISTS faturas_correcoes_auditoria (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fatura_id   uuid NOT NULL,
  empresa_id  uuid,
  acao        text NOT NULL,
  motivo      text,
  snapshot    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'faturas_correcoes_auditoria_fatura_acao_uniq'
  ) THEN
    ALTER TABLE faturas_correcoes_auditoria
      ADD CONSTRAINT faturas_correcoes_auditoria_fatura_acao_uniq UNIQUE (fatura_id, acao);
  END IF;
END $$;

-- ============================================================================
-- 2. BASELINE (read-only) — rodar e GUARDAR antes de qualquer escrita.
-- ============================================================================

-- B1. As 4 faturas-alvo (devem estar todas pendente/vencido, empresa ARQUIVAR,
--     pagas nunca). Se alguma não estiver aberta, o UPDATE simplesmente a ignora.
SELECT f.id AS fatura_id, f.empresa_id, e.nome, f.status, f.valor, f.origem, f.asaas_id
FROM faturas f JOIN empresas e ON e.id = f.empresa_id
WHERE f.id IN (
  '6330d922-2f79-4c05-b299-f7eb2aae9cfd', -- Autônomo Test com Admin
  'cc09a096-1e75-490a-8fb6-9d526c816ff1', -- Ricardo Autônomo
  '5bb19e7d-940b-45d7-ab34-ea821b2d54ed', -- Teste Autônomo 5
  '46f7850b-a4c0-4da1-9bed-2684f0de2693'  -- Teste Autônomo com Adm
)
ORDER BY e.nome;

-- B2. PROVA DE SEGURANÇA: nenhuma dessas 4 pode estar 'pago'. Esperado: 0 linhas.
SELECT id, empresa_id, status FROM faturas
WHERE id IN (
  '6330d922-2f79-4c05-b299-f7eb2aae9cfd',
  'cc09a096-1e75-490a-8fb6-9d526c816ff1',
  '5bb19e7d-940b-45d7-ab34-ea821b2d54ed',
  '46f7850b-a4c0-4da1-9bed-2684f0de2693'
) AND status = 'pago';

-- B3. PROVA DE ISOLAMENTO: as faturas abertas da SANDBOX 01 (keeper) NÃO estão
--     na lista-alvo. Esperado: 2 linhas, ambas com id fora do IN acima.
SELECT id, empresa_id, status FROM faturas
WHERE empresa_id = '0be90f37-8c26-4297-ba4e-a58883317360' -- MATOPIBA ASSINATURA SANDBOX 01
  AND status IN ('pendente','vencido');

-- B4. Gate financeiro antes (referência): esperado 20 / 5 / 604.78 / 6 / 9.
SELECT count(*) total,
       count(*) FILTER (WHERE status='pago') pagas,
       coalesce(sum(valor) FILTER (WHERE status='pago'),0) total_pago,
       count(*) FILTER (WHERE status IN ('pendente','vencido')) abertas,
       count(*) FILTER (WHERE status='cancelado') canceladas
FROM faturas;

-- ============================================================================
-- 3. SNAPSHOT (DML — COMENTADO). Backup lógico ANTES do UPDATE. Só faturas
--    abertas da lista-alvo entram. ON CONFLICT preserva o snapshot original.
--    ⚠️ Descomentar só na aplicação autorizada.
-- ============================================================================
-- INSERT INTO faturas_correcoes_auditoria (fatura_id, empresa_id, acao, motivo, snapshot)
-- SELECT f.id, f.empresa_id, 'soft_cancel_teste_golive',
--        'conta ARQUIVAR (teste); fatura aberta cancelada na limpeza go-live 035',
--        to_jsonb(f)
-- FROM faturas f
-- WHERE f.id IN (
--   '6330d922-2f79-4c05-b299-f7eb2aae9cfd',
--   'cc09a096-1e75-490a-8fb6-9d526c816ff1',
--   '5bb19e7d-940b-45d7-ab34-ea821b2d54ed',
--   '46f7850b-a4c0-4da1-9bed-2684f0de2693'
-- ) AND f.status IN ('pendente','vencido')
-- ON CONFLICT (fatura_id, acao) DO NOTHING;

-- Validação do snapshot (após rodar o INSERT): esperado 4 linhas.
-- SELECT count(*) FROM faturas_correcoes_auditoria WHERE acao='soft_cancel_teste_golive';

-- ============================================================================
-- 4. SOFT-CANCEL (DML — COMENTADO). Só status muda. Nunca toca pagas (filtro),
--    nunca toca keepers (não estão na lista), nunca deleta, nunca muda valor/
--    asaas_id. Idempotente. ⚠️ Descomentar só na aplicação autorizada, e SÓ
--    depois do snapshot acima.
-- ============================================================================
-- UPDATE faturas
-- SET status = 'cancelado'
-- WHERE id IN (
--   '6330d922-2f79-4c05-b299-f7eb2aae9cfd',
--   'cc09a096-1e75-490a-8fb6-9d526c816ff1',
--   '5bb19e7d-940b-45d7-ab34-ea821b2d54ed',
--   '46f7850b-a4c0-4da1-9bed-2684f0de2693'
-- ) AND status IN ('pendente','vencido')
-- RETURNING id, empresa_id, status;

-- ============================================================================
-- 5. VALIDAÇÃO (read-only) — rodar DEPOIS do UPDATE.
-- ============================================================================

-- V1. As 4 alvos agora 'cancelado'. Esperado: 4 linhas cancelado.
-- SELECT id, status FROM faturas WHERE id IN (
--   '6330d922-2f79-4c05-b299-f7eb2aae9cfd',
--   'cc09a096-1e75-490a-8fb6-9d526c816ff1',
--   '5bb19e7d-940b-45d7-ab34-ea821b2d54ed',
--   '46f7850b-a4c0-4da1-9bed-2684f0de2693'
-- );

-- V2. Gate depois: total 20 (nada deletado), pagas 5, total_pago 604.78 (pagas
--     intactas), abertas 6→2 (só SANDBOX 01), canceladas 9→13.
-- SELECT count(*) total,
--        count(*) FILTER (WHERE status='pago') pagas,
--        coalesce(sum(valor) FILTER (WHERE status='pago'),0) total_pago,
--        count(*) FILTER (WHERE status IN ('pendente','vencido')) abertas,
--        count(*) FILTER (WHERE status='cancelado') canceladas
-- FROM faturas;

-- V3. SANDBOX 01 (keeper) intacta: ainda 2 abertas.
-- SELECT count(*) FROM faturas
-- WHERE empresa_id='0be90f37-8c26-4297-ba4e-a58883317360'
--   AND status IN ('pendente','vencido');

-- V4. Snapshots == faturas afetadas. Esperado: 4.
-- SELECT count(*) FROM faturas_correcoes_auditoria WHERE acao='soft_cancel_teste_golive';

-- ============================================================================
-- 6. ROLLBACK (DML — COMENTADO). Restaura o status a partir do snapshot, caso
--    necessário. Só reverte o que a ação 035 cancelou.
-- ============================================================================
-- UPDATE faturas f
-- SET status = (a.snapshot->>'status')
-- FROM faturas_correcoes_auditoria a
-- WHERE a.fatura_id = f.id
--   AND a.acao = 'soft_cancel_teste_golive'
--   AND f.status = 'cancelado';
