const test = require('node:test');
const assert = require('node:assert/strict');

const { enviarEmail, habilitado } = require('../services/emailService');

// http spy que registra chamadas — os testes NUNCA tocam a rede real.
function spyHttp(resposta = { data: { id: 'email-123' } }) {
  const chamadas = [];
  return {
    chamadas,
    post: async (url, body, opts) => { chamadas.push({ url, body, opts }); return resposta; },
  };
}

const MSG = { para: 'admin@empresa.com', assunto: 'Fatura vencida', texto: 'Regularize.' };

test('DESLIGADO por padrão (sem env) → não envia, não toca a rede', async () => {
  const http = spyHttp();
  const r = await enviarEmail(MSG, { http, env: {} });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'desabilitado');
  assert.equal(http.chamadas.length, 0);
});

test('opt-in sem RESEND_API_KEY → sem_api_key, não toca a rede', async () => {
  const http = spyHttp();
  const r = await enviarEmail(MSG, { http, env: { EMAIL_ENVIO_HABILITADO: 'true' } });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'sem_api_key');
  assert.equal(http.chamadas.length, 0);
});

test('payload inválido → payload_invalido', async () => {
  const http = spyHttp();
  const r = await enviarEmail({ para: '', assunto: '', texto: '' }, { http, env: { EMAIL_ENVIO_HABILITADO: 'true', RESEND_API_KEY: 'k' } });
  assert.equal(r.motivo, 'payload_invalido');
  assert.equal(http.chamadas.length, 0);
});

test('opt-in + api key mas sem remetente → sem_remetente', async () => {
  const http = spyHttp();
  const r = await enviarEmail(MSG, { http, env: { EMAIL_ENVIO_HABILITADO: 'true', RESEND_API_KEY: 'k' } });
  assert.equal(r.motivo, 'sem_remetente');
  assert.equal(http.chamadas.length, 0);
});

test('habilitado + credencial + remetente → envia via http mock com Bearer', async () => {
  const http = spyHttp();
  const env = { EMAIL_ENVIO_HABILITADO: 'true', RESEND_API_KEY: 'k-secreta', EMAIL_REMETENTE: 'no-reply@matopibalog.com.br' };
  const r = await enviarEmail(MSG, { http, env });
  assert.equal(r.enviado, true);
  assert.equal(r.id, 'email-123');
  assert.equal(http.chamadas.length, 1);
  const c = http.chamadas[0];
  assert.equal(c.url, 'https://api.resend.com/emails');
  assert.equal(c.body.from, 'no-reply@matopibalog.com.br');
  assert.equal(c.body.to, 'admin@empresa.com');
  assert.equal(c.opts.headers.Authorization, 'Bearer k-secreta');
});

test('erro de rede → best-effort, não lança', async () => {
  const http = { post: async () => { throw new Error('timeout'); } };
  const env = { EMAIL_ENVIO_HABILITADO: 'true', RESEND_API_KEY: 'k', EMAIL_REMETENTE: 'x@y.com' };
  const r = await enviarEmail(MSG, { http, env });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'erro_envio');
});

test('habilitado(): exige opt-in E api key', () => {
  assert.equal(habilitado({}), false);
  assert.equal(habilitado({ EMAIL_ENVIO_HABILITADO: 'true' }), false);
  assert.equal(habilitado({ RESEND_API_KEY: 'k' }), false);
  assert.equal(habilitado({ EMAIL_ENVIO_HABILITADO: 'true', RESEND_API_KEY: 'k' }), true);
});
