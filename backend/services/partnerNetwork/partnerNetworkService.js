'use strict';

// partnerNetworkService — a rede privada de parceiros (E3.6A).
//
// Três responsabilidades, e nenhuma delas é comercial:
//   1. relacionamentos privados (convite, ativação, suspensão, revogação);
//   2. compartilhar uma lacuna de capacidade REAL de campanha;
//   3. registrar a resposta operacional do parceiro.
//
// O que este serviço deliberadamente NÃO faz: preço, adjudicação, vencedor,
// alocação de viagem, comissão. Não há autoridade canônica de preço entre
// solicitante e parceiro — a mesma razão que mantém `PORTAL_QUOTE_PROPOSAL_V1B`
// deferida. Inventar um número aqui seria criar um valor sem dono.

const crypto = require('node:crypto');

const TOKEN_BYTES = 32;
const CONVITE_TTL_DIAS = 7;

class PartnerNetworkError extends Error {
  constructor(message, { status = 400, code = 'partner_network_error', details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function erroDeBanco(error) {
  if (!error) return;
  if (error.code === '42P01') {
    throw new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
      status: 503, code: 'partner_network_schema_missing',
    });
  }
  throw new PartnerNetworkError('Erro de banco na rede de parceiros.', {
    status: 500, code: 'partner_network_database_error', details: { db_code: error.code },
  });
}

// Token de convite: alta entropia, guardado só como hash. O valor puro existe
// uma única vez, na resposta da criação — nunca é persistido, logado nem
// colocado em metadata de evento.
function gerarTokenConvite() {
  const valor = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { valor, hash: hashDoToken(valor) };
}

function hashDoToken(valor) {
  return crypto.createHash('sha256').update(String(valor)).digest('hex');
}

// ── Eventos ────────────────────────────────────────────────────────────────────
//
// NÃO EXISTE MAIS UM `registrarEvento()` NESTE MÓDULO, e a ausência é a decisão.
//
// HIGH-11: toda mutação de autoridade da rede — convidar, ativar, mudar situação,
// compartilhar, responder, retirar, marcar obsoleto — grava o evento DENTRO da
// mesma transação que muda o estado, nas RPCs da migration 082. Não sobrou
// nenhuma mutação "periférica" para justificar um gravador avulso.
//
// Manter a função exportada seria manter a armadilha: ela commita separado do
// estado, então o próximo uso reintroduziria exatamente o defeito que acabou de
// ser corrigido — mudança de estado que persiste sem o registro dela. Uma escrita
// de auditoria fora de transação é mais perigosa que nenhuma, porque parece
// suficiente.
//
// `PARTNER_NETWORK_AUDIT_IS_TRANSACTIONAL_ONLY=true`

// ── Relacionamentos ────────────────────────────────────────────────────────────

async function listarParceiros(supabase, { empresaId }) {
  const { data, error } = await supabase
    .from('partner_relationships')
    .select('id, status, apelido, criado_em, ativado_em, revogado_em, partner_organization_id, '
      + 'partner_organizations!inner(id, nome, documento, linked_empresa_id)')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false });
  erroDeBanco(error);

  const relacionamentos = data || [];
  const ids = relacionamentos.map((r) => r.id);

  // Última atividade relevante por relacionamento, numa consulta agregada — não
  // uma por linha (§71: nada de N+1 na lista da rede).
  const atividadePorRelacionamento = new Map();
  if (ids.length) {
    const { data: recs } = await supabase
      .from('partner_opportunity_recipients')
      .select('relationship_id, criado_em')
      .in('relationship_id', ids)
      .order('criado_em', { ascending: false });
    for (const r of recs || []) {
      if (!atividadePorRelacionamento.has(r.relationship_id)) {
        atividadePorRelacionamento.set(r.relationship_id, r.criado_em);
      }
    }
  }

  return {
    itens: relacionamentos.map((r) => {
      const org = Array.isArray(r.partner_organizations) ? r.partner_organizations[0] : r.partner_organizations;
      return {
        id: r.id,
        nome: r.apelido || org?.nome || 'Parceiro',
        documento: org?.documento || null,
        // Lite vs Cliente é DERIVADO do vínculo — sem coluna paralela que possa
        // divergir do fato.
        tipo: org?.linked_empresa_id ? 'CLIENTE' : 'LITE',
        status: r.status,
        criado_em: r.criado_em,
        ativado_em: r.ativado_em,
        revogado_em: r.revogado_em,
        ultima_atividade_em: atividadePorRelacionamento.get(r.id) || null,
      };
    }),
  };
}

