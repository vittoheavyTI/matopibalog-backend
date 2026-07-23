// Frente #4 (Billing v2) — PR 2: regras puras de precificação de plano.
// Prova:
//   1. 'fixo' devolve o valor digitado — REGRESSÃO: o catálogo atual não muda;
//   2. 'por_motorista' multiplica em centavos inteiros, sem erro de float
//      (149,90 × 3 = 449,70 exato — em float dá 449.70000000000005);
//   3. unitário <= 0, não-numérico ou com 3 casas decimais → recusado;
//   4. quantidade null/0/negativa/decimal/string → recusada;
//   5. quantidade 999 → recusada com a mensagem ESPECÍFICA da sentinela;
//   6. quantidade acima de 200 e valor final acima de R$ 500.000 → recusados;
//   7. modelo inválido → 422;
//   8. preco_mensal enviado pelo cliente é IGNORADO em por_motorista;
//   9. resolverPrecificacao zera preco_por_motorista em 'fixo'.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularPrecoFinal,
  resolverPrecificacao,
  SENTINELA_ILIMITADO,
  LIMITE_MOTORISTAS_MAX,
  VALOR_FINAL_MAX,
  montarImpactoPreco,
} = require('../services/planoPrecoService');

// Atalhos de leitura.
const fixo = (preco_mensal, extra = {}) =>
  calcularPrecoFinal({ modelo_cobranca: 'fixo', preco_mensal, ...extra });

const porMotorista = (preco_por_motorista, limite_motoristas, extra = {}) =>
  calcularPrecoFinal({
    modelo_cobranca: 'por_motorista',
    preco_por_motorista,
    limite_motoristas,
    ...extra,
  });

// ─── 1. Modelo 'fixo' — o catálogo de hoje não pode mudar ────────────────────

test('fixo devolve exatamente o valor digitado', () => {
  const r = fixo(149.9);
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, 149.9);
  assert.equal(r.centavos, 14990);
  assert.equal(r.modelo_cobranca, 'fixo');
});

test('fixo aceita preço 0 (plano gratuito)', () => {
  const r = fixo(0);
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, 0);
  assert.equal(r.centavos, 0);
});

test('fixo ignora preco_por_motorista e devolve unitário nulo', () => {
  const r = fixo(199.9, { preco_por_motorista: 50, limite_motoristas: 999 });
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, 199.9);
  assert.equal(r.preco_por_motorista, null);
});

test('fixo recusa preço negativo', () => {
  const r = fixo(-1);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'preco_mensal');
  assert.equal(r.motivo, 'negativo');
});

test('fixo recusa preço com 3 casas decimais em vez de arredondar', () => {
  const r = fixo(100.005);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'mais_de_2_casas');
});

test('REGRESSÃO: os 5 planos reais de produção devolvem o mesmo preco_mensal', () => {
  // Snapshot de produção validado em 2026-07-16 (migration 029, V4/V5 = 0
  // divergências). Se algum destes mudar, o catálogo real muda junto.
  const catalogo = [
    { nome: 'Free Teste', preco: 0.0, centavos: 0 },
    { nome: 'Plano Básico', preco: 149.9, centavos: 14990 },
    { nome: 'Plano Básico Autônomo', preco: 149.99, centavos: 14999 },
    { nome: 'Plano Enterprise', preco: 199.9, centavos: 19990 },
    { nome: 'Plano Profissional', preco: 149.99, centavos: 14999 },
  ];
  for (const p of catalogo) {
    const r = fixo(p.preco);
    assert.equal(r.ok, true, `${p.nome} deveria ser válido`);
    assert.equal(r.preco_mensal, p.preco, `${p.nome}: preco_mensal mudou`);
    assert.equal(r.centavos, p.centavos, `${p.nome}: centavos divergiram`);
  }
});

// ─── 2. Modelo 'por_motorista' — a conta, em centavos ────────────────────────

test('por_motorista: 100,00 × 10 = 1.000,00 (o caso do relato)', () => {
  const r = porMotorista(100, 10);
  assert.equal(r.ok, true);
  assert.equal(r.centavos, 100000);
  assert.equal(r.preco_mensal, 1000.0);
  assert.equal(r.preco_por_motorista, 100);
  assert.equal(r.limite_motoristas, 10);
});

