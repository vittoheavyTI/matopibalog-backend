'use strict';

// Partner Network V1 (E3.6A) — provas da FRONTEIRA e da AUTORIDADE de sessão.
//
// O que estes testes protegem: que um parceiro nunca entre no tenant de quem o
// convidou, que a credencial dele seja durável mas revogável na hora, e que
// nenhuma resposta vire compromisso quando a fonte já mudou.
//
// Os invariantes de banco (FK composta, trigger, RPC transacional) têm cobertura
// própria em `tests-pg/partner_network_082.pgtest.mjs`, contra Postgres real.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service_key_de_teste';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-partner-network';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

// ── Stub do banco ───────────────────────────────────────────────────────────────
// O middleware relê o estado do parceiro a cada requisição; sem dublê o teste
// sairia pela rede. `ESTADO_DO_PARCEIRO` é o que o banco "tem" no momento.
let ESTADO_DO_PARCEIRO = null;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const pai = (parent && parent.filename) || '';
  if (request === '../config/supabase' && /partnerPortalAuth/.test(pai)) {
    const tabela = {
      select: () => tabela,
      eq: () => tabela,
      maybeSingle: async () => ({ data: ESTADO_DO_PARCEIRO, error: null }),
    };
    return { from: () => tabela };
  }
  return originalLoad.call(this, request, parent, isMain);
};

for (const m of ['../middlewares/partnerPortalAuth', '../services/partnerNetwork/partnerIdentityService']) {
  try { delete require.cache[require.resolve(m)]; } catch { /* ainda não carregado */ }
}

const { TOKEN_KINDS_EXTERNOS } = require('../middlewares/auth');
const {
  PARTNER_TOKEN_KIND, emitirTokenParceiro, verifyPartnerToken,
} = require('../middlewares/partnerPortalAuth');
const { emitirTokenPortal } = require('../middlewares/shipperPortalAuth');
const {
  CAMPOS_PUBLICOS_DA_OPORTUNIDADE, projetarParaParceiro,
} = require('../services/partnerNetwork/partnerOpportunityService');
const {
  hashDoToken, gerarTokenConvite, TRANSICOES_PERMITIDAS,
} = require('../services/partnerNetwork/partnerNetworkService');
const { resumir } = require('../services/partnerNetwork/partnerRouteSummary');
const { PERMISSIONS, TEMPLATE_BASELINE_ALLOW, TEMPLATE_KEYS } = require('../services/permissions/permissionRegistry');

function respostaFake() {
  const r = { statusCode: null, corpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.corpo = b; return r; };
  return r;
}

function requisicaoComToken(token) {
  return { headers: { authorization: `Bearer ${token}` }, cookies: {} };
}

const TOKEN_DO_PARCEIRO = () => emitirTokenParceiro({
  partnerUserId: 'pu-1', partnerOrganizationId: 'org-1', email: 'parceiro@x.invalid',
});

const PARCEIRO_ATIVO = {
  id: 'pu-1', partner_organization_id: 'org-1', email: 'parceiro@x.invalid',
  nome: 'Parceiro', status: 'ATIVO', auth_user_id: 'auth-1',
};

// Executa o middleware e devolve o que aconteceu.
async function passarPeloGate(token, estado = PARCEIRO_ATIVO) {
  ESTADO_DO_PARCEIRO = estado;
  const req = requisicaoComToken(token);
  const res = respostaFake();
  let passou = false;
  await verifyPartnerToken(req, res, () => { passou = true; });
  return { passou, req, res };
}

// ── HIGH-02: default-deny genérico ─────────────────────────────────────────────

