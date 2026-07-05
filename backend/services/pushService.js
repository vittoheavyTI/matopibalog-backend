const supabase = require('../config/supabase');

// Envio de push (FCM) para os aparelhos de um usuario. Regras de produto:
//   * a notificacao interna (tabela notificacoes) e a fonte da verdade; o push
//     e apenas um "aviso" best-effort disparado a partir dela;
//   * FALHA NO PUSH NUNCA quebra a operacao principal (tudo envolto em try/catch,
//     todos os call sites sao fire-and-forget);
//   * se o Firebase nao estiver configurado (env ausente) ou firebase-admin nao
//     estiver instalado, o servico apenas registra "push desabilitado" e segue —
//     o app continua funcionando so com as notificacoes internas;
//   * token invalido/expirado e desativado (ativo=false), nunca vaza no log.

let inicializado = false;
let habilitado = false;
let messaging = null;

// Inicializacao preguicosa: so acontece no primeiro envio. Assim o require deste
// modulo (feito no boot pelo notificacaoService) nunca derruba o servidor, mesmo
// sem firebase-admin instalado ou sem credencial configurada.
function inicializar() {
  if (inicializado) return habilitado;
  inicializado = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    console.log('[pushService] Push desabilitado: FIREBASE_SERVICE_ACCOUNT_JSON ausente.');
    return false;
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch (_) {
    console.log('[pushService] Push desabilitado: firebase-admin nao instalado.');
    return false;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    // No Railway a private_key costuma vir com \n literais (escapados). O SDK
    // precisa das quebras de linha reais para montar a chave PEM.
    if (typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = admin.messaging(app);
    habilitado = true;
    console.log('[pushService] Firebase Admin inicializado. Push habilitado.');
  } catch (error) {
    // Nao logar o conteudo da credencial — apenas a mensagem do erro.
    console.error('[pushService] Falha ao inicializar Firebase Admin:', error?.message || String(error));
    habilitado = false;
  }
  return habilitado;
}

async function tokensAtivos(usuario_id) {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('usuario_id', usuario_id)
    .eq('ativo', true);
  if (error) throw error;
  return (data || []).map((linha) => linha.token).filter(Boolean);
}

async function desativarTokens(tokens) {
  if (!tokens.length) return;
  try {
    await supabase
      .from('push_tokens')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .in('token', tokens);
  } catch (error) {
    console.error('[pushService] Falha ao desativar tokens invalidos:', error?.message || String(error));
  }
}

// Converte o payload `data` para string->string (exigencia do FCM). Valores
// nulos/indefinidos viram string vazia.
function normalizarData(data) {
  const saida = {};
  Object.entries(data || {}).forEach(([chave, valor]) => {
    saida[chave] = valor === null || valor === undefined ? '' : String(valor);
  });
  return saida;
}

// Codigos de erro do FCM que indicam token permanentemente invalido.
const CODIGOS_TOKEN_INVALIDO = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Envia um push best-effort para todos os aparelhos ativos de um usuario.
 * Nunca lanca: qualquer erro e apenas registrado. Retorna um resumo simples.
 */
async function enviarParaUsuario(usuario_id, { titulo, mensagem, data = {} } = {}) {
  try {
    if (!usuario_id || !titulo || !mensagem) return { enviados: 0, motivo: 'payload_invalido' };
    if (!inicializar()) return { enviados: 0, motivo: 'push_desabilitado' };

    const tokens = await tokensAtivos(usuario_id);
    if (!tokens.length) return { enviados: 0, motivo: 'sem_tokens' };

    const resposta = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: titulo, body: mensagem },
      data: normalizarData(data),
      android: {
        priority: 'high',
        notification: { channelId: 'matopibalog_notificacoes', sound: 'default' },
      },
    });

    // Coleta tokens que o FCM reportou como invalidos para desativa-los.
    const invalidos = [];
    resposta.responses.forEach((r, i) => {
      if (!r.success && r.error && CODIGOS_TOKEN_INVALIDO.has(r.error.code)) {
        invalidos.push(tokens[i]);
      }
    });
    if (invalidos.length) await desativarTokens(invalidos);

    return { enviados: resposta.successCount, invalidos: invalidos.length };
  } catch (error) {
    console.error('[pushService] Falha ao enviar push:', error?.message || String(error));
    return { enviados: 0, motivo: 'erro' };
  }
}

module.exports = {
  enviarParaUsuario,
  // Exposto para diagnostico/tests (ex.: confirmar se o Firebase esta configurado).
  _inicializar: inicializar,
};
