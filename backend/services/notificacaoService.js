const supabase = require('../config/supabase');
const pushService = require('./pushService');

function logFalha(contexto, error) {
  console.error('[notificacaoService] Falha controlada', {
    contexto,
    codigo: error?.code || null,
    erro: error?.message || String(error),
  });
}

function metadataSegura(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
}

async function criarNotificacao({
  empresa_id = null,
  usuario_id,
  tipo,
  titulo,
  mensagem,
  entidade_tipo = null,
  entidade_id = null,
  metadata = {},
  dedupe_key = null,
}) {
  if (!usuario_id || !tipo || !titulo || !mensagem) {
    logFalha('payload_invalido', new Error('usuario_id, tipo, titulo e mensagem sao obrigatorios'));
    return null;
  }

  const chaveDedupe = dedupe_key ? `${usuario_id}:${dedupe_key}` : null;

  try {
    if (chaveDedupe) {
      const { data: existente, error: buscaError } = await supabase
        .from('notificacoes')
        .select('id, usuario_id, empresa_id, tipo, titulo, mensagem, referencia_tipo, referencia_id, lida, metadata, created_at, read_at')
        .eq('dedupe_key', chaveDedupe)
        .maybeSingle();
      if (buscaError) throw buscaError;
      if (existente) return existente;
    }

    const { data, error } = await supabase
      .from('notificacoes')
      .insert({
        usuario_id,
        empresa_id,
        tipo,
        titulo,
        mensagem,
        referencia_tipo: entidade_tipo,
        referencia_id: entidade_id,
        metadata: metadataSegura(metadata),
        dedupe_key: chaveDedupe,
      })
      .select('id, usuario_id, empresa_id, tipo, titulo, mensagem, referencia_tipo, referencia_id, lida, metadata, created_at, read_at')
      .single();

    if (error) throw error;

    // Push best-effort a partir da notificacao recem-criada (fonte da verdade).
    // Fire-and-forget: nunca await de forma que atrase/quebre o fluxo principal;
    // o proprio pushService engole qualquer falha e ignora se o Firebase nao
    // estiver configurado. So dispara para insert novo (dedupe existente sai antes).
    pushService.enviarParaUsuario(usuario_id, {
      titulo,
      mensagem,
      data: {
        notificacao_id: data.id,
        tipo,
        referencia_tipo: entidade_tipo,
        referencia_id: entidade_id,
      },
    }).catch(() => {});

    return data;
  } catch (error) {
    // Uma corrida no mesmo evento pode atingir o indice unico. O evento principal
    // continua valido; a notificacao duplicada e simplesmente descartada.
    if (error?.code !== '23505') logFalha(tipo, error);
    return null;
  }
}

async function criarParaUsuario(usuario_id, dados) {
  return criarNotificacao({ ...dados, usuario_id });
}

async function criarParaEmpresa(empresa_id, dados, { somenteAdmins = false, excluir_usuario_id = null } = {}) {
  if (!empresa_id) return [];

  try {
    let query = supabase
      .from('usuarios')
      .select('id')
      .eq('empresa_id', empresa_id)
      .eq('status', 'ativo');

    if (somenteAdmins) query = query.eq('tipo', 'admin');
    // Evita notificar quem executou a acao (ex.: o admin que criou o frete no painel).
    if (excluir_usuario_id) query = query.neq('id', excluir_usuario_id);

    const { data: usuarios, error } = await query;
    if (error) throw error;

    const resultados = await Promise.all((usuarios || []).map((usuario) =>
      criarParaUsuario(usuario.id, { ...dados, empresa_id })
    ));
    return resultados.filter(Boolean);
  } catch (error) {
    logFalha('empresa', error);
    return [];
  }
}

