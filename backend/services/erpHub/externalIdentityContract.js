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
//   - unicidade nos DOIS sentidos: um internal tem um external, e um external
//     pertence a um único internal (dentro de provider+tenant+entity_type).
//   - identidade imutável por padrão: rebind só por caminho auditável explícito,
//     e ainda assim NUNCA sequestrando o external de outro internal (HIGH-03).

function assertCampos(campos) {
  for (const [nome, v] of Object.entries(campos)) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`externalIdentity: campo obrigatorio ausente: ${nome}`);
    }
  }
}

function mapKey({ provider, empresaId, entityType, internalEntityId }) {
  assertCampos({ provider, empresaId, entityType, internalEntityId });
  return [provider, empresaId, entityType, internalEntityId].join('|');
}

function createInMemoryIdentityMap() {
  const byInternal = new Map();  // internalKey → mapping
  const byExternal = new Map();  // externalKey → internal_entity_id

  function extKey({ provider, empresaId, entityType, externalEntityId }) {
    assertCampos({ provider, empresaId, entityType, externalEntityId });
    return [provider, empresaId, entityType, externalEntityId].join('|');
  }

  // Cria o vínculo. Idempotente se o MESMO par já existir. Recusa colisões:
  //   - internal já ligado a outro external → conflito (identidade imutável).
  //   - external já ligado a outro internal → conflito (dois internos, um externo).
  function bind({ provider, empresaId, entityType, internalEntityId, externalEntityId }) {
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

  // Rebind auditável — HIGH-03.
  //
  // A versão anterior tinha três defeitos, e todos só apareciam junto: ela deletava
  // o índice externo ANTES de validar, não checava se o NOVO external já pertencia a
  // outro internal, e validava o novo id menos estritamente que o bind. O resultado
  // era um sequestro de identidade: `rebind(A → ext2)`, com ext2 já pertencendo a B,
  // apontava A para ext2 e deixava B com um mapping órfão — dois internos disputando
  // um external, exatamente o que o bind recusa.
  //
  // Agora: valida TUDO, decide, e só então muta — nunca há estado parcial, nem
  // sequer no contrato em memória (a versão SQL futura fará o mesmo numa transação).
  function rebind({ provider, empresaId, entityType, internalEntityId, externalEntityId, reason }) {
    // 1) validação completa dos campos, com o MESMO rigor do bind.
    const ik = mapKey({ provider, empresaId, entityType, internalEntityId });
    const ekNovo = extKey({ provider, empresaId, entityType, externalEntityId });
    if (typeof reason !== 'string' || reason.trim() === '') {
      return { code: 'reason_required' };
    }

    // 2) o vínculo precisa existir para ser reapontado.
    const atual = byInternal.get(ik);
    if (!atual) return { code: 'not_found' };

    // 3a) reapontar para o mesmo external = no-op idempotente (nada a mutar).
    if (atual.external_entity_id === externalEntityId) {
      return { code: 'idempotent', mapping: { ...atual } };
    }

    // 3b) o external de destino não pode pertencer a OUTRO internal.
    const donoExterno = byExternal.get(ekNovo);
    if (donoExterno && donoExterno !== internalEntityId) {
      return { code: 'conflict_external_already_bound', internal: donoExterno, mapping: { ...atual } };
    }

    // 4) só agora muta: libera o antigo e liga o novo.
    byExternal.delete(extKey({ provider, empresaId, entityType, externalEntityId: atual.external_entity_id }));
    const mapping = {
      ...atual,
      external_entity_id: externalEntityId,
      rebound_at: new Date().toISOString(),
      rebind_reason: reason,
    };
    byInternal.set(ik, mapping);
    byExternal.set(ekNovo, internalEntityId);
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