test('HIGH-02: um token_kind FUTURO, jamais cadastrado, é recusado pelo sistema interno', async () => {
  // Este é o teste que a lista de kinds conhecidos não passava. Um portal novo
  // assinado com o mesmo segredo entraria no tenant até alguém lembrar de
  // cadastrá-lo — o oposto de default-deny.
  const { verifyToken } = require('../middlewares/auth');
  const futuro = jwt.sign(
    { token_kind: 'future_external_domain', uid: 'x-1', role: 'admin' },
    process.env.JWT_SECRET,
  );
  const res = respostaFake();
  verifyToken(requisicaoComToken(futuro), res, () => {
    assert.fail('um domínio externo desconhecido não pode entrar no sistema interno');
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.corpo.message, /externo/i);
});

test('HIGH-02: os kinds conhecidos continuam recusados, com mensagem própria', () => {
  const { verifyToken } = require('../middlewares/auth');
  for (const [kind, esperado] of [['shipper_portal', /embarcador/i], ['partner_portal', /parceiro/i]]) {
    const token = jwt.sign({ token_kind: kind, uid: 'x' }, process.env.JWT_SECRET);
    const res = respostaFake();
    verifyToken(requisicaoComToken(token), res, () => assert.fail(`${kind} não pode entrar`));
    assert.equal(res.statusCode, 403);
    assert.match(res.corpo.message, esperado);
  }
});

test('HIGH-02: o token INTERNO continua funcionando — a regra não pode barrar quem é de casa', () => {
  const { verifyToken } = require('../middlewares/auth');
  // É o formato real: o de sessão usa `token_use`, o legado não tem claim de tipo.
  for (const payload of [
    { uid: 'u-1', role: 'admin', is_super_admin: false },
    { sub: 'u-1', uid: 'u-1', sid: 's-1', token_use: 'access', role: 'admin' },
  ]) {
    const token = jwt.sign(payload, process.env.JWT_SECRET);
    const res = respostaFake();
    let passou = false;
    verifyToken(requisicaoComToken(token), res, () => { passou = true; });
    assert.equal(passou, true, 'token interno não pode ser recusado');
  }
});

test('HIGH-02: os kinds conhecidos seguem registrados para mensagem', () => {
  assert.ok(TOKEN_KINDS_EXTERNOS.has(PARTNER_TOKEN_KIND));
  assert.ok(TOKEN_KINDS_EXTERNOS.has('shipper_portal'));
});

// ── HIGH-01: sessão durável, mas revogável na hora ─────────────────────────────

test('HIGH-01: parceiro ATIVO com token válido entra', async () => {
  const { passou, req } = await passarPeloGate(TOKEN_DO_PARCEIRO());
  assert.equal(passou, true);
  assert.equal(req.partnerUser.partner_organization_id, 'org-1');
  assert.ok(!('empresa_id' in req), 'o request do parceiro nunca ganha tenant');
});

test('HIGH-01: parceiro BLOQUEADO perde acesso mesmo com JWT ainda válido', async () => {
  // O ponto do achado: sem releitura, bloquear só teria efeito quando o token
  // expirasse — até 8 horas depois, o que na prática é não bloquear.
  const { passou, res } = await passarPeloGate(TOKEN_DO_PARCEIRO(), {
    ...PARCEIRO_ATIVO, status: 'BLOQUEADO',
  });
  assert.equal(passou, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.corpo.message, /bloqueado/i);
});

test('HIGH-01: identidade removida invalida a sessão', async () => {
  const { passou, res } = await passarPeloGate(TOKEN_DO_PARCEIRO(), null);
  assert.equal(passou, false);
  assert.equal(res.statusCode, 403);
});

test('HIGH-01: organização divergente entre token e registro invalida a sessão', async () => {
  const { passou, res } = await passarPeloGate(TOKEN_DO_PARCEIRO(), {
    ...PARCEIRO_ATIVO, partner_organization_id: 'org-outra',
  });
  assert.equal(passou, false);
  assert.equal(res.statusCode, 401);
});

test('HIGH-01: o token do parceiro NÃO carrega empresa_id nem parece identidade interna', () => {
  const payload = jwt.decode(TOKEN_DO_PARCEIRO());
  assert.equal(payload.token_kind, 'partner_portal');
  assert.ok(!('empresa_id' in payload), 'empresa_id no token seria o tenant do solicitante na mão dele');
  assert.ok(!('uid' in payload));
  assert.ok(!('role' in payload));
});

test('HIGH-01: token interno NÃO entra na área do parceiro', async () => {
  const interno = jwt.sign({ uid: 'u-1', role: 'admin' }, process.env.JWT_SECRET);
  const { passou, res } = await passarPeloGate(interno);
  assert.equal(passou, false);
  assert.equal(res.statusCode, 403);
});

test('HIGH-01: token do Portal do Embarcador NÃO entra na área do parceiro', async () => {
  const doPortal = emitirTokenPortal({ portalUserId: 'p-1', shipperOrgId: 'org-1', email: 'e@x.invalid' });
  const { passou, res } = await passarPeloGate(doPortal);
  assert.equal(passou, false);
  assert.equal(res.statusCode, 403);
});

test('HIGH-01: a identidade do parceiro reusa o serviço endurecido do Portal, sem copiá-lo', () => {
  // Duplicar a prova de posse foi o que abriu um furo na E3.5 (está registrado no
  // comentário de lá). Este teste trava a decisão de reusar.
  const fonte = require('fs').readFileSync(
    require.resolve('../services/partnerNetwork/partnerIdentityService'), 'utf8',
  );
  assert.match(fonte, /shipperPortal\/shipperIdentityService/,
    'a política de prova de identidade precisa vir do serviço compartilhado');
  assert.ok(!/signInWithPassword/.test(fonte),
    'a chamada de autenticação não pode ser reimplementada aqui');
  assert.ok(!/createUser/.test(fonte),
    'a criação de identidade não pode ser reimplementada aqui');
});

// ── Máquina de estados (§8) ────────────────────────────────────────────────────

test('estado: REVOKED é terminal — não volta a ACTIVE por PATCH', () => {
  assert.deepEqual(TRANSICOES_PERMITIDAS.REVOKED, [],
    'reativar por PATCH desfaria uma revogação sem passar por convite nem prova de posse');
  assert.ok(TRANSICOES_PERMITIDAS.ACTIVE.includes('REVOKED'));
  assert.ok(TRANSICOES_PERMITIDAS.SUSPENDED.includes('ACTIVE'));
  assert.ok(!TRANSICOES_PERMITIDAS.INVITED.includes('ACTIVE'),
    'INVITED só vira ACTIVE por ativação válida do convite, nunca por PATCH');
});

// ── HIGH-08: rota derivada ─────────────────────────────────────────────────────

test('HIGH-08: o resumo de rota preserva o tamanho da operação', () => {
  assert.equal(resumir([], 'origem', 'origens'), null, 'sem dado, não se inventa string');
  assert.equal(resumir(['Balsas/MA'], 'origem', 'origens'), 'Balsas/MA');
  assert.equal(resumir(['Balsas/MA', 'Riachão/MA'], 'origem', 'origens'), 'Balsas/MA e Riachão/MA');
  // Esconder que havia mais pontos faria o parceiro achar a operação menor do
  // que é — e descobrir depois.
  assert.equal(resumir(['A', 'B', 'C'], 'origem', 'origens'), 'A + 2 origens');
  assert.equal(resumir(['A', 'B'], 'destino', 'destinos'), 'A e B');
});

// ── Sanitização do snapshot ────────────────────────────────────────────────────

test('a projeção externa é uma lista POSITIVA — campo novo não vaza sozinho', () => {
  const interna = {
    id: 'op-1', cargo_descricao: 'Soja a granel',
    origem_resumo: 'Balsas/MA', destino_resumo: 'Itaqui/MA',
    quantidade: 500, quantidade_unidade: 'ton',
    estado: 'CURRENT', criado_em: '2026-08-26T00:00:00Z',
    empresa_id: 'emp-a', campaign_id: 'camp-1', plan_version_id: 'plan-9',
    criado_por: 'user-7', client_request_id: 'req-abc', snapshot_version: 3,
    superseded_by_id: 'op-2', estado_motivo: 'replan interno',
    margem_interna: 12345,
  };
  const externa = projetarParaParceiro(interna);
  for (const proibido of ['empresa_id', 'campaign_id', 'plan_version_id', 'criado_por',
    'client_request_id', 'snapshot_version', 'superseded_by_id', 'estado_motivo', 'margem_interna']) {
    assert.ok(!(proibido in externa), `${proibido} não pode chegar ao parceiro`);
  }
  // E o que o parceiro PRECISA para decidir continua chegando (HIGH-08).
  assert.equal(externa.origem_resumo, 'Balsas/MA');
  assert.equal(externa.destino_resumo, 'Itaqui/MA');
  assert.equal(externa.quantidade_unidade, 'ton');
});

test('nenhum campo público tem cheiro de preço ou de dado interno', () => {
  const suspeito = /(preco|price|valor|tarifa|rate|comiss|margem|custo|empresa_id|campaign|plan_version|criado_por|client_request)/i;
  assert.deepEqual(CAMPOS_PUBLICOS_DA_OPORTUNIDADE.filter((c) => suspeito.test(c)), []);
});

// ── Convite ────────────────────────────────────────────────────────────────────

test('o convite guarda hash, nunca o token', () => {
  const { valor, hash } = gerarTokenConvite();
  assert.notEqual(valor, hash);
  assert.equal(hash, hashDoToken(valor));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(valor.length >= 32);
  assert.notEqual(gerarTokenConvite().valor, gerarTokenConvite().valor);
});

// ── Permissões e entitlement ───────────────────────────────────────────────────

test('as quatro capacidades existem e exigem o entitlement partner_network', () => {
  for (const chave of ['partner_network.view', 'partner_network.manage', 'partner_network.share', 'partner_network.respond']) {
    const p = PERMISSIONS.find((x) => x.key === chave);
    assert.ok(p, `${chave} precisa existir no registry`);
    assert.equal(p.entitlementCodigo, 'partner_network');
  }
});

test('Administrador e Gerente de Frota recebem; Operador é DEFAULT_DENY', () => {
  const admin = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.ADMINISTRADOR]);
  const gerente = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.GERENTE_FROTA]);
  const operador = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.OPERADOR]);
  for (const chave of ['partner_network.view', 'partner_network.manage', 'partner_network.share']) {
    assert.equal(admin.has(chave), true);
    assert.equal(gerente.has(chave), true);
    assert.equal(operador.has(chave), false);
  }
});

