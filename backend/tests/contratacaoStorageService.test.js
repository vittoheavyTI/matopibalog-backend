const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUCKET_CONTRATOS,
  SIGNED_URL_TTL_SECONDS,
  caminhoContratoAssinado,
  criarUrlAssinadaContrato,
  criarUrlAssinadaCertificado,
  validarPdfAssinado,
  validarStoragePathContrato,
} = require('../services/contratacaoStorageService');

const pdf = Buffer.from('%PDF-1.7\nconteudo');
const HASH = 'a'.repeat(64); // sha256 hex válido para teste
const FINAL_PATH = `emp-1/contratos/contrato-1/final-${HASH}.pdf`;
const CERT_PATH = `emp-1/contratos/contrato-1/certificado-${HASH}.pdf`;

function supabaseSpy(chamadas) {
  return {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            chamadas.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://signed.example/${path}?token=OPACO` }, error: null };
          },
        };
      },
    },
  };
}

test('validarPdfAssinado aceita somente PDF real ate 10 MB', () => {
  assert.deepEqual(validarPdfAssinado({ mimetype: 'application/pdf', buffer: pdf, size: pdf.length }), { ok: true });
  assert.equal(validarPdfAssinado({ mimetype: 'application/pdf', buffer: Buffer.from('texto'), size: 5 }).status, 415);
  assert.equal(validarPdfAssinado({ mimetype: 'text/plain', buffer: pdf, size: pdf.length }).status, 415);
  assert.equal(validarPdfAssinado({ mimetype: 'application/pdf', buffer: pdf, size: 10 * 1024 * 1024 + 1 }).status, 413);
});

test('path de contrato assinado e fixo por tenant e contrato', () => {
  const path = caminhoContratoAssinado({ empresaId: 'emp-1', contratoId: 'contrato-1' });
  assert.equal(path, 'emp-1/contratos/contrato-1/assinado.pdf');
  assert.equal(validarStoragePathContrato({ storagePath: path, empresaId: 'emp-1', contratoId: 'contrato-1' }), true);
  assert.equal(validarStoragePathContrato({ storagePath: 'emp-2/contratos/contrato-1/assinado.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: 'emp-1/contratos/contrato-1/../../x.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: '/emp-1/contratos/contrato-1/assinado.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
});

test('criarUrlAssinadaContrato usa path salvo, tenant validado e TTL curto', async () => {
  const chamadas = [];
  const supabase = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            chamadas.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
          },
        };
      },
    },
  };
  const contrato = {
    id: 'contrato-1',
    empresa_id: 'emp-1',
    signed_storage_path: 'emp-1/contratos/contrato-1/assinado.pdf',
  };

  const r = await criarUrlAssinadaContrato({ supabase, contrato, empresaId: 'emp-1' });

  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, SIGNED_URL_TTL_SECONDS);
  assert.equal(chamadas[0].bucket, BUCKET_CONTRATOS);
  assert.equal(chamadas[0].ttl, 300);
  assert.equal(chamadas[0].path, contrato.signed_storage_path);
});

test('criarUrlAssinadaContrato bloqueia cross-tenant, ausente e path adulterado', async () => {
  const supabase = { storage: { from() { throw new Error('nao deveria assinar'); } } };
  const contrato = {
    id: 'contrato-1',
    empresa_id: 'emp-1',
    signed_storage_path: 'emp-1/contratos/contrato-1/assinado.pdf',
  };

  assert.equal((await criarUrlAssinadaContrato({ supabase, contrato, empresaId: 'emp-2' })).status, 404);
  assert.equal((await criarUrlAssinadaContrato({ supabase, contrato: { ...contrato, signed_storage_path: null }, empresaId: 'emp-1' })).status, 404);
  assert.equal((await criarUrlAssinadaContrato({ supabase, contrato: { ...contrato, signed_storage_path: 'emp-1/contratos/outro/assinado.pdf' }, empresaId: 'emp-1' })).status, 409);
});

