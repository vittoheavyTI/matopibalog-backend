const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  HASH_VERSION,
  gerarCodigoOtp,
  hmacHex,
  inserirEvento,
  mascararEmail,
  montarEventoHash,
  montarPdfSimples,
  sha256,
  verificarSenhaAtual,
} = require('../services/assinaturaEletronicaInternaService');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'assinaturaEletronicaInternaService.js'),
  'utf8',
);

test('otp: gera codigo numerico de seis digitos', () => {
  const codigo = gerarCodigoOtp(() => Buffer.from([0, 0, 0, 42]));
  assert.equal(codigo, '000042');
  assert.match(codigo, /^\d{6}$/);
});

test('otp: hmac depende do contrato, signatario e segredo', () => {
  const a = hmacHex('segredo-com-tamanho-suficiente', 'contrato-1:sign-1:123456');
  const b = hmacHex('segredo-com-tamanho-suficiente', 'contrato-1:sign-1:654321');
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test('otp: algoritmo gravado e validado e hmac-sha256-v1', () => {
  assert.equal(HASH_VERSION, 'hmac-sha256-v1');
  assert.match(serviceSource, /codigo_alg: HASH_VERSION/);
  assert.match(serviceSource, /desafio\.codigo_alg !== HASH_VERSION/);
});

test('reauth: senha atual invalida e erro de formulario, nao de sessao', async () => {
  const authClient = {
    auth: {
      signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } }),
    },
  };

  const r = await verificarSenhaAtual({
    email: 'admin@example.com',
    senha: 'senha-invalida',
    authClient,
  });

  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.message, 'Senha atual invalida.');
});

test('email: falha de envio cancela desafio e nao deixa codigo ativo', () => {
  assert.match(serviceSource, /update\(\{ status: 'cancelado', invalidated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(serviceSource, /eq\('id', desafio\.id\)/);
  assert.match(serviceSource, /Nao foi possivel enviar o codigo por e-mail agora/);
});

test('email mascarado nao expoe endereco completo', () => {
  assert.equal(mascararEmail('ana.silva@example.com'), 'a*******a@example.com');
  assert.equal(mascararEmail('a@example.com'), 'a@example.com');
});

test('evento hash encadeia evento anterior e payload', () => {
  const criadoEm = '2026-08-02T00:00:00.000Z';
  const primeiro = montarEventoHash({ tipo: 'a', detalhe: { x: 1 }, criadoPor: 'u1', criadoEm });
  const segundo = montarEventoHash({ prevHash: primeiro, tipo: 'b', detalhe: { x: 1 }, criadoPor: 'u1', criadoEm });
  assert.equal(primeiro.length, 64);
  assert.equal(segundo.length, 64);
  assert.notEqual(primeiro, segundo);
});

test('pdf simples produz arquivo PDF e hash verificavel', () => {
  const pdf = montarPdfSimples('Contrato', ['linha 1', 'linha 2']);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(sha256(pdf.toString('binary')).length, 64);
});

test('evento append-only: conflito de cadeia relê ultimo hash e tenta novamente', async () => {
  const hashAnterior = 'a'.repeat(64);
  const inserts = [];
  let leitura = 0;
  const supabase = {
    from(tabela) {
      assert.equal(tabela, 'contrato_eventos');
      const api = {
        select() { return api; },
        eq() { return api; },
        not() { return api; },
        order() { return api; },
        limit: async () => {
          leitura += 1;
          return { data: leitura === 1 ? [] : [{ event_hash: hashAnterior, criado_em: '2026-08-02T00:00:00.000Z' }], error: null };
        },
        insert(payload) {
          inserts.push(payload);
          if (inserts.length === 1) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          return { error: null };
        },
      };
      return api;
    },
  };

  const evento = await inserirEvento({
    supabase,
    contratoId: 'contrato-1',
    empresaId: 'empresa-1',
    tipo: 'assinatura_interna_confirmada',
    detalhe: { papel: 'cliente' },
    criadoPor: 'usuario-1',
  });

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].prev_hash, null);
  assert.equal(inserts[1].prev_hash, hashAnterior);
  assert.equal(evento.prev_hash, hashAnterior);
  assert.match(evento.event_hash, /^[0-9a-f]{64}$/);
});

test('evento append-only: conflito persistente vira erro controlado', async () => {
  const supabase = {
    from(tabela) {
      assert.equal(tabela, 'contrato_eventos');
      const api = {
        select() { return api; },
        eq() { return api; },
        not() { return api; },
        order() { return api; },
        limit: async () => ({ data: [], error: null }),
        insert() { return { error: { code: '23505', message: 'duplicate key' } }; },
      };
      return api;
    },
  };

  await assert.rejects(
    inserirEvento({
      supabase,
      contratoId: 'contrato-1',
      empresaId: 'empresa-1',
      tipo: 'codigo_assinatura_enviado',
      maxTentativas: 2,
    }),
    /Nao foi possivel registrar evento/,
  );
});
