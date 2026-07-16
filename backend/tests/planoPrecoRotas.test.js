// Frente #4 (Billing v2) — PR 3: ligação do planoPrecoService às rotas de planos.
// Cobre a DECISÃO (pura) que POST/PUT /painel-admin/planos consomem. A rota só
// faz as duas leituras (plano atual, contagem de empresas) e devolve o que estas
// funções mandam — não há lógica de dinheiro fora daqui.
//
// Prova:
//   1. POST sem modelo_cobranca → fixo, comportamento de hoje preservado;
//   2. POST por_motorista calcula o final e ignora preco_mensal mentiroso;
//   3. POST recusa 999 / null / 0 / 201;
//   4. PUT recalcula ao mexer em quantidade OU unitário — a armadilha do merge;
//   5. PUT que só renomeia, arquiva ou inativa NÃO recalcula (frente #6 intacta);
//   6. ja_utilizado + preço mudou → 'confirmar' (409); com a flag → aplica;
//   7. preço igual não exige confirmação (renomear é de graça);
//   8. por_motorista → fixo zera o unitário; fixo → por_motorista exige composição.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bodyTocaPreco,
  mesmoPreco,
  mesclarParaPrecificacao,
  montarErroReprecificacao,
  resolverCriacaoPreco,
  decidirEdicaoPreco,
  LIMITE_MOTORISTAS_PADRAO,
} = require('../services/planoPrecoService');

// Planos como o banco realmente devolve (snapshot de produção 2026-07-16).
const PLANO_BASICO = {
  id: '00000000-0000-0000-0000-000000000002',
  preco_mensal: 149.9,
  preco_por_motorista: null,
  limite_motoristas: 1,
  modelo_cobranca: 'fixo',
  ja_utilizado: true,
};

const PLANO_NOVO_NAO_USADO = {
  id: 'plano-novo',
  preco_mensal: 100,
  preco_por_motorista: null,
  limite_motoristas: 5,
  modelo_cobranca: 'fixo',
  ja_utilizado: false,
};

const PLANO_POR_MOTORISTA = {
  id: 'plano-pm',
  preco_mensal: 1000,
  preco_por_motorista: 100,
  limite_motoristas: 10,
  modelo_cobranca: 'por_motorista',
  ja_utilizado: false,
};

// ─── 1. POST — plano novo ────────────────────────────────────────────────────

test('POST sem modelo_cobranca cria plano fixo, como hoje', () => {
  const r = resolverCriacaoPreco({ nome: 'Plano X', preco_mensal: 149.9, limite_motoristas: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    modelo_cobranca: 'fixo',
    preco_mensal: 149.9,
    preco_por_motorista: null,
    limite_motoristas: 10,
  });
});

test('POST preserva o default histórico de limite_motoristas = 5', () => {
  const r = resolverCriacaoPreco({ preco_mensal: 99.9 });
  assert.equal(r.ok, true);
  assert.equal(r.patch.limite_motoristas, LIMITE_MOTORISTAS_PADRAO);
  assert.equal(r.patch.limite_motoristas, 5);
});

test('POST aceita limite_motoristas como string (o body é JSON de formulário)', () => {
  const r = resolverCriacaoPreco({ modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: '10' });
  assert.equal(r.ok, true);
  assert.equal(r.patch.limite_motoristas, 10);
  assert.equal(r.patch.preco_mensal, 1000);
});

