// Frente #8-C (Billing v2 / Macrofrente 1) — regras puras de domínio do upgrade.
// Prova das decisões de produto (PR 1):
//   * trial e ativo podem solicitar; suspenso/expirado/bloqueado regularizam 1º;
//   * plano novo precisa existir, estar ativo, ser pago e ser SUPERIOR ao atual;
//   * plano igual ao atual bloqueia; empresa sem plano aceita plano ativo pago;
//   * snapshot congela valor e nome do plano novo;
//   * solicitação pendente do mesmo plano reaproveita; de outro plano bloqueia;
//   * payloads de erro amigáveis (regularização / plano inválido).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarElegibilidadeUpgrade,
  montarSnapshotUpgrade,
  montarErroRegularizacao,
  montarErroPlanoInvalido,
  deveReutilizarSolicitacaoPendente,
  montarPayloadSolicitacao,
  REDIRECT_REGULARIZACAO,
} = require('../services/upgradeDomainService');

// Planos de referência (preço crescente).
const BASICO = { id: 'p-basico', nome: 'Plano Básico', preco_mensal: 49.9, ativo: true };
const PRO = { id: 'p-pro', nome: 'Plano Profissional', preco_mensal: 99.9, ativo: true };
const ENTERPRISE = { id: 'p-ent', nome: 'Plano Enterprise', preco_mensal: 199.9, ativo: true };

// ─── Elegibilidade por status ────────────────────────────────────────────────

test('trial pode solicitar upgrade', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'trial' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, true);
  assert.equal(r.erro, null);
});

test('ativo pode solicitar upgrade', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, true);
});

test('suspenso bloqueia com regularizacaoNecessaria e redirect', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'suspenso' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.regularizacaoNecessaria, true);
  assert.equal(r.erro.redirect, REDIRECT_REGULARIZACAO);
  assert.equal(r.erro.redirect, '/minhas-faturas');
});

test('expirado bloqueia (regularização)', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'expirado' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.regularizacaoNecessaria, true);
});

test('bloqueado bloqueia (regularização)', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'bloqueado' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.regularizacaoNecessaria, true);
});

test('status desconhecido/cancelado cai em regularização (fail-closed)', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'cancelado' },
    planoAtual: BASICO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.regularizacaoNecessaria, true);
});

// ─── Regras de plano ─────────────────────────────────────────────────────────

test('plano igual ao atual bloqueia', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: PRO,
    planoNovo: PRO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('plano de mesmo preço bloqueia (não é upgrade)', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: PRO,
    planoNovo: { id: 'p-outro', nome: 'Outro', preco_mensal: 99.9, ativo: true },
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('plano inferior bloqueia (anti-downgrade)', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: PRO,
    planoNovo: BASICO,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('plano superior permite', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: PRO,
    planoNovo: ENTERPRISE,
  });
  assert.equal(r.elegivel, true);
});

test('empresa sem plano atual permite plano ativo pago', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'trial' },
    planoAtual: null,
    planoNovo: BASICO,
  });
  assert.equal(r.elegivel, true);
});

