const supabase = require('../config/supabase');
const { avaliarElegibilidadeSuspensao, lerDiasCarenciaSuspensao } = require('../services/paymentDomainService');
const { patchSuspensaoFinanceiraAutomatica } = require('../utils/suspensao');
const { empresaTemContratoObrigatorioPendente } = require('../services/contratoGateService');
const { carregarSituacaoComercial } = require('../services/situacaoComercialService');

// Mensagem de negócio (não só 403 genérico) por situação canônica do fluxo v2.
function mensagemGate(situacao) {
  switch (situacao) {
    case 'aguardando_assinatura': return 'Para continuar usando o sistema, finalize a assinatura do contrato.';
    case 'trial_expirado_aguardando_decisao': return 'Seu período de teste terminou. Escolha continuar com o Matopiba Log para seguir usando o sistema.';
    case 'trial_encerrado_sem_contratacao': return 'Você optou por não continuar após o teste. Reabra a contratação quando quiser voltar a usar o sistema.';
    case 'conversao_aguardando_pagamento': return 'Contratação confirmada. Conclua os pagamentos iniciais para liberar o uso completo.';
    case 'suspensa_financeiramente': return 'Plano suspenso. Regularize seu plano para continuar.';
    case 'bloqueada_administrativamente': return 'Conta bloqueada. Entre em contato com o suporte.';
    case 'cancelada': return 'Conta cancelada. Entre em contato com o suporte.';
    default: return 'Ação não permitida no estado atual da sua conta.';
  }
}

// Proteção: uma conta não pode ser suspensa automaticamente se não houver
// fatura pendente/vencida com link de pagamento e vencimento já passado.
async function podeSuspenderAutomaticamente(empresaId) {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const [{ data: empresa, error: empresaError }, { data: fatura, error: faturaError }, { data: cfgCar }] = await Promise.all([
      supabase
        // `*` (deploy-safe): traz suspensao_prazo_ate só se a coluna existir
        // (antes da migration 047 ela some do retorno, sem erro).
        .from('empresas')
        .select('*')
        .eq('id', empresaId)
        .single(),
      supabase
      .from('faturas')
        .select('id, empresa_id, invoice_url, bank_slip_url, due_date, status')
      .eq('empresa_id', empresaId)
      .in('status', ['pendente', 'vencido'])
      .lt('due_date', hoje)
      .order('due_date', { ascending: true })
      .limit(1)
        .maybeSingle(),
      supabase.from('configuracoes').select('dados').eq('id', 1).single(),
    ]);

    const decisao = avaliarElegibilidadeSuspensao({
      empresa: empresa ? { id: empresaId, ...empresa } : empresa,
      fatura,
      hoje,
      erroConsulta: empresaError || faturaError,
      diasCarencia: lerDiasCarenciaSuspensao(cfgCar && cfgCar.dados),
    });
    return decisao.elegivel;
  } catch {
    return false; // erro na consulta → não suspende (fail-safe)
  }
}

const verificarPlano = async (req, res, next) => {
  // Super-admin não pode ser bloqueado pelo plano de uma empresa cliente.
  if (req.user?.is_super_admin === true) return next();

  // Consultas são read-only: preservam acesso ao histórico mesmo quando o
  // plano está suspenso, expirado ou bloqueado. Escritas seguem verificadas.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Admin não tem empresa, pula verificação
  if (!req.empresa_id) return next();

  // Gate de contrato obrigatório: se o tenant tem contrato/aditivo OBRIGATÓRIO
  // pendente de assinatura, bloqueia as escritas operacionais (vale inclusive
  // para empresa 'ativo'/'trial'). Assinatura (/contratacao), regularização
  // (/pagamentos) e suporte NÃO passam por este middleware, então seguem
  // liberados. GET e super-admin já foram liberados acima. Fail-open em erro.
  if (await empresaTemContratoObrigatorioPendente(supabase, req.empresa_id)) {
    return res.status(403).json({
      message: 'Para continuar usando o sistema, finalize a assinatura do contrato.',
      motivo: 'contrato_obrigatorio_pendente',
    });
  }

  try {
    const { data, error } = await supabase
      .from('empresas')
      .select('*')
      .eq('id', req.empresa_id)
      .single();

    if (error || !data) {
      return res.status(500).json({ message: 'Erro ao verificar plano.' });
    }

    // Fluxo comercial v2: o domínio canônico de situação comercial decide a
    // liberação de escrita (trial gratuito, decisão pós-trial, conversão,
    // suspensão). Contas legadas (commercial_flow_version != 'v2') NÃO entram
    // aqui e seguem exatamente pelo caminho abaixo, inalterado. O gate de
    // contrato obrigatório (acima) já é comum aos dois fluxos.
    if (data.commercial_flow_version === 'v2') {
      const situ = await carregarSituacaoComercial(supabase, req.empresa_id, { empresa: data });
      if (situ && situ.pode_operar === false) {
        return res.status(403).json({
          message: mensagemGate(situ.situacao),
          motivo: situ.motivo || 'bloqueio_comercial',
          situacao: situ.situacao,
          acoes: situ.acoes,
        });
      }
      return next();
    }

    const hoje = new Date();
    const trialExpirado = data.status === 'trial' && data.trial_ends_at && new Date(data.trial_ends_at) < hoje;

    // Se for trial e expirou, verifica se existe fatura pendente/vencida COM link e vencimento passado
    if (trialExpirado) {
      if (await podeSuspenderAutomaticamente(req.empresa_id)) {
        // Metadados da 024: sem reason='financial' o pagamento não reativa.
        await supabase.from('empresas').update(patchSuspensaoFinanceiraAutomatica()).eq('id', req.empresa_id);
        return res.status(403).json({ message: 'Período de teste expirado. Assine um plano para continuar.' });
      }
      // Sem fatura/link: não suspende, mas ainda bloqueia a escrita (sem acesso sem pagamento)
      return res.status(403).json({ message: 'Período de teste expirado. Regularize seu plano para continuar.' });
    }

    // Suspenso/expirado/bloqueado manual: mantém bloqueio existente
    if (data.status === 'expirado' || data.status === 'bloqueado') {
      return res.status(403).json({ message: 'Plano bloqueado ou expirado. Entre em contato com o suporte.' });
    }

    // Suspenso automático: verifica se ainda há fatura pendente/vencida com link e vencida
    if (data.status === 'suspenso') {
      // Se não há mais fatura pendente com link e vencida, mantém suspenso mas permite contato com suporte
      if (!(await podeSuspenderAutomaticamente(req.empresa_id))) {
        return res.status(403).json({ message: 'Plano suspenso. Regularize seu plano para continuar.' });
      }
      return res.status(403).json({ message: 'Plano suspenso. Regularize seu plano para continuar.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ message: 'Erro ao verificar plano.' });
  }
};

module.exports = { verificarPlano };
