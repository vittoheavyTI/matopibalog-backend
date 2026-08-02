const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pendenciaObrigatoria,
  resumoContratos,
  empresaTemContratoObrigatorioPendente,
} = require('../services/contratoGateService');

test('pendenciaObrigatoria: só bloqueia contrato obrigatório E pendente', () => {
  // obrigatório + pendente => bloqueia
  assert.equal(pendenciaObrigatoria([{ obrigatorio: true, status: 'aguardando_assinatura_cliente' }]), true);
  assert.equal(pendenciaObrigatoria([{ obrigatorio: true, status: 'aguardando_assinatura' }]), true);
  // pendente mas NÃO obrigatório => não bloqueia
  assert.equal(pendenciaObrigatoria([{ obrigatorio: false, status: 'aguardando_assinatura_cliente' }]), false);
  assert.equal(pendenciaObrigatoria([{ status: 'aguardando_assinatura_cliente' }]), false);
  // obrigatório mas já concluído => não bloqueia
  assert.equal(pendenciaObrigatoria([{ obrigatorio: true, status: 'plenamente_assinado' }]), false);
  assert.equal(pendenciaObrigatoria([{ obrigatorio: true, status: 'aceito_manualmente' }]), false);
  assert.equal(pendenciaObrigatoria([{ obrigatorio: true, status: 'cancelado' }]), false);
  // lista vazia / nula
  assert.equal(pendenciaObrigatoria([]), false);
  assert.equal(pendenciaObrigatoria(), false);
});

test('resumoContratos: sinais para UI', () => {
  const r = resumoContratos([
    { obrigatorio: true, status: 'aguardando_assinatura_cliente' },
    { obrigatorio: false, status: 'plenamente_assinado' },
  ]);
  assert.deepEqual(r, { pendencia_obrigatoria: true, tem_contrato: true, algum_concluido: true, algum_pendente: true });
  assert.deepEqual(resumoContratos([]), { pendencia_obrigatoria: false, tem_contrato: false, algum_concluido: false, algum_pendente: false });
});

test('empresaTemContratoObrigatorioPendente: lê do supabase e falha-aberto', async () => {
  const supabaseOk = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ obrigatorio: true, status: 'aguardando_assinatura' }], error: null }) }) }) };
  assert.equal(await empresaTemContratoObrigatorioPendente(supabaseOk, 'emp-1'), true);

  const supabaseSemPendencia = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ obrigatorio: false, status: 'aguardando_assinatura' }], error: null }) }) }) };
  assert.equal(await empresaTemContratoObrigatorioPendente(supabaseSemPendencia, 'emp-1'), false);

  // erro na consulta => fail-open (não bloqueia)
  const supabaseErro = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }) }) }) };
  assert.equal(await empresaTemContratoObrigatorioPendente(supabaseErro, 'emp-1'), false);

  // throw na consulta (ex.: coluna ausente) => fail-open
  const supabaseThrow = { from: () => ({ select: () => ({ eq: async () => { throw new Error('coluna ausente'); } }) }) };
  assert.equal(await empresaTemContratoObrigatorioPendente(supabaseThrow, 'emp-1'), false);

  // sem empresaId => false
  assert.equal(await empresaTemContratoObrigatorioPendente(supabaseOk, null), false);
});