test('plano inativo bloqueia', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: BASICO,
    planoNovo: { id: 'p-x', nome: 'Inativo', preco_mensal: 999, ativo: false },
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('plano novo gratuito/sem preço bloqueia', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: null,
    planoNovo: { id: 'p-free', nome: 'Grátis', preco_mensal: 0, ativo: true },
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('plano novo ausente bloqueia', () => {
  const r = avaliarElegibilidadeUpgrade({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: BASICO,
    planoNovo: null,
  });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

test('empresa ausente bloqueia', () => {
  const r = avaliarElegibilidadeUpgrade({ empresa: null, planoAtual: null, planoNovo: PRO });
  assert.equal(r.elegivel, false);
  assert.equal(r.erro.planoInvalido, true);
});

// ─── Snapshot ────────────────────────────────────────────────────────────────

test('snapshot guarda valor_snapshot e plano_nome_snapshot', () => {
  const snap = montarSnapshotUpgrade({ planoNovo: PRO });
  assert.equal(snap.valor_snapshot, 99.9);
  assert.equal(snap.plano_nome_snapshot, 'Plano Profissional');
});

test('snapshot com nome ausente vira null e converte preço', () => {
  const snap = montarSnapshotUpgrade({ planoNovo: { id: 'p', preco_mensal: '150.5' } });
  assert.equal(snap.valor_snapshot, 150.5);
  assert.equal(snap.plano_nome_snapshot, null);
});

// ─── Reaproveitamento de solicitação pendente ────────────────────────────────

test('sem solicitação pendente: pode criar (não reutiliza, não bloqueia)', () => {
  const r = deveReutilizarSolicitacaoPendente({ solicitacaoPendente: null, planoNovoId: 'p-pro' });
  assert.equal(r.reutilizar, false);
  assert.equal(r.bloquear, false);
});

test('solicitação pendente do MESMO plano deve ser reutilizada', () => {
  const pend = { id: 's1', status: 'pendente', plano_novo_id: 'p-pro' };
  const r = deveReutilizarSolicitacaoPendente({ solicitacaoPendente: pend, planoNovoId: 'p-pro' });
  assert.equal(r.reutilizar, true);
  assert.equal(r.bloquear, false);
  assert.equal(r.solicitacao, pend);
});

test('solicitação pendente de OUTRO plano bloqueia novo upgrade', () => {
  const pend = { id: 's1', status: 'pendente', plano_novo_id: 'p-ent' };
  const r = deveReutilizarSolicitacaoPendente({ solicitacaoPendente: pend, planoNovoId: 'p-pro' });
  assert.equal(r.reutilizar, false);
  assert.equal(r.bloquear, true);
});

test('solicitação não-pendente (paga) não reutiliza nem bloqueia', () => {
  const paga = { id: 's1', status: 'pago', plano_novo_id: 'p-pro' };
  const r = deveReutilizarSolicitacaoPendente({ solicitacaoPendente: paga, planoNovoId: 'p-pro' });
  assert.equal(r.reutilizar, false);
  assert.equal(r.bloquear, false);
});

// ─── Payload da solicitação ──────────────────────────────────────────────────

test('payload monta linha correta e NÃO inclui fatura/asaas/plano aplicado', () => {
  const p = montarPayloadSolicitacao({
    empresa: { id: 'e1', status: 'ativo' },
    planoAtual: BASICO,
    planoNovo: PRO,
    criadoPor: 'u1',
    clientRequestId: 'req-123',
  });
  assert.equal(p.empresa_id, 'e1');
  assert.equal(p.plano_atual_id, 'p-basico');
  assert.equal(p.plano_novo_id, 'p-pro');
  assert.equal(p.status, 'pendente');
  assert.equal(p.valor_snapshot, 99.9);
  assert.equal(p.plano_nome_snapshot, 'Plano Profissional');
  assert.equal(p.client_request_id, 'req-123');
  assert.equal(p.criado_por, 'u1');
  // Fundação: não decide fatura, asaas nem aplica plano.
  assert.equal('fatura_id' in p, false);
  assert.equal('asaas_payment_id' in p, false);
  assert.equal('pago_em' in p, false);
});

test('payload sem plano atual e sem opcionais usa null', () => {
  const p = montarPayloadSolicitacao({
    empresa: { id: 'e2', status: 'trial' },
    planoAtual: null,
    planoNovo: BASICO,
  });
  assert.equal(p.plano_atual_id, null);
  assert.equal(p.client_request_id, null);
  assert.equal(p.criado_por, null);
});

// ─── Builders de erro ────────────────────────────────────────────────────────

test('montarErroRegularizacao retorna contrato fixo', () => {
  const e = montarErroRegularizacao('suspenso');
  assert.equal(e.regularizacaoNecessaria, true);
  assert.equal(e.redirect, '/minhas-faturas');
  assert.equal(e.status, 'suspenso');
  assert.equal(typeof e.message, 'string');
});

test('montarErroPlanoInvalido retorna contrato fixo', () => {
  const e = montarErroPlanoInvalido('x');
  assert.equal(e.planoInvalido, true);
  assert.equal(e.message, 'x');
});
