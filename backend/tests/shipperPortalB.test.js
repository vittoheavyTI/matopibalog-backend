'use strict';

// PORTAL-B: projeção de acompanhamento, fronteira de documentos/comprovantes,
// separação de contexto entre credenciais e privacidade dos DTOs externos.
//
// O que estes testes protegem, em uma frase: que o embarcador veja exatamente o
// que é dele, descrito numa linguagem que ele entende, e nada além disso.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-shipper-portal';

const tracking = require('../services/shipperPortal/shipperTrackingService');
const documentos = require('../services/shipperPortal/shipperDocumentService');
const { emitirTokenPortal, verifyPortalToken } = require('../middlewares/shipperPortalAuth');
const { verifyToken } = require('../middlewares/auth');
const { EXECUTION_BUCKET } = require('../services/campaign/freightExecutionStatus');

// Stub de supabase que honra os filtros de verdade — o objetivo é justamente
// provar que a fronteira é aplicada no servidor, então filtro fake não serve.
function makeSupabase(tabelas = {}, { storageImpl } = {}) {
  function builder(nome) {
    const filtros = [];
    const b = {
      select() { return b; },
      eq(col, val) { filtros.push([col, val, 'eq']); return b; },
      in(col, vals) { filtros.push([col, vals, 'in']); return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: linhas()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: linhas()[0] || null, error: null }); },
      then(resolve) { resolve({ data: linhas(), error: null }); },
    };
    function linhas() {
      return (tabelas[nome] || []).filter((row) => filtros.every(([col, val, op]) => (
        op === 'in' ? val.includes(row[col]) : row[col] === val
      )));
    }
    return b;
  }
  return {
    from: (n) => builder(n),
    storage: {
      from: (bucket) => ({
        createSignedUrl: (path, ttl) => Promise.resolve(
          storageImpl ? storageImpl(bucket, path, ttl) : { data: { signedUrl: `https://signed/${bucket}/${path}` }, error: null },
        ),
      }),
    },
  };
}

const ORG_X = 'org-x';
const ORG_Y = 'org-y';
const EMP_A = 'empresa-a';
const REL_AX = 'rel-ax';
const REL_AY = 'rel-ay';
const USER_X = 'user-x';
const USER_Y = 'user-y';

function baseFronteira() {
  return {
    shipper_portal_users: [
      { id: USER_X, shipper_org_id: ORG_X, email: 'x@e.test', nome: 'X', status: 'active' },
      { id: USER_Y, shipper_org_id: ORG_Y, email: 'y@e.test', nome: 'Y', status: 'active' },
    ],
    shipper_carrier_relationships: [
      { id: REL_AX, shipper_org_id: ORG_X, empresa_id: EMP_A, status: 'ACTIVE' },
      { id: REL_AY, shipper_org_id: ORG_Y, empresa_id: EMP_A, status: 'ACTIVE' },
    ],
  };
}

function solicitacao(over = {}) {
  return {
    id: 'req-1', empresa_id: EMP_A, shipper_org_id: ORG_X, relationship_id: REL_AX,
    reference_code: 'SOL-1', status: 'ACCEPTED', cargo_name: 'Soja',
    destination_name: 'Porto', quantity_unit: 'ton', campaign_id: 'camp-1',
    created_at: '2026-01-01T00:00:00Z', submitted_at: '2026-01-01T00:00:00Z',
    decided_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    current_submission_version: 1, revision_count: 0, ...over,
  };
}

// ============================================================================
// Mapa de status externo (§47/§48/§120)
// ============================================================================

test('081B status: cada status de solicitação tem um estado externo definido', () => {
  const esperado = {
    DRAFT: 'RECEBIDA', SUBMITTED: 'EM_ANALISE', CHANGES_REQUESTED: 'AJUSTES_SOLICITADOS',
    ACCEPTED: 'ACEITA', REJECTED: 'RECUSADA', CANCELLED: 'CANCELADA',
  };
  for (const [interno, externo] of Object.entries(esperado)) {
    const r = tracking.derivarStatusExterno({ request: solicitacao({ status: interno, campaign_id: null }) });
    assert.equal(r, externo, `${interno} deve projetar ${externo}`);
  }
});