test('nenhuma permissão de rede concede financeiro', () => {
  const daRede = PERMISSIONS.filter((p) => p.key.startsWith('partner_network.'));
  assert.equal(daRede.length, 4);
  for (const p of daRede) assert.ok(!/finance|reports\.financial/.test(p.key));
});

// ── Ausência de preço/adjudicação (§14) ────────────────────────────────────────

test('nenhum serviço da rede expõe preço, adjudicação ou ranking', () => {
  const proibidos = /(preco|price|award|adjudic|vencedor|winner|comiss|settle|fatur|billing|rank|score|tarifa)/i;
  for (const mod of [
    '../services/partnerNetwork/partnerOpportunityService',
    '../services/partnerNetwork/partnerNetworkService',
    '../services/partnerNetwork/partnerIdentityService',
    '../services/partnerNetwork/partnerRouteSummary',
  ]) {
    assert.deepEqual(Object.keys(require(mod)).filter((k) => proibidos.test(k)), [], mod);
  }
});

test('nenhum serviço da rede expõe marketplace ou descoberta pública', () => {
  const proibidos = /(marketplace|publico|public|directory|diretorio|buscarParceiros|descobrir)/i;
  const servico = require('../services/partnerNetwork/partnerNetworkService');
  assert.deepEqual(Object.keys(servico).filter((k) => proibidos.test(k)), []);
});