test('validarStoragePathContrato aceita fluxo interno final-<sha256>.pdf e rejeita hash inválido', () => {
  // legado continua aceito
  assert.equal(validarStoragePathContrato({ storagePath: 'emp-1/contratos/contrato-1/assinado.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), true);
  // fluxo interno novo
  assert.equal(validarStoragePathContrato({ storagePath: FINAL_PATH, empresaId: 'emp-1', contratoId: 'contrato-1' }), true);
  // hash curto / inválido / sem hash
  assert.equal(validarStoragePathContrato({ storagePath: `emp-1/contratos/contrato-1/final-${'a'.repeat(63)}.pdf`, empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: `emp-1/contratos/contrato-1/final-${'g'.repeat(64)}.pdf`, empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: 'emp-1/contratos/contrato-1/final-.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: 'emp-1/contratos/contrato-1/final.pdf', empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  // tenant/contrato divergentes negados
  assert.equal(validarStoragePathContrato({ storagePath: FINAL_PATH, empresaId: 'emp-2', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: FINAL_PATH, empresaId: 'emp-1', contratoId: 'contrato-9' }), false);
  // extensão errada e subpasta extra negadas
  assert.equal(validarStoragePathContrato({ storagePath: `emp-1/contratos/contrato-1/final-${HASH}.txt`, empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: `emp-1/contratos/contrato-1/sub/final-${HASH}.pdf`, empresaId: 'emp-1', contratoId: 'contrato-1' }), false);
});

test('validarStoragePathContrato categoria certificado exige certificado-<sha256>.pdf', () => {
  assert.equal(validarStoragePathContrato({ storagePath: CERT_PATH, empresaId: 'emp-1', contratoId: 'contrato-1', categoria: 'certificado' }), true);
  // um path de assinado NÃO é aceito como certificado e vice-versa
  assert.equal(validarStoragePathContrato({ storagePath: FINAL_PATH, empresaId: 'emp-1', contratoId: 'contrato-1', categoria: 'certificado' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: CERT_PATH, empresaId: 'emp-1', contratoId: 'contrato-1', categoria: 'assinado' }), false);
  assert.equal(validarStoragePathContrato({ storagePath: `emp-1/contratos/contrato-1/certificado-${'a'.repeat(63)}.pdf`, empresaId: 'emp-1', contratoId: 'contrato-1', categoria: 'certificado' }), false);
});

test('criarUrlAssinadaContrato funciona com final-<hash>.pdf do fluxo interno', async () => {
  const chamadas = [];
  const contrato = { id: 'contrato-1', empresa_id: 'emp-1', signed_storage_path: FINAL_PATH };
  const r = await criarUrlAssinadaContrato({ supabase: supabaseSpy(chamadas), contrato, empresaId: 'emp-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, 300);
  assert.match(r.body.url, /token=OPACO/);
  assert.equal(chamadas[0].bucket, BUCKET_CONTRATOS);
  assert.equal(chamadas[0].ttl, 300);
  assert.equal(chamadas[0].path, FINAL_PATH);
  // não expõe o storage path na resposta
  assert.equal(r.body.storage_path, undefined);
});

test('criarUrlAssinadaCertificado gera signed URL privada com TTL 300 e valida tenant/path', async () => {
  const chamadas = [];
  const contrato = { id: 'contrato-1', empresa_id: 'emp-1', certificate_storage_path: CERT_PATH };
  const r = await criarUrlAssinadaCertificado({ supabase: supabaseSpy(chamadas), contrato, empresaId: 'emp-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, SIGNED_URL_TTL_SECONDS);
  assert.equal(chamadas[0].bucket, BUCKET_CONTRATOS);
  assert.equal(chamadas[0].ttl, 300);
  assert.equal(chamadas[0].path, CERT_PATH);

  // bloqueios: cross-tenant, ausente, adulterado (contrato diferente)
  const semStorage = { storage: { from() { throw new Error('nao deveria assinar'); } } };
  assert.equal((await criarUrlAssinadaCertificado({ supabase: semStorage, contrato, empresaId: 'emp-2' })).status, 404);
  assert.equal((await criarUrlAssinadaCertificado({ supabase: semStorage, contrato: { ...contrato, certificate_storage_path: null }, empresaId: 'emp-1' })).status, 404);
  assert.equal((await criarUrlAssinadaCertificado({ supabase: semStorage, contrato: { ...contrato, certificate_storage_path: `emp-1/contratos/outro/certificado-${HASH}.pdf` }, empresaId: 'emp-1' })).status, 409);
});
