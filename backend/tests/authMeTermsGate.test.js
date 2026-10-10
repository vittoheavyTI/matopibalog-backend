// backend/tests/authMeTermsGate.test.js
// Testes focados da resolução fail-closed de autoridade de termos obrigatórios em GET /auth/me (R1B-A C1).

if (!global.WebSocket) {
  global.WebSocket = class WebSocket {};
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key-mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const authController = require('../controllers/authController');
const termsAuthorityService = require('../services/termsAuthorityService');

function mockRes() {
  let statusCode = 200;
  let responseBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      responseBody = payload;
      return this;
    },
    getStatus: () => statusCode,
    getBody: () => responseBody,
  };
  return res;
}

function mockDbUser(userData) {
  return {
    from(tabela) {
      if (tabela === 'usuarios') {
        return {
          select(cols) {
            return {
              eq(col, val) {
                return {
                  single: async () => ({
                    data: { ...userData },
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: { ...userData },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          in: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    },
  };
}

// ── 1. /auth/me + terms pending => 200 + termos_pendentes=true ─────────────
test('1. /auth/me + terms pending => 200 + termos_pendentes=true e count correto', async () => {
  const req = {
    user: { uid: 'user-pendente-1' },
    supabaseClient: mockDbUser({
      id: 'user-pendente-1',
      tipo: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      nome: 'Admin Pendente',
    }),
    termsAuthorityService: {
      verificarTermosObrigatoriosPendentes: async ({ usuarioId, role, isSuperAdmin }) => {
        assert.equal(usuarioId, 'user-pendente-1');
        assert.equal(role, 'admin');
        assert.equal(isSuperAdmin, false);
        return { temPendentes: true, count: 2 };
      },
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 200);
  const body = res.getBody();
  assert.equal(body.termos_pendentes, true);
  assert.equal(body.termos_pendentes_count, 2);
  assert.equal(body.trial_v2, null);
  assert.equal(body.id, 'user-pendente-1');
});

// ── 2. /auth/me + no pending => 200 + false/0 ──────────────────────────────
test('2. /auth/me + no pending => 200 + false/0', async () => {
  const req = {
    user: { uid: 'user-sem-pendencia-1' },
    supabaseClient: mockDbUser({
      id: 'user-sem-pendencia-1',
      tipo: 'motorista',
      is_super_admin: false,
      empresa_id: 'emp-1',
      nome: 'Motorista Regular',
    }),
    termsAuthorityService: {
      verificarTermosObrigatoriosPendentes: async () => ({
        temPendentes: false,
        count: 0,
      }),
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 200);
  const body = res.getBody();
  assert.equal(body.termos_pendentes, false);
  assert.equal(body.termos_pendentes_count, 0);
  assert.equal(body.id, 'user-sem-pendencia-1');
});

// ── 3. /auth/me + terms authority throws => 503 ────────────────────────────
test('3. /auth/me + terms authority throws => 503 fail-closed (UNKNOWN não vira false)', async () => {
  const req = {
    user: { uid: 'user-throw-1' },
    supabaseClient: mockDbUser({
      id: 'user-throw-1',
      tipo: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-1',
      nome: 'Admin Throw',
    }),
    termsAuthorityService: {
      verificarTermosObrigatoriosPendentes: async () => {
        throw new Error('Falha inesperada no serviço de autoridade de termos');
      },
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 503);
  const body = res.getBody();
  assert.equal(body.error, 'SessionDependencyUnavailable');
  assert.equal(body.code, 'AUTH_DEPENDENCY_UNAVAILABLE');
  assert.equal(typeof body.message, 'string');
  assert.equal(body.termos_pendentes, undefined, 'Não deve retornar payload 200 com termos_pendentes=false');
});

// ── 4. /auth/me + terms DB error => 503 ────────────────────────────────────
test('4. /auth/me + terms DB error => 503 fail-closed', async () => {
  const mockDbComErroTermos = {
    from(tabela) {
      if (tabela === 'usuarios') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'user-db-err', tipo: 'admin', is_super_admin: false, empresa_id: 'emp-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (tabela === 'termos') {
        return {
          select: () => ({
            eq: () => ({
              contains: async () => ({
                data: null,
                error: { message: 'connection reset by peer on terms query' },
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  };

  const req = {
    user: { uid: 'user-db-err' },
    supabaseClient: mockDbComErroTermos,
    // Usa a implementação real de termsAuthorityService contra mock de banco com erro
    termsAuthorityService: termsAuthorityService,
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 503);
  const body = res.getBody();
  assert.equal(body.error, 'SessionDependencyUnavailable');
  assert.equal(body.code, 'AUTH_DEPENDENCY_UNAVAILABLE');
});

// ── 5. /auth/me + authority client unavailable => 503 ──────────────────────
test('5. /auth/me + authority client unavailable => 503 fail-closed', async () => {
  const mockDbSemTermosClient = {
    from(tabela) {
      if (tabela === 'usuarios') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'user-client-unavail', tipo: 'admin', is_super_admin: false, empresa_id: 'emp-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      return null;
    },
  };

  const req = {
    user: { uid: 'user-client-unavail' },
    supabaseClient: mockDbSemTermosClient,
    termsAuthorityService: {
      verificarTermosObrigatoriosPendentes: async () => {
        // Simula rejeição exata de client indisponível de termsAuthorityService
        throw new Error('Cliente de autoridade indisponível para verificação de termos');
      },
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 503);
  const body = res.getBody();
  assert.equal(body.error, 'SessionDependencyUnavailable');
  assert.equal(body.code, 'AUTH_DEPENDENCY_UNAVAILABLE');
});

// ── 6. terms authority succeeds count=0 but trial throws => 200 (non-fatal) ─
test('6. terms authority succeeds count=0 but trial throws => 200, termos_pendentes=false, trial failure non-fatal', async () => {
  const req = {
    user: { uid: 'user-trial-err-1' },
    supabaseClient: mockDbUser({
      id: 'user-trial-err-1',
      tipo: 'admin',
      is_super_admin: false,
      empresa_id: 'emp-com-trial',
      nome: 'Admin com Empresa',
    }),
    termsAuthorityService: {
      verificarTermosObrigatoriosPendentes: async () => ({
        temPendentes: false,
        count: 0,
      }),
    },
    iniciarTrialV2PorAceiteTermos: async () => {
      throw new Error('Asaas timeout or trial RPC exception');
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 200);
  const body = res.getBody();
  assert.equal(body.termos_pendentes, false);
  assert.equal(body.termos_pendentes_count, 0);
  assert.equal(body.trial_v2, null, 'trial_v2 deve ser null quando a inicialização falha de forma não-fatal');
  assert.equal(body.id, 'user-trial-err-1');
});

// ── 7. super-admin => no mandatory terms => normal 200 ─────────────────────
test('7. super-admin => no mandatory terms => normal 200', async () => {
  let trialChamado = false;
  const req = {
    user: { uid: 'user-superadmin' },
    supabaseClient: mockDbUser({
      id: 'user-superadmin',
      tipo: 'admin',
      is_super_admin: true,
      empresa_id: null,
      nome: 'Super Admin Matopiba',
    }),
    // Implementação real de termsAuthorityService para super-admin
    termsAuthorityService: termsAuthorityService,
    iniciarTrialV2PorAceiteTermos: async () => {
      trialChamado = true;
      return { ok: true };
    },
  };
  const res = mockRes();

  await authController.getMe(req, res);

  assert.equal(res.getStatus(), 200);
  const body = res.getBody();
  assert.equal(body.termos_pendentes, false);
  assert.equal(body.termos_pendentes_count, 0);
  assert.equal(body.is_super_admin, true);
  assert.equal(trialChamado, false, 'Super admin não deve acionar trial');
});
