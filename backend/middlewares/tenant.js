const supabase = require('../config/supabase');

const verificarEmpresa = async (req, res, next) => {
  // SOMENTE super-admin pode impersonar via query param (?empresa_id=).
  // Admin comum: o param é IGNORADO — empresa vem sempre da própria conta.
  if (req.user.is_super_admin === true && req.query.empresa_id) {
    req.empresa_id = req.query.empresa_id;
    req.impersonating = true;
    return next();
  }

  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('empresa_id')
      .eq('id', req.user.uid)
      .single();

    if (error) {
      return res.status(500).json({ message: 'Erro ao verificar empresa.' });
    }

    req.empresa_id = data?.empresa_id || null;
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Erro ao verificar empresa.' });
  }
};

module.exports = { verificarEmpresa };