test('as mutações críticas passam por RPC transacional, não por inserts soltos', () => {
  // HIGH-04/06/10: se alguém trocar a RPC por um insert direto, o TOCTOU volta.
  const fonteRede = require('fs').readFileSync(
    require.resolve('../services/partnerNetwork/partnerNetworkService'), 'utf8');
  const fonteOport = require('fs').readFileSync(
    require.resolve('../services/partnerNetwork/partnerOpportunityService'), 'utf8');

  for (const rpc of [
    'partner_network_create_invitation',
    'partner_network_preflight_invitation',
    'partner_network_activate_invitation',
    // HIGH-11: mudar a situação do parceiro deixou de ser UPDATE + evento solto.
    'partner_network_set_relationship_status',
  ]) {
    assert.match(fonteRede, new RegExp(rpc), `${rpc} precisa ser usada`);
  }
  for (const rpc of [
    'partner_network_share_gap', 'partner_network_submit_response',
    'partner_network_mark_source_stale',
    // HIGH-11: retirar também.
    'partner_network_withdraw_opportunity',
  ]) {
    assert.match(fonteOport, new RegExp(rpc), `${rpc} precisa ser usada`);
  }
});

// ── HIGH-11: nenhuma escrita de auditoria fora de transação ────────────────────

test('HIGH-11: não existe gravador de evento avulso — auditoria é sempre transacional', () => {
  // A armadilha que este teste tranca: um `registrarEvento()` que commita
  // separado do estado. Ele PARECE suficiente, e o próximo uso reintroduz
  // exatamente o defeito corrigido — mudança de estado que persiste sem o
  // registro dela.
  const rede = require('../services/partnerNetwork/partnerNetworkService');
  const oport = require('../services/partnerNetwork/partnerOpportunityService');
  for (const [nome, mod] of [['partnerNetworkService', rede], ['partnerOpportunityService', oport]]) {
    assert.deepEqual(
      Object.keys(mod).filter((k) => /registrarEvento|gravarEvento|auditar/i.test(k)), [],
      `${nome} não pode exportar gravador de evento avulso`,
    );
  }

});

