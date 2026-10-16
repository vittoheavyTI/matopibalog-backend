export type FreightCreationRequestState = {
  clientRequestId: string;
  fingerprint: string;
};

type MutableRef<T> = { current: T };

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
  if (ref.current?.fingerprint === fingerprint) return ref.current.clientRequestId;
  const clientRequestId = newId();
  ref.current = { clientRequestId, fingerprint };
  return clientRequestId;
}

export function clearFreightCreationRequest(
  ref: MutableRef<FreightCreationRequestState | null>,
): void {
  ref.current = null;
}
