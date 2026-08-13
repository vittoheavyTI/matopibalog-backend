const { getAuthRuntime } = require('./authRuntime');

async function revogarSessoesDoUsuarioSeSec1(usuarioId, motivo) {
  const { cfg, sessionService } = getAuthRuntime();
  if (!cfg.sessionsEnabled || !sessionService) return { skipped: true };
  return sessionService.revogarTodasDoUsuario(usuarioId, motivo);
}

function responderErroRevogacao(res, error) {
  if (error && typeof error.httpStatus === 'number' && typeof error.toPublic === 'function') {
    return res.status(error.httpStatus).json(error.toPublic());
  }
  return res.status(500).json({ message: 'Erro ao revogar sessoes do usuario.' });
}

module.exports = { revogarSessoesDoUsuarioSeSec1, responderErroRevogacao };
