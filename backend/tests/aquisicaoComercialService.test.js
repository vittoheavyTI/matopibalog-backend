const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORIGEM_AQUISICAO,
  ORIGEM_POS_TRIAL_CONTINUAR,
  iniciarAquisicaoComercial,
  registrarNaoContinuar,
} = require('../services/aquisicaoComercialService');

const AGORA = new Date('2026-08-15T12:00:00.000Z');
const FUTURO = '2026-08-29T12:00:00.000Z';
const PASSADO = '2026-08-01T12:00:00.000Z';

function criarSupabase(over = {}) {
  const state = {
    empresa: {
      id: 'emp-1',
      nome: 'Empresa Piloto',
      email_contato: 'dono@example.com',
      commercial_flow_version: 'v2',
      status: 'trial',
      trial_started_at: '2026-08-15T12:00:00.000Z',
      trial_ends_at: FUTURO,
      plano_id: 'plano-1',
      quantidade_contratada: 7,
      ...over.empresa,
    },
    plano: {
      id: 'plano-1',
      nome: 'Empresa Start',
      categoria: 'empresa',
      ativo: true,
      preco_mensal: 299.9,
      dias_trial: 14,
      limite_motoristas: 5,
      capacidade_inclusa: 5,
      preco_motorista_extra: 100,
      valor_implantacao: 0,
      requer_negociacao: false,
      ...over.plano,
    },
    usuario: { id: 'user-1', nome: 'Dono', email: 'dono@example.com' },
    propostas: over.propostas ? [...over.propostas] : [],
    contratos: over.contratos ? [...over.contratos] : [],
    billingOutbox: [],
    inserts: [],
    updates: [],
  };

  function filtrar(lista, filtros) {
    return lista.filter((row) => filtros.every((f) => row[f.campo] === f.valor));
  }

  const supabase = {
    _state: state,
    from(tabela) {
      const ctx = { tabela, filtros: [], payload: null, limitN: null };
      const api = {
        select() { return api; },
        eq(campo, valor) { ctx.filtros.push({ campo, valor }); return api; },
        order() { return api; },
        limit(n) {
          ctx.limitN = n;
          let data = [];
          if (tabela === 'propostas_comerciais') data = filtrar(state.propostas, ctx.filtros);
          return Promise.resolve({ data: ctx.limitN ? data.slice(0, ctx.limitN) : data, error: null });
        },
        maybeSingle() {
          if (tabela === 'empresas') return Promise.resolve({ data: state.empresa, error: null });
          if (tabela === 'planos') return Promise.resolve({ data: state.plano, error: null });
          if (tabela === 'usuarios') return Promise.resolve({ data: state.usuario, error: null });
          if (tabela === 'contrato_modelos') return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        insert(payload) {
          const row = Array.isArray(payload) ? payload : { ...payload };
          state.inserts.push({ tabela, payload: row });
          if (tabela === 'propostas_comerciais') {
            const proposta = { id: `prop-${state.propostas.length + 1}`, ...row };
            state.propostas.unshift({ ...proposta, contratos_comerciais: [] });
            return { select: () => ({ single: async () => ({ data: proposta, error: null }) }) };
          }
          if (tabela === 'contratos_comerciais') {
            const contrato = { id: `ct-${state.contratos.length + 1}`, ...row };
            state.contratos.unshift(contrato);
            const proposta = state.propostas.find((p) => p.id === contrato.proposta_id);
            if (proposta) proposta.contratos_comerciais = [contrato];
            return { select: () => ({ single: async () => ({ data: contrato, error: null }) }) };
          }
          if (tabela === 'billing_outbox') {
            const existente = state.billingOutbox.find((e) => e.dedupe_key === row.dedupe_key);
            if (existente) {
              return { select: () => ({ maybeSingle: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) };
            }
            const evento = { id: `out-${state.billingOutbox.length + 1}`, ...row };
            state.billingOutbox.push(evento);
            return { select: () => ({ maybeSingle: async () => ({ data: evento, error: null }) }) };
          }
          return api;
        },
        update(payload) {
          ctx.payload = payload;
          return api;
        },
        then(resolve) {
          state.updates.push({ tabela, filtros: ctx.filtros, payload: ctx.payload });
          if (tabela === 'empresas') state.empresa = { ...state.empresa, ...ctx.payload };
          if (tabela === 'propostas_comerciais') {
            state.propostas = state.propostas.map((p) => ctx.filtros.every((f) => p[f.campo] === f.valor) ? { ...p, ...ctx.payload } : p);
          }
          if (tabela === 'contratos_comerciais') {
            state.contratos = state.contratos.map((c) => ctx.filtros.every((f) => c[f.campo] === f.valor) ? { ...c, ...ctx.payload } : c);
            state.propostas = state.propostas.map((p) => ({
              ...p,
              contratos_comerciais: (p.contratos_comerciais || []).map((c) => ctx.filtros.every((f) => c[f.campo] === f.valor) ? { ...c, ...ctx.payload } : c),
            }));
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  return supabase;
}

test('trial -> contratar agora cria proposta e contrato obrigatorio sem alterar datas do trial', async () => {
  const supabase = criarSupabase();
  const r = await iniciarAquisicaoComercial({
    supabase,
    empresaId: 'emp-1',
    usuarioId: 'user-1',
    planoId: 'plano-1',
    quantidadeContratada: 7,
    agora: AGORA,
  });

  assert.equal(r.status, 201);
  assert.equal(r.body.origem, ORIGEM_AQUISICAO);
  assert.equal(r.body.snapshot.valor_mensal, 499.9);
  assert.equal(r.body.snapshot.quantidade_extra, 2);
  assert.equal(r.body.snapshot.trial_dias, 0);
  assert.equal(r.body.snapshot.trial_started_at, '2026-08-15T12:00:00.000Z');
  assert.equal(r.body.snapshot.trial_ends_at, FUTURO);
  assert.equal(supabase._state.empresa.trial_started_at, '2026-08-15T12:00:00.000Z');
  assert.equal(supabase._state.empresa.trial_ends_at, FUTURO);
  assert.equal(supabase._state.empresa.decisao_pos_trial, undefined);
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'propostas_comerciais').length, 1);
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'contratos_comerciais').length, 1);
});

test('aquisicao bloqueia antes do aceite/ativacao do trial', async () => {
  const supabase = criarSupabase({ empresa: { trial_started_at: null, trial_ends_at: null } });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'aguardando_ativacao_trial');
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'propostas_comerciais').length, 0);
});

