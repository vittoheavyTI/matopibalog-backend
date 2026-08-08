// Testes de regressão do hotfix PGRST201 (ambiguidade usuarios ↔ empresas).
// A migration 024 criou empresas.suspended_by → usuarios.id; o embed genérico
// empresas() a partir de usuarios ficou ambíguo e quebrou o login de todos os
// perfis. Estes testes provam:
//   1. o login usa explicitamente a FK usuarios_empresa_id_fkey;
//   2. o contrato do objeto retornado (empresa_tipo/empresa_nome) é preservado;
//   3. usuário com empresa e super-admin autenticam;
//   4. perfil realmente ausente (PGRST116) continua retornando 409;
//   5. erro real de banco NÃO é mascarado como "Perfil incompleto" (vira 500
//      genérico, sem vazar detalhes internos);
//   6. nenhuma consulta corrigida usa empresas_suspended_by_fkey por engano
//      nem manteve o embed genérico ambíguo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/authController');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'chave-de-teste';

// ─── Infra de mocks ──────────────────────────────────────────────────────────

function fakeSupabaseDb({ userData, userError, capturas }) {
  return {
    from(tabela) {
      return {
        select(selecao) {
          capturas.push({ tabela, selecao });
          return {
            eq() {
              return {
                single: async () => ({ data: userData, error: userError || null }),
              };
            },
            not() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        update() {
          return {
            eq() {
              return {
                select(selecao) {
                  capturas.push({ tabela, selecao });
                  return { single: async () => ({ data: userData, error: userError || null }) };
                },
              };
            },
          };
        },
      };
    },
  };
}

function carregarController({ userData, userError, authError, capturas, authRuntime }) {
  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') {
        return fakeSupabaseDb({ userData, userError, capturas });
      }
      if (request === '../services/auth/authRuntime' && authRuntime) {
        return { getAuthRuntime: () => authRuntime };
      }
      if (request === '@supabase/supabase-js') {
        return {
          createClient: () => ({
            auth: {
              signInWithPassword: async () =>
                authError
                  ? { data: null, error: authError }
                  : { data: { user: { id: 'uid-de-teste' } }, error: null },
            },
          }),
        };
      }
      if (request === '../services/empresaService') return { criarEmpresaCompleta: async () => ({}) };
      if (request === '../services/notificacaoService') return { criarNotificacao: async () => {} };
      if (request === './termosController') return { getTermosPendentes: async () => [] };
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null, cookies: [], headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.cookie = (nome, valor, opts) => { res.cookies.push({ nome, opts }); return res; };
  res.set = (nome, valor) => { res.headers[nome.toLowerCase()] = valor; return res; };
  return res;
}

async function executarLogin({ userData, userError, authError, authRuntime, body = {} }) {
  const capturas = [];
  const controller = carregarController({ userData, userError, authError, capturas, authRuntime });
  const req = { body: { email: 'teste@example.com', senha: 'senha-de-teste', ...body }, headers: { 'user-agent': 'teste' } };
  const res = fakeRes();
  await controller.login(req, res);
  return { res, capturas };
}

const perfilComEmpresa = {
  id: 'uid-de-teste',
  nome: 'Usuário Teste',
  email: 'teste@example.com',
  tipo: 'admin',
  status: 'ativo',
  is_super_admin: false,
  senha_temporaria: false,
  empresa_id: 'empresa-de-teste',
  foto_url: null,
  empresas: { nome: 'Empresa Teste', tipo: 'transportadora' },
};

// ─── 1/2/3. FK explícita + contrato preservado + autenticação ────────────────

test('login usa explicitamente usuarios_empresa_id_fkey e nunca suspended_by', async () => {
  const { res, capturas } = await executarLogin({ userData: perfilComEmpresa });
  assert.equal(res.statusCode, 200);

  const consultaUsuarios = capturas.find((c) => c.tabela === 'usuarios');
  assert.ok(consultaUsuarios, 'consulta à tabela usuarios deve existir');
  assert.match(consultaUsuarios.selecao, /empresas!usuarios_empresa_id_fkey\(/);
  assert.ok(!consultaUsuarios.selecao.includes('empresas_suspended_by_fkey'));
  // Não pode restar embed genérico ambíguo "empresas(" sem hint
  assert.ok(!/(?:^|[^!\w])empresas\(/.test(consultaUsuarios.selecao));
});

test('contrato preservado: empresa_tipo/empresa_nome vêm do embed empresas', async () => {
  const { res } = await executarLogin({ userData: perfilComEmpresa });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.empresa_tipo, 'transportadora');
  assert.equal(res.body.user.empresa_nome, 'Empresa Teste');
  assert.equal(res.body.user.empresa_id, 'empresa-de-teste');
  assert.equal(res.body.user.is_super_admin, false);
  assert.ok(res.body.token, 'token JWT deve ser emitido');
});

test('super-admin (sem empresa) autentica com embed nulo', async () => {
  const superAdmin = {
    ...perfilComEmpresa,
    is_super_admin: true,
    empresa_id: null,
    empresas: null,
  };
  const { res } = await executarLogin({ userData: superAdmin });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.is_super_admin, true);
  assert.equal(res.body.user.empresa_tipo, null);
  assert.equal(res.body.user.empresa_nome, null);
});

test('SEC-1 compatible web: login cria sessão, entrega refresh só em cookie e usa no-store', async () => {
  const chamadas = [];
  const authRuntime = {
    cfg: { sessionsEnabled: true },
    sessionService: {
      async criarSessao(args) {
        chamadas.push(args);
        return {
          accessToken: 'access-sec1',
          refreshDelivery: { reveal: () => 'refresh-web', expiresAt: '2026-09-01T00:00:00.000Z' },
        };
      },
    },
  };
  const { res } = await executarLogin({ userData: perfilComEmpresa, authRuntime });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, 'access-sec1');
  assert.equal(res.body.refresh_token, undefined);
  assert.equal(chamadas[0].client_type, 'web');
  assert.equal(res.cookies.find((c) => c.nome === 'refresh_token')?.opts.httpOnly, true);
  assert.equal(res.cookies.find((c) => c.nome === 'refresh_token')?.opts.sameSite, 'none');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('SEC-1 compatible web: login respeita SameSite=Lax quando configurado para same-site', async () => {
  const authRuntime = {
    cfg: { sessionsEnabled: true, refreshCookieSameSite: 'lax' },
    sessionService: {
      async criarSessao() {
        return {
          accessToken: 'access-sec1',
          refreshDelivery: { reveal: () => 'refresh-web', expiresAt: '2026-09-01T00:00:00.000Z' },
        };
      },
    },
  };
  const { res } = await executarLogin({ userData: perfilComEmpresa, authRuntime });
  assert.equal(res.statusCode, 200);
  assert.equal(res.cookies.find((c) => c.nome === 'refresh_token')?.opts.sameSite, 'lax');
});

test('SEC-1 compatible mobile: login cria sessão android e entrega refresh no body', async () => {
  const chamadas = [];
  const authRuntime = {
    cfg: { sessionsEnabled: true },
    sessionService: {
      async criarSessao(args) {
        chamadas.push(args);
        return {
          accessToken: 'access-mobile',
          refreshDelivery: { reveal: () => 'refresh-mobile', expiresAt: '2026-09-01T00:00:00.000Z' },
        };
      },
    },
  };
  const { res } = await executarLogin({ userData: perfilComEmpresa, authRuntime, body: { client_type: 'android' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, 'access-mobile');
  assert.equal(res.body.refresh_token, 'refresh-mobile');
  assert.equal(res.body.refresh_expires_at, '2026-09-01T00:00:00.000Z');
  assert.equal(chamadas[0].client_type, 'android');
});

// ─── 4. Perfil realmente ausente ─────────────────────────────────────────────

test('perfil ausente (PGRST116) continua retornando 409 Perfil incompleto', async () => {
  const { res } = await executarLogin({
    userData: null,
    userError: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /Perfil incompleto/);
});

// ─── 5. Erro de banco NÃO é mascarado como perfil ausente ────────────────────

test('erro real do PostgREST (PGRST201) vira 500 genérico, não 409', async () => {
  const { res } = await executarLogin({
    userData: null,
    userError: {
      code: 'PGRST201',
      message: "Could not embed because more than one relationship was found for 'usuarios' and 'empresas'",
      hint: "Try changing 'empresas' to one of the following: 'empresas!empresas_suspended_by_fkey', 'empresas!usuarios_empresa_id_fkey'.",
    },
  });
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.message.includes('Perfil incompleto'));
  // Não vaza detalhes internos (código, constraint, conteúdo do Supabase)
  assert.ok(!/PGRST|fkey|supabase|relationship/i.test(res.body.message));
});

test('credenciais inválidas seguem retornando 401', async () => {
  const { res } = await executarLogin({ authError: { message: 'Invalid login credentials' } });
  assert.equal(res.statusCode, 401);
});

// ─── 6. Varredura estática: nenhuma consulta corrigida regrediu ──────────────

test('fontes corrigidos usam a FK correta e não usam suspended_by em embed', () => {
  const arquivos = [
    '../controllers/authController.js',
    '../controllers/abastecimentosController.js',
    '../controllers/despesasController.js',
    '../controllers/adminController.js',
  ];

  for (const rel of arquivos) {
    const fonte = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    assert.ok(
      !fonte.includes('empresas!empresas_suspended_by_fkey'),
      `${rel}: não pode usar a relação empresas_suspended_by_fkey em embed`
    );
    // Nenhum select destes arquivos pode manter o embed genérico "empresas("
    // (ambíguo pós-migration 024): todo embed de empresas deve ter hint de FK.
    fonte.split('\n').forEach((linha, i) => {
      if (/select\(/.test(linha) && /[^!\w]empresas\(/.test(linha)) {
        assert.fail(`${rel}:${i + 1} mantém embed genérico ambíguo: ${linha.trim()}`);
      }
    });
  }

  // getMe e updateMe também precisam da FK explícita
  const auth = fs.readFileSync(path.resolve(__dirname, '../controllers/authController.js'), 'utf8');
  const ocorrencias = auth.match(/empresas!usuarios_empresa_id_fkey\(/g) || [];
  assert.ok(ocorrencias.length >= 3, 'login, updateMe e getMe devem usar a FK explícita');
});
