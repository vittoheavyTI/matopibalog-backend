const supabase = require('../config/supabase');

const verificarPlano = async (req, res, next) => {
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

    // Se for trial e expirou, atualiza automaticamente
    if (data.status === 'trial' && data.trial_ends_at && new Date(data.trial_ends_at) < new Date()) {
      await supabase.from('empresas').update({ status: 'expirado' }).eq('id', req.empresa_id);
      return res.status(403).json({ message: 'Período de teste expirado. Assine um plano para continuar.' });
    }

    if (data.status === 'expirado' || data.status === 'bloqueado' || data.status === 'suspenso') {
      return res.status(403).json({ message: 'Plano bloqueado ou expirado. Entre em contato com o suporte.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ message: 'Erro ao verificar plano.' });
  }
};

module.exports = { verificarPlano };
