// backend/utils/asaasConfig.js
// Resolução da apiKey do Asaas a partir da configuração armazenada em
// configuracoes.dados.integracao_asaas. Função pura (sem DB/rede) para permitir
// teste isolado — a leitura no banco fica em getAsaasConfig (routes/pagamentos.js).

const { decryptIntegrationSecret } = require('./integrationsCrypto');

// Recebe o objeto integracao_asaas já lido do banco e devolve a apiKey pronta
// para uso como access_token do Asaas.
//
// - Se houver apiKey armazenada, descriptografa antes de usar. Valor legado em
//   texto puro (sem prefixo enc:v1) passa direto, sem exigir INTEGRATIONS_SECRET_KEY.
// - Se a apiKey armazenada estiver cifrada (enc:v1) e não puder ser descriptografada
//   (INTEGRATIONS_SECRET_KEY ausente/inválida), lança erro genérico — NUNCA devolve
//   o ciphertext, que jamais deve virar access_token do Asaas.
// - Se não houver apiKey armazenada, cai para process.env.ASAAS_API_KEY.
function resolveAsaasApiKey(integracoes) {
  const armazenada = integracoes && integracoes.apiKey ? integracoes.apiKey : null;
  if (!armazenada) return process.env.ASAAS_API_KEY;
  try {
    return decryptIntegrationSecret(armazenada);
  } catch (_) {
    // Mensagem genérica: não vaza segredo nem detalhe técnico.
    throw new Error('Configuração Asaas inválida');
  }
}

module.exports = { resolveAsaasApiKey };
