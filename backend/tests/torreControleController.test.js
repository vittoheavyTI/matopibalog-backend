const test = require('node:test');
const assert = require('node:assert/strict');

const controllerPath = require.resolve('../controllers/relatoriosController');
const supabasePath = require.resolve('../config/supabase');

class QueryBuilder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
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

const baseRows = () => ({
  empresas: [{ id: 'emp-1' }, { id: 'emp-2' }],
  fretes: [
    {
      id: 'f-1',
      empresa_id: 'emp-1',
      motorista_id: 'mot-1',
      data: '2026-07-10',
      origem: 'Origem A',
      destino: 'Destino A',
      placa: 'AAA1A11',
      status: 'finalizado',
      valor_frete: 1000,
    },
    {
      id: 'f-2',
      empresa_id: 'emp-2',
      motorista_id: 'mot-2',
      data: '2026-07-11',
      origem: 'Origem B',
      destino: 'Destino B',
      placa: 'BBB2B22',
      status: 'ativo',
      valor_frete: 2000,
    },
  ],
  motoristas: [
    { id: 'mot-1', empresa_id: 'emp-1', usuarios: { nome: 'Motorista Alfa' } },
    { id: 'mot-2', empresa_id: 'emp-2', usuarios: { nome: 'Motorista Beta' } },
  ],
  frete_ocorrencias: [
    { id: 'oc-1', frete_id: 'f-1', empresa_id: 'emp-1', tipo: 'atraso', status: 'aberta' },
    { id: 'oc-2', frete_id: 'f-1', empresa_id: 'emp-2', tipo: 'avaria', status: 'aberta' },
  ],
  frete_epod: [
    { id: 'ep-1', frete_id: 'f-1', empresa_id: 'emp-1', status: 'validado' },
    { id: 'ep-2', frete_id: 'f-1', empresa_id: 'emp-2', status: 'rejeitado' },
  ],
  frete_epod_evidencias: [
    { id: 'ev-1', frete_id: 'f-1', empresa_id: 'emp-1', status: 'aprovada' },
    { id: 'ev-2', frete_id: 'f-1', empresa_id: 'emp-2', status: 'pendente' },
  ],
});

const callTorre = async ({ rows = baseRows(), req }) => {
  const { controller, supabase } = loadController(rows);
  const res = makeRes();
  await controller.getTorreControle(req, res);
  return { res, supabase };
};

test('torre endpoint: admin comum usa empresa do tenant e ignora empresa_id divergente', async () => {
  const { res, supabase } = await callTorre({
    req: {
      user: { is_super_admin: false },
      empresa_id: 'emp-1',
      query: { empresa_id: 'emp-2' },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens.length, 1);
  assert.equal(res.body.itens[0].empresa_id, 'emp-1');
  assert.equal(res.body.itens[0].motorista_nome, 'Motorista Alfa');
  const fretesCall = supabase.calls.find((call) => call.table === 'fretes');
  assert.deepEqual(fretesCall.filters.find((f) => f.column === 'empresa_id'), { column: 'empresa_id', value: 'emp-1' });
});

test('torre endpoint: superadmin usa empresa ja resolvida pelo middleware', async () => {
  const { res } = await callTorre({
    req: {
      user: { is_super_admin: true },
      empresa_id: 'emp-2',
      query: { empresa_id: 'emp-2' },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens.length, 1);
  assert.equal(res.body.itens[0].empresa_id, 'emp-2');
  assert.equal(res.body.itens[0].motorista_nome, 'Motorista Beta');
});

test('torre endpoint: empresa invalida nao consulta fretes', async () => {
  const { res, supabase } = await callTorre({
    req: {
      user: { is_super_admin: true },
      empresa_id: 'emp-invalida',
      query: { empresa_id: 'emp-invalida' },
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Empresa nao encontrada.');
  assert.equal(supabase.calls.some((call) => call.table === 'fretes'), false);
});

test('torre endpoint: motorista de outro tenant nao tem nome vazado', async () => {
  const rows = baseRows();
  rows.fretes = [{
    id: 'f-cross',
    empresa_id: 'emp-1',
    motorista_id: 'mot-2',
    data: '2026-07-12',
    origem: 'Origem A',
    destino: 'Destino A',
    placa: 'AAA1A11',
    status: 'ativo',
    valor_frete: 1000,
  }];
  rows.frete_ocorrencias = [];
  rows.frete_epod = [];
  rows.frete_epod_evidencias = [];

  const { res } = await callTorre({
    rows,
    req: {
      user: { is_super_admin: false },
      empresa_id: 'emp-1',
      query: {},
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens.length, 1);
  assert.equal(res.body.itens[0].motorista_nome, null);
});

test('torre endpoint: ocorrencia, ePOD e evidencia de outro tenant nao entram no retorno', async () => {
  const { res, supabase } = await callTorre({
    req: {
      user: { is_super_admin: false },
      empresa_id: 'emp-1',
      query: {},
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens[0].ocorrencias.total, 1);
  assert.equal(res.body.itens[0].epod.status, 'validado');
  assert.equal(res.body.itens[0].epod.evidencias_pendentes, 0);

  for (const table of ['frete_ocorrencias', 'frete_epod', 'frete_epod_evidencias']) {
    const call = supabase.calls.find((entry) => entry.table === table);
    assert.deepEqual(call.filters.find((f) => f.column === 'empresa_id'), { column: 'empresa_id', value: 'emp-1' });
  }
});

test('torre endpoint: resumo filtrado por prioridade bate com os itens retornados', async () => {
  const rows = baseRows();
  rows.fretes.push({
    id: 'f-3',
    empresa_id: 'emp-1',
    motorista_id: 'mot-1',
    data: '2026-07-13',
    origem: 'Origem C',
    destino: 'Destino C',
    placa: 'CCC3C33',
    status: 'finalizado',
    valor_frete: 3000,
  });

  const { res } = await callTorre({
    rows,
    req: {
      user: { is_super_admin: false },
      empresa_id: 'emp-1',
      query: { nivel: 'informativo' },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.itens.every((item) => item.nivel === 'informativo'), true);
  assert.equal(res.body.resumo.fretes_total, res.body.itens.length);
  assert.equal(res.body.resumo.sem_comprovacao, res.body.itens.filter((item) => item.epod.sem_comprovacao).length);
});