test('aquisicao bloqueia conta em estado administrativo bloqueado', async () => {
  const supabase = criarSupabase({ empresa: { status: 'bloqueado' } });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'empresa_bloqueada');
});

test('aquisicao valida categoria do plano contra tipo da empresa', async () => {
  const supabase = criarSupabase({
    empresa: { tipo: 'autonomo', quantidade_contratada: 1 },
    plano: { categoria: 'empresa', capacidade_inclusa: 1, limite_motoristas: 1, preco_motorista_extra: null },
  });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 1, agora: AGORA });

  assert.equal(r.status, 422);
  assert.equal(r.body.motivo, 'categoria_incompativel');
});

test('aquisicao bloqueia plano oculto do self-service', async () => {
  const supabase = criarSupabase({ plano: { visivel_cadastro: false } });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 422);
  assert.equal(r.body.motivo, 'plano_oculto_self_service');
});

test('double click contratar agora retorna a mesma contratacao equivalente', async () => {
  const supabase = criarSupabase();
  const primeiro = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });
  const segundo = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(primeiro.status, 201);
  assert.equal(segundo.status, 200);
  assert.equal(segundo.body.idempotente, true);
  assert.equal(segundo.body.proposta_id, primeiro.body.proposta_id);
  assert.equal(segundo.body.contrato_id, primeiro.body.contrato_id);
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'propostas_comerciais').length, 1);
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'contratos_comerciais').length, 1);
});

test('contrato antigo cadastro_publico nao conta como intencao; aquisicao explicita supersede auditavelmente', async () => {
  const supabase = criarSupabase({
    propostas: [{
      id: 'prop-old',
      empresa_id: 'emp-1',
      plano_id: 'plano-1',
      status: 'enviada',
      origem: 'cadastro_publico',
      snapshot: { plano_id: 'plano-1', quantidade_contratada: 7, valor_mensal: 499.9 },
      contratos_comerciais: [{ id: 'ct-old', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
    }],
    contratos: [{ id: 'ct-old', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
  });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 201);
  assert.notEqual(r.body.contrato_id, 'ct-old');
  assert.equal(supabase._state.contratos.find((c) => c.id === 'ct-old').status, 'substituido');
  assert.ok(supabase._state.inserts.some((i) => i.tabela === 'contrato_eventos' && i.payload.tipo === 'contrato_substituido_por_aquisicao_explicita'));
});

test('trial end -> continuar usa o mesmo servico, persiste decisao e cria contrato', async () => {
  const supabase = criarSupabase({ empresa: { trial_ends_at: PASSADO } });
  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 201);
  assert.equal(r.body.origem, ORIGEM_POS_TRIAL_CONTINUAR);
  assert.equal(supabase._state.empresa.decisao_pos_trial, 'continuar');
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'contratos_comerciais').length, 1);
});