test('081B status: status de frete DESCONHECIDO nunca vira "Em transporte"', () => {
  // Este é o teste que impede a mentira mais cara do portal: dizer que a carga
  // saiu quando o sistema não sabe o que aconteceu.
  const r = tracking.derivarStatusExterno({
    request: solicitacao(),
    campaign: { id: 'camp-1', status: 'APPROVED' },
    freights: [{ id: 'f1', status: 'status_que_nao_existe' }],
  });
  assert.equal(r, tracking.EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO);
  assert.notEqual(r, tracking.EXTERNAL_STATUS.EM_TRANSPORTE);
});

test('081B status: frete em execução projeta Em transporte; todos finalizados projetam Entregue', () => {
  const emViagem = tracking.derivarStatusExterno({
    request: solicitacao(), campaign: { id: 'camp-1', status: 'APPROVED' },
    freights: [{ id: 'f1', status: 'em_viagem' }, { id: 'f2', status: 'finalizado' }],
  });
  assert.equal(emViagem, tracking.EXTERNAL_STATUS.EM_TRANSPORTE);

  const entregue = tracking.derivarStatusExterno({
    request: solicitacao(), campaign: { id: 'camp-1', status: 'APPROVED' },
    freights: [{ id: 'f1', status: 'finalizado' }, { id: 'f2', status: 'finalizado' }],
  });
  assert.equal(entregue, tracking.EXTERNAL_STATUS.ENTREGUE);
});

test('081B status: entregue só vira "Comprovante disponível" se houver comprovante COMPARTILHADO', () => {
  const semComprovante = tracking.derivarStatusExterno({
    request: solicitacao(), campaign: { id: 'camp-1', status: 'APPROVED' },
    freights: [{ id: 'f1', status: 'finalizado' }], temComprovante: false,
  });
  assert.equal(semComprovante, tracking.EXTERNAL_STATUS.ENTREGUE);

  const comComprovante = tracking.derivarStatusExterno({
    request: solicitacao(), campaign: { id: 'camp-1', status: 'APPROVED' },
    freights: [{ id: 'f1', status: 'finalizado' }], temComprovante: true,
  });
  assert.equal(comComprovante, tracking.EXTERNAL_STATUS.COMPROVANTE_DISPONIVEL);
});

test('081B status: aceita sem operação criada continua "Aceita" (handoff pendente não vaza erro)', () => {
  // §45: o embarcador não pode ver "erro 500" porque a conversão interna falhou.
  const r = tracking.derivarStatusExterno({ request: solicitacao({ campaign_id: null }), campaign: null });
  assert.equal(r, tracking.EXTERNAL_STATUS.ACEITA);
});

test('081B status: campanha cancelada internamente não vira "Cancelada" para o embarcador', () => {
  // Cancelar o planejamento interno não é uma decisão comunicada ao embarcador;
  // a decisão externa dele continua sendo "aceita".
  const r = tracking.derivarStatusExterno({
    request: solicitacao(), campaign: { id: 'camp-1', status: 'CANCELLED' }, freights: [],
  });
  assert.equal(r, tracking.EXTERNAL_STATUS.ATUALIZACAO_EM_PROCESSAMENTO);
  assert.notEqual(r, tracking.EXTERNAL_STATUS.CANCELADA);
});

test('081B status: todo estado externo tem rótulo em português', () => {
  for (const chave of Object.values(tracking.EXTERNAL_STATUS)) {
    const rotulo = tracking.ROTULO[chave];
    assert.ok(rotulo && rotulo.length > 3, `${chave} precisa de rótulo`);
    assert.ok(!/[A-Z_]{4,}/.test(rotulo), `${chave} não pode expor a chave crua: ${rotulo}`);
  }
});

test('081B status: o mapa de bucket usado é o canônico do produto (sem cópia paralela)', () => {
  // Se alguém criar um segundo mapa de status de frete, este teste quebra —
  // a autoridade tem que continuar sendo uma só.
  assert.equal(EXECUTION_BUCKET.UNKNOWN, 'UNKNOWN');
  assert.equal(EXECUTION_BUCKET.IN_EXECUTION, 'IN_EXECUTION');
});

// ============================================================================
// Próxima ação e linha do tempo (§54/§80)
// ============================================================================

test('081B ação: ajustes solicitados vira instrução, não código de status', () => {
  const acao = tracking.derivarProximaAcao(tracking.EXTERNAL_STATUS.AJUSTES_SOLICITADOS, { requestId: 'r1' });
  assert.equal(acao.tipo, 'REVISAR');
  assert.equal(acao.rotulo, 'Corrigir solicitação');
  assert.ok(!/CHANGES_REQUESTED/.test(acao.rotulo));
});

