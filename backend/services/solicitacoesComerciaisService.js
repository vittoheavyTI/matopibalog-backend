// Solicitações comerciais de ADD-ONS (Fatia 2 — super-admin comercial).
//
// Reaproveita estruturas existentes (SEM migration):
//   - empresa_funcionalidades: a solicitação de add-on é uma linha com
//     status='pendente', origem='adicional', preco_mensal_centavos, billing_component_id=null.
//     'pendente' NÃO ativa entitlement (resolverEntitlement exige 'ativa') nem gera
//     cobrança (billing só lê 'ativa'). Aprovar = status→'ativa'. Recusar = 'inativa'.
//   - funcionalidade_auditoria: trilha de auditoria (acao ativar/desativar, detalhe,
//     ator_id) para aprovar/recusar.
//
// NÃO chama Asaas, NÃO cria cobrança/fatura, NÃO muda empresa.plano_id.

// Preço de referência (apenas rótulo/legado). NÃO é aplicado cegamente: o preço
// gravado é resolvido por funcionalidade (preço específico do plano → preço padrão
// aprovado da feature → NULL/sob proposta). ERP/SSO sem preço aprovado gravam NULL.
const ADDON_PADRAO_CENTAVOS = 14990;
const CODIGOS_ADDON = ['estrutura_operacional', 'integracoes_erp', 'acesso_corporativo_sso'];

async function carregarFuncionalidadesAddon(supabase) {
  const { data, error } = await supabase
    .from('funcionalidades')
    .select('id, codigo, nome, status_ciclo_vida, preco_padrao_centavos')
    .in('codigo', CODIGOS_ADDON);
  if (error) throw error;
  return data || [];
}

// Preço específico do plano da empresa por funcionalidade (override), quando existir.
async function carregarPrecoEspecificoPlano(supabase, planoId, funcIds) {
  const mapa = new Map();
  if (!planoId || !funcIds.length) return mapa;
  const { data, error } = await supabase
    .from('plano_funcionalidades')
    .select('funcionalidade_id, preco_especifico_centavos')
    .eq('plano_id', planoId)
    .in('funcionalidade_id', funcIds);
  if (error || !data) return mapa;
  for (const pf of data) {
    mapa.set(pf.funcionalidade_id, Number.isFinite(pf.preco_especifico_centavos) ? pf.preco_especifico_centavos : null);
  }
  return mapa;
}

// Resolve o preço a GRAVAR na solicitação: específico do plano → padrão da feature
// → NULL (sob proposta). NUNCA inventa preço: ERP/SSO sem preço aprovado = NULL.
function resolverPrecoSolicitacao({ especificoCentavos, padraoCentavos }) {
  if (Number.isFinite(especificoCentavos) && especificoCentavos > 0) return especificoCentavos;
  if (Number.isFinite(padraoCentavos) && padraoCentavos > 0) return padraoCentavos;
  return null;
}

// Cliente (admin/owner) solicita add-ons. Idempotente: se já existe linha
// ativa/pendente para (empresa, funcionalidade), não duplica. Nunca ativa.
async function solicitarAddons({ supabase, empresaId, usuarioId, codigos } = {}) {
  if (!supabase || !empresaId) return { status: 400, body: { message: 'Empresa nao identificada.' } };
  const pedidos = Array.isArray(codigos) ? codigos.filter((c) => CODIGOS_ADDON.includes(c)) : [];
  if (!pedidos.length) return { status: 400, body: { message: 'Selecione ao menos um servico adicional.' } };

  const funcs = await carregarFuncionalidadesAddon(supabase);
  const porCodigo = new Map(funcs.map((f) => [f.codigo, f]));

  // Plano atual da empresa (para preço específico do plano, se houver).
  const { data: empresa } = await supabase
    .from('empresas')
    .select('plano_id')
    .eq('id', empresaId)
    .maybeSingle();
  const funcIds = pedidos.map((c) => porCodigo.get(c)).filter(Boolean).map((f) => f.id);
  const precoEspecifico = await carregarPrecoEspecificoPlano(supabase, empresa?.plano_id, funcIds);

  const { data: existentes } = await supabase
    .from('empresa_funcionalidades')
    .select('funcionalidade_id, status')
    .eq('empresa_id', empresaId)
    .in('status', ['ativa', 'pendente']);
  const jaTem = new Set((existentes || []).map((e) => e.funcionalidade_id));

  const criadas = [];
  const idempotentes = [];
  const sobProposta = [];
  for (const codigo of pedidos) {
    const f = porCodigo.get(codigo);
    if (!f) continue;
    if (jaTem.has(f.id)) { idempotentes.push(codigo); continue; }
    // Preço por funcionalidade — NUNCA fabricado. ERP/SSO sem preço aprovado = NULL.
    const preco = resolverPrecoSolicitacao({
      especificoCentavos: precoEspecifico.get(f.id),
      padraoCentavos: f.preco_padrao_centavos,
    });
    const { error } = await supabase.from('empresa_funcionalidades').insert({
      empresa_id: empresaId,
      funcionalidade_id: f.id,
      status: 'pendente',
      origem: 'adicional',
      preco_mensal_centavos: preco, // null = sob proposta (super-admin define na aprovação)
      motivo: 'solicitacao_cliente',
      billing_component_id: null,
    });
    if (error) throw error;
    criadas.push(codigo);
    if (preco == null) sobProposta.push(codigo);
  }
  return { status: 201, body: { solicitados: criadas, ja_existiam: idempotentes, sob_proposta: sobProposta } };
}

