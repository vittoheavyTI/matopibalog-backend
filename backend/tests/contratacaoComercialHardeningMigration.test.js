const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '054_hardening_contratacao_comercial.sql'),
  'utf8'
);

test('migration 054 revoga acesso direto comercial de anon/auth e preserva service_role', () => {
  for (const tabela of [
    'propostas_comerciais',
    'contratos_comerciais',
    'contrato_signatarios',
    'contrato_eventos',
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${tabela} FROM anon`, 'i'));
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${tabela} FROM authenticated`, 'i'));
    assert.doesNotMatch(migration, new RegExp(`REVOKE .* public\\.${tabela} FROM service_role`, 'i'));
  }
});

test('migration 054 endurece helpers RLS sem remover uso autenticado', () => {
  for (const fn of ['rls_is_super_admin', 'rls_is_company_admin', 'rls_empresa_id']) {
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`, 'i'));
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM anon`, 'i'));
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM authenticated`, 'i'));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\) TO authenticated, service_role`, 'i'));
  }
});

test('migration 054 e local, idempotente e nao altera dados financeiros/storage', () => {
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /\b(faturas|charges|payments|asaas|planos|promocoes|preco|storage\.objects|storage\.buckets)\b/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_contrato_signatarios_empresa/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_contrato_eventos_empresa_criado/i);
});