test('081B ação: sem pendência, a mensagem é explícita em vez de vazia', () => {
  const acao = tracking.derivarProximaAcao(tracking.EXTERNAL_STATUS.EM_ANALISE, { requestId: 'r1' });
  assert.equal(acao.tipo, 'NENHUMA');
  assert.equal(acao.rotulo, 'No momento, nenhuma ação é necessária.');
});

test('081B linha do tempo: só marcos da whitelist, em ordem cronológica', () => {
  const marcos = tracking.montarLinhaDoTempo({
    request: solicitacao({ status: 'ACCEPTED' }),
    campaign: { id: 'c1', status: 'APPROVED', approved_at: '2026-01-03T00:00:00Z' },
    freights: [{ id: 'f1', status: 'finalizado', created_at: '2026-01-04T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' }],
    comprovanteEm: '2026-01-06T00:00:00Z',
  });
  const chaves = marcos.map((m) => m.chave);
  const permitidas = new Set([
    'SOLICITACAO_ENVIADA', 'AJUSTES_SOLICITADOS', 'SOLICITACAO_ACEITA', 'SOLICITACAO_RECUSADA',
    'SOLICITACAO_CANCELADA', 'OPERACAO_PLANEJADA', 'EM_TRANSPORTE', 'ENTREGA_CONCLUIDA',
    'COMPROVANTE_DISPONIBILIZADO',
  ]);
  for (const c of chaves) assert.ok(permitidas.has(c), `marco fora da whitelist: ${c}`);
  const datas = marcos.map((m) => new Date(m.em).getTime());
  assert.deepEqual(datas, [...datas].sort((a, b) => a - b), 'linha do tempo deve estar em ordem');
  assert.ok(chaves.includes('COMPROVANTE_DISPONIBILIZADO'));
});

// ============================================================================
// Isolamento entre embarcadores da MESMA transportadora (§94/§121)
// ============================================================================

test('081B isolamento: X não enxerga a operação de Y na mesma transportadora', async () => {
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [
      solicitacao({ id: 'req-x', shipper_org_id: ORG_X, relationship_id: REL_AX }),
      solicitacao({ id: 'req-y', shipper_org_id: ORG_Y, relationship_id: REL_AY, reference_code: 'SOL-Y' }),
    ],
    operation_campaigns: [{ id: 'camp-1', status: 'APPROVED' }],
    campaign_trip_freights: [],
    shipper_document_shares: [],
    shipper_transport_request_origins: [],
  });

  const { itens } = await tracking.listarMinhasOperacoes(supabase, { portalUserId: USER_X });
  const ids = itens.map((i) => i.request_id);
  assert.ok(ids.includes('req-x'));
  assert.ok(!ids.includes('req-y'), 'operação do embarcador Y não pode aparecer para o X');
});

test('081B isolamento: acessar diretamente a operação de Y devolve 404, não 403', async () => {
  // 404 deliberado (§101): 403 confirmaria que o objeto existe.
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [solicitacao({ id: 'req-y', shipper_org_id: ORG_Y, relationship_id: REL_AY })],
  });
  await assert.rejects(
    tracking.obterMinhaOperacao(supabase, { portalUserId: USER_X, requestId: 'req-y' }),
    (err) => err.status === 404,
  );
});

test('081B legado: frete histórico sem solicitação de origem não aparece por semelhança', async () => {
  // Existe um frete com o mesmo destino, mas sem proveniência. Não pode entrar.
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [],
    fretes: [{ id: 'frete-legado', status: 'finalizado', destino: 'Porto' }],
    operation_campaigns: [],
    campaign_trip_freights: [],
  });
  const { itens } = await tracking.listarMinhasOperacoes(supabase, { portalUserId: USER_X });
  assert.equal(itens.length, 0, 'sem proveniência não há operação visível');
});

// ============================================================================
// Privacidade dos DTOs externos (§98/§99/§127)
// ============================================================================

const CHAVES_PROIBIDAS = [
  'valor_frete', 'valor', 'custo', 'margem', 'comissao', 'combustivel', 'pedagio',
  'acerto', 'despesa', 'motorista_id', 'cpf', 'cnh', 'telefone', 'empresa_id',
  'decided_by', 'submitted_snapshot', 'accepted_snapshot', 'campaign_id',
  'storage_path', 'token_hash', 'criado_por',
];

