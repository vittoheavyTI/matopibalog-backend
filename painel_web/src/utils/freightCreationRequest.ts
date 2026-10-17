export type FreightCreationRequestState = {
  clientRequestId: string;
  fingerprint: string;
  scopeHash: string;
  createdAt: number;
  expiresAt: number;
  status: 'prepared' | 'ambiguous' | 'created';
  confirmedFreightId?: string;
};

type MutableRef<T> = { current: T };
type IntentScope = { tenantId?: string | null; userId?: string | null };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'matopibalog_pending_freight_intents_v1';
const MAX_PENDING = 8;
const TTL_MS = 72 * 60 * 60 * 1000;
let volatileRecords: FreightCreationRequestState[] = [];

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const fingerprintPayload = (payload: Record<string, unknown>) =>
  sha256(JSON.stringify(canonicalize(payload)));

const fingerprintScope = ({ tenantId, userId }: IntentScope) => {
  if (!tenantId || !userId) {
    throw new Error('Contexto autorizado incompleto para criar frete.');
  }
  return sha256(`${tenantId}:${userId}`);
};

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

function loadRecords(storage: StorageLike | null, now: number) {
  let parsed: FreightCreationRequestState[] = volatileRecords;
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      parsed = [];
    }
  }
  const valid = Array.isArray(parsed)
    ? parsed.filter((record) => record && record.expiresAt > now)
    : [];
  volatileRecords = valid;
  return valid;
}

function saveRecords(storage: StorageLike | null, records: FreightCreationRequestState[]) {
  volatileRecords = records.slice(-MAX_PENDING);
  if (!storage) return;
  if (volatileRecords.length === 0) storage.removeItem(STORAGE_KEY);
  else storage.setItem(STORAGE_KEY, JSON.stringify(volatileRecords));
}

export async function getFreightCreationRequest(
  ref: MutableRef<FreightCreationRequestState | null>,
  payload: Record<string, unknown>,
  scope: IntentScope,
  newId: () => string,
  options: { storage?: StorageLike | null; now?: number } = {},
): Promise<FreightCreationRequestState> {
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const [fingerprint, scopeHash] = await Promise.all([
    fingerprintPayload(payload),
    fingerprintScope(scope),
  ]);
  if (ref.current?.fingerprint === fingerprint && ref.current.scopeHash === scopeHash) {
    return ref.current;
  }
  const records = loadRecords(storage, now);
  const existing = records.find(
    (record) => record.fingerprint === fingerprint && record.scopeHash === scopeHash,
  );
  if (existing) {
    ref.current = existing;
    return existing;
  }
  const created: FreightCreationRequestState = {
    clientRequestId: newId(),
    fingerprint,
    scopeHash,
    createdAt: now,
    expiresAt: now + TTL_MS,
    status: 'prepared',
  };
  saveRecords(storage, [...records, created]);
  ref.current = created;
  return created;
}

function updateRecord(
  state: FreightCreationRequestState,
  patch: Partial<FreightCreationRequestState>,
  storage: StorageLike | null = browserStorage(),
) {
  const records = loadRecords(storage, Date.now());
  const updated = { ...state, ...patch };
  saveRecords(storage, records.map((record) =>
    record.clientRequestId === state.clientRequestId && record.scopeHash === state.scopeHash
      ? updated
      : record));
  return updated;
}

export const markFreightCreationAmbiguous = (
  state: FreightCreationRequestState,
  storage?: StorageLike | null,
) => updateRecord(state, { status: 'ambiguous' }, storage);

export const markFreightCreationCreated = (
  state: FreightCreationRequestState,
  freightId: string,
  storage?: StorageLike | null,
) => updateRecord(state, { status: 'created', confirmedFreightId: freightId }, storage);

export function completeFreightCreationRequest(
  ref: MutableRef<FreightCreationRequestState | null>,
  state: FreightCreationRequestState,
  storage: StorageLike | null = browserStorage(),
): void {
  const records = loadRecords(storage, Date.now()).filter((record) =>
    record.clientRequestId !== state.clientRequestId || record.scopeHash !== state.scopeHash);
  saveRecords(storage, records);
  if (ref.current?.clientRequestId === state.clientRequestId) ref.current = null;
}

export function resetFreightCreationRequestsForTesting(): void {
  volatileRecords = [];
}
