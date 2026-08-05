-- seed_funcionalidades.sql
-- Carga inicial IDEMPOTENTE do catálogo de funcionalidades (PR 2C).
-- Aplicar DEPOIS da migration 060 e DEPOIS do merge do código correspondente.
--
-- REGRA: só entra como 'disponivel'/visível o que JÁ está implementado e validado.
-- Funcionalidades futuras entram como roadmap (planejada/em_breve) e OCULTAS
-- (visivel_publicamente=false) — só aparecem como "Em breve" quando o proprietário
-- ativar a visibilidade. Nada futuro é vendido como concluído.

-- ── Implementadas (disponíveis, visíveis) ────────────────────────────────────
INSERT INTO public.funcionalidades (codigo, nome, descricao_publica, categoria, modulo, status_ciclo_vida, modelo_cobranca, visivel_publicamente, ativo, ordem_exibicao) VALUES
  ('gestao_fretes',      'Gestão de fretes',            'Cadastro e acompanhamento de fretes.',                 'operacao',   'fretes',      'disponivel', 'incluso', true, true, 10),
  ('gestao_despesas',    'Despesas e abastecimentos',   'Controle de despesas, abastecimentos e vales.',        'operacao',   'financeiro',  'disponivel', 'incluso', true, true, 20),
  ('relatorios_pdf',     'Relatórios em PDF',           'Relatórios operacionais e financeiros em PDF.',        'relatorios', 'relatorios',  'disponivel', 'incluso', true, true, 30),
  ('app_motorista',      'App do motorista',            'Aplicativo Android para os motoristas.',               'app',        'app',         'disponivel', 'incluso', true, true, 40),
  ('epod',               'ePOD e ocorrências',          'Comprovante eletrônico de entrega e ocorrências.',     'operacao',   'epod',        'disponivel', 'incluso', true, true, 50),
  ('rastreamento_leve',  'Rastreamento leve',           'Localização leve do frete pelo app.',                  'operacao',   'rastreamento','disponivel', 'incluso', true, true, 60),
  ('rentabilidade',      'Rentabilidade por viagem',    'Receita, custo e margem por viagem.',                  'relatorios', 'financeiro',  'disponivel', 'incluso', true, true, 70),
  ('acerto_motoristas',  'Acerto de motoristas',        'Consolidação de acerto por motorista.',                'relatorios', 'financeiro',  'disponivel', 'incluso', true, true, 80),
  ('torre_controle',     'Torre de controle',           'Visão consolidada da operação.',                       'operacao',   'torre',       'disponivel', 'incluso', true, true, 90),
  ('multiusuario',       'Multiusuário no painel',      'Vários usuários administrativos no painel web.',       'plataforma', 'painel',      'disponivel', 'incluso', true, true, 100)
ON CONFLICT (codigo) DO NOTHING;

-- ── Roadmap (NÃO implementadas) — ocultas até o proprietário liberar ─────────
INSERT INTO public.funcionalidades (codigo, nome, descricao_publica, descricao_interna, categoria, modulo, status_ciclo_vida, modelo_cobranca, visivel_publicamente, ativo, ordem_exibicao) VALUES
  ('erp_api',            'Integração ERP via API',      'Conector para ERPs.',                'Integration Hub — adapters/filas/idempotência.',  'integracao', 'erp',      'planejada',        'adicional',     false, true, 200),
  ('webhooks_empresariais','Webhooks empresariais',     'Eventos para sistemas do cliente.',  'Webhooks assinados.',                             'integracao', 'erp',      'planejada',        'adicional',     false, true, 210),
  ('vinculo_docs_fiscais','Vínculo de NF-e/CT-e/MDF-e', 'Vínculo automático de documentos.',  'ERP/provedor é a fonte fiscal autoritativa.',     'fiscal',     'fiscal',   'planejada',        'sob_negociacao',false, true, 220),
  ('emissao_por_erp',    'Solicitação de emissão',      'Orquestra emissão pelo ERP.',        'Matopiba orquestra; não emite.',                  'fiscal',     'fiscal',   'planejada',        'sob_negociacao',false, true, 230),
  ('sso_entra_ad',       'SSO corporativo (Entra/AD)',  'Login corporativo.',                 'SSO Entra ID/AD.',                                'plataforma', 'sso',      'planejada',        'adicional',     false, true, 240),
  ('demanda_frete',      'Demanda e compra de frete',   'Solicitação e aprovação de frete.',  'Fluxo de demanda/aprovação.',                     'operacao',   'demanda',  'planejada',        'adicional',     false, true, 250),
  ('despacho_assistido', 'Despacho assistido',          'Disponibilidade e ofertas.',         'Despacho + oferta ao motorista.',                 'operacao',   'despacho', 'planejada',        'adicional',     false, true, 260),
  ('ia_operacional',     'IA operacional avançada',     'Assistentes por nível de plano.',    'IA por nível / multi-filial / agentes.',          'ia',         'ia',       'planejada',        'adicional',     false, true, 270)
ON CONFLICT (codigo) DO NOTHING;

-- ── Matriz padrão: features CORE implementadas ficam INCLUÍDAS em todos os
-- planos ativos (o super-admin refina depois na página de Funcionalidades). ────
INSERT INTO public.plano_funcionalidades (plano_id, funcionalidade_id, disponibilidade, exibir_no_card, ordem_exibicao)
SELECT p.id, f.id, 'incluida', true, f.ordem_exibicao
FROM public.planos p
CROSS JOIN public.funcionalidades f
WHERE f.status_ciclo_vida = 'disponivel' AND f.ativo = true
ON CONFLICT (plano_id, funcionalidade_id) DO NOTHING;
