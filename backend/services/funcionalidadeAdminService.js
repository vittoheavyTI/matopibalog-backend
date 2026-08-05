// Serviço admin (super-admin) do catálogo de funcionalidades e da matriz por
// plano. Validação PURA (testável) + I/O com trilha de auditoria append-only.
//
// Regras de ciclo de vida / integridade:
//   - codigo é único e IMUTÁVEL depois de utilizado (vínculo em plano/empresa).
//   - funcionalidade utilizada NÃO é apagada → arquivamento (ativo=false).
//   - planejada/em_desenvolvimento NÃO pode ser concedida a cliente (regra no
//     entitlement; aqui apenas o catálogo).
//   - toda alteração relevante gera auditoria.

const CICLOS = ['disponivel', 'em_breve', 'em_desenvolvimento', 'planejada', 'descontinuada'];
const COBRANCAS = ['incluso', 'adicional', 'sob_negociacao'];
const DISPONIBILIDADES = ['incluida', 'opcional_paga', 'indisponivel', 'em_breve', 'sob_negociacao'];
const CODIGO_RE = /^[a-z][a-z0-9_]{2,48}$/;

// ── Validação pura ───────────────────────────────────────────────────────────
function validarFuncionalidade(body = {}, { editando = false, codigoAtual = null, jaUtilizada = false } = {}) {
  const erros = [];
  const nome = String(body.nome || '').trim();
  if (!nome) erros.push('nome é obrigatório');

  if (!editando) {
    const codigo = String(body.codigo || '').trim();
    if (!CODIGO_RE.test(codigo)) erros.push('codigo inválido (minúsculo, [a-z0-9_], 3-49 chars)');
  } else if (body.codigo !== undefined && body.codigo !== codigoAtual) {
    // Alterar código: só permitido se NUNCA foi utilizada.
    if (jaUtilizada) erros.push('codigo não pode ser alterado após uso');
    else if (!CODIGO_RE.test(String(body.codigo).trim())) erros.push('codigo inválido');
  }

  if (body.status_ciclo_vida !== undefined && !CICLOS.includes(body.status_ciclo_vida)) erros.push('status_ciclo_vida inválido');
  if (body.modelo_cobranca !== undefined && !COBRANCAS.includes(body.modelo_cobranca)) erros.push('modelo_cobranca inválido');
  if (body.preco_padrao_centavos !== undefined && body.preco_padrao_centavos !== null) {
    const n = Number(body.preco_padrao_centavos);
    if (!Number.isInteger(n) || n < 0) erros.push('preco_padrao_centavos deve ser inteiro >= 0');
  }
  return { ok: erros.length === 0, erros };
}

function montarPatchFuncionalidade(body = {}) {
  const patch = {};
  const campos = ['nome', 'descricao_publica', 'descricao_interna', 'categoria', 'modulo', 'status_ciclo_vida', 'modelo_cobranca', 'unidade_cobranca'];
  for (const c of campos) if (body[c] !== undefined) patch[c] = body[c];
  if (body.preco_padrao_centavos !== undefined) patch.preco_padrao_centavos = body.preco_padrao_centavos === null ? null : Number(body.preco_padrao_centavos);
  if (body.ativo !== undefined) patch.ativo = body.ativo === true;
  if (body.visivel_publicamente !== undefined) patch.visivel_publicamente = body.visivel_publicamente === true;
  if (body.ordem_exibicao !== undefined) patch.ordem_exibicao = Number(body.ordem_exibicao) || 0;
  if (Array.isArray(body.plataformas)) patch.plataformas = body.plataformas.map(String);
  patch.atualizado_em = new Date().toISOString();
  return patch;
}

// ── Auditoria (append-only) ──────────────────────────────────────────────────
async function registrarAuditoria(supabase, { entidade, entidadeId = null, acao, detalhe = {}, atorId = null }) {
  try {
    await supabase.from('funcionalidade_auditoria').insert({ entidade, entidade_id: entidadeId, acao, detalhe, ator_id: atorId });
  } catch (_) { /* auditoria best-effort não bloqueia a operação */ }
}

