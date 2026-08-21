const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { conflitoUnico } = require('../utils/pgError');

// ── conflitoUnico (helper puro) ──────────────────────────────────────────────

test('conflitoUnico: 23505 com CNPJ → 409 e mensagem de documento', () => {
  const r = conflitoUnico({
    code: '23505',
    message: 'duplicate key value violates unique constraint "empresas_cnpj_key"',
  });
  assert.equal(r.status, 409);
  assert.equal(r.message, 'Já existe uma conta cadastrada com este CPF/CNPJ.');
});

test('conflitoUnico: 23505 desconhecido → 409 e fallback genérico', () => {
  const r = conflitoUnico({
    code: '23505',
    message: 'duplicate key value violates unique constraint "empresas_email_contato_key"',
  });
  assert.equal(r.status, 409);
  assert.equal(r.message, 'Já existe um cadastro com os dados informados.');
});

test('conflitoUnico: mensagem NÃO expõe detalhes técnicos', () => {
  const r = conflitoUnico({
    code: '23505',
    message: 'duplicate key value violates unique constraint "empresas_cnpj_key"',
    details: 'Key (cnpj)=(12345678000199) already exists.',
  });
  const msg = r.message.toLowerCase();
  assert.ok(!msg.includes('empresas_cnpj_key'), 'não pode vazar nome da constraint');
  assert.ok(!msg.includes('duplicate key'), 'não pode vazar "duplicate key"');
  assert.ok(!msg.includes('23505'), 'não pode vazar código SQL');
  assert.ok(!msg.includes('key ('), 'não pode vazar details/payload');
});

test('conflitoUnico: erro que NÃO é 23505 não é mascarado (retorna null)', () => {
  assert.equal(conflitoUnico({ code: '23503', message: 'foreign key violation' }), null);
  assert.equal(conflitoUnico({ message: 'Plano informado é inválido.' }), null);
  assert.equal(conflitoUnico({ code: '22P02', message: 'invalid input syntax for type uuid' }), null);
});

test('conflitoUnico: null/undefined → null (sem erro, segue o fluxo)', () => {
  assert.equal(conflitoUnico(null), null);
  assert.equal(conflitoUnico(undefined), null);
});

// ── criarEmpresaCompleta: criação com documento duplicado ────────────────────

const servicePath = require.resolve('../services/empresaService');

const carregarService = (supabaseMock) => {
  const originalLoad = Module._load;
  delete require.cache[servicePath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(servicePath).criarEmpresaCompleta;
  } finally {
    Module._load = originalLoad;
  }
};

// Mock mínimo: planos por nome e codigo_convite não existem (maybeSingle→null);
// o insert final devolve o insertError configurado (ou sucesso).
const criarSupabaseMock = ({ insertError = null } = {}) => ({
  from() {
    const chain = {
      _payload: null,
      select() { return this; },
      eq() { return this; },
      insert(payload) { this._payload = payload; return this; },
      update() { return this; },
      delete() { return this; },
      async maybeSingle() { return { data: null, error: null }; },
      async single() {
        if (insertError) return { data: null, error: insertError };
        return { data: { id: 'nova-empresa', nome: this._payload?.nome, codigo_convite: this._payload?.codigo_convite }, error: null };
      },
    };
    return chain;
  },
  // P2.9 — provisionamento atômico de templates (RPC). Sucesso por padrão.
  async rpc() { return { data: null, error: null }; },
});

test('criarEmpresaCompleta: insert 23505 (CNPJ) → error amigável + status 409, sem vazar', async () => {
  const criar = carregarService(criarSupabaseMock({
    insertError: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "empresas_cnpj_key"',
      details: 'Key (cnpj)=(12345678000199) already exists.',
    },
  }));
  const r = await criar({ nome: 'Empresa Teste', cnpj: '12345678000199' });
  assert.equal(r.empresa, null);
  assert.equal(r.status, 409);
  assert.equal(r.error, 'Já existe uma conta cadastrada com este CPF/CNPJ.');
  const err = r.error.toLowerCase();
  assert.ok(!err.includes('empresas_cnpj_key') && !err.includes('duplicate key') && !err.includes('23505'));
});

test('criarEmpresaCompleta: outro erro de insert → status 500 genérico sem vazar', async () => {
  const criar = carregarService(criarSupabaseMock({
    insertError: { code: '23502', message: 'null value in column "nome" violates not-null constraint' },
  }));
  const r = await criar({ nome: 'Empresa X', cnpj: '00000000000191' });
  assert.equal(r.empresa, null);
  assert.equal(r.status, 500);
  assert.equal(r.error, 'Erro ao criar empresa.');
});

test('criarEmpresaCompleta: insert OK → empresa criada, sem error', async () => {
  const criar = carregarService(criarSupabaseMock({ insertError: null }));
  const r = await criar({ nome: 'Empresa Nova', cnpj: '11444777000161' });
  assert.equal(r.error, null);
  assert.ok(r.empresa && r.empresa.id === 'nova-empresa');
});
