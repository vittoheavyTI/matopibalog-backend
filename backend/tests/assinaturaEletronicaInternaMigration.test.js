const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '055_assinatura_eletronica_interna.sql'),
  'utf8',
);

test('migration 055 e aditiva, idempotente e sem comandos destrutivos de dados', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.contrato_assinatura_desafios/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS signature_method/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_contratos_comerciais_verification_token_hash/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /(^|;)\s*TRUNCATE\s+/i);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bGRANT\s+ALL\b/i);
});

test('migration 055 mantem tabelas comerciais fechadas para anon/authenticated', () => {
  assert.match(migration, /ALTER TABLE public\.contrato_assinatura_desafios ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.contrato_assinatura_desafios FROM PUBLIC/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.contrato_assinatura_desafios FROM anon/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.contrato_assinatura_desafios FROM authenticated/i);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.contrato_assinatura_desafios TO service_role/i);
  assert.match(migration, /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.propostas_comerciais FROM service_role/i);
  assert.match(migration, /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.contratos_comerciais FROM service_role/i);
  assert.match(migration, /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.contrato_signatarios FROM service_role/i);
  assert.match(migration, /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.contrato_assinatura_desafios FROM service_role/i);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.contrato_eventos FROM service_role/i);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.contrato_eventos TO service_role/i);
  assert.doesNotMatch(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.contrato_eventos TO service_role/i);
  assert.doesNotMatch(migration, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE).*TO\s+anon/i);
  assert.doesNotMatch(migration, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE).*TO\s+authenticated/i);
});

test('migration 055 registra estados canonicos e metodo interno_otp', () => {
  for (const status of [
    'pronto_assinatura',
    'aguardando_assinatura_cliente',
    'aguardando_assinatura_matopiba',
    'plenamente_assinado',
    'recusado',
    'expirado',
    'substituido',
  ]) {
    assert.match(migration, new RegExp(status));
  }
  assert.match(migration, /interno_otp/);
  assert.match(migration, /codigo_alg text NOT NULL DEFAULT 'hmac-sha256-v1' CHECK \(codigo_alg IN \('hmac-sha256-v1'\)\)/i);
  assert.match(migration, /verification_token_hash/);
  assert.match(migration, /event_hash/);
});

test('migration 055 impede multiplos desafios ativos por signatario/finalidade', () => {
  assert.match(migration, /empresa_id uuid NOT NULL/i);
  assert.match(migration, /usuario_id uuid NOT NULL/i);
  assert.match(migration, /email_hash text NOT NULL/i);
  assert.match(migration, /email_mascarado text NOT NULL/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_assinatura_desafios_um_ativo/i);
  assert.match(migration, /ON public\.contrato_assinatura_desafios \(signatario_id, finalidade\)/i);
  assert.match(migration, /WHERE status = 'ativo'/i);
});

test('migration 055 protege cadeia de eventos e valida hashes hexadecimais', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_eventos_event_hash/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_contrato_eventos_chain_prev/i);
  assert.match(migration, /COALESCE\(prev_hash, 'ROOT'\)/i);
  assert.match(migration, /document_file_hash IS NULL OR document_file_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /certificate_file_hash IS NULL OR certificate_file_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /verification_token_hash IS NULL OR verification_token_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /assinatura_hash IS NULL OR assinatura_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /document_hash_assinado IS NULL OR document_hash_assinado ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /prev_hash IS NULL OR prev_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /event_hash IS NULL OR event_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /CHECK \(expires_at > created_at\)/i);
  assert.match(migration, /CHECK \(attempts <= max_attempts\)/i);
});

test('migration 055 documenta modelo backend-only da policy redundante', () => {
  assert.match(migration, /Modelo backend-only: authenticated nao possui GRANT direto/i);
});
