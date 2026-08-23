'use strict';

// Rotas do AI Copilot V1 (read-only).
//   GET  /ai/capabilities  — estado seguro (enabled/provider_available/read_only + tools autorizadas)
//   POST /ai/chat          — assistente tool-mediated, autenticado, com tenant/escopo do servidor
//
// Nunca expõe API key, prompt interno ou credencial. Sem escrita de negócio.

const express = require('express');
const { z } = require('zod');
const router = express.Router();

const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { ensureEffective } = require('../middlewares/requirePermission');
const { resolverEscopoOperacional } = require('../services/operationalScopeService');

const { LIMITS, resolveMode, isEnabled, providerAvailable } = require('../services/ai/config');
const registry = require('../services/ai/toolRegistry');
const { registerAllTools } = require('../services/ai/tools');
const { runChat } = require('../services/ai/chatOrchestrator');

registerAllTools(); // idempotente

// Todas as rotas exigem sessão válida + tenant. Sem chat anônimo (§10).
router.use(verifyToken, verificarEmpresa);

// Contexto de autoridade do servidor (tenant/user/permissões/escopo do servidor,
// NUNCA do cliente/modelo).
async function buildCtx(req) {
  const eff = await ensureEffective(req).catch(() => ({ permissions: {} }));
  let operationalScope = null;
  try { operationalScope = await resolverEscopoOperacional(req, { empresaId: req.empresa_id }); } catch { operationalScope = null; }
  return {
    supabase,
    empresaId: req.empresa_id,
    user: req.user,
    isSuperAdmin: req.user?.is_super_admin === true,
    effectivePermissions: eff?.permissions || {},
    operationalScope,
    correlationId: req.correlation?.correlation_id || null,
  };
}

function toolsAutorizadas(ctx) {
  return registry.listTools()
    .filter((t) => registry.hasPermission(ctx, t.requiredPermission) && registry.hasEntitlement(ctx, t.requiredEntitlement))
    .map((t) => ({ name: t.name, description: t.description }));
}

// GET /ai/capabilities
router.get('/capabilities', async (req, res) => {
  const mode = resolveMode();
  const enabled = isEnabled(mode);
  const base = {
    enabled,
    provider_available: providerAvailable(mode),
    read_only: true,
    max_tool_steps: LIMITS.MAX_TOOL_STEPS,
    max_message_chars: LIMITS.MAX_MESSAGE_CHARS,
    capabilities: [],
  };
  if (!enabled) return res.json(base); // não resolve permissões quando inerte
  try {
    const ctx = await buildCtx(req);
    return res.json({ ...base, capabilities: toolsAutorizadas(ctx) });
  } catch {
    return res.json(base);
  }
});

const chatSchema = z.object({
  message: z.string().min(1, 'Mensagem vazia.').max(LIMITS.MAX_MESSAGE_CHARS),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(LIMITS.MAX_MESSAGE_CHARS),
  })).max(LIMITS.MAX_HISTORY_MESSAGES).optional(),
  context_id: z.string().max(120).optional().nullable(),
}).strict();

// POST /ai/chat
router.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const primeiro = parsed.error?.issues?.[0];
    return res.status(400).json({ message: primeiro?.message || 'Requisição inválida.' });
  }
  try {
    const ctx = await buildCtx(req);
    const result = await runChat({ message: parsed.data.message, history: parsed.data.history || [] }, ctx);
    return res.json(result);
  } catch (err) {
    console.error('[ai/chat] falha', { correlation_id: req.correlation?.correlation_id, status: 500 });
    return res.status(500).json({ message: 'Não foi possível processar sua solicitação agora.' });
  }
});

module.exports = router;
