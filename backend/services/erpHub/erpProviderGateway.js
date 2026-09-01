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

const { MODES, resolveMode } = require('./config');
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

function ensureCapability(cap, opts) {
  if (!supports(cap, opts)) {
    throw new ErpProviderError(ERP_PROVIDER_ERROR.UNSUPPORTED_CAPABILITY, `capability nao suportada: ${cap}`);
  }
}

async function send(envelope, opts = {}) {
  ensureCapability(CAPABILITY.SEND, opts);
  return selectProvider(opts.mode || resolveMode()).send(envelope);
}

async function lookup(envelope, opts = {}) {
  ensureCapability(CAPABILITY.LOOKUP, opts);
  return selectProvider(opts.mode || resolveMode()).lookup(envelope);
}

async function reconcile(envelope, opts = {}) {
  ensureCapability(CAPABILITY.RECONCILE, opts);
  const raw = await selectProvider(opts.mode || resolveMode()).reconcile(envelope);
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
