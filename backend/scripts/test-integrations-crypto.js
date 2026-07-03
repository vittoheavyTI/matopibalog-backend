// backend/scripts/test-integrations-crypto.js
// Teste isolado do helper de criptografia em repouso das integrações.
// Não acessa banco, rede nem credenciais reais — usa apenas uma chave fake local.
// Uso: node backend/scripts/test-integrations-crypto.js

const assert = require('assert');

// Chave fake determinística de 32 bytes, codificada em base64 (nunca é segredo real).
const CHAVE_FAKE = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function comChave() {
  process.env.INTEGRATIONS_SECRET_KEY = CHAVE_FAKE;
}
function semChave() {
  delete process.env.INTEGRATIONS_SECRET_KEY;
}

// Carrega o helper (não depende da chave em tempo de import — ela é lida sob demanda).
const crypto = require('../utils/integrationsCrypto');

let testes = 0;
function teste(nome, fn) {
  fn();
  testes += 1;
}

// 1) encrypt/decrypt reversível
teste('encrypt/decrypt reversível', () => {
  comChave();
  const original = 'minha-api-key-super-secreta';
  const cifrado = crypto.encryptIntegrationSecret(original);
  assert.notStrictEqual(cifrado, original, 'valor cifrado não pode ser igual ao original');
  assert.ok(cifrado.startsWith('enc:v1:'), 'valor cifrado deve começar com enc:v1:');
  assert.strictEqual(crypto.decryptIntegrationSecret(cifrado), original, 'decrypt deve restaurar o original');
});

// 2) isEncryptedIntegrationSecret
teste('isEncryptedIntegrationSecret', () => {
  comChave();
  const cifrado = crypto.encryptIntegrationSecret('abc123');
  assert.strictEqual(crypto.isEncryptedIntegrationSecret(cifrado), true, 'valor enc:v1 é criptografado');
  assert.strictEqual(crypto.isEncryptedIntegrationSecret('texto-puro'), false, 'texto puro não é criptografado');
  assert.strictEqual(crypto.isEncryptedIntegrationSecret(null), false, 'null não é criptografado');
});

// 3) maybeEncryptIntegrationField em campo sensível
teste('maybeEncryptIntegrationField cifra campo sensível', () => {
  comChave();
  const out = crypto.maybeEncryptIntegrationField('apiKey', 'segredo-123', true);
  assert.ok(crypto.isEncryptedIntegrationSecret(out), 'campo sensível deve ser cifrado');
  assert.strictEqual(crypto.maybeDecryptIntegrationField('apiKey', out, true), 'segredo-123', 'ida e volta');
});

// 4) campo público não é criptografado
teste('campo público permanece em claro', () => {
  comChave();
  const out = crypto.maybeEncryptIntegrationField('endpoint', 'https://exemplo.com', false);
  assert.strictEqual(out, 'https://exemplo.com', 'campo não sensível não deve ser alterado');
  assert.strictEqual(crypto.isEncryptedIntegrationSecret(out), false, 'campo público não vira enc:v1');
});

// 5) idempotência: valor já criptografado não muda
teste('idempotência (não recifra)', () => {
  comChave();
  const cifrado = crypto.maybeEncryptIntegrationField('token', 'valor-x', true);
  const recifrado = crypto.maybeEncryptIntegrationField('token', cifrado, true);
  assert.strictEqual(recifrado, cifrado, 'valor já cifrado deve permanecer idêntico');
});

// 6) maybeDecryptIntegrationField com texto puro legado (com chave presente)
teste('decrypt de texto legado devolve o próprio valor', () => {
  comChave();
  const out = crypto.maybeDecryptIntegrationField('senha', 'senha-legada-em-claro', true);
  assert.strictEqual(out, 'senha-legada-em-claro', 'texto legado deve passar direto');
});

// 7) sem chave, encrypt falha de forma segura
teste('encrypt sem chave lança erro', () => {
  semChave();
  assert.throws(() => crypto.encryptIntegrationSecret('qualquer'), /INTEGRATIONS_SECRET_KEY/, 'encrypt deve exigir chave');
});

// 8) sem chave, decrypt de enc:v1 falha de forma segura
teste('decrypt de enc:v1 sem chave lança erro', () => {
  comChave();
  const cifrado = crypto.encryptIntegrationSecret('valor-para-cifrar');
  semChave();
  assert.throws(() => crypto.decryptIntegrationSecret(cifrado), /INTEGRATIONS_SECRET_KEY/, 'decrypt de enc:v1 deve exigir chave');
});

// 9) sem chave, decrypt de texto legado continua funcionando (não quebra)
teste('decrypt de texto legado sem chave não quebra', () => {
  semChave();
  const out = crypto.decryptIntegrationSecret('valor-legado-sem-prefixo');
  assert.strictEqual(out, 'valor-legado-sem-prefixo', 'texto legado não exige chave');
});

// Restaura estado do ambiente ao final (higiene; não é segredo real).
semChave();

console.log(`OK — ${testes} testes de criptografia de integrações passaram.`);
