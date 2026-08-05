const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROTULO,
  rotuloPublico,
  projetarFuncionalidadesDoCard,
  resolverEntitlement,
} = require('../services/entitlementDomainService');

const funcDisp = { id: 'f1', codigo: 'fretes', nome: 'Gestão de fretes', status_ciclo_vida: 'disponivel', ativo: true, visivel_publicamente: true, ordem_exibicao: 1 };
const funcFuturo = { id: 'f2', codigo: 'erp_api', nome: 'Integração ERP', status_ciclo_vida: 'planejada', ativo: true, visivel_publicamente: true, ordem_exibicao: 2 };
const funcFuturoOculto = { id: 'f3', codigo: 'sso', nome: 'SSO corporativo', status_ciclo_vida: 'em_desenvolvimento', ativo: true, visivel_publicamente: false, ordem_exibicao: 3 };

test('rotulo: incluída disponível → Incluído', () => {
  assert.equal(rotuloPublico({ funcionalidade: funcDisp, planoFunc: { funcionalidade_id: 'f1', disponibilidade: 'incluida', exibir_no_card: true } }), ROTULO.INCLUIDO);
});

test('rotulo: opcional_paga disponível → Adicional', () => {
  assert.equal(rotuloPublico({ funcionalidade: funcDisp, planoFunc: { disponibilidade: 'opcional_paga', exibir_no_card: true } }), ROTULO.ADICIONAL);
});

test('rotulo: sob_negociacao → Sob consulta', () => {
  assert.equal(rotuloPublico({ funcionalidade: funcDisp, planoFunc: { disponibilidade: 'sob_negociacao', exibir_no_card: true } }), ROTULO.SOB_CONSULTA);
});

test('rotulo: indisponível → não aparece', () => {
  assert.equal(rotuloPublico({ funcionalidade: funcDisp, planoFunc: { disponibilidade: 'indisponivel', exibir_no_card: true } }), null);
});

test('GUARDA: futura marcada como incluída NUNCA vira Incluído (só Em breve)', () => {
  // Mesmo que a matriz diga "incluida", se a feature não está implementada tecnicamente,
  // não pode aparecer como Incluído.
  const r = rotuloPublico({ funcionalidade: funcFuturo, planoFunc: { disponibilidade: 'incluida', exibir_no_card: true } });
  assert.equal(r, null); // incluida + não-implementada + sem em_breve → oculta (não engana)
  const r2 = rotuloPublico({ funcionalidade: funcFuturo, planoFunc: { disponibilidade: 'em_breve', exibir_no_card: true } });
  assert.equal(r2, ROTULO.EM_BREVE);
});

test('GUARDA: futura sem visibilidade pública nunca aparece', () => {
  assert.equal(rotuloPublico({ funcionalidade: funcFuturoOculto, planoFunc: { disponibilidade: 'em_breve', exibir_no_card: true } }), null);
});

test('projeta card: filtra/ordena e nunca mostra não-implementado como disponível', () => {
  const itens = projetarFuncionalidadesDoCard({
    funcionalidades: [funcDisp, funcFuturo, funcFuturoOculto],
    planoFuncs: [
      { funcionalidade_id: 'f1', disponibilidade: 'incluida', exibir_no_card: true, ordem_exibicao: 1 },
      { funcionalidade_id: 'f2', disponibilidade: 'em_breve', exibir_no_card: true, ordem_exibicao: 2 },
      { funcionalidade_id: 'f3', disponibilidade: 'em_breve', exibir_no_card: true, ordem_exibicao: 3 },
    ],
  });
  assert.deepEqual(itens.map((i) => [i.texto, i.rotulo]), [
    ['Gestão de fretes', ROTULO.INCLUIDO],
    ['Integração ERP', ROTULO.EM_BREVE],
  ]);
  // f3 (oculto) não entra.
  assert.equal(itens.length, 2);
});

// ── resolverEntitlement ──────────────────────────────────────────────────────
test('entitlement: kill switch global nega tudo', () => {
  const r = resolverEntitlement({ codigo: 'fretes', killSwitchGlobal: true, funcionalidade: funcDisp, planoFunc: { disponibilidade: 'incluida' } });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'desligada_globalmente');
});

test('entitlement: não-implementada nega mesmo se plano diz incluída', () => {
  const r = resolverEntitlement({ codigo: 'erp_api', funcionalidade: funcFuturo, planoFunc: { disponibilidade: 'incluida' } });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'nao_implementada');
});

test('entitlement: incluída no plano → permitido, origem plano', () => {
  const r = resolverEntitlement({ codigo: 'fretes', funcionalidade: funcDisp, planoFunc: { disponibilidade: 'incluida', limite_incluso: null } });
  assert.equal(r.permitido, true);
  assert.equal(r.origem, 'plano');
});

test('entitlement: opcional_paga sem override → nega requer_adicional', () => {
  const r = resolverEntitlement({ codigo: 'fretes', funcionalidade: funcDisp, planoFunc: { disponibilidade: 'opcional_paga' } });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'requer_adicional');
  assert.equal(r.proxima_acao, 'contratar_adicional');
});

test('entitlement: override vigente da empresa libera opcional_paga', () => {
  const r = resolverEntitlement({
    codigo: 'fretes', funcionalidade: funcDisp,
    planoFunc: { disponibilidade: 'opcional_paga' },
    empresaFunc: { status: 'ativa', origem: 'adicional', quantidade: 3 },
  });
  assert.equal(r.permitido, true);
  assert.equal(r.origem, 'adicional');
  assert.equal(r.limite, 3);
});

test('entitlement: limite atingido nega', () => {
  const r = resolverEntitlement({ codigo: 'fretes', funcionalidade: funcDisp, planoFunc: { disponibilidade: 'incluida', limite_incluso: 5 }, consumo: 5 });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'limite_atingido');
});

test('entitlement: papel sem permissão nega mesmo incluída', () => {
  const r = resolverEntitlement({ codigo: 'fretes', funcionalidade: funcDisp, planoFunc: { disponibilidade: 'incluida' }, papelPermitido: false });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'sem_permissao_do_papel');
});

test('entitlement: override expirado NÃO libera', () => {
  const r = resolverEntitlement({
    codigo: 'fretes', funcionalidade: funcDisp,
    planoFunc: { disponibilidade: 'opcional_paga' },
    empresaFunc: { status: 'ativa', origem: 'adicional', vigencia_fim: '2000-01-01T00:00:00Z' },
    agora: new Date('2026-08-05T00:00:00Z'),
  });
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'requer_adicional');
});
