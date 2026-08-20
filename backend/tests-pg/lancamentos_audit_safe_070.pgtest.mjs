// PG real (CI): estados audit-safe + transição atômica (CAS) da migration 070.
// Prova, contra Postgres efêmero:
//   - máquina de estados: PENDENTE→{APROVADO,REJEITADO,CANCELADO}; APROVADO→CANCELADO;
//   - bloqueio de transições ilegais (REJEITADO/CANCELADO terminais; double approve/cancel);
//   - CAS (expected_status/expected_version) → conflito previsível em estado velho;
//   - motivo obrigatório em rejeição/cancelamento;
//   - tenant isolation (empresa errada não transiciona);
//   - auditoria append-only (evento inserido; UPDATE/DELETE bloqueados por trigger);
//   - version incrementa; cancelamento preserva o registro (nunca hard delete);
//   - concorrência: duas transições simultâneas na mesma linha → no máximo uma vence.
// Nunca roda contra produção: exige DATABASE_URL do banco de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool, Client } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('lançamentos audit-safe 070 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

const FN = 'public.lancamento_transicionar';

function registrar() {
  const pool = new Pool({ connectionString: CONN });
  after(async () => { await pool.end(); });

  async function seedEmpresa() {
    const empresaId = randomUUID();
    await pool.query('INSERT INTO public.empresas (id, nome) VALUES ($1,$2)', [empresaId, 'L070 ' + empresaId.slice(0, 8)]);
    const motoristaUserId = randomUUID();
    await pool.query('INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1,$2,$3,$4)', [motoristaUserId, empresaId, 'motorista', 'ativo']);
    await pool.query('INSERT INTO public.motoristas (id, empresa_id) VALUES ($1,$2)', [motoristaUserId, empresaId]);
    return { empresaId, motoristaUserId };
  }

  async function seedDespesa(empresaId, motoristaId, status = 'pendente') {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO public.despesas (id, empresa_id, motorista_id, tipo, descricao, valor, quem_pagou, data, status) VALUES ($1,$2,$3,'geral','ctx',100,'motorista',now(),$4)",
      [id, empresaId, motoristaId, status]
    );
    return id;
  }

  // Chama a RPC posicionalmente na assinatura:
  // (entity_type, entity_id, empresa_id, new_status, actor_user_id, actor_role, source, reason, expected_version, expected_status)
  async function transicionar(opts) {
    const {
      tipo = 'despesa', id, empresaId, novo, actor = randomUUID(), role = 'admin',
      source = 'api', motivo = null, expVersion = null, expStatus = null,
    } = opts;
    return pool.query(
      `SELECT ${FN}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS row`,
      [tipo, id, empresaId, novo, actor, role, source, motivo, expVersion, expStatus]
    );
  }

  async function statusDe(id) {
    const { rows } = await pool.query('SELECT status, version, cancelado_por, cancelado_em, motivo_cancelamento, resolvido_por FROM public.despesas WHERE id=$1', [id]);
    return rows[0];
  }
  async function eventos(id) {
    const { rows } = await pool.query('SELECT action, from_status, to_status, actor_user_id, source, reason FROM public.lancamento_eventos WHERE entity_id=$1 ORDER BY occurred_at', [id]);
    return rows;
  }
  const falhaCom = async (promise, regex) => {
    try { await promise; return false; }
    catch (e) { return regex.test(String(e.message || '')); }
  };

  test('PENDENTE→APROVADO: seta resolvido_por, version++, gera evento approved', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);
    const actor = randomUUID();
    await transicionar({ id, empresaId, novo: 'aprovado', actor, source: 'web' });
    const s = await statusDe(id);
    assert.equal(s.status, 'aprovado');
    assert.equal(s.version, 2);
    assert.equal(s.resolvido_por, actor);
    const ev = await eventos(id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].action, 'approved');
    assert.equal(ev[0].from_status, 'pendente');
    assert.equal(ev[0].to_status, 'aprovado');
    assert.equal(ev[0].source, 'web');
  });

  test('PENDENTE→REJEITADO exige motivo; com motivo grava reason no evento', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);
    assert.equal(await falhaCom(transicionar({ id, empresaId, novo: 'rejeitado' }), /MOTIVO_OBRIGATORIO/), true);
    // continua pendente após a recusa
    assert.equal((await statusDe(id)).status, 'pendente');
    await transicionar({ id, empresaId, novo: 'rejeitado', motivo: 'sem comprovante' });
    const ev = await eventos(id);
    assert.equal(ev.at(-1).action, 'rejected');
    assert.equal(ev.at(-1).reason, 'sem comprovante');
  });

  test('CANCELAR exige motivo; APROVADO→CANCELADO preserva registro (nunca deleta)', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);
    await transicionar({ id, empresaId, novo: 'aprovado' });
    assert.equal(await falhaCom(transicionar({ id, empresaId, novo: 'cancelado' }), /MOTIVO_OBRIGATORIO/), true);
    const actor = randomUUID();
    await transicionar({ id, empresaId, novo: 'cancelado', actor, motivo: 'lançado em dobro' });
    const s = await statusDe(id);
    assert.equal(s.status, 'cancelado');
    assert.equal(s.cancelado_por, actor);
    assert.equal(s.motivo_cancelamento, 'lançado em dobro');
    assert.ok(s.cancelado_em, 'cancelado_em preenchido');
    // registro AINDA existe (append-safe): nunca hard delete
    const { rows } = await pool.query('SELECT count(*)::int n FROM public.despesas WHERE id=$1', [id]);
    assert.equal(rows[0].n, 1);
  });

  test('transições ilegais são bloqueadas (terminais / double action)', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    // rejeitado é terminal
    const r = await seedDespesa(empresaId, motoristaUserId);
    await transicionar({ id: r, empresaId, novo: 'rejeitado', motivo: 'x' });
    assert.equal(await falhaCom(transicionar({ id: r, empresaId, novo: 'aprovado' }), /TRANSICAO_INVALIDA/), true);
    // cancelado é terminal
    const c = await seedDespesa(empresaId, motoristaUserId);
    await transicionar({ id: c, empresaId, novo: 'cancelado', motivo: 'x' });
    assert.equal(await falhaCom(transicionar({ id: c, empresaId, novo: 'aprovado' }), /TRANSICAO_INVALIDA/), true);
    // double approve
    const a = await seedDespesa(empresaId, motoristaUserId);
    await transicionar({ id: a, empresaId, novo: 'aprovado' });
    assert.equal(await falhaCom(transicionar({ id: a, empresaId, novo: 'aprovado' }), /TRANSICAO_INVALIDA/), true);
  });

  test('CAS: expected_status/expected_version desatualizado → conflito', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);
    // aprova usando expected_status correto
    await transicionar({ id, empresaId, novo: 'aprovado', expStatus: 'pendente', expVersion: 1 });
    // tentar cancelar com estado/versão velhos → conflito
    assert.equal(await falhaCom(transicionar({ id, empresaId, novo: 'cancelado', motivo: 'x', expStatus: 'pendente' }), /CONFLITO_ESTADO/), true);
    assert.equal(await falhaCom(transicionar({ id, empresaId, novo: 'cancelado', motivo: 'x', expVersion: 1 }), /CONFLITO_VERSAO/), true);
  });

  test('tenant isolation: empresa errada não transiciona', async () => {
    const A = await seedEmpresa();
    const B = await seedEmpresa();
    const id = await seedDespesa(A.empresaId, A.motoristaUserId);
    assert.equal(await falhaCom(transicionar({ id, empresaId: B.empresaId, novo: 'aprovado' }), /LANCAMENTO_TENANT/), true);
    assert.equal((await statusDe(id)).status, 'pendente');
  });

  test('inexistente → NAO_ENCONTRADO; tipo inválido → TIPO_INVALIDO', async () => {
    const { empresaId } = await seedEmpresa();
    assert.equal(await falhaCom(transicionar({ id: randomUUID(), empresaId, novo: 'aprovado' }), /NAO_ENCONTRADO/), true);
    assert.equal(await falhaCom(transicionar({ tipo: 'frete', id: randomUUID(), empresaId, novo: 'aprovado' }), /TIPO_INVALIDO/), true);
  });

  test('auditoria é append-only: UPDATE e DELETE são bloqueados', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);
    await transicionar({ id, empresaId, novo: 'aprovado' });
    assert.equal(await falhaCom(pool.query('UPDATE public.lancamento_eventos SET reason=$1 WHERE entity_id=$2', ['hack', id]), /IMUTAVEL/), true);
    assert.equal(await falhaCom(pool.query('DELETE FROM public.lancamento_eventos WHERE entity_id=$1', [id]), /IMUTAVEL/), true);
  });

  test('concorrência: duas transições simultâneas na mesma linha → no máximo uma vence', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const id = await seedDespesa(empresaId, motoristaUserId);

    const ca = new Client({ connectionString: CONN });
    const cb = new Client({ connectionString: CONN });
    await ca.connect();
    await cb.connect();
    try {
      await ca.query('BEGIN');
      // A aprova e segura o row lock (FOR UPDATE dentro da RPC).
      await ca.query(`SELECT ${FN}('despesa',$1,$2,'aprovado',$3,'admin','api',null,null,null)`, [id, empresaId, randomUUID()]);
      // B tenta rejeitar concorrentemente — bloqueia no lock da linha.
      const bPromise = cb.query(`SELECT ${FN}('despesa',$1,$2,'rejeitado',$3,'admin','api','x',null,null)`, [id, empresaId, randomUUID()]);
      await new Promise((r) => setTimeout(r, 250));
      await ca.query('COMMIT'); // libera; agora status='aprovado'
      // B re-lê 'aprovado' → aprovado→rejeitado é ilegal → falha.
      let bFalhou = false;
      try { await bPromise; } catch (e) { bFalhou = /TRANSICAO_INVALIDA|CONFLITO/.test(String(e.message || '')); }
      assert.equal(bFalhou, true, 'a segunda transição concorrente deve falhar');
    } finally {
      try { await ca.query('ROLLBACK'); } catch { /* já commitado */ }
      await ca.end();
      await cb.end();
    }
    assert.equal((await statusDe(id)).status, 'aprovado');
  });

  test('abastecimento e vale também transicionam (mesma RPC)', async () => {
    const { empresaId, motoristaUserId } = await seedEmpresa();
    const ab = randomUUID();
    await pool.query("INSERT INTO public.abastecimentos (id, empresa_id, motorista_id, litros, valor_total, quem_pagou, data, status) VALUES ($1,$2,$3,100,500,'proprietario',now(),'pendente')", [ab, empresaId, motoristaUserId]);
    await transicionar({ tipo: 'abastecimento', id: ab, empresaId, novo: 'aprovado' });
    const { rows: ra } = await pool.query('SELECT status, version FROM public.abastecimentos WHERE id=$1', [ab]);
    assert.equal(ra[0].status, 'aprovado');
    assert.equal(ra[0].version, 2);

    const vl = randomUUID();
    await pool.query("INSERT INTO public.vales (id, empresa_id, motorista_id, valor, quem_pagou, descricao, data, status) VALUES ($1,$2,$3,50,'proprietario','adiantamento',now(),'pendente')", [vl, empresaId, motoristaUserId]);
    await transicionar({ tipo: 'vale', id: vl, empresaId, novo: 'cancelado', motivo: 'engano' });
    const { rows: rv } = await pool.query('SELECT status FROM public.vales WHERE id=$1', [vl]);
    assert.equal(rv[0].status, 'cancelado');
  });
}
