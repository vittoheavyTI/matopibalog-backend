'use strict';

// Superfície pública da fundação do ERP Integration Hub (E3.7A).
// Provider-agnostic, schema-free, production-inert. Nenhum fornecedor específico,
// nenhuma chamada externa, nenhuma escrita de negócio.

const config = require('./config');
const errors = require('./errors');
const capabilities = require('./capabilities');
const canonicalEnvelope = require('./canonicalEnvelope');
const idempotency = require('./idempotency');
const reconcile = require('./reconcile');
const gateway = require('./erpProviderGateway');
const outboxContract = require('./outboxContract');
const externalIdentityContract = require('./externalIdentityContract');
const diagnostics = require('./diagnostics');

module.exports = {
  config,
  errors,
  capabilities,
  canonicalEnvelope,
  idempotency,
  reconcile,
  gateway,
  outboxContract,
  externalIdentityContract,
  diagnostics,
};
