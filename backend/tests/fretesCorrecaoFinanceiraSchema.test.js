const test = require('node:test');
const assert = require('node:assert/strict');
const { correcaoFinanceiraFreteSchema } = require('../schemas/fretes');

test('schema publico da correcao financeira rejeita correction_type do cliente', () => {
  const result = correcaoFinanceiraFreteSchema.safeParse({
    fields: { valor_tonelada_km: 0.245 },
    reason: 'correcao financeira legado auditada',
    request_id: 'req-schema-1',
    correction_type: 'manual_legacy_financial_correction',
  });

  assert.equal(result.success, false);
  assert.equal(result.error.issues.some((issue) => issue.path.length === 0 && issue.code === 'unrecognized_keys'), true);
});
