'use strict';

// Orquestra o ciclo modelo↔tools do AI Copilot V1 (read-only).
// - Bound de iterações (MAX_TOOL_STEPS) e dedupe de tool calls idênticas.
// - Agrega evidência/warnings das tools.
// - Monta o envelope de resposta { answer, evidence[], warnings[], actions_available[] }.
//   actions_available NUNCA contém ação de negócio executável (V1 read-only).
// - Erros de provider viram mensagem pt-BR segura (sem internals).

const { LIMITS, resolveMode, MODES } = require('./config');
const gateway = require('./providerGateway');
const registry = require('./toolRegistry');
const { SYSTEM_PROMPT } = require('./systemPrompt');
const { AIProviderError, PROVIDER_ERROR } = require('./providers/errors');

function boundHistory(history) {
  const arr = Array.isArray(history) ? history : [];
  const sliced = arr.slice(-LIMITS.MAX_HISTORY_MESSAGES);
  let total = 0;
  const out = [];
  // Mantém as mais recentes dentro do teto de caracteres.
  for (let i = sliced.length - 1; i >= 0; i -= 1) {
    const m = sliced[i];
    const content = typeof m?.content === 'string' ? m.content.slice(0, LIMITS.MAX_MESSAGE_CHARS) : '';
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    total += content.length;
    if (total > LIMITS.MAX_HISTORY_CHARS) break;
    out.unshift({ role, content });
  }
  return out;
}

// Executa a conversa. ctx traz autoridade do servidor (empresaId, user, scope...).
async function runChat({ message, history = [] }, ctx) {
  const mode = resolveMode();
  if (mode === MODES.DISABLED) {
    return { enabled: false, answer: 'O assistente ainda não está habilitado.', evidence: [], warnings: [], actions_available: [] };
  }

  const userMessage = String(message || '').slice(0, LIMITS.MAX_MESSAGE_CHARS);
  const messages = [...boundHistory(history), { role: 'user', content: userMessage }];
  const specs = registry.toolSpecs();

  const evidence = [];
  const warnings = [];
  const dedupe = new Map(); // name+args → envelope
  const startedAt = Date.now();

  try {
    for (let step = 0; step < LIMITS.MAX_TOOL_STEPS; step += 1) {
      if (Date.now() - startedAt > LIMITS.REQUEST_TIMEOUT_MS) {
        return { enabled: true, answer: 'A consulta demorou demais. Tente reformular a pergunta.', evidence, warnings, actions_available: [] };
      }

      const res = await gateway.generate({ system: SYSTEM_PROMPT, messages, tools: specs }, { mode });

      if (res.finishReason !== 'tool_calls' || !res.toolCalls?.length) {
        return {
          enabled: true,
          answer: res.content || 'Não tenho informações suficientes para responder.',
          evidence,
          warnings,
          actions_available: [],
        };
      }

      // Registra a intenção do assistente (para o provider) e executa as tools.
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } })) });

      for (const call of res.toolCalls) {
        const key = `${call.name}:${JSON.stringify(call.arguments || {})}`;
        let envelope = dedupe.get(key);
        if (!envelope) {
          envelope = await registry.executeTool(call.name, call.arguments, ctx);
          dedupe.set(key, envelope);
          if (Array.isArray(envelope.evidence)) evidence.push(...envelope.evidence);
          if (Array.isArray(envelope.warnings)) warnings.push(...envelope.warnings);
        }
        // Devolve ao modelo apenas o envelope sanitizado (dados + ok/warnings).
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: envelope.ok, data: envelope.data, warnings: envelope.warnings, truncated: envelope.truncated, error: envelope.error || null }),
        });
      }
    }

    // Estourou o número de passos: pede resposta final sem mais tools.
    const finalRes = await gateway.generate({ system: SYSTEM_PROMPT, messages, tools: [] }, { mode });
    return {
      enabled: true,
      answer: finalRes.content || 'Não consegui concluir a consulta com as informações disponíveis.',
      evidence,
      warnings: [...warnings, 'Consulta atingiu o limite de etapas.'],
      actions_available: [],
    };
  } catch (err) {
    const code = err instanceof AIProviderError ? err.code : PROVIDER_ERROR.UPSTREAM_ERROR;
    const userMessageSafe = err instanceof AIProviderError ? err.userMessage : 'O assistente está indisponível no momento.';
    return { enabled: true, answer: userMessageSafe, error_class: code, evidence, warnings, actions_available: [] };
  }
}

module.exports = { runChat, boundHistory };
