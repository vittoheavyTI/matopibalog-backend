export type FreightCreationRequestState = {
  clientRequestId: string;
  fingerprint: string;
};

type MutableRef<T> = { current: T };

// Mantém a intenção somente na memória da aba. Isso permite fechar e reabrir o
// modal (ou remontar a rota SPA) depois de uma resposta perdida sem gravar rota,
// valor ou identificadores operacionais em local/sessionStorage.
let pendingSessionRequest: FreightCreationRequestState | null = null;

const stableFingerprint = (payload: Record<string, unknown>): string => JSON.stringify(
  Object.keys(payload).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = payload[key];
    return acc;
  }, {}),
);

export function getFreightCreationRequestId(
  ref: MutableRef<FreightCreationRequestState | null>,
  payload: Record<string, unknown>,
  newId: () => string,
): string {
  const fingerprint = stableFingerprint(payload);
  if (!ref.current && pendingSessionRequest?.fingerprint === fingerprint) {
    ref.current = pendingSessionRequest;
  }
  if (ref.current?.fingerprint === fingerprint) return ref.current.clientRequestId;
  const clientRequestId = newId();
  ref.current = { clientRequestId, fingerprint };
  pendingSessionRequest = ref.current;
  return clientRequestId;
}

export function clearFreightCreationRequest(
  ref: MutableRef<FreightCreationRequestState | null>,
): void {
  ref.current = null;
  pendingSessionRequest = null;
}
