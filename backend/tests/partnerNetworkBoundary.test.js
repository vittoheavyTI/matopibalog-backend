'use strict';

// Partner Network V1 (E3.6A) — provas da FRONTEIRA.
//
// O que estes testes protegem: que a rede privada continue privada, que o
// parceiro externo nunca vire usuário interno, e que nenhuma resposta se
// transforme em compromisso quando a fonte já mudou.
//
// Os invariantes de banco (FK composta, trigger de imutabilidade) têm cobertura
// própria em `tests-pg/partner_network_082.pgtest.mjs`, contra Postgres real —
// aqui ficam as decisões de serviço.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service_key_de_teste';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-partner-network';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { TOKEN_KINDS_EXTERNOS } = require('../middlewares/auth');
const {
  PARTNER_TOKEN_KIND, emitirTokenParceiro, verifyPartnerToken,
} = require('../middlewares/partnerPortalAuth');
const { PARTNER_TOKEN_KIND: _unused } = require('../middlewares/partnerPortalAuth');
const { emitirTokenPortal } = require('../middlewares/shipperPortalAuth');
const {
  CAMPOS_PUBLICOS_DA_OPORTUNIDADE, projetarParaParceiro,
} = require('../services/partnerNetwork/partnerOpportunityService');
const { hashDoToken, gerarTokenConvite } = require('../services/partnerNetwork/partnerNetworkService');
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

// ── Simetria de credencial ─────────────────────────────────────────────────────

test('rede: o token de parceiro é rejeitado pelo sistema interno', () => {
  assert.ok(TOKEN_KINDS_EXTERNOS.has(PARTNER_TOKEN_KIND),
    'sem isto, o caminho legado do verifyToken aceitaria a credencial externa como interna');
});

test('rede: todo token_kind conhecido é externo — a lista é default-deny', () => {
  // Um kind novo que não entre nesta lista atravessaria o verifyToken. O teste
  // existe para cobrar o cadastro, não para descrever o estado atual.
  assert.deepEqual([...TOKEN_KINDS_EXTERNOS].sort(), ['partner_portal', 'shipper_portal']);
});

test('rede: token interno NÃO entra na área do parceiro', () => {
  const interno = jwt.sign({ uid: 'u-1', role: 'admin' }, process.env.JWT_SECRET);
  const res = respostaFake();
  verifyPartnerToken(requisicaoComToken(interno), res, () => {
    assert.fail('token interno não pode passar pelo gate do parceiro');
  });
  assert.equal(res.statusCode, 403);
});

test('rede: token do Portal do Embarcador NÃO entra na área do parceiro', () => {
  // Os dois são externos, mas de mundos diferentes — um embarcador não é parceiro.
  const doPortal = emitirTokenPortal({ portalUserId: 'p-1', shipperOrgId: 'org-1', email: 'e@x.invalid' });
  const res = respostaFake();
  verifyPartnerToken(requisicaoComToken(doPortal), res, () => {
    assert.fail('credencial de outro mundo externo não pode passar');
  });
  assert.equal(res.statusCode, 403);
});

test('rede: o token do parceiro NÃO carrega empresa_id', () => {
  const token = emitirTokenParceiro({
    partnerUserId: 'pu-1', partnerOrganizationId: 'org-1', email: 'parceiro@x.invalid',
  });
  const payload = jwt.decode(token);
  assert.equal(payload.token_kind, 'partner_portal');
  assert.ok(!('empresa_id' in payload),
    'empresa_id no token do parceiro seria o tenant do solicitante na mão dele');
  assert.ok(!('uid' in payload), 'não pode parecer identidade interna');

  const req = requisicaoComToken(token);
  const res = respostaFake();
  let passou = false;
  verifyPartnerToken(req, res, () => { passou = true; });
  assert.equal(passou, true);
  assert.equal(req.partnerUser.partner_organization_id, 'org-1');
  assert.ok(!('empresa_id' in req), 'o request do parceiro nunca ganha tenant');
});

// ── Sanitização do snapshot ────────────────────────────────────────────────────

