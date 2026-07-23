-- Migration 034: limpeza auditável de billing para o go-live.
--
-- ⚠️ NÃO APLICAR AUTOMATICAMENTE. Rodar no Supabase SQL Editor SOMENTE após
-- autorização explícita, bloco a bloco, conferindo a baseline antes e a
-- validação depois. Este arquivo é versionado para revisão; ele NÃO é executado
-- pelo deploy.
--
-- Princípios (mesma disciplina da migration 033):
--   * Preferir SOFT (status='cancelado', reatribuição) a DELETE — nada é apagado.
--   * DDL e DML separados. Aqui NÃO há DDL (nenhuma estrutura muda).
--   * Cada DML é rule-based e idempotente (rodar 2x não piora).
--   * Baseline read-only ANTES; validação read-only DEPOIS.
--   * Escopo restrito: só toca (a) categoria de plano de autônomos e
--     (b) reservas órfãs de regularização. NÃO apaga contas de teste — isso
--     depende de classificação keeper-vs-teste do responsável (bloco C, manual).
--
-- Contexto (auditoria go-live 2026-07-22):
--   * 7 empresas tipo='autonomo' estão em "Plano Básico" (categoria 'empresa').
--     O PR #304 já impede NOVAS incompatibilidades; estas são dados legados.
--   * 13 faturas origem='regularizacao' status='pendente' sem asaas_id são
--     reservas órfãs (cadastro incompleto antes do PR #303) — impagáveis.

-- ============================================================================
-- BASELINE (read-only) — rodar e GUARDAR o resultado antes de qualquer DML.
-- ============================================================================

-- B1. Snapshot das empresas autônomas em plano de categoria empresa.
SELECT e.id, e.nome, e.tipo, e.plano_id, p.nome AS plano, p.categoria
FROM empresas e JOIN planos p ON p.id = e.plano_id
WHERE e.tipo = 'autonomo' AND p.categoria = 'empresa'
ORDER BY e.nome;

-- B2. Snapshot das reservas órfãs (regularização pendente sem asaas_id).
SELECT id, empresa_id, status, valor, origem, periodo_referencia, client_request_id, created_at
FROM faturas
WHERE origem = 'regularizacao' AND status = 'pendente' AND asaas_id IS NULL
ORDER BY created_at;

-- B3. Plano de destino para autônomos (categoria 'autonomo' ativo mais barato).
SELECT id, nome, categoria, preco_mensal
FROM planos
WHERE categoria = 'autonomo' AND ativo = true AND arquivado_em IS NULL
ORDER BY preco_mensal ASC
LIMIT 1;
-- Esperado: 'Plano Básico Autônomo' (a630839f-44dc-435f-8e50-449abdb444d4).

-- ============================================================================
-- BLOCO A (DML) — corrigir categoria: autônomo → plano de autônomo.
-- Reatribui empresas.plano_id para o plano de autônomo mais barato ativo.
-- Rule-based e idempotente: após rodar, B1 volta vazio.
-- ⚠️ Só executar após conferir B1 e B3.
-- ============================================================================

-- UPDATE empresas e
-- SET plano_id = (
--   SELECT p.id FROM planos p
--   WHERE p.categoria = 'autonomo' AND p.ativo = true AND p.arquivado_em IS NULL
--   ORDER BY p.preco_mensal ASC LIMIT 1
-- )
-- FROM planos pa
-- WHERE e.plano_id = pa.id
--   AND e.tipo = 'autonomo'
--   AND pa.categoria = 'empresa';

-- Validação A (deve voltar 0 linhas):
-- SELECT count(*) FROM empresas e JOIN planos p ON p.id = e.plano_id
-- WHERE e.tipo='autonomo' AND p.categoria='empresa';

-- ============================================================================
-- BLOCO B (DML) — cancelar (soft) reservas órfãs de regularização.
-- status → 'cancelado'. NÃO deleta. Idempotente (só pega pendente+órfã).
-- Estas faturas não têm cobrança no Asaas (asaas_id NULL) e são impagáveis;
-- cancelá-las limpa o gate sem afetar nada real.
-- ⚠️ Só executar após conferir B2. Se alguma empresa dessas for MANTIDA e
--    precisar de fatura real, gerar de novo pelo endpoint de regularização
--    (agora com cadastro completo, PR #303).
-- ============================================================================

-- UPDATE faturas
-- SET status = 'cancelado'
-- WHERE origem = 'regularizacao' AND status = 'pendente' AND asaas_id IS NULL;

-- Validação B (deve voltar 0 linhas):
-- SELECT count(*) FROM faturas
-- WHERE origem='regularizacao' AND status='pendente' AND asaas_id IS NULL;

-- ============================================================================
-- BLOCO C (MANUAL, fora deste arquivo) — contas de teste.
-- A exclusão/arquivamento de empresas de teste (Codex, TESTE, Sandbox, Alfa,
-- Bravo, Planeta X, etc.) depende de decisão keeper-vs-teste do responsável e
-- tem FKs (usuarios, motoristas, fretes, faturas). NÃO scriptado aqui: entregar
-- lista classificada + baseline + plano de arquivamento em bloco próprio,
-- preferindo soft (status/arquivamento) a DELETE. Ver runbook de go-live.
-- ============================================================================
