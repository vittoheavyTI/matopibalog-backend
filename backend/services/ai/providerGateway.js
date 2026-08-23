'use strict';

// AIProviderGateway — ponto único de acesso ao LLM. Seleciona o provider pelo modo
// e expõe um contrato estável e provider-agnóstico. NÃO importa supabase (§12): o
// modelo só enxerga tools; nunca o banco.
//
// generate({ system, messages, tools }) → { finishReason, toolCalls[], content, usage }
// Erros sempre como AIProviderError normalizado.

const { MODES, resolveMode } = require('./config');
const { disabledProvider } = require('./providers/disabledProvider');
const { fakeProvider } = require('./providers/fakeProvider');
const { openaiProvider } = require('./providers/openaiProvider');

function selectProvider(mode = resolveMode()) {
  switch (mode) {
    case MODES.FAKE: return fakeProvider;
    case MODES.OPENAI: return openaiProvider;
    default: return disabledProvider;
  }
}

async function generate(input, { mode } = {}) {
  const provider = selectProvider(mode || resolveMode());
  return provider.generate(input);
}

module.exports = { selectProvider, generate, fakeProvider };
