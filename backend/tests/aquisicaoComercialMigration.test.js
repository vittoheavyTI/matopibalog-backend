const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '068_aquisicao_comercial_v2_rpc.sql'),
  'utf8'
);

test('migration 068 libera origens explicitas e cria RPC atomica sem Asaas', () => {
  const semComentarios = migration
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.match(migration, /aquisicao_explicita/);
  assert.match(migration, /pos_trial_continuar/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.iniciar_aquisicao_comercial_v2/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /cc\.proposta_id = p\.id/);
  assert.match(migration, /extensions\.digest/);
  assert.doesNotMatch(migration, /WHERE proposta_id = p\.id/);
  assert.match(migration, /billing_outbox/);
  assert.match(migration, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(migration, /GRANT EXECUTE .* TO service_role/i);
  assert.doesNotMatch(semComentarios, /asaas_|asaas\.|api_key|subscription|payment/i);
});
