const test = require('node:test');
const assert = require('node:assert/strict');

const { aplicarUpgradePago } = require('../services/upgradeApplyService');

// Fake supabase mínimo p/ exercitar aplicarUpgradePago + o guard do gate.
function criarSupabase({ solicitacao, planoNovo, contratos, capturas }) {
  return {
    from(tabela) {
      const builder = {
        select() { return builder; },
        update(payload) { capturas.push({ tabela, op: 'update', payload }); return builder; },
        eq() { return builder; },
        maybeSingle() {
          if (tabela === 'solicitacoes_upgrade_plano') return Promise.resolve({ data: solicitacao, error: null });
          if (tabela === 'planos') return Promise.resolve({ data: planoNovo, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      if (tabela === 'contratos_comerciais') {
        builder.then = (resolve) => resolve({ data: contratos, error: null });
      }
      // updates em empresas/solicitacoes resolvem sem erro quando aguardados
      builder.then = builder.then || ((resolve) => resolve({ error: null }));
      return builder;
    },
  };
}

const solicitacaoPendente = { id: 'sol-1', status: 'pendente', empresa_id: 'emp-1', plano_novo_id: 'plano-2' };
const planoNovoOk = { id: 'plano-2', ativo: true, arquivado_em: null };

test('upgrade: contrato obrigatório pendente BLOQUEIA efetivação do plano', async () => {
  const capturas = [];
  const supabase = criarSupabase({
    solicitacao: solicitacaoPendente,
    planoNovo: planoNovoOk,
    contratos: [{ obrigatorio: true, status: 'aguardando_assinatura_cliente' }],
    capturas,
  });
  const r = await aplicarUpgradePago({ supabase, faturaId: 'f-1', empresaId: 'emp-1', asaasPaymentId: null });
  assert.equal(r.resultado, 'bloqueado');
  assert.equal(r.motivo, 'contrato_obrigatorio_pendente');
  // NÃO pode ter atualizado o plano da empresa nem marcado a solicitação paga
  assert.equal(capturas.some((c) => c.tabela === 'empresas'), false);
  assert.equal(capturas.some((c) => c.tabela === 'solicitacoes_upgrade_plano' && c.op === 'update'), false);
});

test('upgrade: sem contrato obrigatório pendente, efetiva o plano normalmente', async () => {
  const capturas = [];
  const supabase = criarSupabase({
    solicitacao: solicitacaoPendente,
    planoNovo: planoNovoOk,
    contratos: [], // nenhum contrato pendente obrigatório
    capturas,
  });
  const r = await aplicarUpgradePago({ supabase, faturaId: 'f-1', empresaId: 'emp-1', asaasPaymentId: null });
  assert.equal(r.resultado, 'aplicado');
  assert.equal(r.planoNovoId, 'plano-2');
  // Aplicou o plano (update em empresas) e marcou a solicitação paga
  assert.equal(capturas.some((c) => c.tabela === 'empresas' && c.op === 'update' && c.payload.plano_id === 'plano-2'), true);
  assert.equal(capturas.some((c) => c.tabela === 'solicitacoes_upgrade_plano' && c.op === 'update' && c.payload.status === 'pago'), true);
});
