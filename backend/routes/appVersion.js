// GET /app/version-policy — politica de versao do app (MOBILE-M1-008 / D-053).
//
// PUBLICO (sem auth): o app precisa ler a politica ANTES do login, inclusive na
// tela de "atualizacao obrigatoria" onde o usuario pode nem estar autenticado.
// Read-only, sem banco, sem escrita. Backward-compatible (rota nova; nao altera
// contratos existentes). A politica vem de env com defaults seguros (gate inerte).

const express = require('express');
const { z } = require('zod');
const router = express.Router();
const {
  buildPolicy,
  computeSeverity,
} = require('../utils/appVersionPolicy');

const querySchema = z.object({
  platform: z.enum(['android', 'ios']).optional().default('android'),
  // Versao atual do cliente (ex.: "1.0.0"). Opcional: quando ausente, o servidor
  // devolve a politica sem calcular severidade (o app compara localmente).
  current_version: z.string().max(64).optional().nullable(),
});

// GET /app/version-policy?platform=android&current_version=1.0.0
router.get('/version-policy', (req, res) => {
  const parsed = querySchema.safeParse(req.query || {});
  if (!parsed.success) {
    const primeiro = parsed.error?.issues?.[0];
    return res
      .status(400)
      .json({ message: primeiro?.message || 'Parametros invalidos.' });
  }

  const { platform, current_version } = parsed.data;
  const policy = buildPolicy(platform);
  const severity = current_version
    ? computeSeverity(current_version, policy)
    : null;

  return res.status(200).json({
    ...policy,
    // update_severity so vem preenchido quando current_version foi informado.
    // O app SEMPRE recomputa localmente (autoridade defensiva do bloqueio).
    update_severity: severity,
    current_version: current_version || null,
    server_time: new Date().toISOString(),
  });
});

module.exports = router;
