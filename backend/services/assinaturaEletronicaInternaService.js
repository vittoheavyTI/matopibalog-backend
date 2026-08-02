const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { enviarEmail } = require('./emailService');
const {
  STATUS_CONTRATO,
  STATUS_PROPOSTA,
  hashConteudo,
} = require('./contratacaoComercialDomainService');
const { BUCKET_CONTRATOS } = require('./contratacaoStorageService');

const METODO_ASSINATURA = 'interno_otp';
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const HASH_VERSION = 'hmac-sha256-v1';
const CONSENT_VERSION = 'assinatura-interna-v1';
const SIGNATURE_PROVIDER_VERSION = 'interno_otp_v1';

const STATUS_FINAIS = new Set([
  STATUS_CONTRATO.PLENAMENTE_ASSINADO,
  STATUS_CONTRATO.ASSINADO,
  STATUS_CONTRATO.ACEITO_MANUALMENTE,
  STATUS_CONTRATO.CANCELADO,
  STATUS_CONTRATO.RECUSADO,
  STATUS_CONTRATO.EXPIRADO,
  STATUS_CONTRATO.SUBSTITUIDO,
]);

function erroConflitoUnico(error) {
  return error && (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || ''));
}

function sha256(valor) {
  return crypto.createHash('sha256').update(String(valor), 'utf8').digest('hex');
}

function hmacHex(secret, valor) {
  return crypto.createHmac('sha256', secret).update(String(valor), 'utf8').digest('hex');
}

function gerarCodigoOtp(randomBytes = crypto.randomBytes) {
  const n = randomBytes(4).readUInt32BE(0) % 1000000;
  return String(n).padStart(6, '0');
}

function mascararEmail(email) {
  const normalizado = String(email || '').trim().toLowerCase();
  const [nome, dominio] = normalizado.split('@');
  if (!nome || !dominio) return null;
  const visivel = nome.length <= 2 ? nome[0] : `${nome[0]}${'*'.repeat(Math.max(1, nome.length - 2))}${nome[nome.length - 1]}`;
  return `${visivel}@${dominio}`;
}

function normalizarIpHash(ip, secret) {
  if (!ip) return null;
  return hmacHex(secret, String(ip));
}

function textoConsentimento({ papel }) {
  const parte = papel === 'matopiba' ? 'pela Matopiba Log' : 'pela empresa contratante';
  return [
    'Declaro que li o contrato, reconheco que este codigo confirma minha assinatura eletronica interna e autorizo o registro das evidencias tecnicas desta assinatura.',
    `Estou assinando ${parte}, com poderes para representar esta parte no contrato comercial.`,
    'Estou ciente de que o primeiro uso com cliente real depende da revisao juridica do contrato e das evidencias.',
  ].join(' ');
}

function montarConteudoContrato({ contrato, proposta, empresa, cliente, matopiba }) {
  const snapshot = proposta?.snapshot || {};
  return [
    'Contrato tecnico Matopiba Log',
    `Versao: ${contrato.template_version || 'comercial-v1-tecnico'}`,
    `Contrato: ${contrato.id}`,
    `Empresa: ${empresa?.nome || 'Nao informado'}`,
    `Documento da empresa: ${empresa?.cnpj ? 'informado' : 'nao informado'}`,
    `Responsavel cliente: ${cliente?.nome || 'Nao informado'}`,
    `Representante Matopiba: ${matopiba?.nome || 'pendente'}`,
    `Plano: ${snapshot.plano_nome || 'Nao informado'}`,
    `Quantidade contratada: ${snapshot.quantidade_contratada || 0}`,
    `Mensalidade: R$ ${Number(snapshot.valor_mensal || 0).toFixed(2)}`,
    `Implantacao: R$ ${Number(snapshot.valor_implantacao || 0).toFixed(2)}`,
    `Trial: ${Number(snapshot.trial_dias || 0)} dias`,
    '',
    'Aviso: texto tecnico pendente de revisao juridica antes do primeiro cliente real.',
  ].join('\n');
}