test('por_motorista: 99,90 × 10 = 999,00 exato', () => {
  const r = porMotorista(99.9, 10);
  assert.equal(r.ok, true);
  assert.equal(r.centavos, 99900);
  assert.equal(r.preco_mensal, 999.0);
});

test('por_motorista: 149,90 × 3 = 449,70 — ARMADILHA REAL do float', () => {
  // Esta é a prova de que a conta em centavos não é preciosismo: o float erra
  // AQUI, e 149,90 é o preço real do Plano Básico em produção.
  assert.notEqual(149.9 * 3, 449.7); // float dá 449.70000000000005
  const r = porMotorista(149.9, 3);
  assert.equal(r.ok, true);
  assert.equal(r.centavos, 44970);
  assert.equal(r.preco_mensal, 449.7);
});

test('a conta em centavos bate com a exata em TODA a faixa suportada', () => {
  // Varredura: unitário de R$ 0,01 a R$ 200,00 × quantidade de 2 a 20.
  // O float diverge em ~21% desses casos; centavos inteiros, em nenhum.
  let divergencias = 0;
  for (let c = 1; c <= 20000; c++) {
    for (let q = 2; q <= 20; q++) {
      const r = porMotorista(c / 100, q);
      if (!r.ok || r.centavos !== c * q) divergencias++;
    }
  }
  assert.equal(divergencias, 0);
});

test('por_motorista: 149,99 × 7 = 1.049,93 exato', () => {
  const r = porMotorista(149.99, 7);
  assert.equal(r.ok, true);
  assert.equal(r.centavos, 104993);
  assert.equal(r.preco_mensal, 1049.93);
});

test('por_motorista: 0,01 × 3 = 0,03 (centavo não se perde)', () => {
  const r = porMotorista(0.01, 3);
  assert.equal(r.ok, true);
  assert.equal(r.centavos, 3);
  assert.equal(r.preco_mensal, 0.03);
});

test('por_motorista IGNORA o preco_mensal enviado pelo cliente', () => {
  // O frontend manda 100 tentando fixar o valor; o backend recalcula 1.000,00.
  const r = porMotorista(100, 10, { preco_mensal: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, 1000.0);
});

// ─── 3. Unitário inválido ────────────────────────────────────────────────────

test('por_motorista recusa unitário zero', () => {
  const r = porMotorista(0, 10);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'preco_por_motorista');
  assert.equal(r.motivo, 'nao_positivo');
});

test('por_motorista recusa unitário negativo', () => {
  const r = porMotorista(-5, 10);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'nao_positivo');
});

test('por_motorista recusa unitário ausente, NaN ou lixo', () => {
  for (const valor of [undefined, null, '', NaN, 'abc', {}, [], true]) {
    const r = porMotorista(valor, 10);
    assert.equal(r.ok, false, `unitário ${JSON.stringify(valor)} deveria ser recusado`);
    assert.equal(r.campo, 'preco_por_motorista');
  }
});

test('por_motorista recusa unitário com 3 casas decimais', () => {
  const r = porMotorista(100.005, 10);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'mais_de_2_casas');
});

// ─── 4. Quantidade inválida ──────────────────────────────────────────────────

test('por_motorista recusa quantidade nula (ilimitado)', () => {
  const r = porMotorista(100, null);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'limite_motoristas');
  assert.equal(r.motivo, 'ilimitado');
});

test('por_motorista recusa quantidade ausente', () => {
  const r = porMotorista(100, undefined);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ilimitado');
});

test('por_motorista recusa quantidade 0 e negativa', () => {
  for (const limite of [0, -1]) {
    const r = porMotorista(100, limite);
    assert.equal(r.ok, false, `limite ${limite} deveria ser recusado`);
    assert.equal(r.motivo, 'menor_que_um');
  }
});

test('por_motorista recusa quantidade decimal', () => {
  const r = porMotorista(100, 1.5);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'nao_inteiro');
});

