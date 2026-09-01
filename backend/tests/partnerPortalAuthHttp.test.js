'use strict';

// Partner Network V1 (E3.6A) — o CAMINHO REAL de entrada, pela HTTP.
//
// Por que este arquivo existe separado do `partnerNetworkBoundary`: aquele prova
// invariantes de unidade (projeção, máquina de estados, rejeição de token). Este
// atravessa a pilha inteira — rota → serviço → RPC → JWT → rota protegida — que
// é exatamente o trecho onde ninguém olhava.
//
// O HIGH-10 é a prova de que isso importa: o serviço lia `linha.relationship_id`
// e `linha.partner_organization_id`, enquanto a RPC devolve `out_*`. Os dois
// campos chegavam `undefined`, viravam claims ausentes no JWT, e o próprio
// middleware recusava a sessão recém-emitida. Toda a ativação estava quebrada e
// a bateria passava, porque nenhum teste ia da RPC até o token.
//
// REGRA DESTE ARQUIVO: o dublê da RPC não pode inventar shape. Os nomes de campo
// que ele devolve são LIDOS da migration 082 e conferidos por asserção — se a
// assinatura mudar, estes testes quebram antes da produção.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service_key_de_teste';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-partner-http';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

// ── O contrato REAL, lido da migration ────────────────────────────────────────

const SQL_082 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '082_partner_network_foundation.sql'), 'utf8',
);

/** Nomes das colunas do `RETURNS TABLE` de uma função da migration 082. */
function camposDeRetornoDaRpc(nome) {
  const inicio = SQL_082.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.notEqual(inicio, -1, `${nome} precisa existir na migration 082`);
  const trecho = SQL_082.slice(inicio);
  const m = trecho.match(/RETURNS TABLE \(([\s\S]*?)\)\nLANGUAGE/);
  assert.ok(m, `${nome} precisa declarar RETURNS TABLE`);
  return m[1].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
}

// ── Estado do "banco" ─────────────────────────────────────────────────────────

const BD = {
  convites: new Map(),        // token_hash → { email, relationship_id, org_id, empresa_id, status }
  parceiros: [],              // linhas de partner_portal_users
  authUsers: [],              // identidades do Supabase Auth
  senhas: new Map(),          // email → senha válida
  criados: [],                // identidades criadas nesta execução
  metadataCriada: [],         // user_metadata usado em cada criação
};

function limparBd() {
  BD.convites.clear();
  BD.parceiros = [];
  BD.authUsers = [];
  BD.senhas.clear();
  BD.criados = [];
  BD.metadataCriada = [];
}

// Builder de consulta mínimo, com o mesmo formato do supabase-js: encadeia
// filtros e é "thenable", então tanto `await q` quanto `await q.maybeSingle()`
// funcionam — como no código de produção.
function consultaSobre(linhas) {
  const filtros = [];
  const q = {
    select: () => q,
    eq: (col, val) => { filtros.push([col, val]); return q; },
    order: () => q,
    maybeSingle: async () => {
      const r = aplicar(linhas, filtros);
      return { data: r[0] || null, error: null };
    },
    then: (resolve) => resolve({ data: aplicar(linhas, filtros), error: null }),
  };
  return q;
}

function aplicar(linhas, filtros) {
  return linhas.filter((l) => filtros.every(([col, val]) => l[col] === val));
}

// ── RPCs: shape derivado da migration, comportamento derivado do BD ───────────

function rpcPreflight(args) {
  const convite = BD.convites.get(args.p_token_hash);
  if (!convite || convite.status !== 'PENDENTE' || convite.expirado) {
    return { data: null, error: { message: 'partner_invite_indisponivel' } };
  }
  if (convite.relationship_status === 'REVOKED') {
    return { data: null, error: { message: 'partner_relationship_revogado' } };
  }
  if (convite.relationship_status === 'SUSPENDED') {
    return { data: null, error: { message: 'partner_relationship_suspenso' } };
  }
  return {
    data: [{
      out_email: convite.email,
      out_relationship_id: convite.relationship_id,
      out_partner_organization_id: convite.org_id,
      out_empresa_id: convite.empresa_id,
      out_relationship_status: convite.relationship_status,
    }],
    error: null,
  };
}

