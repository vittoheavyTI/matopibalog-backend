const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aceitarContrato,
  criarPropostaEContrato,
  emailHash,
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
  assert.equal(signatario.email_hash, emailHash('ana@example.com'));
  assert.doesNotMatch(JSON.stringify(supabase.inserts), /ana@example\.com/);
});

test('aceitarContrato bloqueia implantacao positiva antes de gravar quando validacao falha', async () => {
  const updates = [];
  const inserts = [];
  const contrato = {
    id: 'contrato-1',
    proposta_id: 'proposta-1',
    empresa_id: 'emp-1',
    status: 'aguardando_assinatura',
    propostas_comerciais: {
      id: 'proposta-1',
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

  await assert.rejects(
    aceitarContrato({
      supabase,
      contratoId: 'contrato-1',
      empresaId: 'emp-1',
      usuarioId: 'user-1',
      cobrancaImplantacao: {
        validar: async () => {
          const err = new Error('sandbox_obrigatorio');
          err.motivo = 'sandbox_obrigatorio';
          err.status = 403;
          throw err;
        },
      },
    }),
    /sandbox_obrigatorio/
  );

  assert.equal(updates.length, 0);
  assert.equal(inserts.length, 0);
});
