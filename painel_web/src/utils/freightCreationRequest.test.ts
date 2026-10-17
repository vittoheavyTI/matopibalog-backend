import { describe, expect, it } from 'vitest';
import {
  clearFreightCreationRequest,
  getFreightCreationRequestId,
  type FreightCreationRequestState,
} from './freightCreationRequest';

describe('freight creation request identity', () => {
  it('reuses the key after an ambiguous failure with the same intent', () => {
    const ref = { current: null as FreightCreationRequestState | null };
    let sequence = 0;
    const newId = () => `request-${++sequence}`;
    const payload = { origem: 'A', destino: 'B', valor_frete: 100 };

    expect(getFreightCreationRequestId(ref, payload, newId)).toBe('request-1');
    expect(getFreightCreationRequestId(ref, { ...payload }, newId)).toBe('request-1');
    expect(sequence).toBe(1);
  });

  it('creates a new key when the intent changes or the completed intent is cleared', () => {
    const ref = { current: null as FreightCreationRequestState | null };
    let sequence = 0;
    const newId = () => `request-${++sequence}`;

    expect(getFreightCreationRequestId(ref, { origem: 'A' }, newId)).toBe('request-1');
    expect(getFreightCreationRequestId(ref, { origem: 'B' }, newId)).toBe('request-2');
    clearFreightCreationRequest(ref);
    expect(getFreightCreationRequestId(ref, { origem: 'B' }, newId)).toBe('request-3');
  });

  it('reuses the pending key after the modal or route is remounted', () => {
    const firstMount = { current: null as FreightCreationRequestState | null };
    const secondMount = { current: null as FreightCreationRequestState | null };
    let sequence = 0;
    const newId = () => `request-${++sequence}`;
    const payload = { origem: 'A', destino: 'B', valor_frete: 100 };

    expect(getFreightCreationRequestId(firstMount, payload, newId)).toBe('request-1');
    expect(getFreightCreationRequestId(secondMount, payload, newId)).toBe('request-1');
    expect(sequence).toBe(1);
    clearFreightCreationRequest(secondMount);
  });
});
