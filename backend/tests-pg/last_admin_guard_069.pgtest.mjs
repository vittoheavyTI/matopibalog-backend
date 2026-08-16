// PG real (CI): guarda de "último administrador da empresa" (migration 069).
// Prova, contra Postgres 16 efêmero:
//   - não deixar a empresa com ZERO admin válido (tipo='admin' AND status='ativo')
//     por rebaixar/desativar/excluir o último admin (RAISE ultimo_admin_da_empresa);
//   - delegar 2º admin destrava o rebaixamento do 1º;
//   - tenant isolation (admin de outra empresa não conta);
//   - concorrência: duas remoções simultâneas dos dois admins → no máximo uma passa,
//     empresa termina com >= 1 admin (advisory xact lock por empresa).
// Nunca roda contra produção: exige DATABASE_URL do banco de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool, Client } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('guarda último admin 069 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

const FN_UPD = 'public.atualizar_usuario_guardando_ultimo_admin';
const FN_DEL = 'public.excluir_usuario_guardando_ultimo_admin';

function registrar() {
  const pool = new Pool({ connectionString: CONN });

  after(async () => { await pool.end(); });

  // Cria uma empresa isolada com um conjunto de usuários. Retorna ids.
  async function seedEmpresa(usuarios) {
    const empresaId = randomUUID();
    await pool.query('INSERT INTO public.empresas (id, nome) VALUES ($1, $2)', [empresaId, 'GuardaAdmin ' + empresaId.slice(0, 8)]);
    const ids = {};
    for (const [chave, u] of Object.entries(usuarios)) {
      const id = randomUUID();
      ids[chave] = id;
      await pool.query(
        'INSERT INTO public.usuarios (id, empresa_id, tipo, status) VALUES ($1,$2,$3,$4)',
        [id, empresaId, u.tipo, u.status]
      );
    }
    return { empresaId, ids };
  }

  async function adminsValidos(empresaId) {
    const { rows } = await pool.query(
      "SELECT count(*)::int n FROM public.usuarios WHERE empresa_id=$1 AND tipo='admin' AND status='ativo'",
      [empresaId]
    );
    return rows[0].n;
  }

  async function atualizar(empresaId, usuarioId, updates) {
    return pool.query(`SELECT ${FN_UPD}($1,$2,$3::jsonb)`, [usuarioId, empresaId, JSON.stringify(updates)]);
  }

  async function esperaFalhaUltimoAdmin(promise) {
    try { await promise; return false; }
    catch (e) { return /ultimo_admin/.test(String(e.message || '')); }
  }

  test('1 admin: desativar o único admin é negado (409/RAISE)', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } });
    assert.equal(await esperaFalhaUltimoAdmin(atualizar(empresaId, ids.a, { status: 'inativo' })), true);
    assert.equal(await adminsValidos(empresaId), 1); // permaneceu admin
  });

  test('1 admin: rebaixar o tipo do único admin é negado (remove a autoridade)', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } });
    assert.equal(await esperaFalhaUltimoAdmin(atualizar(empresaId, ids.a, { tipo: 'operador' })), true);
    assert.equal(await adminsValidos(empresaId), 1);
  });

  test('1 admin: bloquear (status != ativo) o único admin é negado', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } });
    assert.equal(await esperaFalhaUltimoAdmin(atualizar(empresaId, ids.a, { status: 'bloqueado' })), true);
    assert.equal(await adminsValidos(empresaId), 1);
  });

  test('2 admins: rebaixar um é permitido (sobra 1)', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' }, b: { tipo: 'admin', status: 'ativo' } });
    await atualizar(empresaId, ids.a, { tipo: 'operador' });
    assert.equal(await adminsValidos(empresaId), 1);
  });

  test('2 admins: desativar um é permitido (sobra 1)', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' }, b: { tipo: 'admin', status: 'ativo' } });
    await atualizar(empresaId, ids.b, { status: 'inativo' });
    assert.equal(await adminsValidos(empresaId), 1);
  });

  test('delegação: promover 2º admin destrava rebaixar o 1º', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' }, b: { tipo: 'operador', status: 'ativo' } });
    // Antes da delegação, rebaixar o único admin é negado.
    assert.equal(await esperaFalhaUltimoAdmin(atualizar(empresaId, ids.a, { tipo: 'operador' })), true);
    // Delega: b vira admin válido.
    await atualizar(empresaId, ids.b, { tipo: 'admin' });
    // Agora rebaixar a é permitido.
    await atualizar(empresaId, ids.a, { tipo: 'operador' });
    assert.equal(await adminsValidos(empresaId), 1);
  });

  test('tenant isolation: admin de outra empresa não conta', async () => {
    const a = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } });
    await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } }); // empresa B, irrelevante
    // Empresa A tem 1 admin; desativar deve ser negado apesar de B ter admin.
    assert.equal(await esperaFalhaUltimoAdmin(atualizar(a.empresaId, a.ids.a, { status: 'inativo' })), true);
    assert.equal(await adminsValidos(a.empresaId), 1);
  });

  test('exclusão: excluir o último admin é negada; com 2, excluir um é permitido', async () => {
    const solo = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' } });
    let falhou = false;
    try { await pool.query(`SELECT ${FN_DEL}($1,$2)`, [solo.ids.a, solo.empresaId]); }
    catch (e) { falhou = /ultimo_admin/.test(String(e.message || '')); }
    assert.equal(falhou, true);
    assert.equal(await adminsValidos(solo.empresaId), 1);

    const par = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' }, b: { tipo: 'admin', status: 'ativo' } });
    await pool.query(`SELECT ${FN_DEL}($1,$2)`, [par.ids.a, par.empresaId]);
    assert.equal(await adminsValidos(par.empresaId), 1);
  });

  test('concorrência: duas remoções simultâneas dos dois admins → no máximo uma passa', async () => {
    const { empresaId, ids } = await seedEmpresa({ a: { tipo: 'admin', status: 'ativo' }, b: { tipo: 'admin', status: 'ativo' } });

    const ca = new Client({ connectionString: CONN });
    const cb = new Client({ connectionString: CONN });
    await ca.connect();
    await cb.connect();
    try {
      // A abre transação e rebaixa 'a' — mantém o advisory lock do tenant preso.
      await ca.query('BEGIN');
      await ca.query(`SELECT ${FN_UPD}($1,$2,'{"tipo":"operador"}'::jsonb)`, [ids.a, empresaId]);

      // B tenta rebaixar 'b' concorrentemente — bloqueia no advisory lock.
      const bPromise = cb.query(`SELECT ${FN_UPD}($1,$2,'{"tipo":"operador"}'::jsonb)`, [ids.b, empresaId]);
      await new Promise((r) => setTimeout(r, 250)); // deixa B bloquear

      await ca.query('COMMIT'); // libera o lock; 'a' já rebaixado

      let bFalhou = false;
      try { await bPromise; } catch (e) { bFalhou = /ultimo_admin/.test(String(e.message || '')); }
      assert.equal(bFalhou, true, 'a segunda remoção concorrente deve ser negada');
    } finally {
      try { await ca.query('ROLLBACK'); } catch { /* já commitado */ }
      await ca.end();
      await cb.end();
    }

    assert.equal(await adminsValidos(empresaId), 1); // empresa termina com >= 1 admin
  });
}
