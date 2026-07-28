const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avaliarEscadaInadimplencia,
  montarNotificacao,
  copyDoPasso,
} = require('../services/inadimplenciaNotificacaoDomainService');

const HOJE = '2026-07-28T12:00:00.000Z';
const empresaAtiva = { id: 'e1', status: 'ativo' };
function fatura(due, extra = {}) {
  return { id: 'f1', empresa_id: 'e1', status: 'pendente', due_date: due, invoice_url: 'https://ex/pay', bank_slip_url: null, ...extra };
}
const aval = (over = {}) => avaliarEscadaInadimplencia({ empresa: empresaAtiva, hoje: HOJE, diasCarencia: 3, ...over });

// ─── Passos da escada (carência padrão 3) ────────────────────────────────────
test('venceu hoje (D+0) → passo d0', () => {
  const r = aval({ fatura: fatura('2026-07-28') });
  assert.equal(r.deveNotificar, true);
  assert.equal(r.passo, 'd0');
  assert.equal(r.diasVencido, 0);
});

test('1 dia em atraso (D+1) → passo d1', () => {
  const r = aval({ fatura: fatura('2026-07-27') });
  assert.equal(r.passo, 'd1');
  assert.equal(r.diasVencido, 1);
});

test('2 dias em atraso (D+2) → passo d2', () => {
  const r = aval({ fatura: fatura('2026-07-26') });
  assert.equal(r.passo, 'd2');
  assert.equal(r.diasVencido, 2);
});

test('D+3 com carência 3 → passo suspensao', () => {
  const r = aval({ fatura: fatura('2026-07-25') });
  assert.equal(r.passo, 'suspensao');
  assert.equal(r.diasVencido, 3);
});

test('após a suspensão (D+4, carência 3) → fora_da_escada', () => {
  const r = aval({ fatura: fatura('2026-07-24') });
  assert.equal(r.deveNotificar, false);
  assert.equal(r.razao, 'fora_da_escada');
  assert.equal(r.diasVencido, 4);
});

test('ainda não venceu → ainda_nao_venceu', () => {
  const r = aval({ fatura: fatura('2026-07-29') });
  assert.equal(r.deveNotificar, false);
  assert.equal(r.razao, 'ainda_nao_venceu');
});

// ─── Carência configurável ───────────────────────────────────────────────────
test('carência 2: D+2 vira suspensao (não d2)', () => {
  const r = avaliarEscadaInadimplencia({ empresa: empresaAtiva, fatura: fatura('2026-07-26'), hoje: HOJE, diasCarencia: 2 });
  assert.equal(r.passo, 'suspensao');
});

test('carência 2: D+1 continua d1', () => {
  const r = avaliarEscadaInadimplencia({ empresa: empresaAtiva, fatura: fatura('2026-07-27'), hoje: HOJE, diasCarencia: 2 });
  assert.equal(r.passo, 'd1');
});

// ─── Guardas (não notifica) ──────────────────────────────────────────────────
test('sem fatura → sem_fatura', () => {
  assert.equal(aval({ fatura: null }).razao, 'sem_fatura');
});

test('conta já suspensa → ja_suspensa', () => {
  const r = avaliarEscadaInadimplencia({ empresa: { id: 'e1', status: 'suspenso' }, fatura: fatura('2026-07-25'), hoje: HOJE, diasCarencia: 3 });
  assert.equal(r.razao, 'ja_suspensa');
});

test('trial ainda vigente → trial_ativa', () => {
  const r = avaliarEscadaInadimplencia({ empresa: { id: 'e1', status: 'trial', trial_ends_at: '2026-08-30' }, fatura: fatura('2026-07-25'), hoje: HOJE, diasCarencia: 3 });
  assert.equal(r.razao, 'trial_ativa');
});

test('extensão manual ativa → prazo_estendido', () => {
  const r = avaliarEscadaInadimplencia({ empresa: { id: 'e1', status: 'ativo', suspensao_prazo_ate: '2026-08-10' }, fatura: fatura('2026-07-25'), hoje: HOJE, diasCarencia: 3 });
  assert.equal(r.razao, 'prazo_estendido');
});

test('sem caminho de regularização (sem urls) → sem_caminho_regularizacao', () => {
  const r = aval({ fatura: fatura('2026-07-25', { invoice_url: null, bank_slip_url: null }) });
  assert.equal(r.razao, 'sem_caminho_regularizacao');
});

test('fatura paga → status_fatura_nao_elegivel', () => {
  const r = aval({ fatura: fatura('2026-07-25', { status: 'pago' }) });
  assert.equal(r.razao, 'status_fatura_nao_elegivel');
});

test('erro de consulta → fail_safe (não notifica)', () => {
  const r = aval({ fatura: fatura('2026-07-25'), erroConsulta: new Error('db') });
  assert.equal(r.deveNotificar, false);
  assert.equal(r.razao, 'fail_safe_erro_consulta');
});

test('fatura de outro tenant → fatura_outro_tenant', () => {
  const r = aval({ fatura: fatura('2026-07-25', { empresa_id: 'outra' }) });
  assert.equal(r.razao, 'fatura_outro_tenant');
});

// ─── montarNotificacao / copy ────────────────────────────────────────────────
test('montarNotificacao: dedupe determinística, tipo, entidade e metadata', () => {
  const n = montarNotificacao({ empresa: empresaAtiva, fatura: fatura('2026-07-25'), passo: 'suspensao', diasVencido: 3 });
  assert.equal(n.tipo, 'inadimplencia');
  assert.equal(n.entidade_tipo, 'fatura');
  assert.equal(n.entidade_id, 'f1');
  assert.equal(n.dedupe_key, 'inadimplencia:suspensao:f1');
  assert.equal(n.metadata.passo, 'suspensao');
  assert.equal(n.metadata.dias_vencido, 3);
  assert.equal(n.metadata.due_date, '2026-07-25');
  assert.equal(n.metadata.invoice_url, 'https://ex/pay');
});

test('copy: d0 fala em venceu hoje; suspensao fala em suspenso; d2 pluraliza', () => {
  assert.match(copyDoPasso('d0', 0).mensagem, /venceu hoje/i);
  assert.equal(copyDoPasso('d0', 0).titulo, 'Fatura vencida');
  assert.match(copyDoPasso('suspensao', 3).mensagem, /suspens/i);
  assert.match(copyDoPasso('d1', 1).mensagem, /1 dia\b/);
  assert.match(copyDoPasso('d2', 2).mensagem, /2 dias/);
});