test('POST por_motorista calcula o preço final', () => {
  const r = resolverCriacaoPreco({ modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, {
    modelo_cobranca: 'por_motorista',
    preco_mensal: 1000,
    preco_por_motorista: 100,
    limite_motoristas: 10,
  });
});

test('POST por_motorista IGNORA o preco_mensal mentiroso do frontend', () => {
  const r = resolverCriacaoPreco({
    modelo_cobranca: 'por_motorista',
    preco_mensal: 100, // o erro que a frente inteira existe para matar
    preco_por_motorista: 100,
    limite_motoristas: 10,
  });
  assert.equal(r.ok, true);
  assert.equal(r.patch.preco_mensal, 1000);
});

test('POST por_motorista recusa a sentinela 999', () => {
  const r = resolverCriacaoPreco({ modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 999 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.body.motivo, 'sentinela_999');
});

test('POST por_motorista recusa limite null, 0 e 201', () => {
  const casos = [
    { limite: null, motivo: 'ilimitado' },
    { limite: 0, motivo: 'menor_que_um' },
    { limite: 201, motivo: 'acima_do_teto' },
  ];
  for (const c of casos) {
    const r = resolverCriacaoPreco({
      modelo_cobranca: 'por_motorista',
      preco_por_motorista: 100,
      limite_motoristas: c.limite,
    });
    assert.equal(r.ok, false, `limite ${c.limite} deveria ser recusado`);
    assert.equal(r.status, 422);
    assert.equal(r.body.motivo, c.motivo);
  }
});

test('POST recusa valor final acima do teto e modelo inválido', () => {
  const teto = resolverCriacaoPreco({ modelo_cobranca: 'por_motorista', preco_por_motorista: 5000, limite_motoristas: 101 });
  assert.equal(teto.ok, false);
  assert.equal(teto.body.motivo, 'valor_final_acima_do_teto');

  const modelo = resolverCriacaoPreco({ modelo_cobranca: 'xyz', preco_mensal: 100 });
  assert.equal(modelo.ok, false);
  assert.equal(modelo.body.motivo, 'modelo_invalido');
});

test('POST recusa unitário inválido', () => {
  const r = resolverCriacaoPreco({ modelo_cobranca: 'por_motorista', preco_por_motorista: 0, limite_motoristas: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.body.campo, 'preco_por_motorista');
});

// ─── 2. bodyTocaPreco — o gate que preserva a frente #6 ──────────────────────

test('bodyTocaPreco reconhece os 4 campos de precificação', () => {
  assert.equal(bodyTocaPreco({ modelo_cobranca: 'fixo' }), true);
  assert.equal(bodyTocaPreco({ preco_mensal: 1 }), true);
  assert.equal(bodyTocaPreco({ preco_por_motorista: 1 }), true);
  assert.equal(bodyTocaPreco({ limite_motoristas: 1 }), true);
});

test('bodyTocaPreco é falso para nome, descrição, ativo, arquivar e categoria', () => {
  assert.equal(bodyTocaPreco({ nome: 'Outro' }), false);
  assert.equal(bodyTocaPreco({ descricao: 'x' }), false);
  assert.equal(bodyTocaPreco({ ativo: false }), false);
  assert.equal(bodyTocaPreco({ arquivar: true }), false);
  assert.equal(bodyTocaPreco({ categoria: 'empresa' }), false);
  assert.equal(bodyTocaPreco({}), false);
  assert.equal(bodyTocaPreco(undefined), false);
});

// ─── 3. PUT — a armadilha do merge ───────────────────────────────────────────

test('PUT alterando SÓ a quantidade recalcula o preço (a armadilha do merge)', () => {
  // O body traz a quantidade; o unitário só existe no banco. Sem mesclar, o
  // limite mudaria para 20 e o preço continuaria 1.000,00.
  const d = decidirEdicaoPreco({ planoAtual: PLANO_POR_MOTORISTA, body: { limite_motoristas: 20 } });
  assert.equal(d.acao, 'aplicar');
  assert.equal(d.patch.preco_mensal, 2000);
  assert.equal(d.patch.preco_por_motorista, 100);
});

test('PUT alterando SÓ o unitário recalcula o preço', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_POR_MOTORISTA, body: { preco_por_motorista: 150 } });
  assert.equal(d.acao, 'aplicar');
  assert.equal(d.patch.preco_mensal, 1500);
});

test('PUT alterando só o nome NÃO recalcula', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { nome: 'Plano Básico Renomeado' } });
  assert.equal(d.acao, 'ignorar');
  assert.equal(d.patch, undefined);
});

test('PUT arquivar/desarquivar NÃO recalcula (frente #6 intacta)', () => {
  assert.equal(decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { arquivar: true } }).acao, 'ignorar');
  assert.equal(decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { arquivar: false } }).acao, 'ignorar');
});

test('PUT ativar/inativar NÃO recalcula', () => {
  assert.equal(decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { ativo: false } }).acao, 'ignorar');
  assert.equal(decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { ativo: true } }).acao, 'ignorar');
});

test('PUT em plano inexistente que toca preço → 404, não 500', () => {
  const d = decidirEdicaoPreco({ planoAtual: null, body: { preco_mensal: 100 } });
  assert.equal(d.acao, 'erro');
  assert.equal(d.status, 404);
});

test('PUT propaga 422 de precificação inválida', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_POR_MOTORISTA, body: { limite_motoristas: 999 } });
  assert.equal(d.acao, 'erro');
  assert.equal(d.status, 422);
  assert.equal(d.body.motivo, 'sentinela_999');
});

// ─── 4. Troca de modelo ──────────────────────────────────────────────────────

test('PUT por_motorista → fixo zera o unitário', () => {
  const d = decidirEdicaoPreco({
    planoAtual: PLANO_POR_MOTORISTA,
    body: { modelo_cobranca: 'fixo', preco_mensal: 300 },
  });
  assert.equal(d.acao, 'aplicar');
  assert.deepEqual(d.patch, {
    modelo_cobranca: 'fixo',
    preco_mensal: 300,
    preco_por_motorista: null, // sem unitário fantasma esperando ser multiplicado
  });
});

