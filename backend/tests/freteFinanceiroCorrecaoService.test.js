const test = require('node:test');
const assert = require('node:assert/strict');

const {
  snapshotFinanceiroFrete,
  validarStatusCorrecaoFinanceira,
  prepararCorrecaoFinanceira,
} = require('../services/freteFinanceiroCorrecaoService');

const freteLegado = (over = {}) => ({
  id: 'frete-1',
  status: 'ativo',
  modalidade_calculo: 'tonelada_km',
  toneladas: 5,
  valor_tonelada_km: 245,
  valor_frete: 0,
  km_inicial: 1,
  km_final: null,
  ...over,
});

test('snapshot financeiro inclui somente campos financeiros/operacionais permitidos', () => {
  const snap = snapshotFinanceiroFrete({ ...freteLegado(), token: 'segredo', origem: 'A' });
  assert.deepEqual(Object.keys(snap).sort(), [
    'km_final',
    'km_inicial',
    'modalidade_calculo',
    'status',
    'toneladas',
    'valor_frete',
    'valor_tonelada_km',
  ].sort());
  assert.equal(snap.token, undefined);
});

test('status operacional permite correcao e status historico trava', () => {
  assert.equal(validarStatusCorrecaoFinanceira('ativo').ok, true);
  assert.equal(validarStatusCorrecaoFinanceira('pendente').ok, true);
  assert.equal(validarStatusCorrecaoFinanceira('cancelado').error, 'frete_financial_correction_status_locked');
  assert.equal(validarStatusCorrecaoFinanceira('finalizado').error, 'frete_financial_correction_status_locked');
});

test('correcao tonelada/km valida deriva valor_frete pela formula canonica', () => {
  const r = prepararCorrecaoFinanceira({
    freteAtual: freteLegado(),
    campos: { valor_tonelada_km: 0.245, km_final: 800 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.patch.valor_tonelada_km, 0.245);
  assert.equal(r.patch.km_final, 800);
  assert.equal(r.patch.valor_frete, 978.78);
  assert.equal(r.before_snapshot.valor_tonelada_km, 245);
  assert.equal(r.after_preview.valor_tonelada_km, 0.245);
});

test('valor_tonelada_km acima do limite recusa sem patch', () => {
  const r = prepararCorrecaoFinanceira({
    freteAtual: freteLegado({ valor_tonelada_km: 0.2 }),
    campos: { valor_tonelada_km: 245 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'frete_operational_limit');
  assert.equal(r.field, 'valor_tonelada_km');
  assert.equal(r.max_value, 10);
});

test('valor_frete manual em tonelada/km e campo arbitrario sao recusados', () => {
  assert.equal(
    prepararCorrecaoFinanceira({ freteAtual: freteLegado(), campos: { valor_frete: 123 } }).error,
    'frete_financial_correction_value_is_derived',
  );
  assert.equal(
    prepararCorrecaoFinanceira({ freteAtual: freteLegado(), campos: { placa: 'ABC1234' } }).error,
    'frete_financial_correction_field_not_allowed',
  );
});

test('valor_fixo limpa campos de tonelada/km e exige valor_frete valido', () => {
  const r = prepararCorrecaoFinanceira({
    freteAtual: freteLegado(),
    campos: { modalidade_calculo: 'valor_fixo', valor_frete: 250 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.patch.modalidade_calculo, 'valor_fixo');
  assert.equal(r.patch.valor_frete, 250);
  assert.equal(r.patch.toneladas, null);
  assert.equal(r.patch.valor_tonelada_km, null);
});
