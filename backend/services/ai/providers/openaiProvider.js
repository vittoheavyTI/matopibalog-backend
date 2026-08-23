'use strict';

const axios = require('axios');
const { AIProviderError, PROVIDER_ERROR } = require('./errors');
const { LIMITS } = require('../config');

// Adapter OpenAI-compatível (HTTP, sem SDK). Pronto para habilitação FUTURA.
// - Config por env: OPENAI_API_KEY (obrigatória), OPENAI_BASE_URL (opcional,
//   permite APIs OpenAI-compatíveis / local no futuro), OPENAI_MODEL (opcional).
// - NUNCA loga a key. NUNCA é chamado com mode!=openai. Tests usam o fake.
// - Normaliza tool-calls e erros para o contrato do gateway.

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function toOpenAITools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } },
  }));
}

function normalizeToolCalls(message) {
  const raw = message?.tool_calls || [];
  return raw.map((tc) => {
    let args = {};
    try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = {}; }
    return { id: tc.id, name: tc.function?.name, arguments: args };
  });
}

const openaiProvider = {
  name: 'openai',
  async generate({ system, messages, tools }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AIProviderError(PROVIDER_ERROR.NOT_CONFIGURED, 'missing OPENAI_API_KEY');
    const baseURL = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

    const payload = {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: toOpenAITools(tools),
      tool_choice: 'auto',
      temperature: 0,
    };

    let resp;
    try {
      resp = await axios.post(`${baseURL}/chat/completions`, payload, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: LIMITS.PROVIDER_TIMEOUT_MS,
      });
    } catch (err) {
      if (err.code === 'ECONNABORTED') throw new AIProviderError(PROVIDER_ERROR.TIMEOUT, 'provider timeout');
      const status = err.response?.status;
      if (status === 429) throw new AIProviderError(PROVIDER_ERROR.RATE_LIMIT, 'rate limited');
      // Nunca propaga corpo do vendor (pode conter detalhes); só o status.
      throw new AIProviderError(PROVIDER_ERROR.UPSTREAM_ERROR, `upstream status ${status || 'unknown'}`);
    }

    const choice = resp.data?.choices?.[0];
    if (!choice) throw new AIProviderError(PROVIDER_ERROR.INVALID_RESPONSE, 'no choice');
    const message = choice.message || {};
    const toolCalls = normalizeToolCalls(message);
    return {
      finishReason: toolCalls.length ? 'tool_calls' : (choice.finish_reason || 'stop'),
      toolCalls,
      content: typeof message.content === 'string' ? message.content : '',
      usage: resp.data?.usage || null,
    };
  },
};

module.exports = { openaiProvider };
