import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { criarDepsSupabase } = require('../services/billing/billingSupabaseDeps');
const {
  calcularValorMensalComposicao,
  planejarBilling,
} = require('../services/billing/billingOrchestratorDomainService');

const { Pool } = pg;
const CONN = process.env.DATABASE_URL;

if (!CONN) {
  test('billing add-ons PG model (pulado: sem DATABASE_URL)', { skip: true }, () => {});
} else {
  registrar();
}

function supabasePg(pool) {
  return {
    from(table) {
      return new Query(pool, table);
    },
  };
}

class Query {
  constructor(pool, table) {
    this.pool = pool;
    this.table = table;
    this.fields = '*';
    this.filters = [];
    this.notFilters = [];
    this.inFilters = [];
  }

  select(fields) {
    this.fields = fields || '*';
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  not(field, op, value) {
    this.notFilters.push({ field, op, value });
    return this;
  }

  in(field, values) {
    this.inFilters.push({ field, values });
    return this;
  }

  async then(resolve, reject) {
    try {
      resolve(await this._run());
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  async _run() {
    const params = [];
    const where = [];
    for (const f of this.filters) {
      params.push(f.value);
      where.push(`${f.field} = $${params.length}`);
    }
    for (const f of this.notFilters) {
      if (f.op === 'is' && f.value === null) where.push(`${f.field} IS NOT NULL`);
      else throw new Error(`not nao suportado no teste: ${f.field}/${f.op}`);
    }
    for (const f of this.inFilters) {
      params.push(f.values);
      where.push(`${f.field} = ANY($${params.length}::uuid[])`);
    }
    const sql = `SELECT ${this.fields} FROM public.${this.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const { rows } = await this.pool.query(sql, params);
    return { data: rows, error: null };
  }
}

function uuid() {
  return randomUUID();
}

function sha() {
  return 'a'.repeat(64);
}

async function inserirContrato(pool, empresaId, status) {
  const id = uuid();
  await pool.query(
    `INSERT INTO public.contratos_comerciais (id, empresa_id, status, aceito_em)
     VALUES ($1, $2, $3, CASE WHEN $3 IN ('plenamente_assinado','assinado','aceito_manualmente') THEN now() ELSE NULL END)`,
    [id, empresaId, status],
  );
  return id;
}

async function inserirAddon(pool, empresaId, funcionalidadeId, patch = {}) {
  const id = uuid();
  await pool.query(
    `INSERT INTO public.empresa_funcionalidades
      (id, empresa_id, funcionalidade_id, status, origem, preco_mensal_centavos, quantidade,
       vigencia_inicio, vigencia_fim, aprovado_por, contrato_id, aditivo_id, billing_component_id)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12)`,
    [
      id,
      empresaId,
      funcionalidadeId,
      patch.status || 'ativa',
      patch.origem || 'adicional',
      patch.preco_mensal_centavos ?? 5000,
      patch.quantidade ?? null,
      patch.vigencia_inicio ?? null,
      patch.vigencia_fim ?? null,
      patch.contrato_id ?? null,
      patch.aditivo_id ?? null,
      patch.billing_component_id ?? null,
    ],
  );
  return id;
}

function valorCom(addOns, agora = '2026-08-10T00:00:00.000Z') {
  return calcularValorMensalComposicao({
    snapshot: { valor_mensal: 299.9 },
    addOns,
    agora: new Date(agora),
  });
}

function planejarCom(addOns, billingValor = 299.9, agora = '2026-08-10T00:00:00.000Z') {
  return planejarBilling({
    situacao: { situacao: 'ativa' },
    empresaBilling: { asaas_customer_id: 'cus', asaas_subscription_id: 'sub', billing_valor_mensal: billingValor },
    snapshot: { valor_mensal: 299.9 },
    addOns,
    agora: new Date(agora),
  });
}

function registrar() {
  const pool = new Pool({ connectionString: CONN, max: 4 });
  const ids = { empresa: uuid(), func: uuid() };

  before(async () => {
    await pool.query(`INSERT INTO public.empresas (id, nome) VALUES ($1, 'E2E-ADDON-DB')`, [ids.empresa]);
    await pool.query(
      `INSERT INTO public.funcionalidades (id, codigo, nome, modelo_cobranca)
       VALUES ($1, 'addon_pg_' || replace($1::text, '-', ''), 'Addon PG', 'adicional')`,
      [ids.func],
    );
  });

  after(async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]).catch(() => {});
    await pool.query('DELETE FROM public.contratos_comerciais WHERE empresa_id = $1', [ids.empresa]).catch(() => {});
    await pool.query('DELETE FROM public.funcionalidades WHERE id = $1', [ids.func]).catch(() => {});
    await pool.query('DELETE FROM public.empresas WHERE id = $1', [ids.empresa]).catch(() => {});
    await pool.end();
  });

  test('carregarAddOns usa modelo real: sem aceite nao compoe; contrato concluido compoe', async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    await inserirAddon(pool, ids.empresa, ids.func);
    let addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(addOns.length, 1);
    assert.equal(valorCom(addOns), 299.9);
    assert.ok(planejarCom(addOns).acoes.find((a) => a.tipo === 'addon_sem_aceite_billing'));

    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    const contratoId = await inserirContrato(pool, ids.empresa, 'plenamente_assinado');
    await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoId });
    addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(addOns[0].contrato_billing_status, 'plenamente_assinado');
    assert.equal(valorCom(addOns), 349.9);
  });

  test('contrato concluido de outro tenant nao autoriza add-on', async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    const outraEmpresa = uuid();
    await pool.query(`INSERT INTO public.empresas (id, nome) VALUES ($1, 'E2E-ADDON-OUTRO')`, [outraEmpresa]);
    try {
      const contratoOutro = await inserirContrato(pool, outraEmpresa, 'plenamente_assinado');
      await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoOutro });
      const addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
      assert.equal(addOns[0].contrato_billing_status, null);
      assert.equal(valorCom(addOns), 299.9);
      assert.ok(planejarCom(addOns).acoes.find((a) => a.tipo === 'addon_sem_aceite_billing'));
    } finally {
      await pool.query('DELETE FROM public.contratos_comerciais WHERE empresa_id = $1', [outraEmpresa]).catch(() => {});
      await pool.query('DELETE FROM public.empresas WHERE id = $1', [outraEmpresa]).catch(() => {});
    }
  });

  test('carregarAddOns respeita vigencia real de inicio e fim', async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    const contratoId = await inserirContrato(pool, ids.empresa, 'plenamente_assinado');
    await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoId, vigencia_inicio: '2026-09-01T00:00:00.000Z' });
    let addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(valorCom(addOns, '2026-08-10T00:00:00.000Z'), 299.9);

    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoId, vigencia_fim: '2026-08-01T00:00:00.000Z' });
    addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(valorCom(addOns, '2026-08-10T00:00:00.000Z'), 299.9);
    const plano = planejarCom(addOns, 349.9, '2026-08-10T00:00:00.000Z');
    assert.equal(plano.acoes.find((a) => a.tipo === 'atualizar_assinatura_valor').valor_mensal, 299.9);
  });

  test('quantidade nao multiplica preco total negociado; invalida falha fechada', async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    const contratoId = await inserirContrato(pool, ids.empresa, 'plenamente_assinado');
    await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoId, quantidade: 3, preco_mensal_centavos: 5000 });
    let addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(valorCom(addOns), 349.9, 'R$ 50 total, nao R$ 150');

    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    await inserirAddon(pool, ids.empresa, ids.func, { contrato_id: contratoId, quantidade: 0, preco_mensal_centavos: 5000 });
    addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(valorCom(addOns), 299.9);
    assert.ok(planejarCom(addOns).acoes.find((a) => a.tipo === 'addon_quantidade_invalida_billing'));
  });

  test('revogacao/expiracao reduz proximo ciclo e preserva historico pago', async () => {
    await pool.query('DELETE FROM public.empresa_funcionalidades WHERE empresa_id = $1', [ids.empresa]);
    const contratoId = await inserirContrato(pool, ids.empresa, 'plenamente_assinado');
    await inserirAddon(pool, ids.empresa, ids.func, {
      contrato_id: contratoId,
      status: 'inativa',
      billing_component_id: 'pay_pago_sintetico',
    });
    const addOns = await criarDepsSupabase(supabasePg(pool)).carregarAddOns(ids.empresa);
    assert.equal(addOns.length, 1, 'registro historico com componente ainda e carregado para convergencia');
    const plano = planejarCom(addOns, 349.9);
    assert.equal(plano.acoes.find((a) => a.tipo === 'atualizar_assinatura_valor').valor_mensal, 299.9);
    assert.equal(plano.acoes.find((a) => a.tipo === 'remover_addon'), undefined);
  });
}