test('por_motorista recusa quantidade em string (caller não normalizou)', () => {
  const r = porMotorista(100, '10');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'nao_inteiro');
});

// ─── 5. Sentinela 999 — mensagem específica ──────────────────────────────────

test('por_motorista recusa a sentinela 999 com mensagem própria', () => {
  const r = porMotorista(100, SENTINELA_ILIMITADO);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'limite_motoristas');
  assert.equal(r.motivo, 'sentinela_999');
  assert.equal(
    r.message,
    '999 é reservado como sentinela de ilimitado; planos por motorista exigem quantidade finita.'
  );
});

test('a sentinela 999 é pega ANTES do teto de 200 (mensagem certa, não genérica)', () => {
  // 999 > 200: sem a ordem correta, cairia em 'acima_do_teto' e a mensagem
  // explicaria o problema errado.
  const r = porMotorista(100, 999);
  assert.equal(r.motivo, 'sentinela_999');
  assert.notEqual(r.motivo, 'acima_do_teto');
});

test('o Plano Enterprise real (999) não pode virar por_motorista', () => {
  const r = calcularPrecoFinal({
    modelo_cobranca: 'por_motorista',
    preco_por_motorista: 100,
    limite_motoristas: 999, // valor real em produção
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sentinela_999');
});

// ─── 6. Tetos ────────────────────────────────────────────────────────────────

test('por_motorista aceita exatamente o teto de 200 motoristas', () => {
  const r = porMotorista(1, LIMITE_MOTORISTAS_MAX);
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, 200);
});

test('por_motorista recusa 201 motoristas', () => {
  const r = porMotorista(100, 201);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'limite_motoristas');
  assert.equal(r.motivo, 'acima_do_teto');
});

test('recusa valor final acima de R$ 500.000,00', () => {
  // 5.000,00 × 101 = 505.000,00 → acima do teto (quantidade dentro de 200).
  const r = porMotorista(5000, 101);
  assert.equal(r.ok, false);
  assert.equal(r.campo, 'preco_mensal');
  assert.equal(r.motivo, 'valor_final_acima_do_teto');
});

test('aceita valor final exatamente no teto de R$ 500.000,00', () => {
  const r = porMotorista(5000, 100);
  assert.equal(r.ok, true);
  assert.equal(r.preco_mensal, VALOR_FINAL_MAX);
});

test('fixo também respeita o teto de valor final', () => {
  const acima = fixo(500000.01);
  assert.equal(acima.ok, false);
  assert.equal(acima.motivo, 'valor_final_acima_do_teto');

  const noTeto = fixo(500000);
  assert.equal(noTeto.ok, true);
});

// ─── 7. Modelo ───────────────────────────────────────────────────────────────

test('modelo inválido é recusado', () => {
  // 'POR_MOTORISTA' entra aqui de propósito: o CHECK do banco é case-sensitive
  // ('fixo'|'por_motorista'), então aceitar maiúsculas aqui só empurraria o erro
  // para um 23514 feio lá na frente.
  for (const modelo of ['xyz', 'POR_MOTORISTA', 'por motorista', 0, true, {}]) {
    const r = calcularPrecoFinal({ modelo_cobranca: modelo, preco_mensal: 100 });
    assert.equal(r.ok, false, `modelo ${JSON.stringify(modelo)} deveria ser recusado`);
    assert.equal(r.campo, 'modelo_cobranca');
    assert.equal(r.motivo, 'modelo_invalido');
  }
});

test('modelo com espaço em volta é aceito (trim intencional)', () => {
  const r = calcularPrecoFinal({ modelo_cobranca: '  fixo  ', preco_mensal: 149.9 });
  assert.equal(r.ok, true);
  assert.equal(r.modelo_cobranca, 'fixo');
});

test('modelo ausente resolve como fixo (payload atual do painel segue funcionando)', () => {
  for (const modelo of [undefined, null, '']) {
    const r = calcularPrecoFinal({ modelo_cobranca: modelo, preco_mensal: 149.9 });
    assert.equal(r.ok, true, `modelo ${JSON.stringify(modelo)} deveria resolver como fixo`);
    assert.equal(r.modelo_cobranca, 'fixo');
    assert.equal(r.preco_mensal, 149.9);
  }
});

