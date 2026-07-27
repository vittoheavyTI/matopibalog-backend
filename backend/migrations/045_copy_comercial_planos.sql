-- 045_copy_comercial_planos.sql
-- Copy comercial dos planos (descrição + recursos) — texto aprovado pelo usuário.
-- UPDATE-ONLY e IDEMPOTENTE. Mexe SOMENTE em `descricao` (text) e `recursos`
-- (jsonb). NÃO toca preço, capacidade, extras, limite, modelo de cobrança,
-- trial, ativo, categoria — nada além da COMUNICAÇÃO. Sem Asaas, sem faturas,
-- sem cobrança, sem DELETE, sem criar plano.
--
-- Motivação: cards de /planos e /cadastro tinham copy vazia (Autônomo Solo,
-- Autônomo + Admin, Growth, Scale), "Api" (funcionalidade inexistente) em
-- Essencial/Enterprise e descrições com "-- Até" repetindo a capacidade que o
-- card já mostra. Esta migration padroniza a copy sem prometer o que o sistema
-- não faz.
--
-- IDs REAIS (baseline confirmada — mesmos da 041):
--   a630839f-44dc-435f-8e50-449abdb444d4  Autônomo Solo
--   2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0  Autônomo + Admin
--   00000000-0000-0000-0000-000000000002  Empresa Start
--   00000000-0000-0000-0000-000000000003  Empresa Essencial
--   76230185-5877-4a4f-8aa1-9fff8bed16c9  Empresa Growth
--   4401c24a-c5f7-4af8-aa15-bb3b59d6df3f  Empresa Scale
--   00000000-0000-0000-0000-000000000004  Enterprise / Sob negociação
--   00000000-0000-0000-0000-000000000001  Free Teste (NÃO tocado — inativo)
--
-- Rodar UMA vez no Supabase SQL Editor (manual; sob autorização). Transacional.