test('rede: a projeção externa é uma lista POSITIVA — campo novo não vaza sozinho', () => {
  const interna = {
    id: 'op-1',
    cargo_descricao: 'Soja a granel',
    quantidade: 500, quantidade_unidade: 'ton',
    estado: 'CURRENT', criado_em: '2026-08-26T00:00:00Z',
    // Tudo abaixo é interno e não pode sair:
    empresa_id: 'emp-a',
    campaign_id: 'camp-1',
    plan_version_id: 'plan-9',
    criado_por: 'user-7',
    client_request_id: 'req-abc',
    snapshot_version: 3,
    superseded_by_id: 'op-2',
    estado_motivo: 'replan interno',
    // E um campo que um dia alguém acrescente sem pensar:
    margem_interna: 12345,
  };
  const externa = projetarParaParceiro(interna);

  for (const proibido of ['empresa_id', 'campaign_id', 'plan_version_id', 'criado_por',
    'client_request_id', 'snapshot_version', 'superseded_by_id', 'estado_motivo', 'margem_interna']) {
    assert.ok(!(proibido in externa), `${proibido} não pode chegar ao parceiro`);
  }
  assert.equal(externa.cargo_descricao, 'Soja a granel');
  assert.equal(externa.quantidade_unidade, 'ton');
});

test('rede: nenhum campo público tem cheiro de preço ou de dado interno', () => {
  const suspeito = /(preco|price|valor|tarifa|rate|comiss|margem|custo|empresa_id|campaign|plan_version|criado_por|client_request)/i;
  const vazando = CAMPOS_PUBLICOS_DA_OPORTUNIDADE.filter((c) => suspeito.test(c));
  assert.deepEqual(vazando, []);
});

// ── Convite ────────────────────────────────────────────────────────────────────

test('rede: o convite guarda hash, nunca o token', () => {
  const { valor, hash } = gerarTokenConvite();
  assert.notEqual(valor, hash);
  assert.equal(hash, hashDoToken(valor));
  assert.match(hash, /^[0-9a-f]{64}$/, 'sha256 hex');
  assert.ok(valor.length >= 32, 'alta entropia');
  // Dois convites nunca colidem.
  assert.notEqual(gerarTokenConvite().valor, gerarTokenConvite().valor);
});

// ── Permissões e entitlement ───────────────────────────────────────────────────

test('rede: as quatro capacidades existem e exigem o entitlement partner_network', () => {
  const chaves = ['partner_network.view', 'partner_network.manage', 'partner_network.share', 'partner_network.respond'];
  for (const chave of chaves) {
    const p = PERMISSIONS.find((x) => x.key === chave);
    assert.ok(p, `${chave} precisa existir no registry`);
    assert.equal(p.entitlementCodigo, 'partner_network',
      'sem entitlement, a rede ficaria ligada para quem não contratou');
  }
});

test('rede: Administrador e Gerente de Frota recebem; Operador é DEFAULT_DENY', () => {
  const admin = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.ADMINISTRADOR]);
  const gerente = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.GERENTE_FROTA]);
  const operador = new Set(TEMPLATE_BASELINE_ALLOW[TEMPLATE_KEYS.OPERADOR]);

  for (const chave of ['partner_network.view', 'partner_network.manage', 'partner_network.share']) {
    assert.equal(admin.has(chave), true, `Administrador precisa de ${chave}`);
    assert.equal(gerente.has(chave), true, `Gerente de Frota precisa de ${chave}`);
    assert.equal(operador.has(chave), false,
      `Operador é DEFAULT_DENY em ${chave}; a empresa delega depois se quiser`);
  }
});

test('rede: nenhuma permissão de rede concede financeiro', () => {
  const daRede = PERMISSIONS.filter((p) => p.key.startsWith('partner_network.'));
  assert.equal(daRede.length, 4);
  for (const p of daRede) {
    assert.ok(!/finance|reports\.financial/.test(p.key));
  }
});

// ── Ausência de preço/adjudicação (§34/§40) ────────────────────────────────────

test('rede: o serviço de oportunidade não expõe nada de preço ou adjudicação', () => {
  const servico = require('../services/partnerNetwork/partnerOpportunityService');
  const proibidos = /(preco|price|award|adjudic|vencedor|winner|comiss|settle|fatur|billing|rank|score)/i;
  const exportados = Object.keys(servico).filter((k) => proibidos.test(k));
  assert.deepEqual(exportados, [],
    'E3.6A não tem autoridade de preço nem de adjudicação — E36B é outro gate');
});

test('rede: o serviço de rede não exporta nada de marketplace ou descoberta pública', () => {
  const servico = require('../services/partnerNetwork/partnerNetworkService');
  const proibidos = /(marketplace|publico|public|directory|diretorio|buscarParceiros|descobrir)/i;
  assert.deepEqual(Object.keys(servico).filter((k) => proibidos.test(k)), []);
});