async function notificarFreteCriado(frete, { actorId = null } = {}) {
  const paraMotorista = criarParaUsuario(frete.motorista_id, {
    empresa_id: frete.empresa_id,
    tipo: 'frete_criado',
    titulo: 'Frete criado',
    mensagem: `Seu frete de ${frete.origem} para ${frete.destino} foi criado.`,
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `frete_criado:${frete.id}`,
  });
  // O painel dos admins tambem recebe o evento (menos quem criou, para nao notificar a propria acao).
  const paraAdmins = criarParaEmpresa(frete.empresa_id, {
    tipo: 'frete_criado',
    titulo: 'Novo frete criado',
    mensagem: `Frete de ${frete.origem} para ${frete.destino} foi criado.`,
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `frete_criado_admin:${frete.id}`,
  }, { somenteAdmins: true, excluir_usuario_id: actorId });
  const [, resultadoAdmins] = await Promise.all([paraMotorista, paraAdmins]);
  return resultadoAdmins;
}

async function notificarViagemFinalizada(frete, { actorId = null } = {}) {
  const paraMotorista = criarParaUsuario(frete.motorista_id, {
    empresa_id: frete.empresa_id,
    tipo: 'frete_finalizado',
    titulo: 'Frete finalizado',
    mensagem: `Seu frete de ${frete.origem} para ${frete.destino} foi finalizado.`,
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `frete_finalizado:${frete.id}`,
  });
  const paraAdmins = criarParaEmpresa(frete.empresa_id, {
    tipo: 'frete_finalizado',
    titulo: 'Frete finalizado',
    mensagem: `Frete de ${frete.origem} para ${frete.destino} foi finalizado.`,
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `frete_finalizado_admin:${frete.id}`,
  }, { somenteAdmins: true, excluir_usuario_id: actorId });
  const [, resultadoAdmins] = await Promise.all([paraMotorista, paraAdmins]);
  return resultadoAdmins;
}

async function notificarLancamentoCriado(lancamento, tipo) {
  if (lancamento.status !== 'pendente') return [];
  const label = { despesa: 'Despesa', abastecimento: 'Abastecimento', vale: 'Vale' }[tipo] || 'Lancamento';
  return criarParaEmpresa(lancamento.empresa_id, {
    tipo: 'lancamento_criado',
    titulo: 'Novo lancamento pendente',
    mensagem: `${label} aguardando aprovacao.`,
    entidade_id: lancamento.id,
    entidade_tipo: tipo,
    dedupe_key: `lancamento_criado:${tipo}:${lancamento.id}`,
  }, { somenteAdmins: true });
}

// Lancamento criado PELO PAINEL (admin) que impacta o motorista. O fluxo padrao
// so avisa os admins (notificarLancamentoCriado, somenteAdmins) e, quando nasce
// aprovado, nem isso — entao o motorista nunca era avisado. Aqui informamos o
// motorista. Nao duplica com o fluxo de aprovacao/rejeicao (notificarLancamento-
// Resolvido), que so ocorre depois, na acao de resolver o lancamento.
async function notificarLancamentoParaMotorista(lancamento, tipo) {
  if (!lancamento || !lancamento.motorista_id) return null;
  return criarParaUsuario(lancamento.motorista_id, {
    empresa_id: lancamento.empresa_id,
    tipo: 'lancamento_criado',
    titulo: 'Novo lancamento registrado',
    mensagem: 'Um lancamento foi registrado no seu frete.',
    entidade_id: lancamento.id,
    entidade_tipo: tipo,
    dedupe_key: `lancamento_motorista:${tipo}:${lancamento.id}`,
  });
}

async function notificarLancamentoResolvido(lancamento, tipo, aprovado) {
  const acao = aprovado ? 'aprovado' : 'rejeitado';
  const label = { despesa: 'Despesa', abastecimento: 'Abastecimento', vale: 'Vale' }[tipo] || 'Lancamento';
  return criarParaUsuario(lancamento.motorista_id, {
    empresa_id: lancamento.empresa_id,
    tipo: aprovado ? 'lancamento_aprovado' : 'lancamento_rejeitado',
    titulo: `${label} ${acao}`,
    mensagem: `Seu lancamento foi ${acao}.`,
    entidade_id: lancamento.id,
    entidade_tipo: tipo,
    dedupe_key: `lancamento_${acao}:${tipo}:${lancamento.id}`,
  });
}