function rpcAtivar(args) {
  const convite = BD.convites.get(args.p_token_hash);
  if (!convite || convite.status !== 'PENDENTE') {
    return { data: null, error: { message: 'partner_invite_indisponivel' } };
  }
  convite.status = 'ACEITO';
  const parceiro = {
    id: `pu-${BD.parceiros.length + 1}`,
    partner_organization_id: convite.org_id,
    email: convite.email,
    nome: args.p_nome || null,
    status: 'ATIVO',
    auth_user_id: args.p_auth_user_id,
    criado_em: new Date(2026, 0, BD.parceiros.length + 1).toISOString(),
    partner_organizations: { nome: convite.organizacao || 'Parceiro' },
  };
  BD.parceiros.push(parceiro);
  return {
    data: [{
      out_partner_user_id: parceiro.id,
      out_partner_organization_id: parceiro.partner_organization_id,
      out_email: parceiro.email,
      out_relationship_id: convite.relationship_id,
    }],
    error: null,
  };
}

const RPCS = {
  partner_network_preflight_invitation: rpcPreflight,
  partner_network_activate_invitation: rpcAtivar,
};

const supabaseFake = {
  rpc: async (nome, args) => {
    const fn = RPCS[nome];
    if (!fn) return { data: null, error: { message: `função ${nome} não existe`, code: '42883' } };
    return fn(args);
  },
  from: (tabela) => {
    if (tabela === 'partner_portal_users') return consultaSobre(BD.parceiros);
    return consultaSobre([]);
  },
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: BD.authUsers }, error: null }),
      createUser: async ({ email, password, user_metadata: metadata }) => {
        const novo = { id: `auth-${BD.authUsers.length + 1}`, email };
        BD.authUsers.push(novo);
        BD.criados.push(novo);
        BD.metadataCriada.push(metadata);
        BD.senhas.set(email, password);
        return { data: { user: novo }, error: null };
      },
    },
  },
};

// O client isolado que o shipperIdentityService constrói para `signInWithPassword`.
const authClientFake = {
  auth: {
    signInWithPassword: async ({ email, password }) => {
      const alvo = String(email || '').trim().toLowerCase();
      if (BD.senhas.get(alvo) && BD.senhas.get(alvo) === password) {
        const u = BD.authUsers.find((x) => x.email === alvo);
        return { data: { user: { id: u?.id || `auth-${alvo}`, email: alvo } }, error: null };
      }
      return { data: null, error: { message: 'Invalid login credentials' } };
    },
  },
};

const loadOriginal = Module._load;
Module._load = function (request, parent, isMain) {
  const pedido = String(request).replace(/\\/g, '/');
  if (pedido.endsWith('config/supabase')) return supabaseFake;
  if (pedido === '@supabase/supabase-js') return { createClient: () => authClientFake };
  return loadOriginal.call(this, request, parent, isMain);
};

for (const m of [
  '../routes/partnerPortal', '../middlewares/partnerPortalAuth',
  '../services/partnerNetwork/partnerIdentityService',
  '../services/shipperPortal/shipperIdentityService',
]) {
  try { delete require.cache[require.resolve(m)]; } catch { /* ainda não carregado */ }
}

const express = require('express');
const rotasDoParceiro = require('../routes/partnerPortal');

Module._load = loadOriginal;

function montarApp() {
  const app = express();
  app.use(express.json());
  app.use('/portal/parceiro', rotasDoParceiro);
  return app;
}

function pedir(app, metodo, caminho, { corpo = null, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const servidor = app.listen(0, () => {
      const { port } = servidor.address();
      const dados = corpo ? JSON.stringify(corpo) : null;
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const req = http.request({ port, method: metodo, path: caminho, headers }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          servidor.close();
          resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
        });
      });
      req.on('error', (e) => { servidor.close(); reject(e); });
      if (dados) req.write(dados);
      req.end();
    });
  });
}

const TOKEN_CONVITE = 'convite-token-abc';
function hashDoConvite(valor) {
  return require('node:crypto').createHash('sha256').update(String(valor)).digest('hex');
}

function semearConvite(over = {}) {
  BD.convites.set(hashDoConvite(over.token || TOKEN_CONVITE), {
    email: 'convidado@parceiro.test',
    relationship_id: 'rel-1',
    org_id: 'org-1',
    empresa_id: 'emp-1',
    organizacao: 'Transportes do Convidado',
    status: 'PENDENTE',
    relationship_status: 'INVITED',
    expirado: false,
    ...over,
  });
}

// ── O contrato da RPC não é inventado ─────────────────────────────────────────

