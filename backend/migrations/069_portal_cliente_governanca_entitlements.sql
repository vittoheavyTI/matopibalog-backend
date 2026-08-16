-- 069_portal_cliente_governanca_entitlements.sql
-- Portal do Cliente: catálogo declarativo para Estrutura Operacional, ERP e SSO.
--
-- ADITIVA e idempotente. Não cria contas, não altera empresas, não ativa Asaas,
-- não cria faturas, não executa runner e não aplica cobrança. A aplicação desta
-- migration é etapa futura controlada; neste PR ela apenas documenta o próximo
-- DDL/DML necessário para a matriz de funcionalidades.

WITH upsert_func AS (
  INSERT INTO public.funcionalidades
    (codigo, nome, descricao_publica, categoria, modulo, status_ciclo_vida,
     modelo_cobranca, ativo, visivel_publicamente, ordem_exibicao)
  VALUES
    -- Estrutura Operacional é TECNICAMENTE implementada (migration 067: grupos/
    -- filiais/unidades/regiões/escopos) → status_ciclo_vida='disponivel'.
    ('estrutura_operacional', 'Estrutura operacional',
     'Unidades, regiões e acesso por escopo operacional.', 'governanca', 'portal_cliente',
     'disponivel', 'incluso', true, true, 210),
    -- ERP e SSO ainda NÃO possuem conector/implementação técnica real. O ENTITLEMENT
    -- comercial pode existir por plano (plano_funcionalidades abaixo), mas o STATUS
    -- TÉCNICO precisa ser honesto: 'em_breve'. resolverEntitlement nega o acesso real
    -- (nao_implementada) e o card público mostra "Em breve", nunca "Conectado".
    ('integracoes_erp', 'Integrações ERP',
     'Acompanhamento assistido de integrações com sistemas de gestão.', 'integracoes', 'portal_cliente',
     'em_breve', 'adicional', true, true, 220),
    ('acesso_corporativo_sso', 'Acesso corporativo SSO',
     'Governança de acesso corporativo por provedor de identidade.', 'seguranca', 'portal_cliente',
     'em_breve', 'sob_negociacao', true, true, 230)
  ON CONFLICT (codigo) DO UPDATE SET
    nome = EXCLUDED.nome,
    descricao_publica = EXCLUDED.descricao_publica,
    categoria = EXCLUDED.categoria,
    modulo = EXCLUDED.modulo,
    status_ciclo_vida = EXCLUDED.status_ciclo_vida,
    modelo_cobranca = EXCLUDED.modelo_cobranca,
    ativo = true,
    visivel_publicamente = true,
    atualizado_em = now()
  RETURNING id, codigo
),
funcs AS (
  -- UNION (distinct), NÃO "UNION ALL": em re-execução idempotente o upsert_func
  -- (CTE que escreve) devolve os mesmos ids que a leitura da tabela vê no snapshot
  -- pré-statement. Com UNION ALL isso duplicaria os pares (id,codigo) e o
  -- CROSS JOIN abaixo geraria pares (plano,func) repetidos → o ON CONFLICT falharia
  -- com "cannot affect row a second time". UNION deduplica e mantém idempotência.
  SELECT id, codigo FROM upsert_func
  UNION
  SELECT id, codigo FROM public.funcionalidades
   WHERE codigo IN ('estrutura_operacional', 'integracoes_erp', 'acesso_corporativo_sso')
),
planos_alvo AS (
  SELECT id, nome, capacidade_inclusa, limite_motoristas, requer_negociacao
    FROM public.planos
   WHERE categoria IN ('empresa', 'ambos')
)
INSERT INTO public.plano_funcionalidades
  (plano_id, funcionalidade_id, disponibilidade, exibir_no_card, texto_publico, ordem_exibicao)
SELECT
  p.id,
  f.id,
  CASE
    WHEN f.codigo = 'estrutura_operacional'
      THEN CASE
        WHEN p.requer_negociacao = true OR COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 40 THEN 'incluida'
        WHEN COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 20 THEN 'opcional_paga'
        ELSE 'indisponivel'
      END
    WHEN f.codigo = 'integracoes_erp'
      THEN CASE
        WHEN p.requer_negociacao = true OR COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 40 THEN 'incluida'
        WHEN COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 20 THEN 'opcional_paga'
        ELSE 'indisponivel'
      END
    WHEN f.codigo = 'acesso_corporativo_sso'
      THEN CASE
        WHEN p.requer_negociacao = true THEN 'incluida'
        WHEN COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 40 THEN 'sob_negociacao'
        ELSE 'indisponivel'
      END
  END AS disponibilidade,
  true,
  f.nome,
  CASE f.codigo
    WHEN 'estrutura_operacional' THEN 210
    WHEN 'integracoes_erp' THEN 220
    WHEN 'acesso_corporativo_sso' THEN 230
  END
FROM planos_alvo p
CROSS JOIN funcs f
ON CONFLICT (plano_id, funcionalidade_id) DO UPDATE SET
  disponibilidade = EXCLUDED.disponibilidade,
  exibir_no_card = EXCLUDED.exibir_no_card,
  texto_publico = EXCLUDED.texto_publico,
  ordem_exibicao = EXCLUDED.ordem_exibicao,
  atualizado_em = now();

-- ROLLBACK manual:
--   DELETE FROM public.plano_funcionalidades
--    WHERE funcionalidade_id IN (SELECT id FROM public.funcionalidades WHERE codigo IN ('estrutura_operacional','integracoes_erp','acesso_corporativo_sso'));
--   UPDATE public.funcionalidades SET ativo = false
--    WHERE codigo IN ('estrutura_operacional','integracoes_erp','acesso_corporativo_sso');