function pdfEscape(texto) {
  return String(texto).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function montarPdfSimples(titulo, linhas) {
  const comandos = [
    'BT',
    '/F1 14 Tf',
    '50 780 Td',
    `(${pdfEscape(titulo)}) Tj`,
    '/F1 9 Tf',
  ];
  for (const linha of linhas) {
    comandos.push('0 -16 Td');
    comandos.push(`(${pdfEscape(String(linha).slice(0, 110))}) Tj`);
  }
  comandos.push('ET');
  const stream = comandos.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xref = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

function montarCertificado({ contrato, signatarios, eventos, finalHash }) {
  const linhas = [
    `Contrato: ${contrato.id}`,
    `Empresa: ${contrato.empresa_id}`,
    `Metodo: ${METODO_ASSINATURA}`,
    `Arquivo final SHA-256: ${finalHash || contrato.signed_file_hash || 'pendente'}`,
    `Gerado em: ${new Date().toISOString()}`,
    '',
    'Assinaturas',
    ...(signatarios || []).map((s) => `${s.papel}: ${s.nome || 'Nao informado'} - ${s.status} - ${s.assinado_em || 'pendente'}`),
    '',
    'Eventos',
    ...(eventos || []).map((e) => `${e.criado_em || ''} ${e.tipo} ${e.event_hash || ''}`),
    '',
    'Coordenadas, tokens, IP bruto e dados pessoais sensiveis nao sao exibidos neste certificado.',
  ];
  return montarPdfSimples('Certificado de assinatura eletronica interna', linhas);
}

function montarEventoHash({ prevHash, tipo, detalhe, criadoPor, criadoEm }) {
  return sha256(JSON.stringify({
    prev_hash: prevHash || null,
    tipo,
    detalhe: detalhe || {},
    criado_por: criadoPor || null,
    criado_em: criadoEm,
  }));
}

async function inserirEvento({ supabase, contratoId, empresaId, tipo, detalhe = {}, criadoPor = null, actorPapel = null, idempotencyKey = null, maxTentativas = 3 }) {
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa += 1) {
    const { data: anterior, error: anteriorError } = await supabase
      .from('contrato_eventos')
      .select('event_hash, criado_em')
      .eq('contrato_id', contratoId)
      .not('event_hash', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(1);
    if (anteriorError) throw anteriorError;
    const criadoEm = new Date().toISOString();
    const prevHash = anterior?.[0]?.event_hash || null;
    const eventHash = montarEventoHash({ prevHash, tipo, detalhe, criadoPor, criadoEm });
    const payload = {
      contrato_id: contratoId,
      empresa_id: empresaId,
      tipo,
      detalhe,
      criado_por: criadoPor,
      criado_em: criadoEm,
      prev_hash: prevHash,
      event_hash: eventHash,
      actor_papel: actorPapel,
      idempotency_key: idempotencyKey,
    };
    const { error } = await supabase.from('contrato_eventos').insert(payload);
    if (!error) return payload;
    if (!erroConflitoUnico(error)) throw error;
    ultimoErro = error;
  }
  const err = new Error('Nao foi possivel registrar evento de assinatura sem bifurcar a trilha.');
  err.status = 409;
  err.cause = ultimoErro;
  throw err;
}

function assinaturaStoragePath({ empresaId, contratoId, tipo, hash }) {
  return `${empresaId}/contratos/${contratoId}/${tipo}-${hash}.pdf`;
}

async function uploadPdfImutavel({ supabase, empresaId, contratoId, tipo, buffer }) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const path = assinaturaStoragePath({ empresaId, contratoId, tipo, hash });
  const { error } = await supabase.storage
    .from(BUCKET_CONTRATOS)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message || '')) throw error;
  return { path, hash, size: buffer.length };
}

function emailHtmlOtp({ codigo, contratoId, papel }) {
  return [
    '<p>Use o codigo abaixo para confirmar a assinatura eletronica interna.</p>',
    `<p><strong>${codigo}</strong></p>`,
    `<p>Contrato: ${contratoId}</p>`,
    `<p>Parte: ${papel === 'matopiba' ? 'Matopiba Log' : 'Cliente'}</p>`,
    '<p>O codigo expira em 10 minutos. Se voce nao solicitou, ignore esta mensagem.</p>',
  ].join('');
}

