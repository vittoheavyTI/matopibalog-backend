const supabase = require('../config/supabase');

const verificarEmpresa = async (req, res, next) => {
  // Admin pode opcionalmente impersonar via query param
  if (req.user.role === 'admin' && req.query.empresa_id) {
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
