const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const middlewarePath = require.resolve('../middlewares/verificarPlano');

const carregarMiddleware = (supabaseMock) => {
  const originalLoad = Module._load;
  delete require.cache[middlewarePath];

  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return supabaseMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(middlewarePath).verificarPlano;
  } finally {
    Module._load = originalLoad;
  }
};

// Mock que suporta duas tabelas: empresas e faturas.
// A fatura mockável define se há invoice_url/bank_slip_url.
const criarSupabaseMock = (empresa, faturaMock = null) => {
  const chamadas = { consultas: { empresas: 0, faturas: 0 }, updates: [] };

  return {
    chamadas,
    from(tabela) {
      return {
        select() {
          chamadas.consultas[tabela] = (chamadas.consultas[tabela] || 0) + 1;
          return this;
        },
        update(payload) {
          chamadas.updates.push({ tabela, payload });
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        lt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          if (tabela === 'faturas') {
            return Promise.resolve({ data: faturaMock, error: null });
          }
          return Promise.resolve({ data: empresa, error: null });
        },
        single() {
          if (tabela === 'faturas') {
            return Promise.resolve({ data: faturaMock, error: faturaMock ? null : { code: 'PGRST116' } });
          }
          return Promise.resolve({ data: empresa, error: null });
        }
      };
    }
  };
};

const executar = async ({ method, user = {}, empresa, empresaId = 'empresa-1', faturaMock = null }) => {
  const supabase = criarSupabaseMock(empresa, faturaMock);
  const verificarPlano = carregarMiddleware(supabase);
  let nextChamado = 0;
  let resposta = null;

  await verificarPlano(
    { method, user, empresa_id: empresaId },
    {
      status(status) {
        return {
          json(body) {
            resposta = { status, body };
          }
        };
      }
    },
    () => { nextChamado += 1; }
  );

  return { nextChamado, resposta, chamadas: supabase.chamadas };
};

// ── SUPER-ADMIN ─────────────────────────────────────────────────────────────────

test('super-admin nao e bloqueado em POST', async () => {
  const resultado = await executar({
    method: 'POST',
    user: { is_super_admin: true },
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.equal(resultado.chamadas.consultas.empresas, 0);
});

// ── LEITURA ──────────────────────────────────────────────────────────────────────

test('empresa suspensa pode consultar com GET', async () => {
  const resultado = await executar({
    method: 'GET',
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.equal(resultado.chamadas.consultas.empresas, 0);
});

// ── STATUS BLOQUEANTES ───────────────────────────────────────────────────────────

test('empresa suspensa bloqueada em POST', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'suspenso', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  assert.match(resultado.resposta.body.message, /suspenso/i);
});

test('empresa bloqueada bloqueada em PATCH', async () => {
  const resultado = await executar({
    method: 'PATCH',
    empresa: { status: 'bloqueado', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
});

test('empresa expirada bloqueada em DELETE', async () => {
  const resultado = await executar({
    method: 'DELETE',
    empresa: { status: 'expirado', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
});

// ── TRIAL EXPIRADO ───────────────────────────────────────────────────────────────

test('trial vencido pode consultar com GET sem atualizar status', async () => {
  const resultado = await executar({
    method: 'GET',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
  assert.deepEqual(resultado.chamadas.updates, []);
});

test('trial vencido COM fatura com link suspende e bloqueia', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' },
    faturaMock: { id: 'f1', invoice_url: 'https://example.com/pay', bank_slip_url: null, due_date: '1999-12-31', status: 'pendente' }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  assert.equal(resultado.chamadas.updates.length, 1);
  assert.equal(resultado.chamadas.updates[0].payload.status, 'suspenso');
  assert.match(resultado.resposta.body.message, /teste expirado/i);
});

test('trial vencido COM fatura com bank_slip_url suspende', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' },
    faturaMock: { id: 'f1', invoice_url: null, bank_slip_url: 'https://example.com/boleto', due_date: '1999-12-31', status: 'vencido' }
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  assert.equal(resultado.chamadas.updates.length, 1);
});

test('trial vencido SEM fatura bloqueia mas NAO suspende', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' },
    faturaMock: null // sem fatura pendente
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  // Não deve suspender a empresa (update não deve ser chamado)
  assert.equal(resultado.chamadas.updates.length, 0);
  assert.match(resultado.resposta.body.message, /teste expirado/i);
});

test('trial vencido com fatura SEM link bloqueia mas NAO suspende', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2000-01-01T00:00:00.000Z' },
    faturaMock: { id: 'f1', invoice_url: null, bank_slip_url: null } // fatura sem link
  });

  assert.equal(resultado.nextChamado, 0);
  assert.equal(resultado.resposta.status, 403);
  assert.equal(resultado.chamadas.updates.length, 0); // não suspende sem link
});

// ── ATIVO ────────────────────────────────────────────────────────────────────────

test('empresa ativa pode escrever', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'ativo', trial_ends_at: null }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
});

// ── TRIAL ATIVO ──────────────────────────────────────────────────────────────────

test('trial ativo deixa escrever', async () => {
  const resultado = await executar({
    method: 'POST',
    empresa: { status: 'trial', trial_ends_at: '2099-01-01T00:00:00.000Z' }
  });

  assert.equal(resultado.nextChamado, 1);
  assert.equal(resultado.resposta, null);
});
