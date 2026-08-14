const { resolverEscopoOperacional } = require('../services/operationalScopeService');

async function verificarEscopoOperacional(req, res, next) {
  try {
    req.operationalScope = await resolverEscopoOperacional(req);
    if (req.operationalScope.mode === 'NO_COMPANY') {
      return res.status(400).json({ message: 'Empresa nao identificada.' });
    }
    if (req.operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    return next();
  } catch (error) {
    console.error('[operationalScope] erro ao resolver escopo:', error?.message || error);
    return res.status(500).json({ message: 'Erro ao resolver escopo operacional.' });
  }
}

module.exports = { verificarEscopoOperacional };
