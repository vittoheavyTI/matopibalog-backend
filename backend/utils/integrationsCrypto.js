// backend/utils/integrationsCrypto.js
// Criptografia em repouso das credenciais sensíveis de integrações.
// Usa AES-256-GCM com uma chave base64 de 32 bytes lida de INTEGRATIONS_SECRET_KEY.
// Formato do payload criptografado:
//   enc:v1:<ivBase64>:<authTagBase64>:<cipherTextBase64>
//
// Compatibilidade: valores legados em texto puro (sem o prefixo enc:v1) continuam
// sendo lidos como estão — a migração desses valores é uma etapa futura separada.

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1';
const IV_BYTES = 12; // nonce de 96 bits recomendado para GCM

// Retorna a chave como Buffer de 32 bytes, ou null se ausente/inválida.
// Nunca imprime nem retorna o material da chave.
function obterChave() {
  const raw = process.env.INTEGRATIONS_SECRET_KEY;
  if (!raw) return null;
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch (_) {
    return null;
  }
  return buf.length === 32 ? buf : null;
}

// true se o valor já está no formato criptografado enc:v1.
function isEncryptedIntegrationSecret(valor) {
  return typeof valor === 'string' && valor.startsWith(`${PREFIX}:`);
}

// Criptografa um texto sensível. Idempotente: valor já criptografado é devolvido como está.
// Lança erro se a chave não estiver configurada (nunca grava segredo em claro por engano).
function encryptIntegrationSecret(valor) {
  if (isEncryptedIntegrationSecret(valor)) return valor;
  const chave = obterChave();
  if (!chave) throw new Error('INTEGRATIONS_SECRET_KEY ausente ou inválida');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, chave, iv);
  const cipherText = Buffer.concat([cipher.update(String(valor), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${cipherText.toString('base64')}`;
}

// Descriptografa um valor. Valor legado (sem prefixo enc:v1) é devolvido como está,
// sem exigir chave. Valor enc:v1 sem chave configurada lança erro.
function decryptIntegrationSecret(valor) {
  if (!isEncryptedIntegrationSecret(valor)) return valor;
  const partes = valor.split(':');
  if (partes.length !== 5) throw new Error('Formato de segredo criptografado inválido');
  const chave = obterChave();
  if (!chave) throw new Error('INTEGRATIONS_SECRET_KEY ausente ou inválida');
  const [, , ivB64, tagB64, ctB64] = partes;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const cipherText = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, chave, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
}

// Criptografa o campo apenas se for sensível e for texto não vazio.
// Campos não sensíveis (e valores vazios) são preservados sem alteração.
function maybeEncryptIntegrationField(chave, valor, sensivel) {
  if (!sensivel) return valor;
  if (typeof valor !== 'string' || valor.length === 0) return valor;
  return encryptIntegrationSecret(valor);
}

// Descriptografa o campo apenas se for sensível. Campo não sensível é devolvido como está.
// Valor legado em texto puro passa direto (decryptIntegrationSecret não exige chave).
function maybeDecryptIntegrationField(chave, valor, sensivel) {
  if (!sensivel) return valor;
  return decryptIntegrationSecret(valor);
}

module.exports = {
  isEncryptedIntegrationSecret,
  encryptIntegrationSecret,
  decryptIntegrationSecret,
  maybeEncryptIntegrationField,
  maybeDecryptIntegrationField,
};