async function convidarParceiro(supabase, { empresaId, actorUserId, nome, email, documento = null, apelido = null }) {
  const nomeLimpo = String(nome || '').trim();
  const emailLimpo = String(email || '').trim().toLowerCase();
  if (!nomeLimpo) throw new PartnerNetworkError('Informe o nome do parceiro.', { code: 'partner_nome_obrigatorio' });
  if (!emailLimpo || !emailLimpo.includes('@')) {
    throw new PartnerNetworkError('Informe um e-mail válido para o convite.', { code: 'partner_email_invalido' });
  }

  const token = gerarTokenConvite();
  const expiraEm = new Date(Date.now() + CONVITE_TTL_DIAS * 24 * 60 * 60 * 1000).toISOString();

  // HIGH-06: organização + relacionamento + convite + evento numa transação só.
  // Antes eram quatro inserts soltos: uma falha no terceiro deixava organização e
  // relacionamento órfãos, e o parceiro aparecia na lista sem nunca ter sido
  // convidado de fato.
  const { data, error } = await supabase.rpc('partner_network_create_invitation', {
    p_empresa_id: empresaId,
    p_actor_user_id: actorUserId || null,
    p_nome: nomeLimpo,
    p_email: emailLimpo,
    p_token_hash: token.hash,
    p_expires_at: expiraEm,
    p_documento: documento ? String(documento).trim() : null,
    p_apelido: apelido ? String(apelido).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  return {
    relationship_id: linha.out_relationship_id,
    partner_organization_id: linha.out_partner_organization_id,
    nome: nomeLimpo,
    convite: {
      id: linha.out_invitation_id,
      expires_at: expiraEm,
      // Entrega V1 = MANUAL_LINK (§19). O valor puro do token existe aqui, uma
      // vez — no banco só há o hash.
      token: token.valor,
      entrega: 'MANUAL_LINK',
    },
  };
}
// Máquina de estados do relacionamento (§8), explícita para não haver transição
// contraditória por PATCH.
//
//   INVITED   → ACTIVE     (somente por ativação válida do convite)
//   ACTIVE    → SUSPENDED | REVOKED
//   SUSPENDED → ACTIVE     (ação interna deliberada) | REVOKED
//   REVOKED   → terminal nesta fatia
//
// REVOKED ser terminal é decisão de segurança, não limitação: reativar por PATCH
// significaria que revogar o acesso pode ser desfeito sem passar por convite e
// sem prova de que o outro lado ainda controla a conta. Reconvite pós-revogação
// fica registrado como possibilidade futura — com fluxo próprio, não com um
// UPDATE de status.
const TRANSICOES_PERMITIDAS = Object.freeze({
  INVITED: ['REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
});

const ACAO_POR_STATUS = Object.freeze({
  ACTIVE: 'relationship_activated',
  SUSPENDED: 'relationship_suspended',
  REVOKED: 'relationship_revoked',
});

/**
 * Muda a situação do parceiro — mudança de estado e evento na MESMA transação.
 *
 * HIGH-11. A versão anterior fazia `UPDATE` condicional e, depois, uma segunda
 * chamada para registrar o evento. O UPDATE commitava sozinho: se o evento
 * falhasse, o acesso do parceiro já estava cortado e não havia registro de
 * quando nem por quem. Uma revogação que a empresa não consegue provar depois
 * derruba a única finalidade de ter auditoria.
 *
 * A máquina de estados (`TRANSICOES_PERMITIDAS`) continua declarada aqui porque
 * a UI a lê — mas a AUTORIDADE passou a ser a RPC, que decide com a linha
 * travada. Duas mudanças simultâneas serializam no lock, não numa releitura.
 */
async function alterarStatusDoParceiro(supabase, { empresaId, actorUserId, relationshipId, novoStatus, motivo = null }) {
  if (!ACAO_POR_STATUS[novoStatus]) {
    throw new PartnerNetworkError('Situação de parceiro inválida.', { code: 'partner_status_invalido' });
  }

  const { data, error } = await supabase.rpc('partner_network_set_relationship_status', {
    p_empresa_id: empresaId,
    p_actor_user_id: actorUserId || null,
    p_relationship_id: relationshipId,
    p_novo_status: novoStatus,
    p_motivo: motivo ? String(motivo).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Parceiro não encontrado.', { status: 404, code: 'partner_nao_encontrado' });
  }
  const saida = { id: linha.out_relationship_id, status: linha.out_status };
  if (linha.out_inalterado === true) saida.inalterado = true;
  return saida;
}
// Tradução dos erros das RPCs para mensagens de produto. Cada `RAISE EXCEPTION`
// da migration tem um nome estável; sem este mapa a pessoa veria o texto cru do
// Postgres.
const MENSAGEM_DE_RPC = {
  partner_invite_indisponivel: ['Este convite não é mais válido. Peça um novo à transportadora.', 410],
  partner_invite_inconsistente: ['Convite inconsistente. Peça um novo à transportadora.', 409],
  partner_relationship_revogado: ['Seu acesso foi encerrado pela transportadora.', 403],
  partner_relationship_suspenso: ['Seu acesso está suspenso. Fale com a transportadora.', 403],
  partner_invite_dados_invalidos: ['Dados do convite inválidos.', 400],
  partner_invite_token_invalido: ['Convite inválido.', 400],
  partner_activate_dados_invalidos: ['Convite inválido.', 400],
  partner_response_destinatario_invalido: ['Oportunidade não encontrada.', 404],
  partner_response_relacionamento_inativo: ['Seu acesso a esta oportunidade foi encerrado.', 403],
  partner_response_oportunidade_nao_current: ['Esta oportunidade mudou e não aceita mais respostas.', 409],
  partner_response_fonte_obsoleta: ['A campanha foi replanejada. Aguarde um novo pedido da transportadora.', 409],
  partner_response_prazo_encerrado: ['O prazo de resposta desta oportunidade encerrou.', 409],
  partner_response_situacao_invalida: ['Resposta inválida.', 400],
  partner_response_capacidade_invalida: ['Informe a capacidade que você consegue atender.', 400],
  partner_response_capacidade_acima_da_lacuna: ['A capacidade informada é maior que a necessidade compartilhada.', 400],
  partner_response_unidade_divergente: ['Responda na mesma unidade do pedido.', 400],
  partner_response_ator_invalido: ['Não foi possível confirmar quem está respondendo. Entre novamente.', 401],
  partner_response_origem_nao_suportada: ['Esta origem de resposta ainda não está disponível.', 400],
  partner_share_plano_nao_aprovado: ['O plano desta campanha não está mais aprovado. Replaneje antes de pedir capacidade.', 409],
  // ALL_REQUESTED_OR_FAIL: mensagem única para "não existe", "é de outra
  // empresa" e "não está ativo" — distinguir os três confirmaria a existência de
  // relacionamento alheio.
  partner_share_destinatario_indisponivel: [
    'Algum dos parceiros escolhidos não está mais ativo na sua rede. Atualize a lista e compartilhe de novo.', 409],
  partner_share_idempotency_conflict: [
    'Este pedido já foi usado para compartilhar outra campanha ou outro plano. Gere um novo compartilhamento.', 409],
  partner_share_campanha_invalida: ['Campanha não encontrada.', 404],
  partner_stale_campanha_invalida: ['Campanha não encontrada.', 404],
  partner_stale_dados_invalidos: ['Dados inválidos para marcar a fonte como obsoleta.', 400],
  partner_share_sem_destinatarios: ['Escolha pelo menos um parceiro.', 400],
  partner_share_quantidade_invalida: ['Quantidade inválida para compartilhar.', 400],
  partner_share_dados_invalidos: ['Dados insuficientes para compartilhar.', 400],
  partner_nao_encontrado: ['Parceiro não encontrado.', 404],
  partner_relacionamento_revogado_terminal: [
    'Este parceiro foi revogado. Convide-o novamente para restabelecer o acesso.', 409],
  partner_transicao_invalida: ['Esta mudança de situação não é permitida.', 409],
  partner_status_invalido: ['Situação de parceiro inválida.', 400],
  partner_status_dados_invalidos: ['Dados inválidos para mudar a situação do parceiro.', 400],
  partner_oportunidade_indisponivel: ['Oportunidade não encontrada ou já encerrada.', 404],
  partner_withdraw_dados_invalidos: ['Dados inválidos para retirar a oportunidade.', 400],
};

function traduzirErroDeRpc(error) {
  const bruto = String(error?.message || '');
  for (const [codigo, [mensagem, status]] of Object.entries(MENSAGEM_DE_RPC)) {
    if (bruto.includes(codigo)) return new PartnerNetworkError(mensagem, { status, code: codigo });
  }
  if (error?.code === '42883' || error?.code === '42P01') {
    return new PartnerNetworkError('Rede de parceiros ainda não está disponível.', {
      status: 503, code: 'partner_network_schema_missing',
    });
  }
  return new PartnerNetworkError('Não foi possível concluir a operação.', {
    status: 500, code: 'partner_network_rpc_error',
  });
}

/**
 * PREFLIGHT do convite (HIGH-09) — resolve sem consumir.
 *
 * Devolve o e-mail para o qual o convite foi emitido, que é a AUTORIDADE de
 * identidade: quem ativa é quem foi convidado, não quem digita um e-mail na
 * hora.
 *
 * A versão anterior era um `select('email')` cru, e isso tinha duas
 * consequências ruins ao mesmo tempo:
 *
 *   1. Ela achava o e-mail de QUALQUER convite — expirado, já aceito, revogado,
 *      de um relacionamento cortado. A ativação então seguia para o Supabase Auth
 *      e chegava a CRIAR uma conta antes de a RPC recusar o convite. Um token
 *      morto produzindo identidade nova em produção é efeito colateral externo
 *      disparado por credencial inválida.
 *   2. A validação de estado vivia num lugar só — dentro da RPC de consumo —,
 *      então não havia como recusar cedo sem duplicar a matriz.
 *
 * Agora a mesma matriz da RPC de ativação decide aqui também, e o convite
 * continua intacto: nenhum `UPDATE`, nenhum `FOR UPDATE`. Isto ACELERA a recusa;
 * quem decide de verdade continua sendo a transação da ativação.
 */
async function preflightDoConvite(supabase, { token }) {
  if (!token) throw new PartnerNetworkError('Convite inválido.', { status: 400, code: 'convite_invalido' });

  const { data, error } = await supabase.rpc('partner_network_preflight_invitation', {
    p_token_hash: hashDoToken(token),
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Este convite não é mais válido. Peça um novo à transportadora.', {
      status: 410, code: 'convite_indisponivel',
    });
  }
  return {
    email: normalizarEmailDoConvite(linha.out_email),
    relationship_id: linha.out_relationship_id,
    partner_organization_id: linha.out_partner_organization_id,
    relationship_status: linha.out_relationship_status,
  };
}

// O convite grava o e-mail já normalizado; normalizar de novo na leitura é o que
// impede que uma diferença de caixa vire uma comparação falsa lá na frente.
function normalizarEmailDoConvite(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Ativa o convite DEPOIS de a identidade Auth ter sido provada.
 *
 * A ordem importa e é o coração do HIGH-01/HIGH-06: quem prova a posse da conta
 * é o chamador, ANTES de chegar aqui. Se a senha estiver errada, esta função nem
 * é invocada — e o convite continua pendente, disponível para a tentativa certa.
 * Queimar o convite numa senha errada seria transformar erro de digitação em
 * perda de acesso.
 */
async function ativarConvite(supabase, { token, authUserId, nome = null }) {
  if (!token) throw new PartnerNetworkError('Convite inválido.', { status: 400, code: 'convite_invalido' });
  if (!authUserId) {
    throw new PartnerNetworkError('Não foi possível confirmar sua identidade.', { status: 401, code: 'identidade_ausente' });
  }

  const { data, error } = await supabase.rpc('partner_network_activate_invitation', {
    p_token_hash: hashDoToken(token),
    p_auth_user_id: authUserId,
    p_nome: nome ? String(nome).trim() : null,
  });
  if (error) throw traduzirErroDeRpc(error);

  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha) {
    throw new PartnerNetworkError('Este convite não é mais válido. Peça um novo à transportadora.', {
      status: 410, code: 'convite_indisponivel',
    });
  }

  // HIGH-10 — OS NOMES SÃO OS DA RPC, e a leitura é ESTRITA.
  //
  // A RPC devolve `out_partner_user_id`, `out_partner_organization_id`,
  // `out_email` e `out_relationship_id`. Este código lia dois deles sem o
  // prefixo (`linha.partner_organization_id`, `linha.relationship_id`), então os
  // dois chegavam `undefined` — e `undefined` não explode: ele vira uma claim
  // ausente no JWT emitido logo a seguir. O parceiro terminava a ativação com
  // uma sessão sem organização, que o próprio `verifyPartnerToken` rejeita. O
  // fluxo inteiro de entrada estava quebrado e nenhum teste via, porque nenhum
  // teste ia da RPC até o token.
  //
  // Nada de `??` nem de fallback aqui: um campo que não veio é contrato
  // quebrado, e adivinhar o valor esconderia a próxima vez que isso acontecer.
  for (const campo of ['out_partner_user_id', 'out_partner_organization_id', 'out_email', 'out_relationship_id']) {
    if (linha[campo] === undefined || linha[campo] === null) {
      throw new PartnerNetworkError('Não foi possível concluir a ativação. Tente novamente.', {
        status: 500, code: 'partner_activation_contract_broken', details: { campo },
      });
    }
  }

  return {
    partner_user_id: linha.out_partner_user_id,
    partner_organization_id: linha.out_partner_organization_id,
    email: linha.out_email,
    relationship_id: linha.out_relationship_id,
  };
}
module.exports = {
  PartnerNetworkError,
  preflightDoConvite,
  TRANSICOES_PERMITIDAS,
  traduzirErroDeRpc,
  gerarTokenConvite,
  hashDoToken,

  listarParceiros,
  convidarParceiro,
  alterarStatusDoParceiro,
  ativarConvite,
  CONVITE_TTL_DIAS,
};
