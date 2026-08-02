const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aceitarContrato,
  criarCobrancaImplantacaoContrato,
  criarPropostaEContrato,
  emailHash,
  listarContratacaoEmpresa,
} = require('../services/contratacaoComercialService');

function supabaseMock() {
  const inserts = [];
  const api = {
    inserts,
    from(tabela) {
      const ctx = { tabela, payload: null };
      return {
        insert(payload) {
          ctx.payload = payload;
          inserts.push({ tabela, payload });
          return {
            select() {
              return {
                single: async () => ({ data: { id: `${tabela}-id`, ...payload }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  return api;
}

const plano = {
  id: 'plano-1',
  nome: 'Empresa Start',
  preco_mensal: 299.9,
  dias_trial: 7,
  limite_motoristas: 5,
  capacidade_inclusa: 5,
  valor_implantacao: 0,
};

test('criarPropostaEContrato persiste snapshot, contrato, signatario hash e evento sem e-mail bruto', async () => {
  const supabase = supabaseMock();
  const r = await criarPropostaEContrato({
    supabase,
    empresa: { id: 'emp-1', nome: 'Empresa Teste' },
    responsavel: { nome: 'Ana Teste', email: 'ana@example.com' },
    plano,
    criadoPor: 'user-1',
  });

  assert.equal(r.snapshot.implantacao_gratis, true);
  assert.equal(supabase.inserts.filter((i) => i.tabela === 'propostas_comerciais').length, 1);
  assert.equal(supabase.inserts.filter((i) => i.tabela === 'contratos_comerciais').length, 1);
  assert.equal(supabase.inserts.filter((i) => i.tabela === 'contrato_signatarios').length, 1);
  assert.equal(supabase.inserts.filter((i) => i.tabela === 'contrato_eventos').length, 1);

  const signatario = supabase.inserts.find((i) => i.tabela === 'contrato_signatarios').payload;
  const proposta = supabase.inserts.find((i) => i.tabela === 'propostas_comerciais').payload;
  const contrato = supabase.inserts.find((i) => i.tabela === 'contratos_comerciais').payload;
  assert.equal(proposta.status, 'enviada');
  assert.equal(contrato.status, 'aguardando_assinatura');
  // Contratação inicial nasce OBRIGATÓRIA (aciona o gate até a assinatura).
  assert.equal(contrato.obrigatorio, true);
  assert.equal(signatario.status, 'pendente');
  assert.equal(signatario.email_hash, emailHash('ana@example.com'));
  assert.doesNotMatch(JSON.stringify(supabase.inserts), /ana@example\.com/);
});

test('criarPropostaEContrato: contrato inicial nasce obrigatorio=true por padrão; opcional pode nascer false', async () => {
  // padrão (onboarding) → obrigatório
  const s1 = supabaseMock();
  await criarPropostaEContrato({ supabase: s1, empresa: { id: 'e', nome: 'E' }, responsavel: { nome: 'R', email: 'r@x.com' }, plano });
  assert.equal(s1.inserts.find((i) => i.tabela === 'contratos_comerciais').payload.obrigatorio, true);

  // explícito opcional → NÃO obrigatório
  const s2 = supabaseMock();
  await criarPropostaEContrato({ supabase: s2, empresa: { id: 'e', nome: 'E' }, responsavel: { nome: 'R', email: 'r@x.com' }, plano, obrigatorio: false });
  assert.equal(s2.inserts.find((i) => i.tabela === 'contratos_comerciais').payload.obrigatorio, false);
});

test('listarContratacaoEmpresa devolve resumo comercial sem provider, hash ou snapshot bruto', async () => {
  const supabase = {
    from(tabela) {
      assert.equal(tabela, 'propostas_comerciais');
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit: async () => ({
          data: [{
            id: 'proposta-1',
            status: 'enviada',
            snapshot: { plano_nome: 'Empresa Start', valor_mensal: 299.9, implantacao_gratis: true },
            valor_mensal: 299.9,
            valor_implantacao: 0,
            total_inicial: 0,
            trial_dias: 14,
            aceito_em: null,
            contratos_comerciais: [{
              id: 'contrato-1',
              status: 'aguardando_assinatura',
              template_version: 'manual-v1',
              provider: 'manual',
              content_hash: 'hash-tecnico',
              signed_storage_path: null,
              aceito_em: null,
            }],
          }],
          error: null,
        }),
      };
      return api;
    },
  };

  const r = await listarContratacaoEmpresa({ supabase, empresaId: 'emp-1' });

  assert.equal(r.propostas[0].resumo.plano_nome, 'Empresa Start');
  assert.equal(r.propostas[0].snapshot, undefined);
  assert.equal(r.propostas[0].contratos_comerciais[0].provider, undefined);
  assert.equal(r.propostas[0].contratos_comerciais[0].content_hash, undefined);
  assert.equal(r.propostas[0].contratos_comerciais[0].versao, 'manual-v1');
  assert.doesNotMatch(JSON.stringify(r), /hash-tecnico|provider|content_hash|snapshot/);
});

test('aceitarContrato registra aceite manual sem criar cobranca de implantacao', async () => {
  const updates = [];
  const inserts = [];
  const contrato = {
    id: 'contrato-1',
    proposta_id: 'proposta-1',
    empresa_id: 'emp-1',
    status: 'aguardando_assinatura',
    propostas_comerciais: {
      id: 'proposta-1',
      status: 'enviada',
      snapshot: {
        plano_id: 'plano-1',
        plano_nome: 'Empresa Start',
        valor_implantacao: 299,
        implantacao_gratis: false,
      },
    },
  };
  const supabase = {
    from(tabela) {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: tabela === 'contratos_comerciais' ? contrato : null, error: null }),
        update(payload) { updates.push({ tabela, payload }); return api; },
        insert(payload) { inserts.push({ tabela, payload }); return api; },
      };
      return api;
    },
  };

  const r = await aceitarContrato({
    supabase,
    contratoId: 'contrato-1',
    empresaId: 'emp-1',
    usuarioId: 'user-1',
    cobrancaImplantacao: {
      validar: async () => { throw new Error('nao deveria validar cobranca'); },
      executar: async () => { throw new Error('nao deveria criar cobranca'); },
    },
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.fatura_implantacao, null);
  assert.equal(updates.length, 2);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.tipo, 'aceite_manual');
});

test('aceitarContrato nao reativa contrato cancelado nem cria cobranca', async () => {
  const updates = [];
  const inserts = [];
  let validouCobranca = false;
  let executouCobranca = false;
  const contrato = {
    id: 'contrato-1',
    proposta_id: 'proposta-1',
    empresa_id: 'emp-1',
    status: 'cancelado',
    propostas_comerciais: {
      id: 'proposta-1',
      status: 'enviada',
      snapshot: {
        plano_id: 'plano-1',
        plano_nome: 'Empresa Start',
        valor_implantacao: 299,
        implantacao_gratis: false,
      },
    },
  };
  const supabase = {
    from(tabela) {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: tabela === 'contratos_comerciais' ? contrato : null, error: null }),
        update(payload) { updates.push({ tabela, payload }); return api; },
        insert(payload) { inserts.push({ tabela, payload }); return api; },
      };
      return api;
    },
  };

  const r = await aceitarContrato({
    supabase,
    contratoId: 'contrato-1',
    empresaId: 'emp-1',
    usuarioId: 'user-1',
    cobrancaImplantacao: {
      validar: async () => { validouCobranca = true; },
      executar: async () => { executouCobranca = true; },
    },
  });

  assert.equal(r.status, 409);
  assert.match(r.body.message, /cancelado/i);
  assert.equal(validouCobranca, false);
  assert.equal(executouCobranca, false);
  assert.equal(updates.length, 0);
  assert.equal(inserts.length, 0);
});

test('aceitarContrato bloqueia proposta cancelada ou expirada', async () => {
  const contrato = {
    id: 'contrato-1',
    proposta_id: 'proposta-1',
    empresa_id: 'emp-1',
    status: 'aguardando_assinatura',
    propostas_comerciais: { id: 'proposta-1', status: 'expirada', snapshot: { valor_implantacao: 0 } },
  };
  const supabase = {
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: contrato, error: null }),
        update() { throw new Error('nao deveria atualizar'); },
        insert() { throw new Error('nao deveria inserir'); },
      };
      return api;
    },
  };

  const r = await aceitarContrato({ supabase, contratoId: 'contrato-1', empresaId: 'emp-1', usuarioId: 'user-1' });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /expirada/i);
});

