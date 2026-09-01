'use strict';

// ERP Integration Hub V1 (E3.7A) — configuração schema-free, provider-agnostic,
// PRODUCTION-INERT. Fundação; NÃO integra nenhum ERP específico nesta fatia.
//
//   ERP_PROVIDER_MODE = disabled | fake
//     disabled (default de produção) → nenhum provider; toda operação falha de forma
//                                       SEGURA e EXPLÍCITA (nunca finge sucesso).
//     fake     → provider determinístico em memória (testes/dev). NENHUMA chamada
//                externa, NENHUM segredo, NENHUMA escrita de negócio.
//
// Deliberadamente NÃO existe modo 'http'/provider real nesta frente: assim é
// ESTRUTURALMENTE impossível fazer chamada real a ERP externo (ERP_HUB_PROVIDER_REAL_CALLS=0).
// Adicionar um adapter real é uma fatia futura (E3.7B) sob OWNER gate próprio.
//
// Sem secret, sem mudar env do Railway nesta frente (ERP_HUB_ENV_CHANGES=0).

const MODES = Object.freeze({ DISABLED: 'disabled', FAKE: 'fake' });

// Limites determinísticos — bounds de entrada e sanidade. Nenhum I/O aqui.
const LIMITS = Object.freeze({
  MAX_ENTITY_TYPE: 64,
  MAX_ENTITY_ID: 200,
  MAX_EVENT_TYPE: 64,
  MAX_SOURCE: 64,
  MAX_CORRELATION_ID: 128,
  MAX_PAYLOAD_BYTES: 64 * 1024, // teto de sanidade do payload canônico serializado
  MAX_METADATA_KEYS: 32,
  MAX_ATTEMPTS_DEFAULT: 8,
  PROVIDER_TIMEOUT_MS: 8000, // reservado para adapter futuro; inerte nesta frente
});

function resolveMode() {
  const raw = String(process.env.ERP_PROVIDER_MODE || '').trim().toLowerCase();
  if (raw === MODES.FAKE) return MODES.FAKE;
  // Qualquer outro valor (inclusive um nome de provider real digitado por engano)
  // resolve para DISABLED: falha segura por padrão.
  return MODES.DISABLED;
}

// Em 'fake' há um provider (determinístico, sem rede). Em 'disabled' não há
// provider algum. Provider real nunca é "available" nesta frente (não existe modo).
function providerAvailable(mode = resolveMode()) {
  return mode === MODES.FAKE;
}

// O Hub está "enabled" apenas quando há um provider disponível. Em produção
// (disabled) isto é sempre false: o Hub é observável mas totalmente inerte.
function isEnabled(mode = resolveMode()) {
  return mode !== MODES.DISABLED && providerAvailable(mode);
}

module.exports = { MODES, LIMITS, resolveMode, providerAvailable, isEnabled };
