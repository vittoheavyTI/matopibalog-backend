export type FreteFinancialCorrectionIntent = {
  freteId: string;
  fields: Record<string, unknown>;
  reason: string;
};

export type FreteFinancialCorrectionRequestState = {
  fingerprint: string;
  requestId: string;
};

const stableFields = (fields: Record<string, unknown>) =>
  Object.keys(fields)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = fields[key];
      return acc;
    }, {});

export function fingerprintFreteFinancialCorrection(intent: FreteFinancialCorrectionIntent): string {
  return JSON.stringify({
    freteId: intent.freteId,
    reason: intent.reason.trim(),
    fields: stableFields(intent.fields),
  });
}

export function obterRequestIdFreteFinancialCorrection(
  ref: { current: FreteFinancialCorrectionRequestState | null },
  intent: FreteFinancialCorrectionIntent,
  createRequestId: () => string,
): string {
  const fingerprint = fingerprintFreteFinancialCorrection(intent);
  if (ref.current?.fingerprint === fingerprint) return ref.current.requestId;
  const requestId = createRequestId();
  ref.current = { fingerprint, requestId };
  return requestId;
}

export function limparRequestIdFreteFinancialCorrection(
  ref: { current: FreteFinancialCorrectionRequestState | null },
) {
  ref.current = null;
}
