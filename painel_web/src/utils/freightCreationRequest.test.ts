import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeFreightCreationRequest,
  getFreightCreationRequest,
  markFreightCreationAmbiguous,
  markFreightCreationCreated,
  resetFreightCreationRequestsForTesting,
  type FreightCreationRequestState,
} from './freightCreationRequest';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const scopeA = { tenantId: 'tenant-a', userId: 'user-a' };

describe('freight creation request identity', () => {
  beforeEach(() => resetFreightCreationRequestsForTesting());

  it('recovers the same key after reload/browser reconstruction', async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const payload = { origem: 'A', destino: 'B', valor_frete: 100 };
    const first = await getFreightCreationRequest(
      { current: null }, payload, scopeA, () => `request-${++sequence}`, { storage },
    );
    resetFreightCreationRequestsForTesting();
    const afterReload = await getFreightCreationRequest(
      { current: null }, { ...payload }, scopeA, () => `request-${++sequence}`, { storage },
    );
    expect(afterReload.clientRequestId).toBe(first.clientRequestId);
    expect(sequence).toBe(1);
  });

  it('supports two pending intents and completing B does not erase A', async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const refA = { current: null as FreightCreationRequestState | null };
    const refB = { current: null as FreightCreationRequestState | null };
    const a = await getFreightCreationRequest(
      refA, { origem: 'A' }, scopeA, () => `request-${++sequence}`, { storage },
    );
    markFreightCreationAmbiguous(a, storage);
    const b = await getFreightCreationRequest(
      refB, { origem: 'B' }, scopeA, () => `request-${++sequence}`, { storage },
    );
    completeFreightCreationRequest(refB, b, storage);
    resetFreightCreationRequestsForTesting();
    const recoveredA = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, () => `request-${++sequence}`, { storage },
    );
    expect(recoveredA.clientRequestId).toBe('request-1');
    expect(sequence).toBe(2);
  });

  it('isolates pending keys by user and tenant', async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const payload = { origem: 'A' };
    const a = await getFreightCreationRequest(
      { current: null }, payload, scopeA, () => `request-${++sequence}`, { storage },
    );
    const userB = await getFreightCreationRequest(
      { current: null }, payload, { tenantId: 'tenant-a', userId: 'user-b' },
      () => `request-${++sequence}`, { storage },
    );
    const tenantB = await getFreightCreationRequest(
      { current: null }, payload, { tenantId: 'tenant-b', userId: 'user-a' },
      () => `request-${++sequence}`, { storage },
    );
    expect(new Set([a.clientRequestId, userB.clientRequestId, tenantB.clientRequestId]).size).toBe(3);
  });

  it('persists only opaque hashes, UUID metadata and confirmed freight reference', async () => {
    const storage = new MemoryStorage();
    const ref = { current: null as FreightCreationRequestState | null };
    const intent = await getFreightCreationRequest(
      ref,
      { origem: 'Segredo Operacional', valor_frete: 999 },
      scopeA,
      () => '11111111-1111-4111-8111-111111111111',
      { storage },
    );
    const created = markFreightCreationCreated(intent, 'freight-safe-id', storage);
    expect(created.confirmedFreightId).toBe('freight-safe-id');
    const serialized = [...storage.data.values()].join('');
    expect(serialized).not.toContain('Segredo Operacional');
    expect(serialized).not.toContain('999');
    expect(serialized).not.toContain('tenant-a');
    expect(serialized).not.toContain('user-a');
  });

  it('expires stale records and fails closed without actor/tenant scope', async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA,
      () => `request-${++sequence}`, { storage, now: 100 },
    );
    resetFreightCreationRequestsForTesting();
    const expired = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA,
      () => `request-${++sequence}`, { storage, now: 100 + 73 * 60 * 60 * 1000 },
    );
    expect(expired.clientRequestId).toBe('request-2');
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'A' }, { tenantId: null, userId: null },
      () => 'never', { storage },
    )).rejects.toThrow('Contexto autorizado incompleto');
  });
});