-- ─────────────────────────────────────────────────────────────────────────────
-- (BASELINE) Rodar ANTES de aplicar — snapshot read-only do que será alterado.
-- Guarde a saída: é a referência para conferir o antes/depois e o rollback.
--   SELECT id, nome, descricao, recursos
--   FROM planos
--   WHERE id IN (
--     'a630839f-44dc-435f-8e50-449abdb444d4',
--     '2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0',
--     '00000000-0000-0000-0000-000000000002',
--     '00000000-0000-0000-0000-000000000003',
--     '76230185-5877-4a4f-8aa1-9fff8bed16c9',
--     '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f',
--     '00000000-0000-0000-0000-000000000004'
--   )
--   ORDER BY preco_mensal;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Guarda: os 7 planos-alvo precisam existir pelos IDs esperados ────────────
DO $$
DECLARE faltando int;
BEGIN
  SELECT count(*) INTO faltando FROM (VALUES
    ('a630839f-44dc-435f-8e50-449abdb444d4'::uuid),
    ('2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('76230185-5877-4a4f-8aa1-9fff8bed16c9'::uuid),
    ('4401c24a-c5f7-4af8-aa15-bb3b59d6df3f'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid)
  ) AS alvo(id)
  WHERE NOT EXISTS (SELECT 1 FROM planos p WHERE p.id = alvo.id);
  IF faltando > 0 THEN
    RAISE EXCEPTION 'Catálogo divergente: % plano(s)-alvo não encontrado(s) pelos IDs esperados.', faltando;
  END IF;
END $$;

-- ── 1. Autônomo Solo ─────────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Para o caminhoneiro autônomo.',
  recursos  = '["Gestão de fretes e despesas","Relatórios em PDF","App do motorista","Suporte por e-mail"]'::jsonb
WHERE id = 'a630839f-44dc-435f-8e50-449abdb444d4';

-- ── 2. Autônomo + Admin ──────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Autônomo com um administrador acompanhando a operação.',
  recursos  = '["Tudo do Autônomo Solo","Administrador no painel web","Relatórios em PDF","Suporte por e-mail"]'::jsonb
WHERE id = '2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0';

-- ── 3. Empresa Start ─────────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Para pequenas frotas.',
  recursos  = '["Gestão de fretes, despesas e abastecimentos","Relatórios em PDF","App do motorista","Motoristas adicionais sob demanda","Suporte por e-mail"]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000002';

-- ── 4. Empresa Essencial ─────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Para frotas em crescimento.',
  recursos  = '["Tudo do Start","Multiusuário no painel web","Suporte prioritário","Relatórios e histórico de fretes"]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000003';

-- ── 5. Empresa Growth ────────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Para frotas em expansão.',
  recursos  = '["Tudo do Essencial","Gestão para frotas maiores","Multiusuário no painel web","Suporte prioritário"]'::jsonb
WHERE id = '76230185-5877-4a4f-8aa1-9fff8bed16c9';

-- ── 6. Empresa Scale ─────────────────────────────────────────────────────────
UPDATE planos SET
  descricao = 'Para operações de grande porte.',
  recursos  = '["Tudo do Growth","Gestão para frotas grandes","Multiusuário no painel web","Suporte prioritário"]'::jsonb
WHERE id = '4401c24a-c5f7-4af8-aa15-bb3b59d6df3f';

-- ── 7. Enterprise / Sob negociação ───────────────────────────────────────────
UPDATE planos SET
  descricao = 'Acima de 40 motoristas — proposta personalizada.',
  recursos  = '["Motoristas conforme sua operação","Suporte dedicado","Implantação e atendimento personalizados","Multiusuário no painel web"]'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000004';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- (VALIDAÇÃO PÓS-APLICAÇÃO) Rodar DEPOIS — todas read-only.
--
-- (V1) A copy nova está gravada nos 7 planos, e Free Teste NÃO foi tocado.
--   SELECT id, nome, descricao, recursos
--   FROM planos
--   WHERE categoria IN ('autonomo','empresa') OR id = '00000000-0000-0000-0000-000000000004'
--   ORDER BY preco_mensal;
--
-- (V2) Nenhum "Api" sobrou em recursos (esperado: 0 linhas).
--   SELECT id, nome FROM planos WHERE recursos::text ILIKE '%"Api"%';
--
-- (V3) NADA além de descricao/recursos mudou — confira que preço, capacidade,
--      extras, limite, modelo e ativo seguem os valores da 041 (esperado: iguais).
--   SELECT nome, preco_mensal, capacidade_inclusa, preco_motorista_extra,
--          limite_motoristas, modelo_cobranca, requer_negociacao, ativo
--   FROM planos WHERE categoria IN ('autonomo','empresa')
--      OR id = '00000000-0000-0000-0000-000000000004'
--   ORDER BY preco_mensal;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- (ROLLBACK) Restaura EXATAMENTE a copy anterior (baseline read-only 2026-07-26).
-- Executar manualmente se precisar reverter. Só descricao/recursos.
--
-- BEGIN;
-- UPDATE planos SET descricao='Plano para motoristas autônomos', recursos='[]'::jsonb
--   WHERE id='a630839f-44dc-435f-8e50-449abdb444d4';
-- UPDATE planos SET descricao='Plano para motoristas autônomos — 1 motorista e 1 administrador.', recursos='[]'::jsonb
--   WHERE id='2a2f60bd-1ae3-4df0-aa9f-d98abd41ddb0';
-- UPDATE planos SET descricao='Para pequenas frotas — até 5 motoristas', recursos='["Suporte: email","Relatórios"]'::jsonb
--   WHERE id='00000000-0000-0000-0000-000000000002';
-- UPDATE planos SET descricao='Para frotas em crescimento — até 10 motoristas', recursos='["Api","Suporte: prioritário","Relatórios"]'::jsonb
--   WHERE id='00000000-0000-0000-0000-000000000003';
-- UPDATE planos SET descricao='Para frotas mais consistentes -- Até 20 motoristas', recursos='[]'::jsonb
--   WHERE id='76230185-5877-4a4f-8aa1-9fff8bed16c9';
-- UPDATE planos SET descricao='Empresas com frotas grandes -- Até 40 motoristas', recursos='[]'::jsonb
--   WHERE id='4401c24a-c5f7-4af8-aa15-bb3b59d6df3f';
-- UPDATE planos SET descricao='Motoristas ilimitados — recursos completos', recursos='["Api","Suporte: dedicado","Relatórios","Multiusuário","Personalização"]'::jsonb
--   WHERE id='00000000-0000-0000-0000-000000000004';
-- COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