test('contrato: o dublê devolve EXATAMENTE os campos que a migration 082 declara', () => {
  // Esta é a asserção que impede o defeito de voltar disfarçado. Se alguém
  // renomear uma coluna de retorno na migration, o dublê para de casar e os
  // testes abaixo deixam de valer — em vez de continuarem verdes contra um
  // contrato que só existe no teste.
  const preflight = rpcPreflight({ p_token_hash: 'x' });
  assert.equal(preflight.error?.message, 'partner_invite_indisponivel');

  semearConvite();
  assert.deepEqual(
    Object.keys(rpcPreflight({ p_token_hash: hashDoConvite(TOKEN_CONVITE) }).data[0]).sort(),
    camposDeRetornoDaRpc('partner_network_preflight_invitation').sort(),
  );
  assert.deepEqual(
    Object.keys(rpcAtivar({ p_token_hash: hashDoConvite(TOKEN_CONVITE), p_auth_user_id: 'auth-x' }).data[0]).sort(),
    camposDeRetornoDaRpc('partner_network_activate_invitation').sort(),
  );
  limparBd();
});

// ── (D)(E) HIGH-10: RPC real → JWT correto → /eu ──────────────────────────────

test('HIGH-10 (D)(E): ativar devolve JWT com organização e partner_user_id, e o /eu aceita esse mesmo token', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123', nome: 'Contato' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email, 'convidado@parceiro.test');

  // O defeito exato do HIGH-10: estas duas claims chegavam `undefined`.
  const claims = jwt.decode(r.body.token);
  assert.equal(claims.token_kind, 'partner_portal');
  assert.equal(claims.partner_user_id, 'pu-1');
  assert.equal(claims.partner_organization_id, 'org-1', 'a organização vem de out_partner_organization_id');
  assert.equal(claims.email, 'convidado@parceiro.test');
  assert.ok(!('empresa_id' in claims), 'o token do parceiro nunca carrega o tenant do solicitante');

  // E o token emitido de fato ABRE a área do parceiro — que era o que não
  // acontecia: o middleware recusava a sessão recém-criada.
  const eu = await pedir(app, 'GET', '/portal/parceiro/eu', { token: r.body.token });
  assert.equal(eu.status, 200, JSON.stringify(eu.body));
  assert.equal(eu.body.partner_user_id, 'pu-1');
  assert.equal(eu.body.email, 'convidado@parceiro.test');
});

// ── (A) HIGH-09: o e-mail do convite é a autoridade ───────────────────────────

test('HIGH-09 (A): e-mail no corpo NÃO substitui o do convite — divergir é negar', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, email: 'invasor@outro.test', senha: 'senha-forte-123' },
  });

  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'convite_email_divergente');
  assert.equal(BD.criados.length, 0, 'nenhuma identidade é criada para o e-mail do invasor');
  assert.equal(BD.convites.get(hashDoConvite(TOKEN_CONVITE)).status, 'PENDENTE',
    'o convite permanece disponível para quem foi de fato convidado');
});

test('HIGH-09 (A): e-mail no corpo IGUAL ao do convite continua funcionando (compatibilidade)', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    // Caixa diferente de propósito: a comparação é normalizada, não literal.
    corpo: { token: TOKEN_CONVITE, email: 'Convidado@Parceiro.TEST', senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('HIGH-09: a identidade provada é a DO CONVITE, mesmo com outro e-mail sugerido', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  assert.equal(BD.criados.length, 1);
  assert.equal(BD.criados[0].email, 'convidado@parceiro.test');
});

// ── (B)(C) preflight: convite morto não produz identidade ─────────────────────

test('HIGH-09 (B): convite EXPIRADO não cria nem tenta provar identidade no Auth', async () => {
  limparBd();
  semearConvite({ expirado: true });
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 410, JSON.stringify(r.body));
  assert.equal(BD.criados.length, 0,
    'um token morto não pode produzir conta nova em produção');
  assert.equal(BD.parceiros.length, 0);
});

test('HIGH-09 (C): convite de relacionamento REVOGADO não cria identidade', async () => {
  limparBd();
  semearConvite({ relationship_status: 'REVOKED' });
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(BD.criados.length, 0);
});

test('HIGH-09 (C): convite de relacionamento SUSPENSO não cria identidade', async () => {
  limparBd();
  semearConvite({ relationship_status: 'SUSPENDED' });
  const app = montarApp();

  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(BD.criados.length, 0);
});

test('HIGH-09: token desconhecido não vaza se o convite existe, e não cria nada', async () => {
  limparBd();
  const app = montarApp();
  const r = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: 'token-que-nunca-existiu', senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 410);
  assert.equal(BD.criados.length, 0);
});