// Super-admin: lista solicitações de add-on pendentes (com empresa e funcionalidade).
async function listarSolicitacoes({ supabase } = {}) {
  const { data, error } = await supabase
    .from('empresa_funcionalidades')
    .select('id, empresa_id, funcionalidade_id, status, origem, preco_mensal_centavos, motivo, criado_em, empresas!inner(nome, plano_id), funcionalidades!inner(codigo, nome, status_ciclo_vida)')
    .eq('status', 'pendente')
    .eq('origem', 'adicional')
    .order('criado_em', { ascending: true });
  if (error) throw error;
  const itens = (data || []).map((r) => ({
    id: r.id,
    empresa_id: r.empresa_id,
    empresa_nome: r.empresas?.nome || null,
    codigo: r.funcionalidades?.codigo || null,
    funcionalidade_nome: r.funcionalidades?.nome || null,
    em_breve: r.funcionalidades?.status_ciclo_vida !== 'disponivel',
    preco_mensal: r.preco_mensal_centavos != null ? Number((r.preco_mensal_centavos / 100).toFixed(2)) : null,
    solicitado_em: r.criado_em,
    status: r.status,
  }));
  return { status: 200, body: { solicitacoes: itens } };
}

async function auditar(supabase, { entidadeId, acao, detalhe, atorId }) {
  try {
    await supabase.from('funcionalidade_auditoria').insert({
      entidade: 'empresa_funcionalidade', entidade_id: entidadeId, acao, detalhe: detalhe || {}, ator_id: atorId || null,
    });
  } catch { /* auditoria best-effort; não bloqueia a operação */ }
}

// Super-admin aprova: pendente→ativa (CAS). Opcionalmente ajusta o preço. NÃO
// chama Asaas nem cria cobrança (billing production está desligado).
async function aprovarSolicitacao({ supabase, id, aprovadorId, precoCentavos = null } = {}) {
  if (!supabase || !id) return { status: 400, body: { message: 'Solicitacao invalida.' } };
  const { data: atual } = await supabase
    .from('empresa_funcionalidades')
    .select('id, empresa_id, funcionalidade_id, status, preco_mensal_centavos')
    .eq('id', id)
    .maybeSingle();
  if (!atual) return { status: 404, body: { message: 'Solicitacao nao encontrada.' } };
  if (atual.status !== 'pendente') return { status: 409, body: { message: 'Solicitacao nao esta pendente.', status_atual: atual.status } };

  const update = { status: 'ativa', aprovado_por: aprovadorId || null, atualizado_em: new Date().toISOString() };
  if (Number.isFinite(precoCentavos) && precoCentavos >= 0) update.preco_mensal_centavos = precoCentavos;

  const { error } = await supabase
    .from('empresa_funcionalidades')
    .update(update)
    .eq('id', id)
    .eq('status', 'pendente'); // CAS: só aprova se ainda pendente
  if (error) return { status: 500, body: { message: 'Erro ao aprovar.' } };

  await auditar(supabase, {
    entidadeId: id, acao: 'ativar', atorId: aprovadorId,
    detalhe: { empresa_id: atual.empresa_id, funcionalidade_id: atual.funcionalidade_id, antes: 'pendente', depois: 'ativa', preco_mensal_centavos: update.preco_mensal_centavos ?? atual.preco_mensal_centavos },
  });
  return { status: 200, body: { id, status: 'ativa' } };
}

// Super-admin recusa: pendente→inativa (CAS) + motivo.
async function recusarSolicitacao({ supabase, id, aprovadorId, motivo = null } = {}) {
  if (!supabase || !id) return { status: 400, body: { message: 'Solicitacao invalida.' } };
  const { data: atual } = await supabase
    .from('empresa_funcionalidades')
    .select('id, empresa_id, funcionalidade_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!atual) return { status: 404, body: { message: 'Solicitacao nao encontrada.' } };
  if (atual.status !== 'pendente') return { status: 409, body: { message: 'Solicitacao nao esta pendente.', status_atual: atual.status } };

  const { error } = await supabase
    .from('empresa_funcionalidades')
    .update({ status: 'inativa', motivo: motivo ? String(motivo).slice(0, 240) : 'recusada_pelo_super_admin', atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pendente');
  if (error) return { status: 500, body: { message: 'Erro ao recusar.' } };

  await auditar(supabase, {
    entidadeId: id, acao: 'desativar', atorId: aprovadorId,
    detalhe: { empresa_id: atual.empresa_id, funcionalidade_id: atual.funcionalidade_id, antes: 'pendente', depois: 'inativa', motivo: motivo || null },
  });
  return { status: 200, body: { id, status: 'inativa' } };
}

module.exports = {
  ADDON_PADRAO_CENTAVOS,
  CODIGOS_ADDON,
  resolverPrecoSolicitacao,
  solicitarAddons,
  listarSolicitacoes,
  aprovarSolicitacao,
  recusarSolicitacao,
};
