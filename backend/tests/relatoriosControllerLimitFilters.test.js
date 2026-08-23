const test = require('node:test');
const assert = require('node:assert/strict');

const controllerPath = require.resolve('../controllers/relatoriosController');
const supabasePath = require.resolve('../config/supabase');
const operationalScopePath = require.resolve('../services/operationalScopeService');

class QueryBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.neqFilters = [];
    this.inFilters = [];
    this.rangeFilters = [];
    this.limitValue = null;
    this.singleMode = false;
    this.maybeSingleMode = false;
    this.db.calls.push(this);
  }

  select(columns) {
    this.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  neq(column, value) {
    this.neqFilters.push({ column, value });
    return this;
  }

  gte(column, value) {
    this.rangeFilters.push({ column, op: 'gte', value });
    return this;
  }

  lte(column, value) {
    this.rangeFilters.push({ column, op: 'lte', value });
    return this;
  }

  in(column, values) {
    this.inFilters.push({ column, values });
    return this;
  }

  order() {
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this;
  }

  single() {
    this.singleMode = true;
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  execute() {
    let rows = [...(this.db.rows[this.table] || [])];
    for (const filter of this.filters) {
      rows = rows.filter((row) => row[filter.column] === filter.value);
    }
    for (const filter of this.neqFilters) {
      rows = rows.filter((row) => row[filter.column] !== filter.value);
    }
    for (const filter of this.inFilters) {
      rows = rows.filter((row) => filter.values.includes(row[filter.column]));
    }
    for (const filter of this.rangeFilters) {
      rows = rows.filter((row) => {
        if (filter.op === 'gte') return String(row[filter.column]) >= String(filter.value);
        return String(row[filter.column]) <= String(filter.value);
      });
    }
    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    if (this.singleMode || this.maybeSingleMode) {
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

const createSupabaseMock = (rows) => {
  const db = {
    rows,
    calls: [],
    from(table) {
      return new QueryBuilder(db, table);
    },
  };
  return db;
};

const loadController = (rows) => {
  delete require.cache[controllerPath];
  delete require.cache[operationalScopePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: createSupabaseMock(rows),
  };
  return {
    controller: require('../controllers/relatoriosController'),
    supabase: require('../config/supabase'),
  };
};

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const reqEmpresa = (query = {}) => ({
  user: { is_super_admin: true },
  empresa_id: 'emp-1',
  headers: {},
  query: { empresa_id: 'emp-1', ...query },
});

const frete = (id, status, extra = {}) => ({
  id,
  empresa_id: 'emp-1',
  motorista_id: 'mot-1',
  data: '2026-07-10',
  origem: 'Origem',
  destino: 'Destino',
  status,
  valor_frete: 1000,
  motoristas: {
    usuarios: { nome: 'Motorista Alfa' },
    percentual_comissao: 10,
    empresas: { tipo: 'transportadora', nome: 'Empresa Alfa' },
  },
  ...extra,
});

const rowsBase = (fretes) => ({
  empresas: [{ id: 'emp-1', operational_scope_mode: 'legacy' }],
  fretes,
  abastecimentos: [],
  despesas: [],
  vales: [],
});

test('rentabilidade filtra cancelados antes do limite para nao esconder viagens validas', async () => {
  const cancelados = Array.from({ length: 1000 }, (_, i) => frete(`cancel-${i}`, 'cancelado'));
  const rows = rowsBase([...cancelados, frete('ativo-real', 'ativo')]);
  const { controller, supabase } = loadController(rows);
  const res = makeRes();

  await controller.getRentabilidade(reqEmpresa(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens.length, 1);
  assert.equal(res.body.itens[0].frete_id, 'ativo-real');
  const fretesCall = supabase.calls.find((call) => call.table === 'fretes');
  assert.deepEqual(fretesCall.neqFilters.find((f) => f.column === 'status'), { column: 'status', value: 'cancelado' });
});

test('acerto busca finalizados antes do limite para nao cortar viagens de acerto', async () => {
  const ativos = Array.from({ length: 1500 }, (_, i) => frete(`ativo-${i}`, 'ativo'));
  const rows = rowsBase([...ativos, frete('finalizado-real', 'finalizado')]);
  const { controller, supabase } = loadController(rows);
  const res = makeRes();

  await controller.getAcertoMotoristas(reqEmpresa(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.resumo.viagens_consideradas, 1);
  assert.equal(res.body.motoristas[0].itens[0].frete_id, 'finalizado-real');
  const fretesCall = supabase.calls.find((call) => call.table === 'fretes');
  assert.deepEqual(fretesCall.filters.find((f) => f.column === 'status'), { column: 'status', value: 'finalizado' });
});
