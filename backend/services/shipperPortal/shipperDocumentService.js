'use strict';

// shipperDocumentService — documentos e comprovantes na fronteira externa.
//
// Regra que organiza tudo aqui (§57/§59): o portal expõe por WHITELIST, nunca
// "a linha inteira menos os campos sensíveis". São três — e só três — origens
// possíveis para um arquivo aparecer ao embarcador:
//
//   1. ele mesmo enviou           -> shipper_request_documents
//   2. a transportadora liberou   -> shipper_document_shares (FRETE_DOCUMENTO)
//   3. comprovante liberado       -> shipper_document_shares (EPOD_EVIDENCIA)
//
// Nada aparece por padrão. Um documento interno de frete continua interno até
// alguém autorizado criar a linha de compartilhamento (§63).
//
// SIGNED URL (§66/§97): a URL assinada só é emitida DEPOIS da checagem de
// fronteira sobre o objeto concreto. Não existe caminho neste arquivo em que
// `createSignedUrl` seja chamado antes de provar que o objeto pertence ao
// embarcador autenticado.

const crypto = require('crypto');
const {
  ShipperPortalError, loadPortalContext, requireOwnedRequest, throwDb,
} = require('./shipperBoundaryService');

const BUCKET_PORTAL = 'fretes-documentos';
const BUCKET_EVIDENCIAS = 'fretes-evidencias';
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_DOCS_POR_SOLICITACAO = 10;

