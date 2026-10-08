'use strict';

// Capabilities explícitas do provider de ERP. Um provider declara EXATAMENTE o
// que sabe fazer; o gateway nunca assume suporte. Regra dura (§8):
//   capability desconhecida  ≠  suportada.
//
// V1 define o vocabulário mínimo de operações. Nenhuma delas executa nada nesta
// frente (provider disabled em produção; fake em memória nos testes).

const CAPABILITY = Object.freeze({
  SEND: 'send',           // empurrar um envelope canônico ao ERP (outbound)
  LOOKUP: 'lookup',       // consultar estado/identidade externa (read)
  RECONCILE: 'reconcile', // reconciliar um envio previamente feito
});

const KNOWN_CAPABILITIES = Object.freeze(Object.values(CAPABILITY));

function isKnownCapability(cap) {
  return typeof cap === 'string' && KNOWN_CAPABILITIES.includes(cap);
}

// Um provider "suporta" uma capability apenas se ela é conhecida E consta na
// lista declarada por ele. Qualquer ambiguidade → não suportada.
function providerSupports(declaredCapabilities, cap) {
  if (!isKnownCapability(cap)) return false;
  if (!Array.isArray(declaredCapabilities)) return false;
  return declaredCapabilities.includes(cap);
}

module.exports = { CAPABILITY, KNOWN_CAPABILITIES, isKnownCapability, providerSupports };
