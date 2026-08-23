'use strict';

const { AIProviderError, PROVIDER_ERROR } = require('./errors');

// Provider FAKE determinístico (testes/dev). NENHUMA chamada externa.
//
// Roteirizável: setScript([...turns]) define o que cada chamada generate() retorna,
// em ordem. Cada "turn":
//   { type:'text', content }                    → resposta final
//   { type:'tools', toolCalls:[{name,arguments}] } → pede execução de tools
//   { type:'error', code }                       → lança AIProviderError(code)
//   { type:'timeout' }                           → lança TIMEOUT
// Sem script: devolve um texto determinístico (sem inventar fatos).

let script = [];
let calls = 0;

function reset() { script = []; calls = 0; }
function setScript(turns) { script = Array.isArray(turns) ? [...turns] : []; calls = 0; }
function callCount() { return calls; }

let _id = 0;
function nextId() { _id += 1; return `call_${_id}`; }

const fakeProvider = {
  name: 'fake',
  reset,
  setScript,
  callCount,
  async generate() {
    calls += 1;
    const turn = script.shift();
    if (!turn) {
      return { finishReason: 'stop', toolCalls: [], content: 'Não tenho informações suficientes para responder.', usage: { total_tokens: 0 } };
    }
    if (turn.type === 'error') {
      throw new AIProviderError(PROVIDER_ERROR[turn.code] || PROVIDER_ERROR.UPSTREAM_ERROR, 'fake error');
    }
    if (turn.type === 'timeout') {
      throw new AIProviderError(PROVIDER_ERROR.TIMEOUT, 'fake timeout');
    }
    if (turn.type === 'tools') {
      const toolCalls = (turn.toolCalls || []).map((t) => ({
        id: nextId(),
        name: t.name,
        arguments: t.arguments || {},
      }));
      return { finishReason: 'tool_calls', toolCalls, content: turn.content || '', usage: { total_tokens: 0 } };
    }
    return { finishReason: 'stop', toolCalls: [], content: turn.content || '', usage: { total_tokens: 0 } };
  },
};

module.exports = { fakeProvider };