test('cobranca de implantacao positiva exige aceite e acao explicita', async () => {
  const inserts = [];
  const contrato = {
    id: 'contrato-1',
    proposta_id: 'proposta-1',
    empresa_id: 'emp-1',
    status: 'aceito_manualmente',
    propostas_comerciais: {
      id: 'proposta-1',
      status: 'aceita',
      snapshot: {
        plano_id: 'plano-1',
        plano_nome: 'Empresa Start',
        valor_implantacao: 299,
        implantacao_gratis: false,
      },
    },
  };
  const supabase = {
    from(tabela) {
      const api = {
        select() { return api; },
        eq() { return api; },
        maybeSingle: async () => ({ data: tabela === 'contratos_comerciais' ? contrato : null, error: null }),
        insert(payload) { inserts.push({ tabela, payload }); return api; },
      };
      return api;
    },
  };
  let validou = false;
  let executou = false;

  const r = await criarCobrancaImplantacaoContrato({
    supabase,
    contratoId: 'contrato-1',
    empresaId: 'emp-1',
    usuarioId: 'user-1',
    cobrancaImplantacao: {
      validar: async () => { validou = true; },
      executar: async () => { executou = true; return { resultado: 'gerada' }; },
    },
  });

  assert.equal(r.status, 200);
  assert.equal(validou, true);
  assert.equal(executou, true);
  assert.equal(inserts[0].payload.tipo, 'cobranca_implantacao_solicitada');
});