// ── PARTNER_AUTH_METADATA_DOMAIN ──────────────────────────────────────────────

test('metadata: a conta criada por convite de PARCEIRO não é marcada como portal do embarcador', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123', nome: 'Contato' },
  });

  const metadata = BD.metadataCriada[0];
  assert.equal(metadata.partner_portal, true, 'a marca precisa ser a do domínio que criou');
  assert.ok(!('portal_embarcador' in metadata),
    'dizer que a conta nasceu no Portal do Embarcador seria simplesmente falso');
});

// ── (F)(G)(H) HIGH-15: login com uma e com várias redes ───────────────────────

async function ativarEmDuasRedes(app) {
  // Rede A.
  semearConvite();
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123', nome: 'Contato' },
  });
  // Rede B — MESMO e-mail, MESMA identidade Auth, organização diferente. É o
  // caso legítimo: duas transportadoras convidaram a mesma empresa parceira.
  semearConvite({
    token: 'convite-token-b', relationship_id: 'rel-2', org_id: 'org-2', empresa_id: 'emp-2',
    organizacao: 'Rede da Transportadora B',
  });
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: 'convite-token-b', senha: 'senha-forte-123', nome: 'Contato' },
  });
}

test('HIGH-15 (F): identidade com UMA rede entra direto, sem tela de escolha', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });

  const r = await pedir(app, 'POST', '/portal/parceiro/entrar', {
    corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token, 'com um contexto só, o token vem direto');
  assert.ok(!r.body.requires_context_selection);
});

test('HIGH-15 (G): identidade com DUAS redes não quebra o login — pede escolha explícita', async () => {
  limparBd();
  const app = montarApp();
  await ativarEmDuasRedes(app);
  assert.equal(BD.parceiros.length, 2);
  assert.equal(BD.parceiros[0].auth_user_id, BD.parceiros[1].auth_user_id,
    'é a MESMA identidade Auth — o segundo convite não cria conta nova');

  const r = await pedir(app, 'POST', '/portal/parceiro/entrar', {
    corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123' },
  });

  // O defeito: `maybeSingle()` falha com duas linhas, então aceitar o segundo
  // convite QUEBRAVA o login do primeiro — 500, sem explicação.
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.requires_context_selection, true);
  assert.equal(r.body.token, undefined, 'nenhuma sessão é emitida antes da escolha');
  assert.equal(r.body.contextos.length, 2);
  for (const c of r.body.contextos) {
    assert.ok(c.partner_user_id && c.organizacao);
    // Nada do solicitante sai daqui — nem numa tela que aparece antes da sessão.
    assert.deepEqual(Object.keys(c).sort(), ['organizacao', 'partner_user_id', 'vinculado_em']);
  }
});