const EXTENSAO_POR_MIME = {
  'application/pdf': 'pdf',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function userId(user) {
  return user?.uid || user?.id || null;
}

// ---- lado do embarcador: enviar documento da solicitação -------------------

async function enviarDocumentoDaSolicitacao(supabase, { portalUserId, requestId, arquivo, body = {} }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  // Fronteira ANTES de qualquer escrita ou upload.
  const request = await requireOwnedRequest(supabase, context, requestId);

  if (!arquivo) {
    throw new ShipperPortalError('Selecione um arquivo para enviar.', { status: 400, code: 'file_required' });
  }
  const extensao = EXTENSAO_POR_MIME[arquivo.mimetype];
  if (!extensao) {
    throw new ShipperPortalError('Formato de arquivo não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).', {
      status: 415, code: 'invalid_file_type',
    });
  }

  const nome = typeof body.nome_documento === 'string' && body.nome_documento.trim()
    ? body.nome_documento.trim().slice(0, 120)
    : (arquivo.originalname || 'Documento').slice(0, 120);
  const descricao = typeof body.descricao === 'string' && body.descricao.trim()
    ? body.descricao.trim().slice(0, 500) : null;
  const clientRequestId = typeof body.client_request_id === 'string' && body.client_request_id.trim()
    ? body.client_request_id.trim().slice(0, 120) : null;

  // Idempotência ANTES do upload: um retry de rede não pode gerar dois arquivos
  // no storage nem duas linhas.
  if (clientRequestId) {
    const { data: existente, error } = await supabase
      .from('shipper_request_documents')
      .select('id, nome_documento, descricao, created_at, status')
      .eq('request_id', requestId).eq('enviado_por', portalUserId)
      .eq('client_request_id', clientRequestId).maybeSingle();
    throwDb(error, 'Não foi possível verificar o envio do documento.');
    if (existente) return { ...projetarDocumentoDoEmbarcador(existente), idempotent: true };
  }

  const { count, error: countError } = await supabase
    .from('shipper_request_documents')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId).eq('status', 'ativo');
  throwDb(countError, 'Não foi possível verificar os documentos já enviados.');
  if ((count || 0) >= MAX_DOCS_POR_SOLICITACAO) {
    throw new ShipperPortalError(`Limite de ${MAX_DOCS_POR_SOLICITACAO} documentos por solicitação atingido.`, {
      status: 409, code: 'document_limit_reached',
    });
  }

  const docId = crypto.randomUUID();
  // O caminho carrega a empresa e a solicitação: fica auditável e alinhado com
  // o particionamento já usado pelos documentos internos.
  const storagePath = `${request.empresa_id}/portal/${request.shipper_org_id}/solicitacoes/${requestId}/${docId}.${extensao}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_PORTAL)
    .upload(storagePath, arquivo.buffer, { contentType: arquivo.mimetype, upsert: false });
  if (uploadError) {
    // Nunca devolvemos a exceção do storage ao usuário externo (§70).
    console.error('[shipperPortal:documento:upload] falha', {
      request_id: requestId, mime: arquivo.mimetype, size: arquivo.size,
      erro: uploadError.message || String(uploadError),
    });
    throw new ShipperPortalError('O arquivo não pôde ser enviado. Tente novamente.', {
      status: 502, code: 'upload_failed',
    });
  }

  const { data: inserido, error: insertError } = await supabase
    .from('shipper_request_documents')
    .insert({
      id: docId,
      request_id: requestId,
      empresa_id: request.empresa_id,     // derivado da solicitação, nunca do body
      shipper_org_id: request.shipper_org_id,
      nome_documento: nome,
      descricao,
      storage_path: storagePath,
      mime_type: arquivo.mimetype,
      tamanho_bytes: arquivo.size,
      enviado_por: portalUserId,
      client_request_id: clientRequestId,
    })
    .select('id, nome_documento, descricao, created_at, status').single();

  if (insertError) {
    // Compensação: o arquivo já subiu mas a linha falhou. Remover evita órfão
    // no bucket — e a ausência da linha já garante que ninguém o alcança.
    await supabase.storage.from(BUCKET_PORTAL).remove([storagePath]).catch(() => {});
    throwDb(insertError, 'Não foi possível registrar o documento enviado.');
  }

  return projetarDocumentoDoEmbarcador(inserido);
}

function projetarDocumentoDoEmbarcador(row) {
  return {
    id: row.id,
    origem: 'ENVIADO_POR_MIM',
    nome: row.nome_documento,
    descricao: row.descricao || null,
    enviado_em: row.created_at,
    // Tipo do arquivo para a tela decidir entre pré-visualizar e baixar. É
    // metadado do próprio documento do embarcador — `storage_path` JAMAIS entra
    // na projeção (§67).
    mime_type: row.mime_type || null,
  };
}

function projetarCompartilhado(row) {
  return {
    id: row.id,
    origem: row.source_kind === 'EPOD_EVIDENCIA' ? 'COMPROVANTE' : 'ENVIADO_PELA_TRANSPORTADORA',
    nome: row.titulo,
    descricao: null,
    enviado_em: row.shared_at,
  };
}

// Lista tudo que o embarcador pode ver de UMA solicitação: o que ele enviou e o
// que a transportadora liberou. Duas consultas, ambas já restritas à fronteira.
async function listarDocumentosDaSolicitacao(supabase, { portalUserId, requestId }) {
  const context = await loadPortalContext(supabase, { portalUserId });
  await requireOwnedRequest(supabase, context, requestId);

  const [meus, compartilhados] = await Promise.all([
    supabase.from('shipper_request_documents')
      .select('id, nome_documento, descricao, created_at, status, mime_type')
      .eq('request_id', requestId).eq('status', 'ativo')
      .order('created_at', { ascending: false }),
    supabase.from('shipper_document_shares')
      .select('id, source_kind, titulo, shared_at')
      .eq('request_id', requestId)
      .eq('shipper_org_id', context.shipperOrgId)
      .in('relationship_id', context.relationshipIds)
      .eq('status', 'ACTIVE')
      .order('shared_at', { ascending: false }),
  ]);
  throwDb(meus.error, 'Não foi possível carregar seus documentos.');
  throwDb(compartilhados.error, 'Não foi possível carregar os documentos da transportadora.');

  return {
    enviados_por_mim: (meus.data || []).map(projetarDocumentoDoEmbarcador),
    da_transportadora: (compartilhados.data || [])
      .filter((s) => s.source_kind === 'FRETE_DOCUMENTO').map(projetarCompartilhado),
    comprovantes: (compartilhados.data || [])
      .filter((s) => s.source_kind === 'EPOD_EVIDENCIA').map(projetarCompartilhado),
  };
}

// Todos os arquivos do embarcador, de todos os pedidos, em uma lista só.
//
// Existe porque a pessoa procura um comprovante PELO ARQUIVO ("cadê o canhoto
// da entrega?"), não pelo pedido que o originou — e antes isso obrigava a
// lembrar em qual pedido ele estava. A fronteira é a MESMA das outras leituras:
// organização do embarcador + relacionamentos ativos, aplicada no servidor.
// Nenhuma origem nova de arquivo é introduzida aqui: continuam as três de
// sempre, e `storage_path` segue fora da projeção (§67).
async function listarTodosOsDocumentos(supabase, { portalUserId }) {
  const context = await loadPortalContext(supabase, { portalUserId });

  // Os pedidos do embarcador, para dar nome e referência a cada arquivo.
  const { data: requests, error: reqError } = await supabase
    .from('shipper_transport_requests')
    .select('id, reference_code, cargo_name, destination_name')
    .eq('shipper_org_id', context.shipperOrgId)
    .in('relationship_id', context.relationshipIds);
  throwDb(reqError, 'Não foi possível carregar seus pedidos.');

  const requestIds = (requests || []).map((r) => r.id);
  if (!requestIds.length) return { itens: [] };
  const pedidoPorId = new Map((requests || []).map((r) => [r.id, r]));

  const [meus, compartilhados] = await Promise.all([
    supabase.from('shipper_request_documents')
      .select('id, request_id, nome_documento, descricao, created_at, status, mime_type')
      .in('request_id', requestIds).eq('status', 'ativo')
      .order('created_at', { ascending: false }),
    supabase.from('shipper_document_shares')
      .select('id, request_id, source_kind, titulo, shared_at')
      .in('request_id', requestIds)
      .eq('shipper_org_id', context.shipperOrgId)
      .in('relationship_id', context.relationshipIds)
      .eq('status', 'ACTIVE')
      .order('shared_at', { ascending: false }),
  ]);
  throwDb(meus.error, 'Não foi possível carregar seus documentos.');
  throwDb(compartilhados.error, 'Não foi possível carregar os documentos da transportadora.');

  const comPedido = (doc, requestId) => {
    const pedido = pedidoPorId.get(requestId);
    return {
      ...doc,
      request_id: requestId,
      pedido_referencia: pedido?.reference_code || null,
      pedido_titulo: pedido ? `${pedido.cargo_name} · ${pedido.destination_name}` : null,
    };
  };

  const itens = [
    ...(meus.data || []).map((row) => comPedido(
      { ...projetarDocumentoDoEmbarcador(row), mime_type: row.mime_type || null }, row.request_id,
    )),
    ...(compartilhados.data || []).map((row) => comPedido(projetarCompartilhado(row), row.request_id)),
  ].sort((a, b) => String(b.enviado_em).localeCompare(String(a.enviado_em)));

  return { itens };
}

// Emissão da URL assinada. Este é o ponto onde um erro de fronteira viraria
// IDOR, então a checagem é explícita e vem ANTES da assinatura, em todos os
// caminhos.
async function urlAssinadaParaEmbarcador(supabase, { portalUserId, documentoId, tipo }) {
  const context = await loadPortalContext(supabase, { portalUserId });

  if (tipo === 'MEU') {
    // Documento que o próprio embarcador enviou: precisa ser da organização
    // dele E de uma solicitação dentro da fronteira.
    const { data: doc, error } = await supabase
      .from('shipper_request_documents')
      .select('id, storage_path, request_id, shipper_org_id, status, mime_type')
      .eq('id', documentoId)
      .eq('shipper_org_id', context.shipperOrgId)
      .eq('status', 'ativo')
      .maybeSingle();
    throwDb(error, 'Não foi possível abrir o documento.');
    if (!doc) throw naoEncontrado();
    // Confirma a solicitação também — se o relacionamento foi revogado, o
    // documento deixa de ser alcançável mesmo pertencendo à organização.
    await requireOwnedRequest(supabase, context, doc.request_id);
    return assinar(supabase, BUCKET_PORTAL, doc.storage_path, doc.mime_type);
  }

  // Documento/comprovante liberado pela transportadora. A autoridade é a linha
  // de compartilhamento ATIVA — revogar corta o acesso aqui (§105).
  const { data: share, error } = await supabase
    .from('shipper_document_shares')
    .select('id, source_kind, frete_documento_id, epod_evidencia_id, status, request_id, empresa_id, frete_id')
    .eq('id', documentoId)
    .eq('shipper_org_id', context.shipperOrgId)
    .in('relationship_id', context.relationshipIds)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  throwDb(error, 'Não foi possível abrir o documento.');
  if (!share) throw naoEncontrado();

  // Defesa em profundidade (§23): as FKs já provam a cadeia na gravação, mas na
  // hora de assinar reconferimos empresa e frete do objeto. "A linha de
  // compartilhamento existe" não pode ser tratado como "tudo que ela referencia
  // continua válido" — o arquivo pode ter sido cancelado ou a evidência
  // reprovada depois do compartilhamento.
  if (share.source_kind === 'FRETE_DOCUMENTO') {
    const { data: doc, error: docError } = await supabase
      .from('frete_documentos').select('storage_path, status, mime')
      .eq('id', share.frete_documento_id)
      .eq('frete_id', share.frete_id)
      .eq('empresa_id', share.empresa_id)
      .maybeSingle();
    throwDb(docError, 'Não foi possível abrir o documento.');
    if (!doc || doc.status !== 'ativo') throw naoEncontrado();
    return assinar(supabase, BUCKET_PORTAL, doc.storage_path, doc.mime);
  }

  const { data: evid, error: evidError } = await supabase
    .from('frete_epod_evidencias').select('storage_path, status, mime')
    .eq('id', share.epod_evidencia_id)
    .eq('frete_id', share.frete_id)
    .eq('empresa_id', share.empresa_id)
    .maybeSingle();
  throwDb(evidError, 'Não foi possível abrir o comprovante.');
  // Dupla trava (§71/§72): mesmo compartilhada, uma evidência que deixou de
  // estar aprovada não é servida como comprovante final.
  if (!evid || evid.status !== 'aprovada') throw naoEncontrado();
  return assinar(supabase, BUCKET_EVIDENCIAS, evid.storage_path, evid.mime);
}

function naoEncontrado() {
  return new ShipperPortalError('Documento não encontrado.', { status: 404, code: 'document_not_found' });
}

// `mimeType` acompanha a URL para o portal decidir COMO mostrar o arquivo:
// imagem e PDF ganham pré-visualização embutida, o resto cai em download
// (VIS-08). É metadado do próprio objeto já validado acima — não abre fronteira
// nova nem revela `storage_path`.
async function assinar(supabase, bucket, storagePath, mimeType = null) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new ShipperPortalError('Não foi possível abrir o arquivo agora. Tente novamente.', {
      status: 502, code: 'signed_url_failed',
    });
  }
  return {
    url: data.signedUrl,
    expira_em_segundos: SIGNED_URL_TTL_SECONDS,
    mime_type: mimeType || null,
  };
}

// ---- lado da transportadora: compartilhar / revogar -----------------------

// O que a transportadora PODE oferecer ao embarcador de uma solicitação: os
// documentos e comprovantes dos fretes que nasceram daquela solicitação.
// Note a proveniência: partimos da solicitação, não de uma busca por empresa.
async function listarCompartilhaveis(supabase, { empresaId, requestId }) {
  const { data: request, error } = await supabase
    .from('shipper_transport_requests')
    .select('id, empresa_id, campaign_id, relationship_id, shipper_org_id')
    .eq('id', requestId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!request) {
    throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  }
  if (!request.campaign_id) return { documentos: [], comprovantes: [], ja_compartilhados: [] };

  const { data: vinculos, error: vinculoError } = await supabase
    .from('campaign_trip_freights').select('frete_id').eq('campaign_id', request.campaign_id);
  throwDb(vinculoError, 'Não foi possível carregar as viagens da operação.');
  const freteIds = [...new Set((vinculos || []).map((v) => v.frete_id).filter(Boolean))];
  if (!freteIds.length) return { documentos: [], comprovantes: [], ja_compartilhados: [] };

  const { data: docs, error: docsError } = await supabase
    .from('frete_documentos')
    .select('id, frete_id, empresa_id, tipo, nome_documento, nome_arquivo, created_at, status')
    .in('frete_id', freteIds).eq('status', 'ativo').eq('empresa_id', empresaId);
  throwDb(docsError, 'Não foi possível carregar os documentos.');

  // Somente evidências APROVADAS entram na lista de comprovantes ofertáveis
  // (§71/§72): rascunho, pendente ou rejeitada não são prova de entrega.
  // `frete_epod_evidencias` já carrega `frete_id` e `empresa_id`, então a
  // consulta parte direto dos fretes provados desta operação — sem passar pelo
  // ePOD e sem depender de o vínculo estar coerente.
  const { data: evid, error: evidError } = await supabase
    .from('frete_epod_evidencias')
    // Sem `tipo`: essa coluna não faz parte da cadeia versionada de migrations
    // (048/050), e o serviço não precisa dela — pedir uma coluna que pode não
    // existir quebraria a listagem inteira por nada.
    .select('id, frete_id, empresa_id, epod_id, created_at, status')
    .in('frete_id', freteIds).eq('empresa_id', empresaId).eq('status', 'aprovada');
  throwDb(evidError, 'Não foi possível carregar os comprovantes.');
  const evidencias = evid || [];

  const { data: jaCompartilhados, error: shareError } = await supabase
    .from('shipper_document_shares')
    .select('id, source_kind, frete_documento_id, epod_evidencia_id, titulo, status, shared_at')
    .eq('request_id', requestId).eq('status', 'ACTIVE');
  throwDb(shareError, 'Não foi possível carregar os compartilhamentos.');
  const docsCompartilhados = new Set((jaCompartilhados || []).map((s) => s.frete_documento_id).filter(Boolean));
  const evidCompartilhadas = new Set((jaCompartilhados || []).map((s) => s.epod_evidencia_id).filter(Boolean));

  return {
    // `frete_id` acompanha cada item porque é parte da proveniência que a
    // gravação do compartilhamento precisa registrar — o banco vai exigi-la.
    documentos: (docs || []).map((d) => ({
      id: d.id,
      frete_id: d.frete_id,
      titulo: d.nome_documento || d.nome_arquivo || d.tipo?.toUpperCase() || 'Documento',
      tipo: d.tipo,
      criado_em: d.created_at,
      compartilhado: docsCompartilhados.has(d.id),
    })),
    comprovantes: evidencias.map((e) => ({
      id: e.id,
      frete_id: e.frete_id,
      titulo: 'Comprovante de entrega',
      criado_em: e.created_at,
      compartilhado: evidCompartilhadas.has(e.id),
    })),
    ja_compartilhados: (jaCompartilhados || []).map((s) => ({
      id: s.id, titulo: s.titulo, origem: s.source_kind, desde: s.shared_at,
    })),
  };
}

// Compartilhar é uma decisão explícita e registrada. Replay do mesmo
// compartilhamento converge em vez de estourar erro (§105).
async function compartilhar(supabase, { empresaId, user, requestId, body = {} }) {
  const sourceKind = String(body.source_kind || '').trim().toUpperCase();
  if (!['FRETE_DOCUMENTO', 'EPOD_EVIDENCIA'].includes(sourceKind)) {
    throw new ShipperPortalError('Tipo de documento inválido.', { status: 400, code: 'invalid_source_kind' });
  }
  const objetoId = String(body.objeto_id || '').trim();
  if (!objetoId) {
    throw new ShipperPortalError('Informe o documento a compartilhar.', { status: 400, code: 'missing_object' });
  }

  const { data: request, error } = await supabase
    .from('shipper_transport_requests')
    .select('id, empresa_id, campaign_id, relationship_id, shipper_org_id')
    .eq('id', requestId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!request) {
    throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  }

  // O objeto precisa PROVADAMENTE pertencer à operação que nasceu desta
  // solicitação. Sem esta checagem, um id de documento de outra empresa
  // poderia ser compartilhado só por ser conhecido.
  const elegiveis = await listarCompartilhaveis(supabase, { empresaId, requestId });
  const fonte = sourceKind === 'FRETE_DOCUMENTO'
    ? elegiveis.documentos.find((d) => d.id === objetoId)
    : elegiveis.comprovantes.find((c) => c.id === objetoId);
  if (!fonte) {
    throw new ShipperPortalError('Este documento não pertence a esta operação.', {
      status: 404, code: 'document_not_eligible',
    });
  }

  const jaAtivo = await supabase
    .from('shipper_document_shares')
    .select('id')
    .eq('relationship_id', request.relationship_id)
    .eq('status', 'ACTIVE')
    .eq(sourceKind === 'FRETE_DOCUMENTO' ? 'frete_documento_id' : 'epod_evidencia_id', objetoId)
    .maybeSingle();
  if (jaAtivo.data) return { id: jaAtivo.data.id, ja_estava_compartilhado: true };

  // Proveniência COMPLETA na linha (HIGH-02). A checagem de elegibilidade acima
  // continua valendo como primeira barreira e mensagem amigável; estas colunas
  // são o que permite ao BANCO recusar sozinho uma combinação impossível.
  const { data, error: insertError } = await supabase
    .from('shipper_document_shares')
    .insert({
      empresa_id: empresaId,
      shipper_org_id: request.shipper_org_id,
      relationship_id: request.relationship_id,
      request_id: requestId,
      campaign_id: request.campaign_id,
      frete_id: fonte.frete_id,
      source_kind: sourceKind,
      frete_documento_id: sourceKind === 'FRETE_DOCUMENTO' ? objetoId : null,
      epod_evidencia_id: sourceKind === 'EPOD_EVIDENCIA' ? objetoId : null,
      titulo: (body.titulo && String(body.titulo).trim().slice(0, 160)) || fonte.titulo,
      shared_by: userId(user),
    })
    .select('id').single();
  if (insertError && insertError.code === '23503') {
    // Violação de FK aqui significa que a cadeia de proveniência não fecha —
    // é o banco recusando o que a aplicação deixou passar.
    throw new ShipperPortalError('Este documento não pertence a esta operação.', {
      status: 409, code: 'document_provenance_invalid',
    });
  }
  throwDb(insertError, 'Não foi possível compartilhar o documento.');
  return { id: data.id, ja_estava_compartilhado: false };
}

// Documentos que o EMBARCADOR enviou, vistos pelo lado da transportadora
// (HIGH-05). Sem isto, o operador recebia anexos que não conseguia abrir — o
// que torna o envio de documento pelo portal inútil na prática.
//
// Projeção por whitelist também aqui: `storage_path` nunca sai.
async function listarDocumentosDoEmbarcador(supabase, { empresaId, requestId }) {
  const { data: request, error } = await supabase
    .from('shipper_transport_requests').select('id')
    .eq('id', requestId).eq('empresa_id', empresaId).maybeSingle();
  throwDb(error, 'Não foi possível carregar a solicitação.');
  if (!request) {
    throw new ShipperPortalError('Solicitação não encontrada.', { status: 404, code: 'request_not_found' });
  }

  const { data, error: docsError } = await supabase
    .from('shipper_request_documents')
    .select('id, nome_documento, descricao, mime_type, tamanho_bytes, created_at')
    .eq('request_id', requestId).eq('empresa_id', empresaId).eq('status', 'ativo')
    .order('created_at', { ascending: false });
  throwDb(docsError, 'Não foi possível carregar os documentos do embarcador.');

  return {
    itens: (data || []).map((d) => ({
      id: d.id,
      nome: d.nome_documento,
      descricao: d.descricao || null,
      tipo_arquivo: d.mime_type || null,
      tamanho_bytes: d.tamanho_bytes || null,
      enviado_em: d.created_at,
    })),
  };
}

// URL assinada para a transportadora abrir um documento enviado pelo embarcador.
// A fronteira aqui é o tenant + a solicitação: o documento precisa pertencer a
// uma solicitação DESTA empresa.
async function urlAssinadaParaTransportadora(supabase, { empresaId, requestId, documentoId }) {
  const { data: doc, error } = await supabase
    .from('shipper_request_documents')
    .select('id, storage_path, status, request_id, empresa_id, mime_type')
    .eq('id', documentoId)
    .eq('request_id', requestId)
    .eq('empresa_id', empresaId)
    .eq('status', 'ativo')
    .maybeSingle();
  throwDb(error, 'Não foi possível abrir o documento.');
  if (!doc) throw naoEncontrado();
  return assinar(supabase, BUCKET_PORTAL, doc.storage_path, doc.mime_type);
}

async function revogarCompartilhamento(supabase, { empresaId, user, shareId }) {
  const { data, error } = await supabase
    .from('shipper_document_shares')
    .update({ status: 'REVOKED', revoked_at: new Date().toISOString(), revoked_by: userId(user) })
    .eq('id', shareId).eq('empresa_id', empresaId).eq('status', 'ACTIVE')
    .select('id, status').maybeSingle();
  throwDb(error, 'Não foi possível revogar o compartilhamento.');
  if (!data) {
    throw new ShipperPortalError('Este compartilhamento não está ativo ou não foi encontrado.', {
      status: 404, code: 'share_not_found',
    });
  }
  return data;
}

module.exports = {
  enviarDocumentoDaSolicitacao,
  listarDocumentosDaSolicitacao,
  listarTodosOsDocumentos,
  urlAssinadaParaEmbarcador,
  listarCompartilhaveis,
  compartilhar,
  revogarCompartilhamento,
  listarDocumentosDoEmbarcador,
  urlAssinadaParaTransportadora,
  EXTENSAO_POR_MIME,
  MAX_DOCS_POR_SOLICITACAO,
  SIGNED_URL_TTL_SECONDS,
};
