const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '053_create_contratacao_comercial.sql'),
  'utf8'
);

test('migration de contratacao cria tabelas aditivas com RLS e policies tenant-safe', () => {
  for (const tabela of [
    'propostas_comerciais',
    'contratos_comerciais',
    'contrato_signatarios',
    'contrato_eventos',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tabela}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${tabela} ENABLE ROW LEVEL SECURITY`));
  }

  assert.match(migration, /public\.rls_is_super_admin\(\)/);
  assert.match(migration, /empresa_id = public\.rls_empresa_id\(\)/);
  assert.match(migration, /INSERT INTO storage\.buckets/i);
  assert.match(migration, /'contratos-comerciais'/);
  assert.match(migration, /public = false/);
  assert.doesNotMatch(migration, /TO authenticated\s+USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /ASAAS|apiKey|webhook/i);
});