test('HIGH-15 (H): escolher um contexto emite token ESCOPADO àquela organização', async () => {
  limparBd();
  const app = montarApp();
  await ativarEmDuasRedes(app);

  const lista = await pedir(app, 'POST', '/portal/parceiro/entrar', {
    corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123' },
  });

  const tokens = {};
  for (const c of lista.body.contextos) {
    const r = await pedir(app, 'POST', '/portal/parceiro/contexto', {
      corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123', partner_user_id: c.partner_user_id },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[c.partner_user_id] = jwt.decode(r.body.token);
  }

  const [a, b] = Object.values(tokens);
  assert.notEqual(a.partner_organization_id, b.partner_organization_id);
  assert.equal(a.partner_organization_id, 'org-1');
  assert.equal(b.partner_organization_id, 'org-2');
  // Um token, um contexto: nenhuma sessão carrega as duas organizações.
  for (const t of [a, b]) {
    assert.equal(typeof t.partner_organization_id, 'string');
    assert.ok(!Array.isArray(t.partner_organization_id));
  }
});

test('HIGH-15: token da rede A não vale na rede B — o vínculo é relido a cada requisição', async () => {
  limparBd();
  const app = montarApp();
  await ativarEmDuasRedes(app);

  const sessaoA = await pedir(app, 'POST', '/portal/parceiro/contexto', {
    corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123', partner_user_id: 'pu-1' },
  });
  const claimsA = jwt.decode(sessaoA.body.token);
  assert.equal(claimsA.partner_organization_id, 'org-1');

  // Forja: mesma pessoa, mesma senha, mas o token diz que ela é da org-2. O
  // middleware relê o vínculo pelo `partner_user_id` e recusa a divergência.
  const forjado = jwt.sign(
    { token_kind: 'partner_portal', partner_user_id: 'pu-1', partner_organization_id: 'org-2', email: 'convidado@parceiro.test' },
    process.env.JWT_SECRET, { expiresIn: 3600 },
  );
  const r = await pedir(app, 'GET', '/portal/parceiro/eu', { token: forjado });
  assert.equal(r.status, 401, 'organização divergente entre token e registro invalida a sessão');
});

test('HIGH-15: partner_user_id de OUTRA identidade é negado mesmo com senha própria correta', async () => {
  limparBd();
  const app = montarApp();
  await ativarEmDuasRedes(app);

  // Uma terceira pessoa, com conta própria e senha própria, tentando escolher o
  // vínculo de outro. Sem a prova de pertencimento, `partner_user_id` no corpo
  // seria um seletor livre de organização.
  BD.authUsers.push({ id: 'auth-9', email: 'terceiro@outro.test' });
  BD.senhas.set('terceiro@outro.test', 'senha-do-terceiro');
  BD.parceiros.push({
    id: 'pu-9', partner_organization_id: 'org-9', email: 'terceiro@outro.test',
    nome: 'Terceiro', status: 'ATIVO', auth_user_id: 'auth-9',
    criado_em: new Date().toISOString(), partner_organizations: { nome: 'Rede do Terceiro' },
  });

  const r = await pedir(app, 'POST', '/portal/parceiro/contexto', {
    corpo: { email: 'terceiro@outro.test', senha: 'senha-do-terceiro', partner_user_id: 'pu-1' },
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'contexto_invalido');
});

test('HIGH-15: senha errada não emite sessão nem revela os contextos', async () => {
  limparBd();
  const app = montarApp();
  await ativarEmDuasRedes(app);

  const r = await pedir(app, 'POST', '/portal/parceiro/entrar', {
    corpo: { email: 'convidado@parceiro.test', senha: 'chute-errado' },
  });
  assert.equal(r.status, 401);
  assert.equal(r.body.contextos, undefined);
  assert.equal(r.body.token, undefined);
});

// ── (I) sessão é revogável na hora ────────────────────────────────────────────

test('(I): parceiro BLOQUEADO perde o acesso com o JWT ainda válido', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();
  const ativado = await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  assert.equal((await pedir(app, 'GET', '/portal/parceiro/eu', { token: ativado.body.token })).status, 200);

  BD.parceiros[0].status = 'BLOQUEADO';

  const r = await pedir(app, 'GET', '/portal/parceiro/eu', { token: ativado.body.token });
  assert.equal(r.status, 403, 'sem releitura, bloquear só valeria quando o token expirasse');
  assert.match(r.body.message, /bloqueado/i);
});

test('(I): identidade bloqueada também não consegue entrar de novo', async () => {
  limparBd();
  semearConvite();
  const app = montarApp();
  await pedir(app, 'POST', '/portal/parceiro/ativar', {
    corpo: { token: TOKEN_CONVITE, senha: 'senha-forte-123' },
  });
  BD.parceiros[0].status = 'BLOQUEADO';

  const r = await pedir(app, 'POST', '/portal/parceiro/entrar', {
    corpo: { email: 'convidado@parceiro.test', senha: 'senha-forte-123' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'sem_acesso_de_parceiro');
});

// ── (J)(K) simetria de credenciais ────────────────────────────────────────────
//
// A recusa do token de parceiro nas rotas INTERNAS e do `token_kind` futuro está
// provada em `partnerNetworkBoundary.test.js` (HIGH-02), contra o `verifyToken`
// real. Aqui fica o lado espelhado: credencial interna na área do parceiro.

test('(J)(K): token interno e token sem kind não entram na área do parceiro', async () => {
  limparBd();
  const app = montarApp();
  for (const payload of [
    { uid: 'u-1', role: 'admin' },
    { sub: 'u-1', uid: 'u-1', sid: 's-1', token_use: 'access', role: 'admin' },
    { token_kind: 'shipper_portal', portal_user_id: 'p-1', shipper_organization_id: 'o-1' },
    { token_kind: 'algum_portal_do_futuro', partner_user_id: 'pu-1', partner_organization_id: 'org-1' },
  ]) {
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: 3600 });
    const r = await pedir(app, 'GET', '/portal/parceiro/eu', { token });
    assert.equal(r.status, 403, `credencial ${JSON.stringify(payload)} não pode entrar`);
  }
});
