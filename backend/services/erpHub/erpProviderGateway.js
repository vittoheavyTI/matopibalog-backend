'use strict';

// ErpProviderGateway — ponto ÚNICO de acesso ao provider de ERP. Seleciona pelo
// modo e expõe um contrato estável, provider-agnostic. NÃO importa supabase e não
// conhece nenhum fornecedor específico (§6/§8).
//
// Contrato:
//   capabilities()                → string[] declaradas pelo provider ativo
//   supports(cap)                 → boolean (capability desconhecida = false)
//   send(envelope)                → resultado do adapter | ErpProviderError
//   lookup(envelope)              → idem
//   reconcile(envelope)           → { status } normalizado
//
// Guardas duras:
//   - provider disabled → sempre ErpProviderError DISABLED (nunca finge sucesso).
//   - capability não suportada → ErpProviderError UNSUPPORTED_CAPABILITY, ANTES de
//     chamar o adapter.

const { MODES, resolveMode, providerAvailable } = require('./config');
const { ErpProviderError, ERP_PROVIDER_ERROR } = require('./errors');
const { CAPABILITY, providerSupports } = require('./capabilities');
const { normalizeReconcile } = require('./reconcile');
const { disabledErpProvider } = require('./providers/disabledErpProvider');
const { fakeErpProvider } = require('./providers/fakeErpProvider');

function selectProvider(mode = resolveMode()) {
  switch (mode) {
    case MODES.FAKE: return fakeErpProvider;
    default: return disabledErpProvider;
  }
}

function capabilities({ mode } = {}) {
  const p = selectProvider(mode || resolveMode());
  const caps = typeof p.capabilities === 'function' ? p.capabilities() : [];
  return Array.isArray(caps) ? caps : [];
}

function supports(cap, { mode } = {}) {
  return providerSupports(capabilities({ mode }), cap);
}

// HIGH-06 — `disabled` e `unsupported` são diagnósticos DIFERENTES e não podem
// colapsar num só. Antes, `send` com o provider desligado caía no teste de
// capability, achava a lista vazia e devolvia UNSUPPORTED_CAPABILITY — dizendo "esta
// operação não existe" quando a verdade é "não há provider ligado". Quem lesse o erro
// concluiria que o Hub não sabe enviar, e não que o ERP está desativado.
//
// Ordem correta, aplicada a send/lookup/reconcile:
//   1) resolver o modo/provider;
//   2) modo disabled            → DISABLED;
//   3) provider disponível      → checar capability;
//   4) capability desconhecida/não declarada → UNSUPPORTED_CAPABILITY.
function ensureUsable(cap, opts = {}) {
  const mode = opts.mode || resolveMode();
  if (mode === MODES.DISABLED || !providerAvailable(mode)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.DISABLED, 'erp provider disabled by config');
  }
  if (!supports(cap, { mode })) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.UNSUPPORTED_CAPABILITY, `capability nao suportada: ${cap}`);
  }
  return mode;
}

async function send(envelope, opts = {}) {
  const mode = ensureUsable(CAPABILITY.SEND, opts);
  return selectProvider(mode).send(envelope);
}

async function lookup(envelope, opts = {}) {
  const mode = ensureUsable(CAPABILITY.LOOKUP, opts);
  return selectProvider(mode).lookup(envelope);
}

async function reconcile(envelope, opts = {}) {
  const mode = ensureUsable(CAPABILITY.RECONCILE, opts);
  const raw = await selectProvider(mode).reconcile(envelope);
  const status = normalizeReconcile(raw && raw.status);
  return { ...raw, status };
}

module.exports = {
  selectProvider,
  capabilities,
  supports,
  send,
  lookup,
  reconcile,
  fakeErpProvider,
  disabledErpProvider,
};
