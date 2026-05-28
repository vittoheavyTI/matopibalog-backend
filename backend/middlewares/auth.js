const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const verifyToken = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token de autenticação não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar se usuário ainda está ativo no banco (invalida tokens de bloqueados)
    const { data: user, error } = await supabase
      .from('usuarios')
      .select('status')
      .eq('id', decoded.uid)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Usuário não encontrado.' });
    }

    if (user.status === 'bloqueado') {
      return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
    }

    req.user = decoded; // { uid, email, role }
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Acesso negado. Apenas administradores podem realizar esta ação.' });
  }
};

// Middleware para validar se o motorista está acessando seus próprios dados
const isMotorista = (req, res, next) => {
  const motoristaId = req.params.id || req.body.motorista_id;
  
  if (req.user.role === 'admin') {
    return next();
  }

  if (req.user.uid === motoristaId) {
    next();
  } else {
    return res.status(403).json({ message: 'Acesso negado. Você não tem permissão para acessar dados de outro motorista.' });
  }
};

// Função para verificar permissão granular por módulo
// Uso: router.get('/rota', verifyToken, verificarPermissao('motoristas'), handler)
// NOTA: Não ativada por padrão — apenas código disponível para uso futuro.
const verificarPermissao = (modulo) => {
  return async (req, res, next) => {
    // Admin completo libera tudo
    if (req.user.role === 'admin') return next();

    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('permissoes')
        .eq('id', req.user.uid)
        .single();

      if (error || !data?.permissoes) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }

      if (data.permissoes[modulo] === true) {
        return next();
      }

      return res.status(403).json({ message: 'Acesso negado.' });
    } catch {
      return res.status(500).json({ message: 'Erro ao verificar permissões.' });
    }
  };
};

module.exports = {
  verifyToken,
  isAdmin,
  isMotorista,
  verificarPermissao
};
