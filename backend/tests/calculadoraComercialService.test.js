// MEGA-FRENTE Billing Comercial Avançado — FASE 2/3.
// Prova o cálculo comercial (base + capacidade inclusa + extra) e a recomendação
// de plano mais barato, com os 7 cenários do prompt + bordas.
//
// Toda a conta é conferida em CENTAVOS INTEIROS (total_centavos): 299,90 + 2×100
// dá 499,70000... em float, mas 49990 exato em centavos.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularCustoPlano,
  recomendarPlano,
  montarSnapshotComercial,
  LIMITE_NEGOCIACAO_PADRAO,
} = require('../services/calculadoraComercialService');

// ─── Catálogo comercial de referência (fixtures — NÃO é o catálogo de produção) ─
// Números da decisão comercial inicial do prompt. Vivem aqui como fixture; em
// produção virão da tabela `planos` com os campos novos.
const START = { id: 'start', nome: 'Empresa Start', categoria: 'empresa', preco_mensal: 299.90, capacidade_inclusa: 5, preco_motorista_extra: 100 };
const ESSENCIAL = { id: 'essencial', nome: 'Empresa Essencial', categoria: 'empresa', preco_mensal: 499.90, capacidade_inclusa: 10, preco_motorista_extra: 90 };
const GROWTH = { id: 'growth', nome: 'Empresa Growth', categoria: 'empresa', preco_mensal: 799.90, capacidade_inclusa: 20, preco_motorista_extra: 80 };
const SCALE = { id: 'scale', nome: 'Empresa Scale', categoria: 'empresa', preco_mensal: 1199.90, capacidade_inclusa: 40, preco_motorista_extra: 70 };
const EMPRESA_CATALOGO = [START, ESSENCIAL, GROWTH, SCALE];

const SOLO = { id: 'solo', nome: 'Autônomo Solo', categoria: 'autonomo', preco_mensal: 99.90, capacidade_inclusa: 1, preco_motorista_extra: null };
const ADMIN = { id: 'admin', nome: 'Autônomo + Admin', categoria: 'autonomo', preco_mensal: 149.90, capacidade_inclusa: 2, preco_motorista_extra: null };

// ── Cenário 1: 5 caminhões no Start → cabe na base, sem extras ──────────────
test('5 caminhões no Start: só a base, sem extras', () => {
  const c = calcularCustoPlano({ plano: START, quantidade: 5 });
  assert.equal(c.ok, true);
  assert.equal(c.acomoda, true);
  assert.equal(c.extras_qtd, 0);
  assert.equal(c.total_centavos, 29990);
  assert.equal(c.total, 299.90);
});

// ── Cenário 2: 7 caminhões — Start (com extras) vs Essencial (base) ─────────
test('7 caminhões: Start com 2 extras empata com Essencial (R$ 499,90)', () => {
  const start7 = calcularCustoPlano({ plano: START, quantidade: 7 });
  assert.equal(start7.extras_qtd, 2);
  assert.equal(start7.total_centavos, 49990); // 29990 + 2*10000
  const essencial7 = calcularCustoPlano({ plano: ESSENCIAL, quantidade: 7 });
  assert.equal(essencial7.extras_qtd, 0);
  assert.equal(essencial7.total_centavos, 49990);

  const rec = recomendarPlano({ planos: EMPRESA_CATALOGO, quantidade: 7, planoAtualId: 'start' });
  assert.equal(rec.valorComExtras, 499.90);
  // Empate em preço → desempata pela maior capacidade inclusa (Essencial).
  assert.equal(rec.planoRecomendado, 'essencial');
  assert.equal(rec.economia, 0);
  assert.equal(rec.empate, true);
});

// ── Cenário 3: 10 caminhões no Essencial → cabe na base ─────────────────────
test('10 caminhões no Essencial: só a base', () => {
  const c = calcularCustoPlano({ plano: ESSENCIAL, quantidade: 10 });
  assert.equal(c.acomoda, true);
  assert.equal(c.extras_qtd, 0);
  assert.equal(c.total_centavos, 49990);
});

// ── Cenário 4: 15 caminhões — Essencial (com extras) vs Growth (base) ───────
test('15 caminhões: Growth (R$ 799,90) é mais barato que Essencial+5 extras (R$ 949,90)', () => {
  const essencial15 = calcularCustoPlano({ plano: ESSENCIAL, quantidade: 15 });
  assert.equal(essencial15.extras_qtd, 5);
  assert.equal(essencial15.total_centavos, 94990); // 49990 + 5*9000
  const growth15 = calcularCustoPlano({ plano: GROWTH, quantidade: 15 });
  assert.equal(growth15.extras_qtd, 0);
  assert.equal(growth15.total_centavos, 79990);

  const rec = recomendarPlano({ planos: EMPRESA_CATALOGO, quantidade: 15, planoAtualId: 'essencial' });
  assert.equal(rec.valorComExtras, 949.90);
  assert.equal(rec.planoRecomendado, 'growth');
  assert.equal(rec.valorPlanoRecomendado, 799.90);
  assert.equal(rec.economia, 150.00);
  assert.equal(rec.empate, false);
});

// ── Cenário 5: 25 caminhões — Growth (com extras) vs Scale (base) ───────────
test('25 caminhões: Growth+5 extras (R$ 1.199,90) empata com Scale (base)', () => {
  const growth25 = calcularCustoPlano({ plano: GROWTH, quantidade: 25 });
  assert.equal(growth25.extras_qtd, 5);
  assert.equal(growth25.total_centavos, 119990); // 79990 + 5*8000
  const scale25 = calcularCustoPlano({ plano: SCALE, quantidade: 25 });
  assert.equal(scale25.extras_qtd, 0);
  assert.equal(scale25.total_centavos, 119990);

  const rec = recomendarPlano({ planos: EMPRESA_CATALOGO, quantidade: 25, planoAtualId: 'growth' });
  assert.equal(rec.economia, 0);
  assert.equal(rec.empate, true);
  // Empate → Scale (maior capacidade inclusa).
  assert.equal(rec.planoRecomendado, 'scale');
});