test('PUT fixo → por_motorista exige unitário válido', () => {
  const semUnitario = decidirEdicaoPreco({
    planoAtual: PLANO_NOVO_NAO_USADO,
    body: { modelo_cobranca: 'por_motorista' },
  });
  assert.equal(semUnitario.acao, 'erro');
  assert.equal(semUnitario.body.campo, 'preco_por_motorista');
});

test('PUT fixo → por_motorista exige quantidade finita (não herda 999 do banco)', () => {
  const enterprise = { ...PLANO_NOVO_NAO_USADO, limite_motoristas: 999 };
  const d = decidirEdicaoPreco({
    planoAtual: enterprise,
    body: { modelo_cobranca: 'por_motorista', preco_por_motorista: 100 },
  });
  assert.equal(d.acao, 'erro');
  assert.equal(d.body.motivo, 'sentinela_999');
});

test('PUT fixo → por_motorista com composição válida calcula o final', () => {
  const d = decidirEdicaoPreco({
    planoAtual: PLANO_NOVO_NAO_USADO,
    body: { modelo_cobranca: 'por_motorista', preco_por_motorista: 100, limite_motoristas: 10 },
  });
  assert.equal(d.acao, 'aplicar');
  assert.equal(d.patch.preco_mensal, 1000);
});

// ─── 5. Gate de reprecificação (ja_utilizado) ────────────────────────────────

test('plano ja_utilizado com preço diferente → confirmar (409), sem aplicar', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { preco_mensal: 199.9 } });
  assert.equal(d.acao, 'confirmar');
  assert.equal(d.preco_atual, 149.9);
  assert.equal(d.preco_novo, 199.9);
  assert.equal(d.patch, undefined); // nada é aplicado
});

test('plano ja_utilizado com confirmar_reprecificacao=true aplica', () => {
  const d = decidirEdicaoPreco({
    planoAtual: PLANO_BASICO,
    body: { preco_mensal: 199.9, confirmar_reprecificacao: true },
  });
  assert.equal(d.acao, 'aplicar');
  assert.equal(d.patch.preco_mensal, 199.9);
});

test('preço IGUAL não exige confirmação, mesmo em plano usado', () => {
  // Salvar o formulário sem mexer no valor não pode pedir confirmação.
  const d = decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { preco_mensal: 149.9 } });
  assert.equal(d.acao, 'aplicar');
});

test('preço igual escrito com outra escala (149.90 vs 149.9) não exige confirmação', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_BASICO, body: { preco_mensal: '149.90' } });
  assert.equal(d.acao, 'aplicar');
});

test('plano NÃO usado muda de preço sem confirmação', () => {
  const d = decidirEdicaoPreco({ planoAtual: PLANO_NOVO_NAO_USADO, body: { preco_mensal: 250 } });
  assert.equal(d.acao, 'aplicar');
  assert.equal(d.patch.preco_mensal, 250);
});

test('confirmar_reprecificacao só vale como booleano true', () => {
  for (const valor of ['true', 1, 'sim', {}]) {
    const d = decidirEdicaoPreco({
      planoAtual: PLANO_BASICO,
      body: { preco_mensal: 199.9, confirmar_reprecificacao: valor },
    });
    assert.equal(d.acao, 'confirmar', `confirmar_reprecificacao=${JSON.stringify(valor)} não deveria destravar`);
  }
});

test('montarErroReprecificacao avisa que o Asaas NÃO é atualizado', () => {
  const body = montarErroReprecificacao({ preco_atual: 149.9, preco_novo: 1000, empresas_afetadas: 17 });
  assert.equal(body.reprecificacaoRequerConfirmacao, true);
  assert.equal(body.preco_atual, 149.9);
  assert.equal(body.preco_novo, 1000);
  assert.equal(body.empresas_afetadas, 17);
  assert.match(body.message, /NÃO atualiza automaticamente assinaturas Asaas/);
});

// ─── 6. Helpers de mescla ────────────────────────────────────────────────────

test('mesclarParaPrecificacao dá preferência ao body e completa com o banco', () => {
  const m = mesclarParaPrecificacao(PLANO_POR_MOTORISTA, { limite_motoristas: 20 });
  assert.equal(m.limite_motoristas, 20); // do body
  assert.equal(m.preco_por_motorista, 100); // do banco
  assert.equal(m.modelo_cobranca, 'por_motorista'); // do banco
});

test('mesclarParaPrecificacao normaliza quantidade em string', () => {
  const m = mesclarParaPrecificacao(PLANO_POR_MOTORISTA, { limite_motoristas: '20' });
  assert.equal(m.limite_motoristas, 20);
  assert.equal(typeof m.limite_motoristas, 'number');
});

test('mesmoPreco compara em centavos, não em float', () => {
  assert.equal(mesmoPreco(149.9, 149.9), true);
  assert.equal(mesmoPreco('149.90', 149.9), true);
  assert.equal(mesmoPreco(149.9, 149.91), false);
  assert.equal(mesmoPreco(null, 149.9), false); // sem certeza → trata como mudou
});
