const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routerPath = require.resolve('../routes/pagamentos');
const servicePath = require.resolve('../services/asaasWebhookService');

function carregarRouterComServico(servico) {
  const originalLoad = Module._load;
  delete require.cache[routerPath];
  delete require.cache[servicePath];
  try {
    Module._load = function (request, parent, isMain) {
      if (request === '../config/supabase') return { from: () => ({ select: () => ({}) }) };
      if (request === 'axios') return {};
      if (request === '../services/asaasWebhookService') return servico;
      return originalLoad.call(this, request, parent, isMain);
    };
    return require(routerPath);
  } finally {
    Module._load = originalLoad;
  }
}

function getHandler(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method.toLowerCase()]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`Handler nao encontrado: ${method} ${path}`);
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function chamarWebhook({ tokenHeader, expectedToken = 'token-correto', body, servicoResultado, servicoErro }) {
  const chamadas = [];
  const antigoToken = process.env.ASAAS_WEBHOOK_TOKEN;
  process.env.ASAAS_WEBHOOK_TOKEN = expectedToken;

  const router = carregarRouterComServico({
    async processarWebhook(args) {
      chamadas.push(args);
      if (servicoErro) throw servicoErro;
      return servicoResultado || { httpStatus: 200, resultado: { received: true } };
    },
  });
  const handler = getHandler(router, 'POST', '/webhook/asaas');
  const res = fakeRes();

  try {
    await handler({
      headers: tokenHeader === undefined ? {} : { 'asaas-access-token': tokenHeader },
      body: body || { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } },
    }, res, () => {});
  } finally {
    if (antigoToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = antigoToken;
  }

  return { res, chamadas };
}

test('POST /pagamentos/webhook/asaas autentica token e delega body valido', async () => {
  const body = { id: 'evt_ok', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_ok' } };
  const { res, chamadas } = await chamarWebhook({ tokenHeader: 'token-correto', body });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0].body, body);
});

test('POST /pagamentos/webhook/asaas rejeita token ausente, vazio, invalido e tamanho diferente sem delegar', async () => {
  for (const tokenHeader of [undefined, '', 'errado', 'token-correto-com-sufixo']) {
    const { res, chamadas } = await chamarWebhook({ tokenHeader });

    assert.equal(res.statusCode, 401, String(tokenHeader));
    assert.equal(res.body.message, 'Unauthorized');
    assert.equal(chamadas.length, 0);
    assert.equal(JSON.stringify(res.body).includes('token-correto'), false);
  }
});

test('POST /pagamentos/webhook/asaas traduz resultados internos para HTTP sem payload bruto', async () => {
  const matriz = [
    ['processed', 200, { received: true, processed: true }],
    ['ignored', 200, { received: true, ignored: true }],
    ['duplicate_processed', 200, { received: true, idempotente: true, code: 'conflict_processed' }],
    ['duplicate_ignored', 200, { received: true, idempotente: true, code: 'conflict_ignored' }],
    ['duplicate_processing', 200, { received: true, idempotente: true, code: 'em_processamento' }],
    ['payment_not_managed', 200, { received: true, ignored: true, razao: 'payment_not_managed' }],
    ['unknown_event', 200, { received: true, ignored: true, razao: 'evento_desconhecido' }],
    ['invalid_body', 400, { message: 'Payload invalido.' }],
    ['missing_event_id', 400, { message: 'Payload invalido.' }],
    ['missing_event_type', 400, { message: 'Payload invalido.' }],
    ['missing_payment_id', 400, { message: 'Payload invalido.' }],
    ['persistence_error', 500, { message: 'Erro interno ao processar evento.' }],
    ['processing_error', 500, { message: 'Erro ao processar evento.' }],
    ['database_error', 500, { message: 'Erro interno ao processar evento.' }],
  ];

  for (const [nome, httpStatus, resultado] of matriz) {
    const { res } = await chamarWebhook({
      tokenHeader: 'token-correto',
      body: {
        id: `evt_${nome}`,
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_123',
          customer: 'cus_nao_deve_voltar',
          externalReference: 'referencia_sensivel',
        },
      },
      servicoResultado: { httpStatus, resultado },
    });

    assert.equal(res.statusCode, httpStatus, nome);
    const serializado = JSON.stringify(res.body);
    assert.equal(serializado.includes('cus_nao_deve_voltar'), false, nome);
    assert.equal(serializado.includes('referencia_sensivel'), false, nome);
    assert.equal(serializado.includes('pay_123'), false, nome);
  }
});

test('POST /pagamentos/webhook/asaas retorna 500 seguro quando servico lanca erro inesperado', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  let resultado;
  try {
    resultado = await chamarWebhook({
      tokenHeader: 'token-correto',
      servicoErro: new Error('erro com pay_123 e usuario@example.com'),
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(resultado.chamadas.length, 1);
  assert.equal(resultado.res.statusCode, 500);
  assert.deepEqual(resultado.res.body, { message: 'Erro ao processar webhook.' });
  const logSerializado = logs.join(' ');
  assert.equal(logSerializado.includes('pay_123'), false);
  assert.equal(logSerializado.includes('usuario@example.com'), false);
});
