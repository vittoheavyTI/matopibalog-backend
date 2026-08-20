// PG real (CI): valida a migration 072 (Permissões V9 — templates + overrides +
// visibility + guardas de governança) contra Postgres efêmero. Cobre:
//   - SEED idempotente de templates baseline por empresa (9 stable_keys);
//   - ASSIGNMENT por tipo legado (admin→administrador, motorista→motorista);
//   - preservação de EFETIVO: admin com menu legado off → override DENY .view
//     (governança users.manage/permissions.manage intacta); motorista com
//     pode_finalizar_viagem=true → override ALLOW freight.finish;
//   - guarda do ÚLTIMO ADMIN na atribuição de template e no override de governança;
//   - RLS habilitada + idempotência (reaplicar não duplica/erra).
// Nunca roda contra produção: exige DATABASE_URL do banco de teste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('permissões 072 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql072 = readFileSync(join(here, '..', 'migrations', '072_permissions_templates_overrides.sql'), 'utf8');

  // Ids fixos e distintos (DB compartilhado entre pgtests).
  const EMP = '72000000-0000-4000-a000-000000000001';
  const EMP2 = '72000000-0000-4000-a000-000000000002';
  const EMP3 = '72000000-0000-4000-a000-000000000003'; // exatamente 2 admins (concorrência)
  const ADMIN1 = '72000000-0000-4000-a000-0000000000a1'; // menu usuarios=false
  const ADMIN2 = '72000000-0000-4000-a000-0000000000a2'; // admin "normal"
  const MOTO1 = '72000000-0000-4000-a000-0000000000b1';  // pode_finalizar=true
  const MOTO2 = '72000000-0000-4000-a000-0000000000b2';  // pode_finalizar=false
  const ADMIN_SOLO = '72000000-0000-4000-a000-0000000000c1'; // único admin da EMP2
  const ADM_X = '72000000-0000-4000-a000-0000000000d1'; // EMP3 governance admin
  const ADM_Y = '72000000-0000-4000-a000-0000000000d2'; // EMP3 governance admin

  const pool = new Pool({ connectionString: CONN });

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome) VALUES ($1,'PG072 Emp'),($2,'PG072 Emp2'),($3,'PG072 Emp3') ON CONFLICT (id) DO NOTHING`, [EMP, EMP2, EMP3]);
    const users = [
      [ADMIN1, EMP, 'admin', 'ativo', JSON.stringify({ usuarios: false, dashboard: true, motoristas: true, relatorios: true, configuracoes: false })],
      [ADMIN2, EMP, 'admin', 'ativo', JSON.stringify({ usuarios: true, dashboard: true, motoristas: true, relatorios: true, configuracoes: true })],
      [MOTO1, EMP, 'motorista', 'ativo', null],
      [MOTO2, EMP, 'motorista', 'ativo', null],
      [ADMIN_SOLO, EMP2, 'admin', 'ativo', JSON.stringify({ usuarios: true, configuracoes: true })],
      [ADM_X, EMP3, 'admin', 'ativo', JSON.stringify({ usuarios: true, configuracoes: true })],
      [ADM_Y, EMP3, 'admin', 'ativo', JSON.stringify({ usuarios: true, configuracoes: true })],
    ];
    for (const [id, emp, tipo, status, perms] of users) {
      await pool.query(
        `INSERT INTO public.usuarios (id, empresa_id, tipo, status, permissoes)
         VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE
           SET empresa_id=EXCLUDED.empresa_id, tipo=EXCLUDED.tipo, status=EXCLUDED.status, permissoes=EXCLUDED.permissoes,
               permission_template_id = NULL`,
        [id, emp, tipo, status, perms]
      );
    }
    await pool.query(`INSERT INTO public.motoristas (id, empresa_id, pode_finalizar_viagem) VALUES ($1,$2,true),($3,$4,false)
      ON CONFLICT (id) DO UPDATE SET pode_finalizar_viagem=EXCLUDED.pode_finalizar_viagem`, [MOTO1, EMP, MOTO2, EMP]);

    // Limpa overrides/templates de execuções anteriores desta empresa e reaplica 072
    // (o apply_schema roda 072 ANTES de existirem usuários → seed vazio).
    await pool.query(`DELETE FROM public.user_permission_overrides WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`UPDATE public.usuarios SET permission_template_id=NULL WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(sql072);
  });

  after(async () => {
    await pool.query(`DELETE FROM public.user_permission_overrides WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`DELETE FROM public.permission_template_permissions WHERE template_id IN (SELECT id FROM public.permission_templates WHERE empresa_id IN ($1,$2,$3))`, [EMP, EMP2, EMP3]);
    await pool.query(`DELETE FROM public.motoristas WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`UPDATE public.usuarios SET permission_template_id=NULL WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`DELETE FROM public.permission_templates WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`DELETE FROM public.usuarios WHERE empresa_id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.query(`DELETE FROM public.empresas WHERE id IN ($1,$2,$3)`, [EMP, EMP2, EMP3]);
    await pool.end();
  });

  test('seed: 9 templates baseline por empresa + baseline correto', async () => {
    const { rows } = await pool.query(`SELECT stable_key FROM public.permission_templates WHERE empresa_id=$1 ORDER BY stable_key`, [EMP]);
    assert.equal(rows.length, 9);
    const keys = rows.map((r) => r.stable_key);
    for (const k of ['administrador', 'operador', 'gerente_frota', 'gerente_filial', 'gerente_regional', 'gerente_nacional', 'financeiro', 'embarcador', 'motorista']) {
      assert.ok(keys.includes(k), `falta template ${k}`);
    }
    // administrador tem permissions.manage; operador não; motorista sem freight.finish
    const has = async (sk, pk) => (await pool.query(
      `SELECT 1 FROM public.permission_template_permissions p JOIN public.permission_templates t ON t.id=p.template_id
       WHERE t.empresa_id=$1 AND t.stable_key=$2 AND p.permission_key=$3 AND p.allowed`, [EMP, sk, pk])).rowCount > 0;
    assert.equal(await has('administrador', 'permissions.manage'), true);
    assert.equal(await has('operador', 'permissions.manage'), false);
    assert.equal(await has('operador', 'finance.operational.view'), false);
    assert.equal(await has('motorista', 'freight.view'), true);
    assert.equal(await has('motorista', 'freight.finish'), false);
    // visibility policy default no template motorista
    const { rows: mv } = await pool.query(`SELECT driver_financial_visibility_mode m FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='motorista'`, [EMP]);
    assert.equal(mv[0].m, 'commission_only');
  });

  test('assignment: admin→administrador, motorista→motorista', async () => {
    const tid = async (sk) => (await pool.query(`SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key=$2`, [EMP, sk])).rows[0].id;
    const admTpl = await tid('administrador');
    const motTpl = await tid('motorista');
    const { rows: a } = await pool.query(`SELECT permission_template_id FROM public.usuarios WHERE id=$1`, [ADMIN2]);
    const { rows: m } = await pool.query(`SELECT permission_template_id FROM public.usuarios WHERE id=$1`, [MOTO1]);
    assert.equal(a[0].permission_template_id, admTpl);
    assert.equal(m[0].permission_template_id, motTpl);
  });

  test('preservação: admin menu off → override DENY .view; governança intacta', async () => {
    const ov = async (uid, pk) => (await pool.query(`SELECT effect FROM public.user_permission_overrides WHERE usuario_id=$1 AND permission_key=$2`, [uid, pk])).rows[0]?.effect || null;
    assert.equal(await ov(ADMIN1, 'users.view'), 'deny');
    assert.equal(await ov(ADMIN1, 'company.settings.view'), 'deny');
    // governança NUNCA foi negada:
    assert.equal(await ov(ADMIN1, 'users.manage'), null);
    assert.equal(await ov(ADMIN1, 'permissions.manage'), null);
    // admin "normal" não ganhou overrides:
    assert.equal(await ov(ADMIN2, 'users.view'), null);
  });

  test('preservação: motorista pode_finalizar=true → override ALLOW freight.finish', async () => {
    const ov = async (uid, pk) => (await pool.query(`SELECT effect FROM public.user_permission_overrides WHERE usuario_id=$1 AND permission_key=$2`, [uid, pk])).rows[0]?.effect || null;
    assert.equal(await ov(MOTO1, 'freight.finish'), 'allow');
    assert.equal(await ov(MOTO2, 'freight.finish'), null);
  });

  test('guarda último admin: atribuir template não-admin ao único admin → erro', async () => {
    const opTpl = (await pool.query(`SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='operador'`, [EMP2])).rows[0].id;
    await assert.rejects(
      pool.query(`SELECT public.atribuir_template_guardando_ultimo_admin($1,$2,$3,$4)`, [ADMIN_SOLO, EMP2, opTpl, ADMIN_SOLO]),
      /ultimo_admin_da_empresa/
    );
  });

  test('guarda último admin: com 2 admins um pode ser rebaixado', async () => {
    const opTpl = (await pool.query(`SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='operador'`, [EMP]))?.rows[0].id;
    // EMP tem ADMIN1 e ADMIN2; rebaixar ADMIN1 deve passar.
    await pool.query(`SELECT public.atribuir_template_guardando_ultimo_admin($1,$2,$3,$4)`, [ADMIN1, EMP, opTpl, ADMIN2]);
    const { rows } = await pool.query(`SELECT tipo FROM public.usuarios WHERE id=$1`, [ADMIN1]);
    assert.equal(rows[0].tipo, 'operador');
    // restaura para não afetar outros testes de ordem
    const admTpl = (await pool.query(`SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='administrador'`, [EMP])).rows[0].id;
    await pool.query(`SELECT public.atribuir_template_guardando_ultimo_admin($1,$2,$3,$4)`, [ADMIN1, EMP, admTpl, ADMIN2]);
  });

  test('guarda: override DENY permissions.manage no último admin → erro', async () => {
    await assert.rejects(
      pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'permissions.manage','deny',$3)`, [ADMIN_SOLO, EMP2, ADMIN_SOLO]),
      /ultimo_admin_da_empresa/
    );
  });

  test('override RPC: set allow e depois inherit (remove)', async () => {
    await pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'finance.operational.view','allow',$3)`, [MOTO2, EMP, ADMIN2]);
    let { rows } = await pool.query(`SELECT effect FROM public.user_permission_overrides WHERE usuario_id=$1 AND permission_key='finance.operational.view'`, [MOTO2]);
    assert.equal(rows[0].effect, 'allow');
    await pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'finance.operational.view','inherit',$3)`, [MOTO2, EMP, ADMIN2]);
    ({ rows } = await pool.query(`SELECT effect FROM public.user_permission_overrides WHERE usuario_id=$1 AND permission_key='finance.operational.view'`, [MOTO2]));
    assert.equal(rows.length, 0);
  });

  test('RLS habilitada nas tabelas novas', async () => {
    const { rows } = await pool.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1::text[])`,
      [['permission_templates', 'permission_template_permissions', 'user_permission_overrides', 'permission_change_events']]
    );
    for (const r of rows) assert.equal(r.relrowsecurity, true, `${r.relname} sem RLS`);
    assert.equal(rows.length, 4);
  });

  test('idempotência: reaplicar 072 não duplica templates', async () => {
    await pool.query(sql072);
    const { rows } = await pool.query(`SELECT count(*)::int n FROM public.permission_templates WHERE empresa_id=$1`, [EMP]);
    assert.equal(rows[0].n, 9);
  });

  // ── GOVERNANCE ADMIN V9 (efetivo) ──────────────────────────────────────────
  test('governance helpers: admin=governance, motorista=não', async () => {
    const gov = async (uid, emp) => (await pool.query(`SELECT public.eh_governance_admin($1,$2) g`, [uid, emp])).rows[0].g;
    assert.equal(await gov(ADMIN2, EMP), true);
    assert.equal(await gov(MOTO1, EMP), false);
    assert.equal(await gov(ADMIN_SOLO, EMP2), true);
    const n = (await pool.query(`SELECT public.contar_governance_admins($1,NULL) n`, [EMP2])).rows[0].n;
    assert.equal(n, 1);
  });

  test('override governança: 2 admins — negar permissions.manage em um passa; no segundo 409', async () => {
    // EMP tem ADMIN1 e ADMIN2 (ambos administrador → governance). Negar em ADMIN1 passa.
    await pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'permissions.manage','deny',$3)`, [ADMIN1, EMP, ADMIN2]);
    assert.equal((await pool.query(`SELECT public.eh_governance_admin($1,$2) g`, [ADMIN1, EMP])).rows[0].g, false);
    // agora só ADMIN2 é governance; negar nele → 409
    await assert.rejects(
      pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'permissions.manage','deny',$3)`, [ADMIN2, EMP, ADMIN1]),
      /ultimo_admin_da_empresa/
    );
    // restaurar ADMIN1 (inherit) → volta a ser governance
    await pool.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'permissions.manage','inherit',$3)`, [ADMIN1, EMP, ADMIN2]);
    assert.equal((await pool.query(`SELECT public.eh_governance_admin($1,$2) g`, [ADMIN1, EMP])).rows[0].g, true);
  });

  test('guard de edição de template: remover permissions.manage do administrador (EMP2, único admin) → 409', async () => {
    const admTpl = (await pool.query(`SELECT id FROM public.permission_templates WHERE empresa_id=$1 AND stable_key='administrador'`, [EMP2])).rows[0].id;
    await assert.rejects(
      pool.query(`SELECT public.atualizar_template_permissions_guardando_governanca($1,$2,$3::text[],$4::text[],$5)`,
        [admTpl, EMP2, ['company.settings.view'], ['permissions.manage','users.manage'], ADMIN_SOLO]),
      /ultimo_admin_da_empresa/
    );
    // permissions.manage continua no template (rollback):
    const still = (await pool.query(`SELECT 1 FROM public.permission_template_permissions WHERE template_id=$1 AND permission_key='permissions.manage' AND allowed`, [admTpl])).rowCount;
    assert.equal(still, 1);
  });

  // ── RPCs LEGADO (069) com GOVERNANÇA V9 (Review 2.3) ────────────────────────
  test('legacy UPDATE: desativar (status) o único governance admin (EMP2) → 409, sem mutação', async () => {
    await assert.rejects(
      pool.query(`SELECT public.atualizar_usuario_guardando_ultimo_admin($1,$2,$3::jsonb)`,
        [ADMIN_SOLO, EMP2, JSON.stringify({ status: 'inativo' })]),
      /ultimo_admin_da_empresa/
    );
    const { rows } = await pool.query(`SELECT status FROM public.usuarios WHERE id=$1`, [ADMIN_SOLO]);
    assert.equal(rows[0].status, 'ativo'); // rollback preservou o estado
  });

  test('legacy UPDATE: rebaixar tipo do único governance admin (EMP2) → 409, sem mutação', async () => {
    await assert.rejects(
      pool.query(`SELECT public.atualizar_usuario_guardando_ultimo_admin($1,$2,$3::jsonb)`,
        [ADMIN_SOLO, EMP2, JSON.stringify({ tipo: 'operador' })]),
      /ultimo_admin_da_empresa/
    );
    const { rows } = await pool.query(`SELECT tipo FROM public.usuarios WHERE id=$1`, [ADMIN_SOLO]);
    assert.equal(rows[0].tipo, 'admin');
  });

  test('legacy DELETE: excluir o único governance admin (EMP2) → 409, usuário permanece', async () => {
    await assert.rejects(
      pool.query(`SELECT public.excluir_usuario_guardando_ultimo_admin($1,$2)`, [ADMIN_SOLO, EMP2]),
      /ultimo_admin_da_empresa/
    );
    const { rows } = await pool.query(`SELECT 1 FROM public.usuarios WHERE id=$1`, [ADMIN_SOLO]);
    assert.equal(rows.length, 1);
  });

  test('legacy UPDATE: atualizar campo neutro (nome) do único admin passa (governança mantida)', async () => {
    await pool.query(`SELECT public.atualizar_usuario_guardando_ultimo_admin($1,$2,$3::jsonb)`,
      [ADMIN_SOLO, EMP2, JSON.stringify({ nome: 'Solo Renomeado' })]);
    const { rows } = await pool.query(`SELECT nome, tipo, status FROM public.usuarios WHERE id=$1`, [ADMIN_SOLO]);
    assert.equal(rows[0].nome, 'Solo Renomeado');
    assert.equal(rows[0].tipo, 'admin');
    assert.equal(rows[0].status, 'ativo');
  });

  // ── CONCORRÊNCIA REAL (advisory xact lock por empresa) ──────────────────────
  test('concorrência: 2 governance admins (EMP3), remoção simultânea da governança → no máximo 1 passa', async () => {
    // sanidade: EMP3 começa com 2 governance admins
    assert.equal((await pool.query(`SELECT public.contar_governance_admins($1,NULL) n`, [EMP3])).rows[0].n, 2);

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    const worker = async (client, userId) => {
      try {
        await client.query('BEGIN');
        await client.query(`SELECT public.set_user_override_guardando_governanca($1,$2,'permissions.manage','deny',$3)`, [userId, EMP3, userId]);
        await client.query('COMMIT');
        return 'ok';
      } catch {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
        return 'fail';
      }
    };
    try {
      const resultados = await Promise.all([worker(c1, ADM_X), worker(c2, ADM_Y)]);
      const oks = resultados.filter((r) => r === 'ok').length;
      assert.equal(oks, 1, 'exatamente uma transação remove governança');
      // a empresa NUNCA fica com zero governance admin
      const n = (await pool.query(`SELECT public.contar_governance_admins($1,NULL) n`, [EMP3])).rows[0].n;
      assert.equal(n, 1, 'EMP3 retém exatamente 1 governance admin');
    } finally {
      c1.release(); c2.release();
    }
  });

  test('tenant isolation: governance admins contados só na própria empresa', async () => {
    // EMP tem 2 admins; EMP2 tem 1; contagem não vaza entre tenants.
    const nEmp = (await pool.query(`SELECT public.contar_governance_admins($1,NULL) n`, [EMP])).rows[0].n;
    const nEmp2 = (await pool.query(`SELECT public.contar_governance_admins($1,NULL) n`, [EMP2])).rows[0].n;
    assert.ok(nEmp >= 2);
    assert.equal(nEmp2, 1);
  });
}
