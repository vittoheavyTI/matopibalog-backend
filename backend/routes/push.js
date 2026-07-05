const express = require('express');
const { z } = require('zod');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');

// Todas as rotas exigem sessao valida. verificarEmpresa injeta req.empresa_id.
router.use(verifyToken, verificarEmpresa);

const registrarSchema = z.object({
  token: z.string().min(10, 'Token invalido.').max(4096),
  platform: z.enum(['android', 'ios']).optional().default('android'),
  device_id: z.string().max(255).optional().nullable(),
  app_version: z.string().max(64).optional().nullable(),
});

const removerSchema = z.object({
  token: z.string().min(10, 'Token invalido.').max(4096),
});

function mensagemZod(error) {
  const primeiro = error?.issues?.[0];
  return primeiro?.message || 'Dados invalidos.';
}

// POST /push/tokens — registra/atualiza o token FCM do aparelho para o usuario
// autenticado. Idempotente via upsert no token (UNIQUE). Reativa o token caso
// tivesse sido desativado antes (ex.: reinstalacao / novo login).
router.post('/tokens', async (req, res) => {
  const parsed = registrarSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: mensagemZod(parsed.error) });
  }
  const { token, platform, device_id, app_version } = parsed.data;

  try {
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('push_tokens')
      .upsert({
        usuario_id: req.user.uid,
        empresa_id: req.empresa_id || null,
        token,
        platform,
        device_id: device_id || null,
        app_version: app_version || null,
        ativo: true,
        updated_at: agora,
        last_seen_at: agora,
      }, { onConflict: 'token' });

    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('[push] Falha ao registrar token:', error?.message || String(error));
    return res.status(500).json({ message: 'Nao foi possivel registrar o token de notificacao.' });
  }
});

// DELETE /push/tokens — desativa o token no logout. So mexe em token do proprio
// usuario (ownership por usuario_id). Nao apaga: mantem historico.
router.delete('/tokens', async (req, res) => {
  const parsed = removerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: mensagemZod(parsed.error) });
  }

  try {
    const { error } = await supabase
      .from('push_tokens')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('token', parsed.data.token)
      .eq('usuario_id', req.user.uid);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    console.error('[push] Falha ao remover token:', error?.message || String(error));
    return res.status(500).json({ message: 'Nao foi possivel remover o token de notificacao.' });
  }
});

module.exports = router;
