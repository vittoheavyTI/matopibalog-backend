const jwt = require('jsonwebtoken');

// Middleware 1: Verifica se o usuário está logado olhando o Cookie
const verifyToken = (req, res, next) => {
  const tokenFromCookie = req.cookies ? req.cookies.token : null;
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const token = tokenFromCookie || tokenFromHeader;

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Salva os dados do usuário para a próxima rota
    next(); 
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
};

// Middleware 2: Verifica se o usuário é um Administrador
const isAdmin = (req, res, next) => {
  // Olhamos o 'role' que salvamos dentro do token na hora do login
  if (req.user && req.user.role === 'admin') {
    next(); // Pode passar
  } else {
    return res.status(403).json({ message: 'Acesso restrito para administradores.' });
  }
};

// Exporta as duas funções para serem usadas nas rotas
module.exports = { 
  verifyToken, 
  isAdmin 
};