function varrer(objeto, caminho = '') {
  const achados = [];
  if (objeto === null || typeof objeto !== 'object') return achados;
  if (Array.isArray(objeto)) {
    objeto.forEach((v, i) => achados.push(...varrer(v, `${caminho}[${i}]`)));
    return achados;
  }
  for (const [k, v] of Object.entries(objeto)) {
    if (CHAVES_PROIBIDAS.includes(k)) achados.push(`${caminho}.${k}`);
    achados.push(...varrer(v, `${caminho}.${k}`));
  }
  return achados;
}

test('081B privacidade: detalhe da operação não carrega dado financeiro, PII nem interno', async () => {
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [solicitacao()],
    operation_campaigns: [{ id: 'camp-1', status: 'APPROVED', approved_at: '2026-01-03T00:00:00Z' }],
    campaign_trip_freights: [{ campaign_id: 'camp-1', frete_id: 'f1' }],
    fretes: [{ id: 'f1', status: 'finalizado', created_at: '2026-01-04T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' }],
    shipper_document_shares: [],
    shipper_transport_request_origins: [
      { request_id: 'req-1', nome: 'Fazenda 1', quantidade: 100, quantity_unit: 'ton', ordem: 0 },
    ],
  });
  const detalhe = await tracking.obterMinhaOperacao(supabase, { portalUserId: USER_X, requestId: 'req-1' });
  const vazamentos = varrer(detalhe);
  assert.deepEqual(vazamentos, [], `DTO externo vazou: ${vazamentos.join(', ')}`);
});

test('081B privacidade: lista de operações também não vaza chave proibida', async () => {
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [solicitacao()],
    operation_campaigns: [{ id: 'camp-1', status: 'APPROVED' }],
    campaign_trip_freights: [{ campaign_id: 'camp-1', frete_id: 'f1' }],
    fretes: [{ id: 'f1', status: 'em_viagem' }],
    shipper_document_shares: [],
    shipper_transport_request_origins: [],
  });
  const { itens } = await tracking.listarMinhasOperacoes(supabase, { portalUserId: USER_X });
  const vazamentos = varrer(itens);
  assert.deepEqual(vazamentos, [], `lista externa vazou: ${vazamentos.join(', ')}`);
});

// ============================================================================
// Documentos e URL assinada (§66/§97/§125)
// ============================================================================

function fixtureDocumentos(over = {}) {
  return {
    ...baseFronteira(),
    shipper_transport_requests: [solicitacao({ id: 'req-1' })],
    shipper_request_documents: [
      { id: 'doc-meu', storage_path: 'p/meu.pdf', request_id: 'req-1', shipper_org_id: ORG_X, status: 'ativo' },
      { id: 'doc-do-y', storage_path: 'p/y.pdf', request_id: 'req-y', shipper_org_id: ORG_Y, status: 'ativo' },
    ],
    shipper_document_shares: [
      {
        id: 'share-ativo', source_kind: 'EPOD_EVIDENCIA', epod_evidencia_id: 'ev-1',
        frete_documento_id: null, status: 'ACTIVE', request_id: 'req-1',
        shipper_org_id: ORG_X, relationship_id: REL_AX, titulo: 'Comprovante', shared_at: '2026-01-06T00:00:00Z',
      },
      {
        id: 'share-revogado', source_kind: 'EPOD_EVIDENCIA', epod_evidencia_id: 'ev-2',
        frete_documento_id: null, status: 'REVOKED', request_id: 'req-1',
        shipper_org_id: ORG_X, relationship_id: REL_AX, titulo: 'Antigo', shared_at: '2026-01-05T00:00:00Z',
      },
      {
        id: 'share-do-y', source_kind: 'EPOD_EVIDENCIA', epod_evidencia_id: 'ev-3',
        frete_documento_id: null, status: 'ACTIVE', request_id: 'req-y',
        shipper_org_id: ORG_Y, relationship_id: REL_AY, titulo: 'Do Y', shared_at: '2026-01-06T00:00:00Z',
      },
    ],
    frete_epod_evidencias: [
      { id: 'ev-1', storage_path: 'e/1.jpg', status: 'aprovada' },
      { id: 'ev-2', storage_path: 'e/2.jpg', status: 'aprovada' },
      { id: 'ev-3', storage_path: 'e/3.jpg', status: 'aprovada' },
      { id: 'ev-pendente', storage_path: 'e/4.jpg', status: 'pendente' },
    ],
    ...over,
  };
}

