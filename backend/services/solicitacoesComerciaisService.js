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

const ADDON_PADRAO_CENTAVOS = 14990;
const CODIGOS_ADDON = ['estrutura_operacional', 'integracoes_erp', 'acesso_corporativo_sso'];

async function carregarFuncionalidadesAddon(supabase) {
  const { data, error } = await supabase
    .from('funcionalidades')
    .select('id, codigo, nome, status_ciclo_vida')
    .in('codigo', CODIGOS_ADDON);
  if (error) throw error;
  return data || [];
}

// Cliente (admin/owner) solicita add-ons. Idempotente: se já existe linha
// ativa/pendente para (empresa, funcionalidade), não duplica. Nunca ativa.
async function solicitarAddons({ supabase, empresaId, usuarioId, codigos } = {}) {
  if (!supabase || !empresaId) return { status: 400, body: { message: 'Empresa nao identificada.' } };
  const pedidos = Array.isArray(codigos) ? codigos.filter((c) => CODIGOS_ADDON.includes(c)) : [];
  if (!pedidos.length) return { status: 400, body: { message: 'Selecione ao menos um servico adicional.' } };

  const funcs = await carregarFuncionalidadesAddon(supabase);
  const porCodigo = new Map(funcs.map((f) => [f.codigo, f]));

  const { data: existentes } = await supabase
    .from('empresa_funcionalidades')
    .select('funcionalidade_id, status')
    .eq('empresa_id', empresaId)
    .in('status', ['ativa', 'pendente']);
  const jaTem = new Set((existentes || []).map((e) => e.funcionalidade_id));

  const criadas = [];
  const idempotentes = [];
  for (const codigo of pedidos) {
    const f = porCodigo.get(codigo);
    if (!f) continue;
    if (jaTem.has(f.id)) { idempotentes.push(codigo); continue; }
    const { error } = await supabase.from('empresa_funcionalidades').insert({
      empresa_id: empresaId,
      funcionalidade_id: f.id,
      status: 'pendente',
      origem: 'adicional',
      preco_mensal_centavos: ADDON_PADRAO_CENTAVOS,
      motivo: 'solicitacao_cliente',
      billing_component_id: null,
    });
    if (error) throw error;
    criadas.push(codigo);
  }
  return { status: 201, body: { solicitados: criadas, ja_existiam: idempotentes } };
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
  solicitarAddons,
  listarSolicitacoes,
  aprovarSolicitacao,
  recusarSolicitacao,
};
