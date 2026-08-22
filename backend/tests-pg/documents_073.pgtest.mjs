// PG real (CI): certifica a migration 073 sobre o baseline de documentos
// existente (026/048/049/050) apos o schema de teste atual chegar ate 072.
// Nunca roda contra producao: exige DATABASE_URL do Postgres efemero da CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('documents 073 PG (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function registrar() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = (name) => readFileSync(join(here, '..', 'migrations', name), 'utf8');
  const sqls = [
    migration('026_create_frete_documentos.sql'),
    migration('048_create_frete_epod.sql'),
    migration('049_create_frete_ocorrencias.sql'),
    migration('050_epod_evidencia_status.sql'),
    migration('073_documents_foundation_security_web.sql'),
  ];
  const sql073 = sqls.at(-1);

  const EMP_A = '07300000-0000-4000-a000-000000000001';
  const EMP_B = '07300000-0000-4000-a000-000000000002';
  const ADM_A = '07300000-0000-4000-a000-0000000000a1';
  const ADM_B = '07300000-0000-4000-a000-0000000000b1';
  const MOT_A = '07300000-0000-4000-a000-0000000000c1';
  const MOT_B = '07300000-0000-4000-a000-0000000000d1';
  const FRETE_A = '07300000-0000-4000-a000-000000000101';
  const FRETE_A2 = '07300000-0000-4000-a000-000000000102';
  const FRETE_B = '07300000-0000-4000-a000-000000000201';
  const DOC_A = '07300000-0000-4000-a000-000000001001';
  const DOC_B = '07300000-0000-4000-a000-000000001002';
  const EPOD_A = '07300000-0000-4000-a000-000000002001';
  const OCOR_A = '07300000-0000-4000-a000-000000003001';

  const pool = new Pool({ connectionString: CONN });

  async function withAuth(uid, fn) {
    const client = await pool.connect();
    await client.query('SET ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    try {
      return await fn(client);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query(`SELECT set_config('request.jwt.claim.sub', '', false)`).catch(() => {});
      client.release();
    }
  }

  before(async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT COALESCE((SELECT is_super_admin FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_is_company_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT COALESCE((SELECT tipo = 'admin' FROM usuarios WHERE id = auth.uid()), false) $$;
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.rls_empresa_id()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$ SELECT empresa_id FROM usuarios WHERE id = auth.uid() $$;
    `);

    for (const sql of sqls) await pool.query(sql);
    await pool.query(sql073); // idempotencia: reaplica a 073 explicitamente.

    await pool.query(
      `INSERT INTO public.empresas (id, nome) VALUES ($1,'Docs 073 A'),($2,'Docs 073 B')
       ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
      [EMP_A, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.usuarios (id, empresa_id, tipo, status, is_super_admin)
       VALUES ($1,$5,'admin','ativo',false),($2,$6,'admin','ativo',false),($3,$5,'motorista','ativo',false),($4,$6,'motorista','ativo',false)
       ON CONFLICT (id) DO UPDATE SET empresa_id=EXCLUDED.empresa_id, tipo=EXCLUDED.tipo, status=EXCLUDED.status, is_super_admin=EXCLUDED.is_super_admin`,
      [ADM_A, ADM_B, MOT_A, MOT_B, EMP_A, EMP_B],
    );
    await pool.query(
      `INSERT INTO public.fretes (id, empresa_id, motorista_id, status)
       VALUES ($1,$4,$6,'ativo'),($2,$4,$6,'ativo'),($3,$5,$7,'ativo')
       ON CONFLICT (id) DO UPDATE SET empresa_id=EXCLUDED.empresa_id, motorista_id=EXCLUDED.motorista_id, status=EXCLUDED.status`,
      [FRETE_A, FRETE_A2, FRETE_B, EMP_A, EMP_B, MOT_A, MOT_B],
    );
  });

  after(async () => {
    await pool.query(`DELETE FROM public.frete_documento_participantes WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_documento_eventos WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_ocorrencia_evidencias WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_ocorrencias WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_epod_evidencias WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_epod WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.frete_documentos WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.fretes WHERE empresa_id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.query(`DELETE FROM public.usuarios WHERE id IN ($1,$2,$3,$4)`, [ADM_A, ADM_B, MOT_A, MOT_B]).catch(() => {});
    await pool.query(`DELETE FROM public.empresas WHERE id IN ($1,$2)`, [EMP_A, EMP_B]).catch(() => {});
    await pool.end();
  });

  test('073 cria tabelas, colunas, checks e indexes esperados', async () => {
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name = ANY($1::text[]) ORDER BY table_name`,
      [['frete_documento_eventos', 'frete_documento_participantes']],
    );
    assert.deepEqual(tables.map((r) => r.table_name), ['frete_documento_eventos', 'frete_documento_participantes']);

    const { rows: columns } = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema='public'
         AND ((table_name='frete_documentos' AND column_name = ANY($1::text[]))
           OR (table_name='frete_epod_evidencias' AND column_name = ANY($2::text[]))
           OR (table_name='frete_ocorrencia_evidencias' AND column_name = ANY($2::text[])))
       ORDER BY table_name, column_name`,
      [
        ['cancelado_em', 'cancelado_por', 'cancelamento_motivo', 'client_request_id', 'descricao', 'document_contract_version', 'nome_documento', 'status', 'updated_at'],
        ['client_request_id', 'updated_at'],
      ],
    );
    assert.equal(columns.length, 13);

    const { rows: constraints } = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conname = ANY($1::text[]) ORDER BY conname`,
      [['frete_documentos_status_check', 'frete_documentos_contract_version_check']],
    );
    assert.deepEqual(constraints.map((r) => r.conname), ['frete_documentos_contract_version_check', 'frete_documentos_status_check']);

    const { rows: indexes } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
      [[
        'frete_documento_eventos_documento_idx',
        'frete_documento_eventos_frete_idx',
        'frete_documento_participantes_documento_idx',
        'frete_documentos_client_request_key',
        'frete_documentos_status_idx',
        'frete_epod_evidencias_client_request_key',
        'frete_ocorrencia_evidencias_client_request_key',
      ]],
    );
    assert.equal(indexes.length, 7);
  });

  test('073 preserva backend legado: tipo outro sem metadata continua gravando', async () => {
    const { rows } = await pool.query(
      `INSERT INTO public.frete_documentos (id, frete_id, empresa_id, tipo, storage_path, nome_arquivo, mime, tamanho_bytes, criado_por)
       VALUES ($1,$2,$3,'outro','073/a/legacy-outro.pdf','legacy.pdf','application/pdf',123,$4)
       RETURNING document_contract_version, status, nome_documento, descricao, client_request_id`,
      [DOC_A, FRETE_A, EMP_A, MOT_A],
    );
    assert.equal(rows[0].document_contract_version, 1);
    assert.equal(rows[0].status, 'ativo');
    assert.equal(rows[0].nome_documento, null);
    assert.equal(rows[0].descricao, null);
    assert.equal(rows[0].client_request_id, null);
  });

  test('073 constraints bloqueiam status/version invalidos', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, status)
         VALUES ($1,$2,'cte','073/a/status-invalido.pdf','apagado')`,
        [FRETE_A, EMP_A],
      ),
      /frete_documentos_status_check/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, document_contract_version)
         VALUES ($1,$2,'cte','073/a/version-invalida.pdf',3)`,
        [FRETE_A, EMP_A],
      ),
      /frete_documentos_contract_version_check/,
    );
  });

  test('073 idempotencia DB: escopo por frete+autor+client_request_id', async () => {
    await pool.query(
      `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,'cte','073/a/idem-1.pdf',$3,'same-key-073')`,
      [FRETE_A, EMP_A, MOT_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, criado_por, client_request_id)
         VALUES ($1,$2,'mdfe','073/a/idem-1-diff.pdf',$3,'same-key-073')`,
        [FRETE_A, EMP_A, MOT_A],
      ),
      /frete_documentos_client_request_key/,
    );
    await pool.query(
      `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,'cte','073/a2/idem-1.pdf',$3,'same-key-073')`,
      [FRETE_A2, EMP_A, MOT_A],
    );
    await pool.query(
      `INSERT INTO public.frete_documentos (frete_id, empresa_id, tipo, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,'cte','073/b/idem-1.pdf',$3,'same-key-073')`,
      [FRETE_B, EMP_B, MOT_B],
    );
  });

  test('073 idempotencia DB cobre evidencias ePOD e ocorrencia', async () => {
    await pool.query(
      `INSERT INTO public.frete_epod (id, frete_id, empresa_id, criado_por) VALUES ($1,$2,$3,$4)
       ON CONFLICT (frete_id) DO NOTHING`,
      [EPOD_A, FRETE_A, EMP_A, MOT_A],
    );
    await pool.query(
      `INSERT INTO public.frete_ocorrencias (id, frete_id, empresa_id, tipo, descricao, criado_por)
       VALUES ($1,$2,$3,'outro','teste 073',$4) ON CONFLICT (id) DO NOTHING`,
      [OCOR_A, FRETE_A, EMP_A, MOT_A],
    );
    await pool.query(
      `INSERT INTO public.frete_epod_evidencias (epod_id, frete_id, empresa_id, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,$3,'073/a/epod-1.jpg',$4,'ev-key-073')`,
      [EPOD_A, FRETE_A, EMP_A, MOT_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.frete_epod_evidencias (epod_id, frete_id, empresa_id, storage_path, criado_por, client_request_id)
         VALUES ($1,$2,$3,'073/a/epod-dup.jpg',$4,'ev-key-073')`,
        [EPOD_A, FRETE_A, EMP_A, MOT_A],
      ),
      /frete_epod_evidencias_client_request_key/,
    );
    await pool.query(
      `INSERT INTO public.frete_ocorrencia_evidencias (ocorrencia_id, frete_id, empresa_id, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,$3,'073/a/ocor-1.jpg',$4,'oc-key-073')`,
      [OCOR_A, FRETE_A, EMP_A, MOT_A],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO public.frete_ocorrencia_evidencias (ocorrencia_id, frete_id, empresa_id, storage_path, criado_por, client_request_id)
         VALUES ($1,$2,$3,'073/a/ocor-dup.jpg',$4,'oc-key-073')`,
        [OCOR_A, FRETE_A, EMP_A, MOT_A],
      ),
      /frete_ocorrencia_evidencias_client_request_key/,
    );
  });

  test('073 RLS ligado e policies criadas para eventos/participantes', async () => {
    const { rows: rls } = await pool.query(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname = ANY($1::text[]) ORDER BY relname`,
      [['frete_documento_eventos', 'frete_documento_participantes']],
    );
    assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity]), [
      ['frete_documento_eventos', true],
      ['frete_documento_participantes', true],
    ]);
    const { rows: policies } = await pool.query(
      `SELECT policyname, cmd FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY($1::text[]) ORDER BY policyname`,
      [['frete_documento_eventos', 'frete_documento_participantes']],
    );
    assert.deepEqual(policies.map((r) => `${r.policyname}:${r.cmd}`), [
      'frete_documento_eventos_tenant_access:SELECT',
      'frete_documento_participantes_tenant_access:ALL',
    ]);
  });

  test('073 tenant RLS: admin e motorista so enxergam o proprio frete/empresa', async () => {
    await pool.query(
      `INSERT INTO public.frete_documentos (id, frete_id, empresa_id, tipo, storage_path, criado_por, client_request_id)
       VALUES ($1,$2,$3,'cte','073/a/tenant-doc.pdf',$4,'tenant-doc-a'),
              ($5,$6,$7,'cte','073/b/tenant-doc.pdf',$8,'tenant-doc-b')
       ON CONFLICT (id) DO NOTHING`,
      [DOC_A, FRETE_A, EMP_A, MOT_A, DOC_B, FRETE_B, EMP_B, MOT_B],
    );
    await pool.query(`
      GRANT SELECT ON public.usuarios, public.fretes, public.frete_documento_eventos TO authenticated;
      GRANT SELECT, INSERT ON public.frete_documento_participantes TO authenticated;
    `);
    await pool.query(
      `INSERT INTO public.frete_documento_eventos (documento_id, frete_id, empresa_id, evento, actor_id, actor_role)
       VALUES ($1,$2,$3,'uploaded',$4,'motorista'),($5,$6,$7,'uploaded',$8,'motorista')`,
      [DOC_A, FRETE_A, EMP_A, MOT_A, DOC_B, FRETE_B, EMP_B, MOT_B],
    );

    await withAuth(ADM_A, async (db) => {
      const { rows } = await db.query(`SELECT empresa_id FROM public.frete_documento_eventos ORDER BY empresa_id`);
      assert.deepEqual(rows.map((r) => r.empresa_id), [EMP_A]);
      await db.query(
        `INSERT INTO public.frete_documento_participantes (documento_id, frete_id, empresa_id, tipo, nome, criado_por)
         VALUES ($1,$2,$3,'recebedor','Recebedor A',$4)`,
        [DOC_A, FRETE_A, EMP_A, ADM_A],
      );
      await assert.rejects(
        db.query(
          `INSERT INTO public.frete_documento_participantes (documento_id, frete_id, empresa_id, tipo, nome, criado_por)
           VALUES ($1,$2,$3,'recebedor','Recebedor B indevido',$4)`,
          [DOC_B, FRETE_B, EMP_B, ADM_A],
        ),
        /row-level security|violates row-level/i,
      );
    });

    await withAuth(MOT_A, async (db) => {
      const { rows } = await db.query(`SELECT frete_id FROM public.frete_documento_eventos ORDER BY frete_id`);
      assert.deepEqual(rows.map((r) => r.frete_id), [FRETE_A]);
    });
  });
}
