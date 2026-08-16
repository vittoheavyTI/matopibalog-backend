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
  RETURNING id, codigo, nome
),
funcs AS (
  -- UNION (distinct), NÃO "UNION ALL": em re-execução idempotente o upsert_func
  -- (CTE que escreve) devolve os mesmos ids que a leitura da tabela vê no snapshot
  -- pré-statement. Com UNION ALL isso duplicaria os pares (id,codigo) e o
  -- CROSS JOIN abaixo geraria pares (plano,func) repetidos → o ON CONFLICT falharia
  -- com "cannot affect row a second time". UNION deduplica e mantém idempotência.
  -- `nome` entra aqui porque o texto_publico do INSERT usa f.nome.
  SELECT id, codigo, nome FROM upsert_func
  UNION
  SELECT id, codigo, nome FROM public.funcionalidades
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
      -- Decisão comercial do proprietário: SSO/AD segue a MESMA progressão da
      -- Estrutura/ERP (Growth = adicional pago; Scale = incluído; Enterprise =
      -- incluído/sob proposta). O status técnico segue 'em_breve' — o direito
      -- comercial não implica uso técnico até a implementação real.
      THEN CASE
        WHEN p.requer_negociacao = true OR COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 40 THEN 'incluida'
        WHEN COALESCE(p.capacidade_inclusa, p.limite_motoristas, 0) >= 20 THEN 'opcional_paga'
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

-- ============================================================================
-- Guarda de "último administrador" da empresa (governança de acesso)
-- ----------------------------------------------------------------------------
-- Impede que uma empresa fique com ZERO administradores válidos por auto-serviço
-- do painel (rebaixar/desativar/remover o último admin). "Administrador válido"
-- da empresa = usuarios.tipo='admin' AND usuarios.status='ativo' (a autoridade de
-- administração no backend é `isAdmin` = role 'admin'). NÃO cria coluna owner: usa
-- o modelo real existente (tipo/status).
--
-- Concorrência: `pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(
-- empresa_id))` serializa TODA mudança de autoridade do MESMO tenant (update e
-- delete compartilham a chave). Duas remoções simultâneas dos dois últimos admins
-- não passam ambas: a segunda transação espera, re-lê o estado já aplicado e é
-- negada — a empresa termina sempre com >= 1 administrador válido.
--
-- Super-admin NÃO passa por estas funções (break-glass é decidido no controller).
-- Tenant isolation: só conta/atua sobre usuarios da empresa alvo (empresa_id).

CREATE OR REPLACE FUNCTION public.atualizar_usuario_guardando_ultimo_admin(
  p_usuario_id uuid,
  p_empresa_id uuid,
  p_updates jsonb
)
RETURNS public.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_novo_status text;
  v_novo_tipo text;
  v_era_admin boolean;
  v_sera_admin boolean;
  v_outros integer;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo
    FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  v_novo_status := COALESCE(p_updates->>'status', v_alvo.status);
  v_novo_tipo   := COALESCE(p_updates->>'tipo', v_alvo.tipo);

  v_era_admin  := (v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo');
  v_sera_admin := (v_novo_tipo = 'admin' AND v_novo_status = 'ativo');

  IF v_era_admin AND NOT v_sera_admin THEN
    SELECT count(*) INTO v_outros
      FROM public.usuarios
     WHERE empresa_id = p_empresa_id
       AND id <> p_usuario_id
       AND tipo = 'admin'
       AND status = 'ativo';
    IF v_outros = 0 THEN
      RAISE EXCEPTION 'ultimo_admin_da_empresa';
    END IF;
  END IF;

  UPDATE public.usuarios SET
    nome       = CASE WHEN p_updates ? 'nome'       THEN p_updates->>'nome'       ELSE nome END,
    telefone   = CASE WHEN p_updates ? 'telefone'   THEN p_updates->>'telefone'   ELSE telefone END,
    cep        = CASE WHEN p_updates ? 'cep'        THEN p_updates->>'cep'        ELSE cep END,
    endereco   = CASE WHEN p_updates ? 'endereco'   THEN p_updates->>'endereco'   ELSE endereco END,
    bairro     = CASE WHEN p_updates ? 'bairro'     THEN p_updates->>'bairro'     ELSE bairro END,
    cidade     = CASE WHEN p_updates ? 'cidade'     THEN p_updates->>'cidade'     ELSE cidade END,
    foto_url   = CASE WHEN p_updates ? 'foto_url'   THEN p_updates->>'foto_url'   ELSE foto_url END,
    permissoes = CASE WHEN p_updates ? 'permissoes' THEN p_updates->'permissoes'  ELSE permissoes END,
    status     = v_novo_status,
    tipo       = v_novo_tipo
  WHERE id = p_usuario_id
  RETURNING * INTO v_alvo;

  RETURN v_alvo;
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_usuario_guardando_ultimo_admin(
  p_usuario_id uuid,
  p_empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_alvo public.usuarios;
  v_outros integer;
BEGIN
  IF p_usuario_id IS NULL OR p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'guarda_admin_payload_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('guarda_ultimo_admin'), hashtext(p_empresa_id::text));

  SELECT * INTO v_alvo
    FROM public.usuarios
   WHERE id = p_usuario_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  IF v_alvo.tipo = 'admin' AND v_alvo.status = 'ativo' THEN
    SELECT count(*) INTO v_outros
      FROM public.usuarios
     WHERE empresa_id = p_empresa_id
       AND id <> p_usuario_id
       AND tipo = 'admin'
       AND status = 'ativo';
    IF v_outros = 0 THEN
      RAISE EXCEPTION 'ultimo_admin_da_empresa';
    END IF;
  END IF;

  DELETE FROM public.usuarios WHERE id = p_usuario_id;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.excluir_usuario_guardando_ultimo_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.excluir_usuario_guardando_ultimo_admin(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.excluir_usuario_guardando_ultimo_admin(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_usuario_guardando_ultimo_admin(uuid, uuid) TO service_role;

-- ROLLBACK manual:
--   DROP FUNCTION IF EXISTS public.excluir_usuario_guardando_ultimo_admin(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.atualizar_usuario_guardando_ultimo_admin(uuid, uuid, jsonb);
--   DELETE FROM public.plano_funcionalidades
--    WHERE funcionalidade_id IN (SELECT id FROM public.funcionalidades WHERE codigo IN ('estrutura_operacional','integracoes_erp','acesso_corporativo_sso'));
--   UPDATE public.funcionalidades SET ativo = false
--    WHERE codigo IN ('estrutura_operacional','integracoes_erp','acesso_corporativo_sso');
