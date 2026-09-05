'use strict';

// Provider FAKE determinístico (testes/dev). NENHUMA chamada externa, NENHUM
// segredo, NENHUMA escrita de negócio. Existe só para exercitar o contrato do
// gateway/outbox/reconcile de forma reprodutível.
//
// Determinismo: a "identidade externa" e o estado de reconcile derivam de um hash
// estável do envelope/idempotency key — a mesma entrada dá sempre a mesma saída.
// Roteirizável para erros via setFailure(code) e para reconcile via setReconcile(status).

const crypto = require('node:crypto');
const { ErpProviderError, ERP_PROVIDER_ERROR } = require('../errors');
const { CAPABILITY } = require('../capabilities');
const { RECONCILE_STATUS } = require('../reconcile');

let forcedFailure = null;
let forcedReconcile = null;

function setFailure(code) { forcedFailure = code || null; }
function setReconcile(status) { forcedReconcile = status || null; }
function reset() { forcedFailure = null; forcedReconcile = null; }

function stableExternalId(env) {
  const seed = `${env.empresa_id}|${env.entity_type}|${env.entity_id}`;
  const h = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
  return `fake_ext_${h}`;
}

const fakeErpProvider = {
  name: 'fake',
  setFailure,
  setReconcile,
  reset,
  capabilities() {
    // O fake declara suportar as três operações canônicas.
    return [CAPABILITY.SEND, CAPABILITY.LOOKUP, CAPABILITY.RECONCILE];
  },
  async send(envelope) {
    if (forcedFailure) {
      throw new ErpProviderError(ERP_PROVIDER_ERROR[forcedFailure] || ERP_PROVIDER_ERROR.UPSTREAM_ERROR, 'fake failure');
    }
    // "Aceito": devolve a identidade externa determinística. NÃO persiste nada.
    return {
      provider: 'fake',
      accepted: true,
      external_entity_id: stableExternalId(envelope),
      event_id: envelope.event_id,
    };
  },
  async lookup(envelope) {
    if (forcedFailure) {
      throw new ErpProviderError(ERP_PROVIDER_ERROR[forcedFailure] || ERP_PROVIDER_ERROR.UPSTREAM_ERROR, 'fake failure');
    }
    return { provider: 'fake', external_entity_id: stableExternalId(envelope), found: true };
  },
  async reconcile(envelope) {
    if (forcedFailure) {
      throw new ErpProviderError(ERP_PROVIDER_ERROR[forcedFailure] || ERP_PROVIDER_ERROR.UPSTREAM_ERROR, 'fake failure');
    }
    return { provider: 'fake', status: forcedReconcile || RECONCILE_STATUS.SUCCEEDED };
  },
};

module.exports = { fakeErpProvider };
