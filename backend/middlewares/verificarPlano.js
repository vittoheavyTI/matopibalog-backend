const supabase = require('../config/supabase');
const { avaliarElegibilidadeSuspensao } = require('../services/paymentDomainService');
const { patchSuspensaoFinanceiraAutomatica } = require('../utils/suspensao');

// Proteção: uma conta não pode ser suspensa automaticamente se não houver
// fatura pendente/vencida com link de pagamento e vencimento já passado.
async function podeSuspenderAutomaticamente(empresaId) {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const [{ data: empresa, error: empresaError }, { data: fatura, error: faturaError }] = await Promise.all([
      supabase
        .from('empresas')
        .select('id, status, trial_ends_at')
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
    ]);

    const decisao = avaliarElegibilidadeSuspensao({
      empresa: empresa ? { id: empresaId, ...empresa } : empresa,
      fatura,
      hoje,
      erroConsulta: empresaError || faturaError,
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

  try {
    const { data, error } = await supabase
      .from('empresas')
      .select('status, trial_ends_at')
      .eq('id', req.empresa_id)
      .single();

    if (error || !data) {
      return res.status(500).json({ message: 'Erro ao verificar plano.' });
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
