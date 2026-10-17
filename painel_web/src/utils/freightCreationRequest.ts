export type FreightCreationRequestState = {
  clientRequestId: string;
  fingerprint: string;
  scopeHash: string;
  createdAt: number;
  expiresAt: number;
  status: 'prepared' | 'ambiguous' | 'created';
  confirmedFreightId?: string;
  retentionState?: 'expired_requires_reconciliation';
};

type MutableRef<T> = { current: T };
type IntentScope = { tenantId?: string | null; userId?: string | null };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'matopibalog_pending_freight_intents_v1';
const MAX_PENDING = 8;
const TTL_MS = 72 * 60 * 60 * 1000;
export class FreightCreationIntentSafetyError extends Error {
  readonly code: 'storage_unavailable' | 'storage_corrupted' | 'storage_write_failed' | 'capacity_requires_reconciliation';

  constructor(
    code: 'storage_unavailable' | 'storage_corrupted' | 'storage_write_failed' | 'capacity_requires_reconciliation',
    message: string,
  ) {
    super(message);
    this.name = 'FreightCreationIntentSafetyError';
    this.code = code;
  }
}

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

const isRecord = (value: unknown): value is FreightCreationRequestState => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FreightCreationRequestState>;
  return typeof record.clientRequestId === 'string'
    && typeof record.fingerprint === 'string'
    && typeof record.scopeHash === 'string'
    && typeof record.createdAt === 'number'
    && typeof record.expiresAt === 'number'
    && ['prepared', 'ambiguous', 'created'].includes(record.status || '')
    && (record.confirmedFreightId === undefined || typeof record.confirmedFreightId === 'string');
};

function loadRecords(storage: StorageLike | null) {
  if (!storage) {
    throw new FreightCreationIntentSafetyError(
      'storage_unavailable',
      'Nao foi possivel acessar o registro seguro das tentativas. Nenhum novo frete foi enviado. Restaure o armazenamento e tente novamente.',
    );
  }
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    throw new FreightCreationIntentSafetyError(
      'storage_unavailable',
      'Nao foi possivel acessar o registro seguro das tentativas. Nenhum novo frete foi enviado. Restaure o armazenamento e tente novamente.',
    );
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
      throw new Error('invalid intent ledger');
    }
    return parsed;
  } catch (error) {
    throw new FreightCreationIntentSafetyError(
      'storage_corrupted',
      'O registro das tentativas anteriores esta indisponivel ou corrompido. Nenhum novo frete foi enviado; reconcilie as pendencias antes de continuar.',
    );
  }
}

function saveRecords(storage: StorageLike | null, records: FreightCreationRequestState[]) {
  if (!storage) {
    throw new FreightCreationIntentSafetyError(
      'storage_unavailable',
      'Nao foi possivel acessar o registro seguro das tentativas. Nenhum novo frete foi enviado. Restaure o armazenamento e tente novamente.',
    );
  }
  if (records.length > MAX_PENDING) {
    throw new FreightCreationIntentSafetyError(
      'capacity_requires_reconciliation',
      'Existem oito tentativas pendentes. Reconcilie ou conclua uma delas antes de criar outro frete; nenhuma pendencia foi descartada.',
    );
  }
  try {
    if (records.length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    throw new FreightCreationIntentSafetyError(
      'storage_write_failed',
      'Nao foi possivel preservar a identidade desta tentativa. Nenhum novo frete foi enviado. Libere o armazenamento e tente novamente.',
    );
  }
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
  const records = loadRecords(storage);
  const currentPersisted = ref.current
    ? records.find((record) =>
        record.clientRequestId === ref.current?.clientRequestId
        && record.scopeHash === ref.current.scopeHash
        && record.fingerprint === ref.current.fingerprint)
    : undefined;
  if (ref.current && !currentPersisted) {
    throw new FreightCreationIntentSafetyError(
      'storage_corrupted',
      'A identidade desta tentativa nao esta mais no registro persistente. Nenhum novo frete foi enviado; reconcilie a pendencia antes de continuar.',
    );
  }
  if (ref.current?.fingerprint === fingerprint && ref.current.scopeHash === scopeHash) {
    const persisted = currentPersisted!;
    if (persisted.expiresAt > now) {
      ref.current = persisted;
      return persisted;
    }
    const retained = {
      ...persisted,
      retentionState: 'expired_requires_reconciliation' as const,
    };
    saveRecords(storage, records.map((record) =>
      record.clientRequestId === retained.clientRequestId && record.scopeHash === retained.scopeHash
        ? retained
        : record));
    ref.current = retained;
    return retained;
  }
  const existing = records.find(
    (record) => record.fingerprint === fingerprint && record.scopeHash === scopeHash,
  );
  if (existing) {
    const retained = existing.expiresAt <= now
      ? { ...existing, retentionState: 'expired_requires_reconciliation' as const }
      : existing;
    if (retained !== existing) {
      saveRecords(storage, records.map((record) =>
        record.clientRequestId === existing.clientRequestId && record.scopeHash === existing.scopeHash
          ? retained
          : record));
    }
    ref.current = retained;
    return retained;
  }
  if (records.length >= MAX_PENDING) {
    throw new FreightCreationIntentSafetyError(
      'capacity_requires_reconciliation',
      'Existem oito tentativas pendentes. Reconcilie ou conclua uma delas antes de criar outro frete; nenhuma pendencia foi descartada.',
    );
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
  const records = loadRecords(storage);
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
  const records = loadRecords(storage).filter((record) =>
    record.clientRequestId !== state.clientRequestId || record.scopeHash !== state.scopeHash);
  saveRecords(storage, records);
  if (ref.current?.clientRequestId === state.clientRequestId) ref.current = null;
}

export function resetFreightCreationRequestsForTesting(): void {
  // O ledger e sempre lido do adapter persistente; nao existe fallback volatil.
}