// HIGH-15: a superfície do serviço precisa oferecer a LISTA de contextos.
//
// Resolver o login por `maybeSingle()` em `auth_user_id` era o defeito: essa
// chamada FALHA com mais de uma linha, então aceitar o segundo convite legítimo
// quebrava o login do primeiro. A prova de COMPORTAMENTO está em
// `partnerPortalAuthHttp.test.js` (duas redes, login não quebra, escolha
// explícita) e nos testes PG contra o schema real — aqui fica só a garantia de
// que a função existe e o contrato não regrediu para uma resolução única.
test('HIGH-15: a identidade expõe listagem de contextos, não uma resolução única por auth_user_id', () => {
  const identidade = require('../services/partnerNetwork/partnerIdentityService');
  assert.equal(typeof identidade.listarContextosDoParceiro, 'function');
  assert.equal(typeof identidade.carregarContextoDoParceiro, 'function');
});

test('HIGH-09: o serviço expõe o preflight do convite, que resolve sem consumir', () => {
  const rede = require('../services/partnerNetwork/partnerNetworkService');
  assert.equal(typeof rede.preflightDoConvite, 'function');
  // `emailDoConvite` era a leitura crua que achava o e-mail de QUALQUER convite
  // — inclusive expirado ou revogado — e deixava a ativação chegar ao Auth.
  assert.equal(rede.emailDoConvite, undefined,
    'a leitura sem validação de estado não pode voltar a existir');
});

test('PARTNER_AUTH_METADATA_DOMAIN: o parceiro tem marca própria, e o embarcador segue como default', () => {
  const parceiro = require('../services/partnerNetwork/partnerIdentityService');
  const embarcador = require('../services/shipperPortal/shipperIdentityService');
  assert.equal(parceiro.METADATA_DO_PARCEIRO.partner_portal, true);
  assert.ok(!('portal_embarcador' in parceiro.METADATA_DO_PARCEIRO),
    'marcar a conta do parceiro como do Portal do Embarcador seria simplesmente falso');
  assert.equal(embarcador.METADATA_PADRAO.portal_embarcador, true,
    'o default preserva o comportamento da E3.5');
});
