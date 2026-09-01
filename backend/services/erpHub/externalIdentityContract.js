'use strict';

// Contrato de MAPEAMENTO DE IDENTIDADE EXTERNA (§10). Hoje o repo persiste
// external ids AD HOC (empresas.asaas_subscription_id, faturas.asaas_subscription_id,
// asaas_webhook_events.asaas_payment_id…) — espalhados por várias tabelas de
// domínio. A fundação genérica evita repetir esse anti-padrão: UM mapa
// (provider, empresa_id, entity_type, internal_entity_id) → external_entity_id.
//
// Como o outbox, a persistência real (tabela tenant-safe, chaves únicas) é a
// próxima fatia (E3.7B). Aqui ficam os INVARIANTES, testados em memória:
//   - tenant-safe: nunca associa entidade do tenant A a mapping do tenant B.
//   - provider-safe: o mesmo internal_entity_id pode ter mappings distintos por
//     provider; nunca colidem entre providers.
//   - unicidade: (provider, empresa_id, entity_type, internal_entity_id) → 1 external.
//   - identidade imutável por padrão: rebind só por caminho auditável explícito.

function mapKey({ provider, empresaId, entityType, internalEntityId }) {
  for (const [nome, v] of Object.entries({ provider, empresaId, entityType, internalEntityId })) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`externalIdentity: campo obrigatorio ausente: ${nome}`);
    }
  }
  return [provider, empresaId, entityType, internalEntityId].join('|');
}

function createInMemoryIdentityMap() {
  const byInternal = new Map();  // mapKey → { external_entity_id, ... }
  const byExternal = new Map();  // provider|empresa|entity|external → internal (colisão externa)

  function extKey({ provider, empresaId, entityType, externalEntityId }) {
    return [provider, empresaId, entityType, externalEntityId].join('|');
  }

  // Cria o vínculo. Idempotente se o MESMO par já existir. Recusa colisões:
  //   - internal já ligado a outro external → conflito (identidade imutável).
  //   - external já ligado a outro internal → conflito (dois internos, um externo).
  function bind({ provider, empresaId, entityType, internalEntityId, externalEntityId }) {
    if (typeof externalEntityId !== 'string' || externalEntityId.trim() === '') {
      throw new Error('externalIdentity.bind: externalEntityId obrigatorio');
    }
    const ik = mapKey({ provider, empresaId, entityType, internalEntityId });
    const ek = extKey({ provider, empresaId, entityType, externalEntityId });

    const existenteInterno = byInternal.get(ik);
    if (existenteInterno) {
      if (existenteInterno.external_entity_id === externalEntityId) {
        return { code: 'idempotent', mapping: { ...existenteInterno } };
      }
      return { code: 'conflict_internal_already_bound', mapping: { ...existenteInterno } };
    }
    const donoExterno = byExternal.get(ek);
    if (donoExterno && donoExterno !== internalEntityId) {
      return { code: 'conflict_external_already_bound', internal: donoExterno };
    }

    const mapping = {
      provider, empresa_id: empresaId, entity_type: entityType,
      internal_entity_id: internalEntityId, external_entity_id: externalEntityId,
      created_at: new Date().toISOString(),
    };
    byInternal.set(ik, mapping);
    byExternal.set(ek, internalEntityId);
    return { code: 'bound', mapping: { ...mapping } };
  }

  // Rebind auditável: caminho EXPLÍCITO e separado do bind. Exige motivo. É o
  // único jeito de trocar um vínculo já existente (identidade imutável por padrão).
  function rebind({ provider, empresaId, entityType, internalEntityId, externalEntityId, reason }) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      return { code: 'reason_required' };
    }
    const ik = mapKey({ provider, empresaId, entityType, internalEntityId });
    const atual = byInternal.get(ik);
    if (!atual) return { code: 'not_found' };
    // Libera o external antigo e liga o novo.
    byExternal.delete(extKey({ provider, empresaId, entityType, externalEntityId: atual.external_entity_id }));
    const mapping = { ...atual, external_entity_id: externalEntityId, rebound_at: new Date().toISOString(), rebind_reason: reason };
    byInternal.set(ik, mapping);
    byExternal.set(extKey({ provider, empresaId, entityType, externalEntityId }), internalEntityId);
    return { code: 'rebound', mapping: { ...mapping } };
  }

  function resolveExternal({ provider, empresaId, entityType, internalEntityId }) {
    const m = byInternal.get(mapKey({ provider, empresaId, entityType, internalEntityId }));
    return m ? m.external_entity_id : null;
  }

  function resolveInternal({ provider, empresaId, entityType, externalEntityId }) {
    return byExternal.get(extKey({ provider, empresaId, entityType, externalEntityId })) || null;
  }

  return { bind, rebind, resolveExternal, resolveInternal, _key: mapKey };
}

module.exports = { mapKey, createInMemoryIdentityMap };