test('trial end -> continuar reutiliza compra antecipada equivalente e persiste decisao', async () => {
  const supabase = criarSupabase();
  const primeiro = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });
  supabase._state.empresa.trial_ends_at = PASSADO;
  const segundo = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(primeiro.status, 201);
  assert.equal(segundo.status, 200);
  assert.equal(segundo.body.idempotente, true);
  assert.equal(segundo.body.proposta_id, primeiro.body.proposta_id);
  assert.equal(supabase._state.empresa.decisao_pos_trial, 'continuar');
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'contratos_comerciais').length, 1);
});

test('trial end -> continuar com compra antecipada assinada rearma billing uma vez', async () => {
  const supabase = criarSupabase({
    empresa: { trial_ends_at: PASSADO },
    propostas: [{
      id: 'prop-signed',
      empresa_id: 'emp-1',
      plano_id: 'plano-1',
      status: 'enviada',
      origem: ORIGEM_AQUISICAO,
      snapshot: { plano_id: 'plano-1', quantidade_contratada: 7, valor_mensal: 499.9 },
      contratos_comerciais: [{ id: 'ct-signed', empresa_id: 'emp-1', status: 'plenamente_assinado', obrigatorio: true }],
    }],
    contratos: [{ id: 'ct-signed', empresa_id: 'emp-1', status: 'plenamente_assinado', obrigatorio: true }],
  });

  const primeiro = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });
  const segundo = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(primeiro.status, 200);
  assert.equal(primeiro.body.billing_event.code, 'inserted');
  assert.equal(segundo.status, 200);
  assert.equal(segundo.body.billing_event.code, 'duplicate');
  assert.equal(supabase._state.billingOutbox.length, 1);
  assert.equal(supabase._state.billingOutbox[0].event_type, 'contratacao_apta');
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'faturas').length, 0);
});

test('trial end -> continuar com contrato pendente nao rearma billing', async () => {
  const supabase = criarSupabase({
    empresa: { trial_ends_at: PASSADO },
    propostas: [{
      id: 'prop-pending',
      empresa_id: 'emp-1',
      plano_id: 'plano-1',
      status: 'enviada',
      origem: ORIGEM_AQUISICAO,
      snapshot: { plano_id: 'plano-1', quantidade_contratada: 7, valor_mensal: 499.9 },
      contratos_comerciais: [{ id: 'ct-pending', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
    }],
    contratos: [{ id: 'ct-pending', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
  });

  const r = await iniciarAquisicaoComercial({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', planoId: 'plano-1', quantidadeContratada: 7, agora: AGORA });

  assert.equal(r.status, 200);
  assert.equal(r.body.billing_event.code, 'contrato_nao_concluido');
  assert.equal(supabase._state.billingOutbox.length, 0);
});

test('nao continuar durante trial ativo e negado e nao grava decisao', async () => {
  const supabase = criarSupabase();
  const r = await registrarNaoContinuar({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', agora: AGORA });

  assert.equal(r.status, 409);
  assert.equal(r.body.motivo, 'trial_ainda_ativo');
  assert.equal(supabase._state.empresa.decisao_pos_trial, undefined);
});

test('nao continuar persiste decisao, cancela pendencias explicitas e nao cria divida', async () => {
  const supabase = criarSupabase({
    empresa: { trial_ends_at: PASSADO },
    propostas: [{
      id: 'prop-1',
      empresa_id: 'emp-1',
      plano_id: 'plano-1',
      status: 'enviada',
      origem: ORIGEM_AQUISICAO,
      snapshot: { plano_id: 'plano-1', quantidade_contratada: 7, valor_mensal: 499.9 },
      contratos_comerciais: [{ id: 'ct-1', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
    }],
    contratos: [{ id: 'ct-1', empresa_id: 'emp-1', status: 'aguardando_assinatura', obrigatorio: true }],
  });
  const r = await registrarNaoContinuar({ supabase, empresaId: 'emp-1', usuarioId: 'user-1', agora: AGORA });

  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'trial_encerrado_sem_contratacao');
  assert.equal(r.body.fatura, null);
  assert.equal(r.body.asaas, null);
  assert.equal(supabase._state.empresa.decisao_pos_trial, 'nao_continuar');
  assert.equal(supabase._state.inserts.filter((i) => i.tabela === 'faturas').length, 0);
});