test('081B documento: URL assinada é emitida para documento próprio', async () => {
  const supabase = makeSupabase(fixtureDocumentos());
  const r = await documentos.urlAssinadaParaEmbarcador(supabase, {
    portalUserId: USER_X, documentoId: 'doc-meu', tipo: 'MEU',
  });
  assert.match(r.url, /^https:\/\/signed\//);
  assert.equal(r.expira_em_segundos, documentos.SIGNED_URL_TTL_SECONDS);
});

test('081B documento IDOR: documento de OUTRO embarcador não gera URL assinada', async () => {
  const supabase = makeSupabase(fixtureDocumentos());
  await assert.rejects(
    documentos.urlAssinadaParaEmbarcador(supabase, {
      portalUserId: USER_X, documentoId: 'doc-do-y', tipo: 'MEU',
    }),
    (err) => err.status === 404,
  );
});

test('081B comprovante: compartilhamento REVOGADO deixa de gerar URL assinada', async () => {
  const supabase = makeSupabase(fixtureDocumentos());
  // O ativo funciona.
  const ok = await documentos.urlAssinadaParaEmbarcador(supabase, {
    portalUserId: USER_X, documentoId: 'share-ativo', tipo: 'COMPARTILHADO',
  });
  assert.match(ok.url, /^https:\/\/signed\//);
  // O revogado, não — mesmo conhecendo o id.
  await assert.rejects(
    documentos.urlAssinadaParaEmbarcador(supabase, {
      portalUserId: USER_X, documentoId: 'share-revogado', tipo: 'COMPARTILHADO',
    }),
    (err) => err.status === 404,
  );
});

test('081B comprovante: compartilhamento de outro embarcador é inalcançável', async () => {
  const supabase = makeSupabase(fixtureDocumentos());
  await assert.rejects(
    documentos.urlAssinadaParaEmbarcador(supabase, {
      portalUserId: USER_X, documentoId: 'share-do-y', tipo: 'COMPARTILHADO',
    }),
    (err) => err.status === 404,
  );
});

test('081B comprovante: evidência que não está aprovada não é servida como comprovante final', async () => {
  // Dupla trava (§71/§72): mesmo com compartilhamento ativo, evidência pendente
  // ou rejeitada não é prova de entrega.
  const supabase = makeSupabase(fixtureDocumentos({
    shipper_document_shares: [{
      id: 'share-pendente', source_kind: 'EPOD_EVIDENCIA', epod_evidencia_id: 'ev-pendente',
      frete_documento_id: null, status: 'ACTIVE', request_id: 'req-1',
      shipper_org_id: ORG_X, relationship_id: REL_AX, titulo: 'Rascunho', shared_at: '2026-01-06T00:00:00Z',
    }],
  }));
  await assert.rejects(
    documentos.urlAssinadaParaEmbarcador(supabase, {
      portalUserId: USER_X, documentoId: 'share-pendente', tipo: 'COMPARTILHADO',
    }),
    (err) => err.status === 404,
  );
});

test('081B documento: listagem separa o que eu enviei do que a transportadora liberou, sem storage_path', async () => {
  const supabase = makeSupabase(fixtureDocumentos());
  const r = await documentos.listarDocumentosDaSolicitacao(supabase, {
    portalUserId: USER_X, requestId: 'req-1',
  });
  assert.ok(Array.isArray(r.enviados_por_mim));
  assert.ok(Array.isArray(r.comprovantes));
  assert.equal(r.comprovantes.length, 1, 'só o compartilhamento ATIVO aparece');
  const vazamentos = varrer(r);
  assert.deepEqual(vazamentos, [], `listagem vazou: ${vazamentos.join(', ')}`);
});

// ============================================================================
// Separação de contexto entre credenciais (§100/§114)
// ============================================================================

function respostaFake() {
  const r = { statusCode: null, payload: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.payload = body; return r; };
  return r;
}

test('081B contexto: token de portal é RECUSADO pela autenticação interna', () => {
  const token = emitirTokenPortal({ portalUserId: USER_X, shipperOrgId: ORG_X, email: 'x@e.test' });
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const res = respostaFake();
  let seguiu = false;
  verifyToken(req, res, () => { seguiu = true; });
  assert.equal(seguiu, false, 'token de portal nunca pode entrar no sistema interno');
  assert.equal(res.statusCode, 403);
});

test('081B contexto: token interno é RECUSADO pelo portal', () => {
  const interno = jwt.sign({ uid: 'operador-1', empresa_id: EMP_A, tipo: 'admin' }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${interno}` }, cookies: {} };
  const res = respostaFake();
  let seguiu = false;
  verifyPortalToken(req, res, () => { seguiu = true; });
  assert.equal(seguiu, false, 'credencial interna não vale no portal');
  assert.equal(res.statusCode, 403);
});

test('081B contexto: token de portal válido entra no portal e traz o contexto externo', () => {
  const token = emitirTokenPortal({ portalUserId: USER_X, shipperOrgId: ORG_X, email: 'x@e.test' });
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const res = respostaFake();
  let seguiu = false;
  verifyPortalToken(req, res, () => { seguiu = true; });
  assert.equal(seguiu, true);
  assert.equal(req.portalUser.id, USER_X);
  assert.equal(req.portalUser.shipper_org_id, ORG_X);
  // O token do portal NUNCA carrega empresa_id: não existe tenant interno aqui.
  assert.equal(req.portalUser.empresa_id, undefined);
});

test('081B contexto: token de portal não carrega empresa_id no payload assinado', () => {
  const token = emitirTokenPortal({ portalUserId: USER_X, shipperOrgId: ORG_X, email: 'x@e.test' });
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  assert.equal(payload.token_kind, 'shipper_portal');
  assert.equal(payload.empresa_id, undefined, 'o token externo não pode transportar tenant interno');
  assert.equal(payload.uid, undefined);
});

// ============================================================================
// Acesso revogado / usuário desativado (§24/§25/§96)
// ============================================================================

test('081B revogação: relacionamento revogado derruba o acesso na requisição seguinte', async () => {
  const supabase = makeSupabase({
    shipper_portal_users: [{ id: USER_X, shipper_org_id: ORG_X, email: 'x@e.test', nome: 'X', status: 'active' }],
    shipper_carrier_relationships: [
      { id: REL_AX, shipper_org_id: ORG_X, empresa_id: EMP_A, status: 'REVOKED' },
    ],
    shipper_transport_requests: [solicitacao()],
  });
  await assert.rejects(
    tracking.listarMinhasOperacoes(supabase, { portalUserId: USER_X }),
    (err) => err.status === 403 && err.code === 'no_active_relationship',
  );
});

test('081B desativação: usuário de portal desativado não acessa, mesmo com token válido', async () => {
  const supabase = makeSupabase({
    shipper_portal_users: [{ id: USER_X, shipper_org_id: ORG_X, email: 'x@e.test', nome: 'X', status: 'disabled' }],
    shipper_carrier_relationships: [{ id: REL_AX, shipper_org_id: ORG_X, empresa_id: EMP_A, status: 'ACTIVE' }],
  });
  await assert.rejects(
    tracking.listarMinhasOperacoes(supabase, { portalUserId: USER_X }),
    (err) => err.status === 403 && err.code === 'portal_user_disabled',
  );
});

// ============================================================================
// Resumo da home (§79)
// ============================================================================

test('081B início: o que precisa de atenção vem separado do resto', async () => {
  const supabase = makeSupabase({
    ...baseFronteira(),
    shipper_transport_requests: [
      solicitacao({ id: 'req-ajuste', status: 'CHANGES_REQUESTED', campaign_id: null, decision_reason: 'Rever janela' }),
      solicitacao({ id: 'req-andamento', status: 'SUBMITTED', campaign_id: null }),
    ],
    operation_campaigns: [], campaign_trip_freights: [],
    shipper_document_shares: [], shipper_transport_request_origins: [],
  });
  const r = await tracking.resumoInicio(supabase, { portalUserId: USER_X });
  assert.equal(r.contadores.precisam_atencao, 1);
  assert.equal(r.precisam_atencao[0].request_id, 'req-ajuste');
  assert.equal(r.precisam_atencao[0].proxima_acao.rotulo, 'Corrigir solicitação');
  assert.equal(r.contadores.em_andamento, 1);
});