test('plano ausente/vazio não explode', () => {
  assert.equal(calcularPrecoFinal(undefined).ok, false);
  assert.equal(calcularPrecoFinal({}).ok, false);
});

// ─── 8. resolverPrecificacao — contrato para o PR 3 ──────────────────────────

test('resolverPrecificacao devolve patch com unitário NULO em fixo', () => {
  const r = resolverPrecificacao({
    modelo_cobranca: 'fixo',
    preco_mensal: 149.9,
    preco_por_motorista: 50, // unitário fantasma de um por_motorista anterior
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    modelo_cobranca: 'fixo',
    preco_mensal: 149.9,
    preco_por_motorista: null,
  });
});

test('resolverPrecificacao devolve patch com preco_mensal derivado em por_motorista', () => {
  const r = resolverPrecificacao({
    modelo_cobranca: 'por_motorista',
    preco_mensal: 1, // mentira do cliente
    preco_por_motorista: 100,
    limite_motoristas: 10,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    modelo_cobranca: 'por_motorista',
    preco_mensal: 1000,
    preco_por_motorista: 100,
  });
});

test('resolverPrecificacao devolve 422 amigável em erro', () => {
  const r = resolverPrecificacao({
    modelo_cobranca: 'por_motorista',
    preco_por_motorista: 100,
    limite_motoristas: 999,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.body.precoInvalido, true);
  assert.equal(r.body.campo, 'limite_motoristas');
  assert.equal(r.body.motivo, 'sentinela_999');
  assert.match(r.body.message, /sentinela de ilimitado/);
  assert.equal(r.patch, undefined);
});

// ─── FASE 5 (mega-frente go-live): preview de impacto de reprecificação ──────

test('impacto: plano ausente → 404', () => {
  const r = montarImpactoPreco({ planoAtual: null, novo: { preco_mensal: 200 } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('impacto: sem campos de preço → impacto zero (preço não muda)', () => {
  const planoAtual = { id: 'p1', nome: 'Básico', preco_mensal: 149.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5 };
  const r = montarImpactoPreco({ planoAtual, novo: {}, empresas_afetadas: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.impacto.preco_atual, 149.9);
  assert.equal(r.impacto.preco_novo, 149.9);
  assert.equal(r.impacto.mudou_preco, false);
  assert.equal(r.impacto.empresas_afetadas, 3);
  assert.match(r.impacto.aviso_snapshot, /NÃO mudam/);
});

test('impacto: fixo novo_preco muda o valor e marca mudou_preco', () => {
  const planoAtual = { id: 'p1', nome: 'Básico', preco_mensal: 149.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5 };
  const r = montarImpactoPreco({ planoAtual, novo: { preco_mensal: '299.90' }, empresas_afetadas: 2, faturas_abertas: 1, proximas_recorrencias: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.impacto.preco_novo, 299.9);
  assert.equal(r.impacto.mudou_preco, true);
  assert.equal(r.impacto.faturas_abertas, 1);
  assert.equal(r.impacto.proximas_recorrencias, 2);
});

test('impacto: mudar para por_motorista deriva unitário × quantidade', () => {
  const planoAtual = { id: 'p1', nome: 'Profissional', preco_mensal: 149.99, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5 };
  const r = montarImpactoPreco({ planoAtual, novo: { modelo_cobranca: 'por_motorista', preco_por_motorista: '100.00', novo_limite: undefined } });
  // limite_motoristas herda do plano atual (5) → 100 × 5 = 500
  assert.equal(r.ok, true);
  assert.equal(r.impacto.modelo_novo, 'por_motorista');
  assert.equal(r.impacto.preco_novo, 500);
  assert.equal(r.impacto.preco_por_motorista_novo, 100);
});

test('impacto: preço novo inválido (3 casas) → 422 propagado', () => {
  const planoAtual = { id: 'p1', nome: 'Básico', preco_mensal: 149.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5 };
  const r = montarImpactoPreco({ planoAtual, novo: { preco_mensal: '149.999' } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.body.campo, 'preco_mensal');
});