// ── ePOD (comprovação de entrega) ──────────────────────────────────────────
// Motorista envia uma evidência → avisa os admins da empresa (menos quem agiu).
async function notificarEpodEvidenciaEnviada(frete, evidenciaId, { actorId = null } = {}) {
  if (!frete || !frete.empresa_id) return [];
  return criarParaEmpresa(frete.empresa_id, {
    tipo: 'epod_evidencia',
    titulo: 'Nova comprovação de entrega',
    mensagem: 'Nova comprovação de entrega aguardando validação.',
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `epod_evid_enviada:${evidenciaId}`,
  }, { somenteAdmins: true, excluir_usuario_id: actorId });
}

// Admin aprova uma evidência → avisa o motorista do frete.
async function notificarEpodEvidenciaAprovada(frete, evidenciaId) {
  if (!frete || !frete.motorista_id) return null;
  return criarParaUsuario(frete.motorista_id, {
    empresa_id: frete.empresa_id,
    tipo: 'epod_aprovada',
    titulo: 'Comprovante aprovado',
    mensagem: 'Comprovante de entrega aprovado.',
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `epod_evid_aprovada:${evidenciaId}`,
  });
}

// Admin rejeita uma evidência → avisa o motorista, com o motivo quando houver.
async function notificarEpodEvidenciaRejeitada(frete, evidenciaId, motivo) {
  if (!frete || !frete.motorista_id) return null;
  const detalhe = motivo && String(motivo).trim() ? ` Motivo: ${String(motivo).trim()}` : '';
  return criarParaUsuario(frete.motorista_id, {
    empresa_id: frete.empresa_id,
    tipo: 'epod_rejeitada',
    titulo: 'Comprovante rejeitado',
    mensagem: `Comprovante rejeitado. Envie uma nova evidência.${detalhe}`,
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `epod_evid_rejeitada:${evidenciaId}`,
  });
}

// ── Ocorrências logísticas ─────────────────────────────────────────────────
async function notificarOcorrenciaCriada(frete, ocorrenciaId, { actorId = null } = {}) {
  if (!frete || !frete.empresa_id) return [];
  return criarParaEmpresa(frete.empresa_id, {
    tipo: 'ocorrencia_criada',
    titulo: 'Nova ocorrência no frete',
    mensagem: 'Uma ocorrência foi registrada em um frete.',
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `ocorrencia_criada:${ocorrenciaId}`,
  }, { somenteAdmins: true, excluir_usuario_id: actorId });
}

// Admin resolve → avisa quem abriu a ocorrência (se não for o próprio autor da ação).
async function notificarOcorrenciaResolvida(frete, ocorrencia, { actorId = null } = {}) {
  const destino = ocorrencia?.criado_por;
  if (!frete || !destino || destino === actorId) return null;
  return criarParaUsuario(destino, {
    empresa_id: frete.empresa_id,
    tipo: 'ocorrencia_resolvida',
    titulo: 'Ocorrência resolvida',
    mensagem: 'Uma ocorrência do seu frete foi resolvida.',
    entidade_id: frete.id,
    entidade_tipo: 'frete',
    dedupe_key: `ocorrencia_resolvida:${ocorrencia.id}`,
  });
}

module.exports = {
  criarNotificacao,
  criarParaUsuario,
  criarParaEmpresa,
  notificarFreteCriado,
  notificarViagemFinalizada,
  notificarLancamentoCriado,
  notificarLancamentoParaMotorista,
  notificarLancamentoResolvido,
  notificarEpodEvidenciaEnviada,
  notificarEpodEvidenciaAprovada,
  notificarEpodEvidenciaRejeitada,
  notificarOcorrenciaCriada,
  notificarOcorrenciaResolvida,
};
