// backend/scripts/test-asaas-config-crypto.js
// Teste isolado da resolução da apiKey do Asaas (resolveAsaasApiKey).
// Não acessa banco, rede nem credenciais reais — usa apenas uma chave fake local.
// Uso: node backend/scripts/test-asaas-config-crypto.js

const assert = require('assert');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { encryptIntegrationSecret } = require('../utils/integrationsCrypto');

// Chave fake determinística de 32 bytes, codificada em base64 (nunca é segredo real).
const CHAVE_FAKE = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function comChave() {
  process.env.INTEGRATIONS_SECRET_KEY = CHAVE_FAKE;
}
function semChave() {
  delete process.env.INTEGRATIONS_SECRET_KEY;
}

let testes = 0;
function teste(nome, fn) {
  fn();
  testes += 1;
}

const ASAAS_ENV_ANTERIOR = process.env.ASAAS_API_KEY;

// 1) apiKey armazenada em texto puro legado → devolve igual, sem exigir chave
teste('legado em texto puro sem chave retorna igual', () => {
  semChave();
  const out = resolveAsaasApiKey({ apiKey: '$aact_legado_em_claro' });
  assert.strictEqual(out, '$aact_legado_em_claro', 'texto legado deve passar direto');
});

// 2) apiKey armazenada enc:v1 → descriptografa com INTEGRATIONS_SECRET_KEY
teste('enc:v1 descriptografa com chave e nunca retorna ciphertext', () => {
  comChave();
  const real = '$aact_chave_real_secreta';
  const cifrada = encryptIntegrationSecret(real);
  assert.ok(cifrada.startsWith('enc:v1:'), 'pré-condição: valor cifrado');
  const out = resolveAsaasApiKey({ apiKey: cifrada });
  assert.strictEqual(out, real, 'deve devolver a apiKey real');
  assert.strictEqual(out.startsWith('enc:v1:'), false, 'NUNCA devolve ciphertext');
});

// 3) apiKey armazenada enc:v1 sem chave → lança erro genérico (não vaza, não usa ciphertext)
teste('enc:v1 sem chave lança erro genérico', () => {
  comChave();
  const cifrada = encryptIntegrationSecret('$aact_outra_chave');
  semChave();
  assert.throws(
    () => resolveAsaasApiKey({ apiKey: cifrada }),
    (err) => err instanceof Error && err.message === 'Configuração Asaas inválida' && !/enc:v1/.test(err.message),
    'deve lançar erro genérico sem vazar segredo'
  );
});

// 4) sem apiKey armazenada → cai para process.env.ASAAS_API_KEY (mesmo sem chave)
teste('fallback para ASAAS_API_KEY quando não há apiKey armazenada', () => {
  semChave();
  process.env.ASAAS_API_KEY = '$aact_env_fallback';
  assert.strictEqual(resolveAsaasApiKey({}), '$aact_env_fallback', 'objeto vazio usa env');
  assert.strictEqual(resolveAsaasApiKey({ apiKey: '' }), '$aact_env_fallback', 'apiKey vazia usa env');
  assert.strictEqual(resolveAsaasApiKey(null), '$aact_env_fallback', 'null usa env');
});

// 5) legado em texto puro COM chave configurada também retorna igual (compatibilidade)
teste('legado em texto puro com chave presente retorna igual', () => {
  comChave();
  const out = resolveAsaasApiKey({ apiKey: '$aact_legado_com_chave' });
  assert.strictEqual(out, '$aact_legado_com_chave', 'legado passa direto mesmo com chave');
});

// Restaura ambiente (higiene; não é segredo real).
semChave();
if (ASAAS_ENV_ANTERIOR === undefined) delete process.env.ASAAS_API_KEY;
else process.env.ASAAS_API_KEY = ASAAS_ENV_ANTERIOR;

console.log(`OK — ${testes} testes de resolução de apiKey do Asaas passaram.`);
