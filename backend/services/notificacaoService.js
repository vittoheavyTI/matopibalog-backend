const supabase = require('../config/supabase');

async function criar(usuarioId, empresaId, tipo, titulo, mensagem, referenciaId = null, referenciaTipo = null) {
  try {
    await supabase.from('notificacoes').insert({
      usuario_id: usuarioId,
      empresa_id: empresaId,
      tipo,
      titulo,
      mensagem,
      referencia_id: referenciaId,
      referencia_tipo: referenciaTipo,
    });
  } catch (e) {
    console.error('[notificacaoService] Erro ao criar notificação:', e);
  }
}

async function notificarViagemFinalizada(frete, motoristaNome) {
  await criar(
    frete.motorista_id,
    frete.empresa_id,
    'viagem_finalizada',
    'Viagem finalizada',
    `Sua viagem de ${frete.origem} para ${frete.destino} foi finalizada.`,
    frete.id,
    'frete'
  );
}

async function notificarLancamentoResolvido(lancamento, tipo, aprovado, motoristaNome) {
  const acao = aprovado ? 'aprovado' : 'rejeitado';
  const label = { despesa: 'Despesa', abastecimento: 'Abastecimento', vale: 'Vale' }[tipo] || 'Lançamento';
  await criar(
    lancamento.motorista_id,
    lancamento.empresa_id,
    aprovado ? 'lancamento_aprovado' : 'lancamento_rejeitado',
    `${label} ${acao}`,
    `Seu lançamento foi ${acao}.`,
    lancamento.id,
    tipo
  );
}

module.exports = { criar, notificarViagemFinalizada, notificarLancamentoResolvido };