// ── I/O ──────────────────────────────────────────────────────────────────────
async function funcionalidadeUtilizada(supabase, funcionalidadeId) {
  const [{ count: c1 }, { count: c2 }] = await Promise.all([
    supabase.from('plano_funcionalidades').select('id', { count: 'exact', head: true }).eq('funcionalidade_id', funcionalidadeId),
    supabase.from('empresa_funcionalidades').select('id', { count: 'exact', head: true }).eq('funcionalidade_id', funcionalidadeId),
  ]);
  return (c1 || 0) + (c2 || 0) > 0;
}

async function listarFuncionalidades(supabase, filtros = {}) {
  let q = supabase.from('funcionalidades').select('*');
  if (filtros.categoria) q = q.eq('categoria', filtros.categoria);
  if (filtros.modulo) q = q.eq('modulo', filtros.modulo);
  if (filtros.status_ciclo_vida) q = q.eq('status_ciclo_vida', filtros.status_ciclo_vida);
  if (filtros.modelo_cobranca) q = q.eq('modelo_cobranca', filtros.modelo_cobranca);
  if (filtros.ativo === 'true') q = q.eq('ativo', true);
  if (filtros.ativo === 'false') q = q.eq('ativo', false);
  if (filtros.visivel === 'true') q = q.eq('visivel_publicamente', true);
  if (filtros.busca) q = q.or(`nome.ilike.%${filtros.busca}%,codigo.ilike.%${filtros.busca}%`);
  const { data, error } = await q.order('ordem_exibicao', { ascending: true }).order('nome', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function criarFuncionalidade(supabase, body, atorId) {
  const v = validarFuncionalidade(body, { editando: false });
  if (!v.ok) return { status: 422, body: { message: 'Dados inválidos.', erros: v.erros } };
  const patch = montarPatchFuncionalidade(body);
  patch.codigo = String(body.codigo).trim();
  const { data, error } = await supabase.from('funcionalidades').insert(patch).select().single();
  if (error) {
    if (/duplicate|unique/i.test(error.message || '')) return { status: 409, body: { message: 'Código já existe.' } };
    return { status: 500, body: { message: 'Erro ao criar funcionalidade.' } };
  }
  await registrarAuditoria(supabase, { entidade: 'funcionalidade', entidadeId: data.id, acao: 'criar', detalhe: { codigo: data.codigo }, atorId });
  return { status: 201, body: data };
}

async function editarFuncionalidade(supabase, id, body, atorId) {
  const { data: atual, error: e0 } = await supabase.from('funcionalidades').select('*').eq('id', id).maybeSingle();
  if (e0 || !atual) return { status: 404, body: { message: 'Funcionalidade não encontrada.' } };
  const usada = await funcionalidadeUtilizada(supabase, id);
  const v = validarFuncionalidade(body, { editando: true, codigoAtual: atual.codigo, jaUtilizada: usada });
  if (!v.ok) return { status: 422, body: { message: 'Dados inválidos.', erros: v.erros } };
  const patch = montarPatchFuncionalidade(body);
  if (body.codigo !== undefined && body.codigo !== atual.codigo && !usada) patch.codigo = String(body.codigo).trim();
  const { data, error } = await supabase.from('funcionalidades').update(patch).eq('id', id).select().single();
  if (error) return { status: 500, body: { message: 'Erro ao editar funcionalidade.' } };
  await registrarAuditoria(supabase, { entidade: 'funcionalidade', entidadeId: id, acao: 'editar', detalhe: { antes: atual, depois: patch }, atorId });
  return { status: 200, body: data };
}

async function arquivarFuncionalidade(supabase, id, atorId, arquivar = true) {
  const { data, error } = await supabase.from('funcionalidades').update({ ativo: !arquivar, atualizado_em: new Date().toISOString() }).eq('id', id).select().single();
  if (error || !data) return { status: 404, body: { message: 'Funcionalidade não encontrada.' } };
  await registrarAuditoria(supabase, { entidade: 'funcionalidade', entidadeId: id, acao: arquivar ? 'arquivar' : 'ativar', atorId });
  return { status: 200, body: data };
}

async function listarMatriz(supabase) {
  const { data, error } = await supabase.from('plano_funcionalidades').select('*');
  if (error) throw error;
  return data || [];
}

// Traduz o erro da RPC transacional (SQLSTATE de domínio) para HTTP, SEM vazar SQL
// bruto. P0001→422 (payload), P0002→404 (inexistente), P0003→409 (conflito de
// versão, com dados p/ a UI recarregar). Ver migration 061.
function traduzirErroMatriz(error) {
  const code = error?.code || '';
  const msg = String(error?.message || '');
  if (code === 'P0003' || /conflito_versao/.test(msg)) {
    const m = msg.match(/conflito_versao:([^:]+):(\d+):(\d+)/i);
    return { status: 409, body: {
      message: 'A matriz foi alterada por outra pessoa. Recarregue os dados e tente novamente.',
      erro: 'conflito_versao',
      plano_id: m ? m[1] : null,
      versao_esperada: m ? Number(m[2]) : null,
      versao_atual: m ? Number(m[3]) : null,
    } };
  }
  if (code === 'P0002' || /inexistente/.test(msg)) {
    return { status: 404, body: { message: 'Plano ou funcionalidade não encontrado.' } };
  }
  if (code === 'P0001') {
    let detalhe = 'Dados inválidos.';
    if (/versao_esperada_ausente/.test(msg)) detalhe = 'Versão esperada ausente para um ou mais planos (recarregue a matriz).';
    else if (/celula_duplicada/.test(msg)) detalhe = 'Item (plano + funcionalidade) enviado em duplicidade.';
    else if (/disponibilidade_invalida/.test(msg)) detalhe = 'Disponibilidade inválida.';
    else if (/matriz_vazia/.test(msg)) detalhe = 'Nenhum item enviado.';
    return { status: 422, body: { message: detalhe } };
  }
  return { status: 500, body: { message: 'Erro ao salvar matriz.' } };
}

// Publica a matriz plano×funcionalidade via RPC TRANSACIONAL (migration 061):
// atômica, versão esperada OBRIGATÓRIA por plano (conflito → 409), aplica só
// células alteradas, bump único por plano, auditoria na MESMA transação e
// idempotente (republicação idêntica não escreve/versiona/audita). O backend é a
// autoridade: ator vem de req.user, origem/request_id/motivo do controlador —
// NUNCA do payload do cliente.
async function salvarMatrizLote(supabase, { itens, versoesEsperadas = {}, motivo = null, requestId = null } = {}, atorId = null) {
  if (!Array.isArray(itens) || itens.length === 0) return { status: 400, body: { message: 'Nenhum item enviado.' } };
  const { data, error } = await supabase.rpc('publicar_matriz_funcionalidades', {
    p_itens: itens,
    p_versoes_esperadas: versoesEsperadas || {},
    p_ator: atorId || null,
    p_origem: 'painel_admin',
    p_request_id: requestId || null,
    p_motivo: motivo || null,
  });
  if (error) return traduzirErroMatriz(error);
  return { status: 200, body: data };
}

async function listarAuditoria(supabase, { limite = 100 } = {}) {
  const { data, error } = await supabase.from('funcionalidade_auditoria').select('*').order('criado_em', { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

// Direitos atuais de uma empresa (read-only) — plano + overrides.
async function entitlementsDaEmpresa(supabase, empresaId) {
  const [{ data: emp }, { data: overrides }] = await Promise.all([
    supabase.from('empresas').select('id, nome, plano_id, commercial_flow_version').eq('id', empresaId).maybeSingle(),
    supabase.from('empresa_funcionalidades').select('*, funcionalidades(codigo, nome, status_ciclo_vida)').eq('empresa_id', empresaId),
  ]);
  if (!emp) return { status: 404, body: { message: 'Empresa não encontrada.' } };
  let matrizPlano = [];
  if (emp.plano_id) {
    const { data } = await supabase.from('plano_funcionalidades').select('*, funcionalidades(codigo, nome, status_ciclo_vida)').eq('plano_id', emp.plano_id);
    matrizPlano = data || [];
  }
  return { status: 200, body: { empresa: emp, plano_funcionalidades: matrizPlano, overrides: overrides || [] } };
}

module.exports = {
  CICLOS, COBRANCAS, DISPONIBILIDADES, CODIGO_RE,
  validarFuncionalidade, montarPatchFuncionalidade,
  listarFuncionalidades, criarFuncionalidade, editarFuncionalidade, arquivarFuncionalidade,
  funcionalidadeUtilizada, listarMatriz, salvarMatrizLote, traduzirErroMatriz, listarAuditoria, entitlementsDaEmpresa,
  registrarAuditoria,
};