function criarAuthClient(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verificarSenhaAtual({ email, senha, authClient = null, env = process.env }) {
  if (!email || !senha) return { ok: false, status: 400, message: 'Informe a senha atual.' };
  const client = authClient || criarAuthClient(env);
  if (!client) return { ok: false, status: 503, message: 'Reautenticacao indisponivel.' };
  const { data, error } = await client.auth.signInWithPassword({ email, password: senha });
  if (error || !data?.user) return { ok: false, status: 400, message: 'Senha atual invalida.' };
  return { ok: true };
}

async function usuarioAutenticado({ supabase, usuarioId }) {
  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, empresa_id, is_super_admin, tipo, status')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error) throw error;
  if (!usuario || usuario.status === 'inativo') return null;
  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(usuarioId);
  if (authError) throw authError;
  const confirmado = Boolean(authData?.user?.email_confirmed_at || authData?.user?.confirmed_at);
  return { ...usuario, email_confirmado: confirmado };
}

async function carregarContratoAssinatura({ supabase, contratoId, empresaId }) {
  const { data, error } = await supabase
    .from('contratos_comerciais')
    .select('*, propostas_comerciais(id, status, snapshot), empresas(id, nome, cnpj)')
    .eq('id', contratoId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.empresa_id !== empresaId) return null;
  return data;
}

async function listarSignatarios({ supabase, contratoId, empresaId }) {
  const { data, error } = await supabase
    .from('contrato_signatarios')
    .select('*')
    .eq('contrato_id', contratoId)
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function upsertSignatario({ supabase, contrato, usuario, papel }) {
  const existentes = await listarSignatarios({ supabase, contratoId: contrato.id, empresaId: contrato.empresa_id });
  const atual = existentes.find((s) => s.papel === papel);
  const patch = {
    contrato_id: contrato.id,
    empresa_id: contrato.empresa_id,
    usuario_id: usuario.id,
    nome: usuario.nome || (papel === 'matopiba' ? 'Matopiba Log' : 'Responsavel'),
    papel,
    email_hash: sha256(String(usuario.email || '').trim().toLowerCase()),
    email_mascarado: mascararEmail(usuario.email),
    metodo_assinatura: METODO_ASSINATURA,
    status: atual?.status || 'pendente',
  };
  if (atual) {
    const { data, error } = await supabase
      .from('contrato_signatarios')
      .update(patch)
      .eq('id', atual.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('contrato_signatarios')
    .insert(patch)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function motivoContratoNaoAssinavel(contrato) {
  if (!contrato) return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  if (STATUS_FINAIS.has(contrato.status)) return { status: 409, body: { message: 'Contrato nao pode receber nova assinatura neste estado.' } };
  const proposta = Array.isArray(contrato.propostas_comerciais)
    ? contrato.propostas_comerciais[0]
    : contrato.propostas_comerciais;
  if ([STATUS_PROPOSTA.CANCELADA, STATUS_PROPOSTA.EXPIRADA].includes(proposta?.status)) {
    return { status: 409, body: { message: 'Proposta cancelada ou expirada nao pode ser assinada.' } };
  }
  return null;
}

async function prepararDocumentoSeNecessario({ supabase, contrato, usuario }) {
  if (contrato.storage_path && contrato.content_hash) return contrato;
  const proposta = Array.isArray(contrato.propostas_comerciais)
    ? contrato.propostas_comerciais[0]
    : contrato.propostas_comerciais;
  const empresa = Array.isArray(contrato.empresas) ? contrato.empresas[0] : contrato.empresas;
  const conteudo = montarConteudoContrato({ contrato, proposta, empresa, cliente: usuario });
  const documentHash = hashConteudo(conteudo);
  const buffer = montarPdfSimples('Contrato tecnico Matopiba Log', conteudo.split('\n'));
  const upload = await uploadPdfImutavel({
    supabase,
    empresaId: contrato.empresa_id,
    contratoId: contrato.id,
    tipo: 'original',
    buffer,
  });
  const agora = new Date().toISOString();
  const metadata = {
    ...(contrato.metadata || {}),
    aviso_juridico: 'texto_tecnico_pendente_revisao_juridica',
    assinatura_eletronica: { metodo: METODO_ASSINATURA, versao: SIGNATURE_PROVIDER_VERSION },
  };
  const { data, error } = await supabase
    .from('contratos_comerciais')
    .update({
      status: contrato.status === STATUS_CONTRATO.AGUARDANDO_ASSINATURA ? STATUS_CONTRATO.AGUARDANDO_ASSINATURA_CLIENTE : contrato.status,
      provider: METODO_ASSINATURA,
      signature_method: METODO_ASSINATURA,
      signature_method_version: SIGNATURE_PROVIDER_VERSION,
      storage_path: upload.path,
      content_hash: documentHash,
      document_file_hash: upload.hash,
      document_size_bytes: upload.size,
      document_fechado_em: agora,
      metadata,
      atualizado_em: agora,
    })
    .eq('id', contrato.id)
    .eq('empresa_id', contrato.empresa_id)
    .select('*, propostas_comerciais(id, status, snapshot), empresas(id, nome, cnpj)')
    .single();
  if (error) throw error;
  await inserirEvento({
    supabase,
    contratoId: contrato.id,
    empresaId: contrato.empresa_id,
    tipo: 'documento_preparado_assinatura_interna',
    detalhe: { metodo: METODO_ASSINATURA, document_hash: documentHash, storage_hash: upload.hash },
    criadoPor: usuario.id,
  });
  return data;
}

async function solicitarDesafioAssinatura({
  supabase,
  contratoId,
  empresaId,
  usuarioId,
  papel,
  senha,
  ip = null,
  userAgent = null,
  env = process.env,
  emailDeps = {},
  authClient = null,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!['cliente', 'matopiba'].includes(papel)) {
    return { status: 400, body: { message: 'Parte de assinatura invalida.' } };
  }
  const secret = env.ASSINATURA_OTP_HMAC_SECRET || env.JWT_SECRET;
  if (!secret || String(secret).length < 24) {
    return { status: 503, body: { message: 'Assinatura eletronica indisponivel: segredo de OTP nao configurado.' } };
  }
  const usuario = await usuarioAutenticado({ supabase, usuarioId });
  if (!usuario) return { status: 401, body: { message: 'Usuario nao encontrado.' } };
  if (!usuario.email_confirmado) return { status: 403, body: { message: 'Confirme o e-mail antes de assinar.' } };
  if (papel === 'cliente' && usuario.empresa_id !== empresaId) return { status: 403, body: { message: 'Usuario nao pertence a esta empresa.' } };
  if (papel === 'matopiba' && usuario.is_super_admin !== true) return { status: 403, body: { message: 'Apenas super-admin pode assinar pela Matopiba.' } };

  const senhaOk = await verificarSenhaAtual({ email: usuario.email, senha, authClient, env });
  if (!senhaOk.ok) return { status: senhaOk.status, body: { message: senhaOk.message } };

  let contrato = await carregarContratoAssinatura({ supabase, contratoId, empresaId });
  const bloqueio = motivoContratoNaoAssinavel(contrato);
  if (bloqueio) return bloqueio;
  contrato = await prepararDocumentoSeNecessario({ supabase, contrato, usuario });
  const signatario = await upsertSignatario({ supabase, contrato, usuario, papel });
  if (signatario.status === 'assinado') {
    return { status: 200, body: { idempotente: true, status: contrato.status, message: 'Assinatura ja registrada.' } };
  }

  const codigo = gerarCodigoOtp(randomBytes);
  const agora = new Date();
  const expiresAt = new Date(agora.getTime() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  const codigoHmac = hmacHex(secret, `${contrato.id}:${signatario.id}:${codigo}`);
  const email = usuario.email;

  await supabase
    .from('contrato_assinatura_desafios')
    .update({ status: 'cancelado', invalidated_at: new Date().toISOString() })
    .eq('contrato_id', contrato.id)
    .eq('signatario_id', signatario.id)
    .eq('status', 'ativo');

  const payloadDesafio = {
    contrato_id: contrato.id,
    empresa_id: contrato.empresa_id,
    signatario_id: signatario.id,
    usuario_id: usuario.id,
    papel,
    document_hash: contrato.content_hash,
    codigo_hmac: codigoHmac,
    codigo_alg: HASH_VERSION,
    expires_at: expiresAt,
    attempts: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    status: 'ativo',
    email_hash: sha256(String(email).trim().toLowerCase()),
    email_mascarado: mascararEmail(email),
    ip_hash: normalizarIpHash(ip, secret),
    user_agent_hash: userAgent ? hmacHex(secret, String(userAgent).slice(0, 300)) : null,
  };

  const { data: desafio, error } = await supabase
    .from('contrato_assinatura_desafios')
    .insert(payloadDesafio)
    .select('id, expires_at, email_mascarado')
    .single();
  if (error) {
    if (erroConflitoUnico(error)) {
      return { status: 409, body: { message: 'Ja existe um codigo ativo para esta assinatura. Aguarde alguns instantes e tente novamente.' } };
    }
    throw error;
  }

  const envio = await enviarEmail({
    para: email,
    assunto: 'Codigo de assinatura Matopiba Log',
    html: emailHtmlOtp({ codigo, contratoId: contrato.id, papel }),
    texto: `Codigo de assinatura: ${codigo}. Expira em ${OTP_TTL_MINUTES} minutos.`,
  }, emailDeps);
  if (!envio.enviado) {
    await supabase
      .from('contrato_assinatura_desafios')
      .update({ status: 'cancelado', invalidated_at: new Date().toISOString() })
      .eq('id', desafio.id);
    return {
      status: 503,
      body: {
        message: 'Nao foi possivel enviar o codigo por e-mail agora. Tente novamente ou fale com o suporte.',
        motivo: envio.motivo,
      },
    };
  }

  await supabase
    .from('contrato_assinatura_desafios')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', desafio.id);

  await inserirEvento({
    supabase,
    contratoId: contrato.id,
    empresaId: contrato.empresa_id,
    tipo: 'codigo_assinatura_enviado',
    detalhe: { papel, email_mascarado: desafio.email_mascarado, expires_at: desafio.expires_at },
    criadoPor: usuario.id,
    actorPapel: papel,
  });

  return {
    status: 201,
    body: {
      desafio_id: desafio.id,
      expires_at: desafio.expires_at,
      email_mascarado: desafio.email_mascarado,
      status: contrato.status,
    },
  };
}

async function confirmarAssinatura({
  supabase,
  contratoId,
  empresaId,
  usuarioId,
  papel,
  codigo,
  consentimentoAceito,
  declaracaoPoderes,
  ip = null,
  userAgent = null,
  env = process.env,
} = {}) {
  if (!consentimentoAceito || !declaracaoPoderes) {
    return { status: 422, body: { message: 'Confirme o consentimento e a declaracao de poderes para assinar.' } };
  }
  if (!/^\d{6}$/.test(String(codigo || ''))) {
    return { status: 400, body: { message: 'Codigo invalido.' } };
  }
  const secret = env.ASSINATURA_OTP_HMAC_SECRET || env.JWT_SECRET;
  if (!secret || String(secret).length < 24) {
    return { status: 503, body: { message: 'Assinatura eletronica indisponivel: segredo de OTP nao configurado.' } };
  }
  const usuario = await usuarioAutenticado({ supabase, usuarioId });
  if (!usuario) return { status: 401, body: { message: 'Usuario nao encontrado.' } };
  if (papel === 'cliente' && usuario.empresa_id !== empresaId) return { status: 403, body: { message: 'Usuario nao pertence a esta empresa.' } };
  if (papel === 'matopiba' && usuario.is_super_admin !== true) return { status: 403, body: { message: 'Apenas super-admin pode assinar pela Matopiba.' } };

  const contrato = await carregarContratoAssinatura({ supabase, contratoId, empresaId });
  const bloqueio = motivoContratoNaoAssinavel(contrato);
  if (bloqueio) return bloqueio;
  const signatarios = await listarSignatarios({ supabase, contratoId, empresaId });
  const signatario = signatarios.find((s) => s.papel === papel && s.usuario_id === usuario.id);
  if (!signatario) return { status: 409, body: { message: 'Solicite um novo codigo antes de assinar.' } };
  if (signatario.status === 'assinado') {
    return { status: 200, body: { idempotente: true, id: contrato.id, status: contrato.status } };
  }

  const { data: desafios, error: desafioError } = await supabase
    .from('contrato_assinatura_desafios')
    .select('*')
    .eq('contrato_id', contrato.id)
    .eq('signatario_id', signatario.id)
    .eq('status', 'ativo')
    .order('created_at', { ascending: false })
    .limit(1);
  if (desafioError) throw desafioError;
  const desafio = desafios?.[0];
  if (!desafio) return { status: 409, body: { message: 'Codigo expirado ou ausente. Solicite um novo codigo.' } };
  if (desafio.codigo_alg !== HASH_VERSION) {
    return { status: 409, body: { message: 'Codigo expirado ou ausente. Solicite um novo codigo.' } };
  }
  if (new Date(desafio.expires_at).getTime() < Date.now()) {
    await supabase.from('contrato_assinatura_desafios').update({ status: 'expirado' }).eq('id', desafio.id);
    return { status: 409, body: { message: 'Codigo expirado. Solicite um novo codigo.' } };
  }
  if (Number(desafio.attempts || 0) >= Number(desafio.max_attempts || OTP_MAX_ATTEMPTS)) {
    await supabase.from('contrato_assinatura_desafios').update({ status: 'bloqueado' }).eq('id', desafio.id);
    return { status: 429, body: { message: 'Muitas tentativas. Solicite um novo codigo.' } };
  }
  const esperado = hmacHex(secret, `${contrato.id}:${signatario.id}:${codigo}`);
  if (esperado !== desafio.codigo_hmac) {
    await supabase.from('contrato_assinatura_desafios').update({ attempts: Number(desafio.attempts || 0) + 1 }).eq('id', desafio.id);
    return { status: 401, body: { message: 'Codigo incorreto.' } };
  }

  const agora = new Date().toISOString();
  const consentText = textoConsentimento({ papel });
  const assinaturaHash = sha256(JSON.stringify({
    contrato_id: contrato.id,
    signatario_id: signatario.id,
    papel,
    document_hash: contrato.content_hash,
    consent_text: consentText,
    confirmed_at: agora,
  }));
  await supabase.from('contrato_assinatura_desafios').update({ status: 'confirmado', confirmed_at: agora }).eq('id', desafio.id);
  await supabase.from('contrato_signatarios').update({
    status: 'assinado',
    assinado_em: agora,
    metodo_assinatura: METODO_ASSINATURA,
    assinatura_hash: assinaturaHash,
    document_hash_assinado: contrato.content_hash,
    consent_text_version: CONSENT_VERSION,
    consent_text: consentText,
    ip_hash: normalizarIpHash(ip, secret),
    user_agent_hash: userAgent ? hmacHex(secret, String(userAgent).slice(0, 300)) : null,
  }).eq('id', signatario.id);

  await inserirEvento({
    supabase,
    contratoId: contrato.id,
    empresaId,
    tipo: 'assinatura_interna_confirmada',
    detalhe: { papel, metodo: METODO_ASSINATURA, assinatura_hash: assinaturaHash, document_hash: contrato.content_hash },
    criadoPor: usuario.id,
    actorPapel: papel,
  });

  const atualizados = await listarSignatarios({ supabase, contratoId, empresaId });
  const clienteAssinado = atualizados.some((s) => s.papel === 'cliente' && s.status === 'assinado');
  const matopibaAssinado = atualizados.some((s) => s.papel === 'matopiba' && s.status === 'assinado');
  let novoStatus = contrato.status;
  const patchContrato = { atualizado_em: agora, provider: METODO_ASSINATURA, signature_method: METODO_ASSINATURA };
  if (clienteAssinado && !matopibaAssinado) {
    novoStatus = STATUS_CONTRATO.AGUARDANDO_ASSINATURA_MATOPIBA;
    patchContrato.status = novoStatus;
  }
  if (clienteAssinado && matopibaAssinado) {
    novoStatus = STATUS_CONTRATO.PLENAMENTE_ASSINADO;
    const linhasFinal = [
      'Contrato assinado eletronicamente',
      `Contrato: ${contrato.id}`,
      `Hash do documento original: ${contrato.content_hash}`,
      ...atualizados.map((s) => `${s.papel}: ${s.nome || 'Nao informado'} - ${s.assinado_em || 'pendente'}`),
    ];
    const finalPdf = montarPdfSimples('Contrato Matopiba Log assinado', linhasFinal);
    const finalUpload = await uploadPdfImutavel({ supabase, empresaId, contratoId: contrato.id, tipo: 'final', buffer: finalPdf });
    const eventos = [];
    const certificadoPdf = montarCertificado({ contrato, signatarios: atualizados, eventos, finalHash: finalUpload.hash });
    const certUpload = await uploadPdfImutavel({ supabase, empresaId, contratoId: contrato.id, tipo: 'certificado', buffer: certificadoPdf });
    const verificationToken = crypto.randomBytes(24).toString('base64url');
    patchContrato.status = novoStatus;
    patchContrato.signed_storage_path = finalUpload.path;
    patchContrato.signed_file_hash = finalUpload.hash;
    patchContrato.certificate_storage_path = certUpload.path;
    patchContrato.certificate_file_hash = certUpload.hash;
    patchContrato.verification_token_hash = sha256(verificationToken);
    patchContrato.aceito_por = usuario.id;
    patchContrato.aceito_em = agora;
    await supabase.from('propostas_comerciais').update({
      status: STATUS_PROPOSTA.ACEITA,
      aceito_por: usuario.id,
      aceito_em: agora,
      atualizado_em: agora,
    }).eq('id', contrato.proposta_id).eq('empresa_id', empresaId);
    patchContrato.metadata = { ...(contrato.metadata || {}), verification_url_hint: 'public_token_hash_stored' };
    patchContrato._verification_token = verificationToken;
  }
  const token = patchContrato._verification_token;
  delete patchContrato._verification_token;
  await supabase.from('contratos_comerciais').update(patchContrato).eq('id', contrato.id).eq('empresa_id', empresaId);

  if (novoStatus === STATUS_CONTRATO.PLENAMENTE_ASSINADO) {
    await inserirEvento({
      supabase,
      contratoId: contrato.id,
      empresaId,
      tipo: 'contrato_plenamente_assinado',
      detalhe: { metodo: METODO_ASSINATURA },
      criadoPor: usuario.id,
      actorPapel: papel,
    });
  }

  return {
    status: 200,
    body: {
      id: contrato.id,
      status: novoStatus,
      metodo: METODO_ASSINATURA,
      verification_token: token || undefined,
    },
  };
}

async function verificarContratoPublico({ supabase, token }) {
  if (!token || String(token).length < 20) return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  const tokenHash = sha256(String(token));
  const { data, error } = await supabase
    .from('contratos_comerciais')
    .select('id, empresa_id, status, template_version, signed_file_hash, certificate_file_hash, aceito_em, verification_token_hash')
    .eq('verification_token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== STATUS_CONTRATO.PLENAMENTE_ASSINADO) return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  const { data: signatarios, error: signError } = await supabase
    .from('contrato_signatarios')
    .select('papel, status, assinado_em, metodo_assinatura, email_mascarado')
    .eq('contrato_id', data.id)
    .eq('empresa_id', data.empresa_id)
    .order('criado_em', { ascending: true });
  if (signError) throw signError;
  return {
    status: 200,
    body: {
      valido: true,
      contrato_id: data.id,
      status: data.status,
      assinado_em: data.aceito_em,
      template_version: data.template_version,
      signed_file_hash: data.signed_file_hash,
      certificate_file_hash: data.certificate_file_hash,
      signatarios: signatarios || [],
    },
  };
}

module.exports = {
  CONSENT_VERSION,
  HASH_VERSION,
  METODO_ASSINATURA,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  gerarCodigoOtp,
  hmacHex,
  erroConflitoUnico,
  inserirEvento,
  mascararEmail,
  montarCertificado,
  montarEventoHash,
  montarPdfSimples,
  sha256,
  solicitarDesafioAssinatura,
  confirmarAssinatura,
  verificarContratoPublico,
  verificarSenhaAtual,
};
