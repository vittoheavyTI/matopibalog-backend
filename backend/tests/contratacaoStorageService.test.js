const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUCKET_CONTRATOS,
  SIGNED_URL_TTL_SECONDS,
  caminhoContratoAssinado,
  criarUrlAssinadaContrato,
  validarPdfAssinado,
  validarStoragePathContrato,
} = require('../services/contratacaoStorageService');

const pdf = Buffer.from('%PDF-1.7\nconteudo');

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
