// Configuração do AI Copilot V1 — schema-free, read-only, production-safe.
//
// O modo do provider vem de env (SEM secret logado, SEM mudar Railway nesta frente).
// Default de produção = 'disabled': o deploy desta macrofrente NÃO ativa IA.
//
//   AI_PROVIDER_MODE = disabled | fake | openai
//     disabled → nenhuma chamada; capabilities.enabled=false; chat responde inerte.
//     fake     → provider determinístico (testes/dev). Nenhuma chamada externa.
//     openai   → adapter HTTP OpenAI-compatível; exige OPENAI_API_KEY. Sem key → NOT_CONFIGURED.

'use strict';

const MODES = Object.freeze({ DISABLED: 'disabled', FAKE: 'fake', OPENAI: 'openai' });

// Limites determinísticos (bound de entrada e do loop de tools).
const LIMITS = Object.freeze({
  MAX_MESSAGE_CHARS: 4000,
  MAX_HISTORY_MESSAGES: 20,
  MAX_HISTORY_CHARS: 24000,
  MAX_TOOL_STEPS: 6,
  MAX_TOOL_ROWS: 50, // teto de linhas por tool devolvidas ao modelo
  PROVIDER_TIMEOUT_MS: 20000,
  TOOL_TIMEOUT_MS: 8000,
  REQUEST_TIMEOUT_MS: 45000,
});

function resolveMode() {
  const raw = String(process.env.AI_PROVIDER_MODE || '').trim().toLowerCase();
  if (raw === MODES.FAKE) return MODES.FAKE;
  if (raw === MODES.OPENAI) return MODES.OPENAI;
  return MODES.DISABLED; // default seguro
}

// openai só é "disponível" com key presente; nunca expõe a key.
function providerAvailable(mode = resolveMode()) {
  if (mode === MODES.FAKE) return true;
  if (mode === MODES.OPENAI) return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

function isEnabled(mode = resolveMode()) {
  return mode !== MODES.DISABLED && providerAvailable(mode);
}

module.exports = { MODES, LIMITS, resolveMode, providerAvailable, isEnabled };
