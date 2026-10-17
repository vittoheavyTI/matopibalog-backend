import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeFreightCreationRequest,
  FreightCreationIntentSafetyError,
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

  it('RET-013/014 preserves expired prepared and ambiguous identities for reconciliation', async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const first = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA,
      () => `request-${++sequence}`, { storage, now: 100 },
    );
    markFreightCreationAmbiguous(first, storage);
    resetFreightCreationRequestsForTesting();
    const expired = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA,
      () => `request-${++sequence}`, { storage, now: 100 + 73 * 60 * 60 * 1000 },
    );
    expect(expired.clientRequestId).toBe('request-1');
    expect(expired.status).toBe('ambiguous');
    expect(expired.retentionState).toBe('expired_requires_reconciliation');
    expect(sequence).toBe(1);
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'A' }, { tenantId: null, userId: null },
      () => 'never', { storage },
    )).rejects.toThrow('Contexto autorizado incompleto');
  });

  it('RET-011/012 retains eight pending intents and blocks the ninth', async () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 8; index += 1) {
      const intent = await getFreightCreationRequest(
        { current: null }, { origem: `route-${index}` }, scopeA,
        () => `request-${index}`, { storage },
      );
      markFreightCreationAmbiguous(intent, storage);
    }
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'route-9' }, scopeA, () => 'request-9', { storage },
    )).rejects.toMatchObject({ code: 'capacity_requires_reconciliation' });
    expect(JSON.parse([...storage.data.values()][0])).toHaveLength(8);
  });

  it('RET-015/019 preserves expired confirmed freight for upload recovery after restart', async () => {
    const storage = new MemoryStorage();
    const intent = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, () => 'request-1', { storage, now: 100 },
    );
    markFreightCreationCreated(intent, 'freight-1', storage);
    resetFreightCreationRequestsForTesting();
    const recovered = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, () => 'never',
      { storage, now: 100 + 73 * 60 * 60 * 1000 },
    );
    expect(recovered.clientRequestId).toBe('request-1');
    expect(recovered.confirmedFreightId).toBe('freight-1');
    expect(recovered.retentionState).toBe('expired_requires_reconciliation');
  });

  it('RET-016/017 refuses unavailable or corrupted storage before allocating a new key', async () => {
    const newId = vi.fn(() => 'unsafe-new-id');
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, newId, { storage: null },
    )).rejects.toMatchObject({ code: 'storage_unavailable' });
    const corrupted = new MemoryStorage();
    corrupted.data.set('matopibalog_pending_freight_intents_v1', '{broken');
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, newId, { storage: corrupted },
    )).rejects.toMatchObject({ code: 'storage_corrupted' });
    expect(newId).not.toHaveBeenCalled();
  });

  it('RET-017 rejects a missing persisted identity instead of trusting memory', async () => {
    const storage = new MemoryStorage();
    const ref = { current: null as FreightCreationRequestState | null };
    await getFreightCreationRequest(
      ref, { origem: 'A' }, scopeA, () => 'request-1', { storage },
    );
    storage.removeItem('matopibalog_pending_freight_intents_v1');
    const newId = vi.fn(() => 'unsafe-new-id');
    await expect(getFreightCreationRequest(
      ref, { origem: 'B' }, scopeA, newId, { storage },
    )).rejects.toMatchObject({ code: 'storage_corrupted' });
    expect(newId).not.toHaveBeenCalled();
  });

  it('RET-018/025 refuses a failed write before any POST identity can be used', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new Error('quota'); };
    await expect(getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, () => 'request-1', { storage },
    )).rejects.toBeInstanceOf(FreightCreationIntentSafetyError);
  });

  it('RET-020/021/022/023/024 keeps account scopes and individual cleanup independent', async () => {
    const storage = new MemoryStorage();
    const aRef = { current: null as FreightCreationRequestState | null };
    const a = await getFreightCreationRequest(aRef, { origem: 'A' }, scopeA, () => 'a', { storage });
    const b = await getFreightCreationRequest(
      { current: null }, { origem: 'B' }, scopeA, () => 'b', { storage },
    );
    const userB = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, { tenantId: 'tenant-a', userId: 'user-b' }, () => 'user-b', { storage },
    );
    const tenantB = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, { tenantId: 'tenant-b', userId: 'user-a' }, () => 'tenant-b', { storage },
    );
    completeFreightCreationRequest(aRef, b, storage);
    resetFreightCreationRequestsForTesting();
    const loggedBackIn = await getFreightCreationRequest(
      { current: null }, { origem: 'A' }, scopeA, () => 'never', { storage },
    );
    expect(loggedBackIn.clientRequestId).toBe(a.clientRequestId);
    expect(new Set([a.clientRequestId, userB.clientRequestId, tenantB.clientRequestId])).toHaveLength(3);
    expect([...storage.data.values()].join('')).not.toContain('origem');
  });

  it('RET-026 exposes a comprehensible fail-closed message', () => {
    const error = new FreightCreationIntentSafetyError(
      'capacity_requires_reconciliation',
      'Existem oito tentativas pendentes. Reconcilie ou conclua uma delas antes de criar outro frete; nenhuma pendencia foi descartada.',
    );
    expect(error.message).toContain('Reconcilie');
    expect(error.message).toContain('nenhuma pendencia foi descartada');
  });
});