// ── Cenário 6: 41 caminhões → sob negociação ────────────────────────────────
test('41 caminhões: acima do teto → requer negociação, sem preço de tabela', () => {
  const c = calcularCustoPlano({ plano: SCALE, quantidade: 41 });
  assert.equal(c.requer_negociacao, true);
  assert.equal(c.acomoda, false);
  assert.equal(c.total, null);

  const rec = recomendarPlano({ planos: EMPRESA_CATALOGO, quantidade: 41, planoAtualId: 'scale' });
  assert.equal(rec.requerNegociacao, true);
  assert.equal(rec.planoRecomendado, null);
  assert.equal(rec.valorPlanoRecomendado, null);
  assert.match(rec.mensagem, /sob proposta/i);
});

// ── Cenário 7: autônomo sem extra ───────────────────────────────────────────
test('autônomo Solo: 1 cabe na base; 2 não acomoda (sem extra)', () => {
  const solo1 = calcularCustoPlano({ plano: SOLO, quantidade: 1 });
  assert.equal(solo1.acomoda, true);
  assert.equal(solo1.total_centavos, 9990);

  const solo2 = calcularCustoPlano({ plano: SOLO, quantidade: 2 });
  assert.equal(solo2.acomoda, false);
  assert.equal(solo2.requer_negociacao, false);
  assert.equal(solo2.motivo, 'excede_capacidade_sem_extra');
  assert.equal(solo2.total, null);

  const admin2 = calcularCustoPlano({ plano: ADMIN, quantidade: 2 });
  assert.equal(admin2.acomoda, true);
  assert.equal(admin2.total_centavos, 14990);
});

// ── Bordas / robustez ───────────────────────────────────────────────────────
test('quantidade inválida (0, negativa, decimal, string) é recusada', () => {
  for (const q of [0, -1, 2.5, '7', null, undefined]) {
    const c = calcularCustoPlano({ plano: START, quantidade: q });
    assert.equal(c.ok, false, `quantidade ${q} deveria falhar`);
    assert.equal(c.motivo, 'quantidade_invalida');
  }
});

test('preço base com 3 casas decimais é recusado (não arredonda)', () => {
  const c = calcularCustoPlano({ plano: { ...START, preco_mensal: 299.905 }, quantidade: 5 });
  assert.equal(c.ok, false);
  assert.equal(c.motivo, 'base_invalida');
});

test('preço de extra com 3 casas decimais é recusado', () => {
  const c = calcularCustoPlano({ plano: { ...START, preco_motorista_extra: 100.001 }, quantidade: 7 });
  assert.equal(c.ok, false);
  assert.equal(c.motivo, 'extra_invalido');
});

test('capacidade_inclusa ausente cai para limite_motoristas (compat legado)', () => {
  const legado = { id: 'legado', nome: 'Legado', preco_mensal: 149.90, limite_motoristas: 10, preco_motorista_extra: null };
  const dentro = calcularCustoPlano({ plano: legado, quantidade: 10 });
  assert.equal(dentro.acomoda, true);
  assert.equal(dentro.capacidade_inclusa, 10);
  const fora = calcularCustoPlano({ plano: legado, quantidade: 11 });
  assert.equal(fora.acomoda, false);
  assert.equal(fora.motivo, 'excede_capacidade_sem_extra');
});

test('teto de negociação é 40 por padrão e sobrescrevível por plano', () => {
  assert.equal(LIMITE_NEGOCIACAO_PADRAO, 40);
  const c40 = calcularCustoPlano({ plano: SCALE, quantidade: 40 });
  assert.equal(c40.acomoda, true); // 40 ainda cabe
  // plano com teto próprio menor
  const capado = { ...GROWTH, limite_negociacao: 22 };
  const c23 = calcularCustoPlano({ plano: capado, quantidade: 23 });
  assert.equal(c23.requer_negociacao, true);
});

test('recomendarPlano: plano atual já é o mais econômico (12 no Growth)', () => {
  // 12: Essencial+2 = 49990+18000=67990 (679,90); Growth base = 79990 (799,90).
  // Essencial é o mais barato → se o atual já for Essencial, ele se mantém.
  const rec = recomendarPlano({ planos: EMPRESA_CATALOGO, quantidade: 12, planoAtualId: 'essencial' });
  assert.equal(rec.planoRecomendado, 'essencial');
  assert.equal(rec.valorComExtras, 679.90);
  assert.equal(rec.economia, 0);
  assert.match(rec.mensagem, /mais econômica/i);
});

test('montarSnapshotComercial congela composição comercial', () => {
  const snap = montarSnapshotComercial({ plano: START, quantidade: 7, planoRecomendadoId: 'essencial' });
  assert.equal(snap.ok, true);
  assert.equal(snap.snapshot.capacidade_contratada_snapshot, 7);
  assert.equal(snap.snapshot.capacidade_inclusa_snapshot, 5);
  assert.equal(snap.snapshot.extras_qtd_snapshot, 2);
  assert.equal(snap.snapshot.extra_unitario_snapshot, 100);
  assert.equal(snap.snapshot.requer_negociacao_snapshot, false);
  assert.equal(snap.snapshot.plano_recomendado_id_snapshot, 'essencial');
});
