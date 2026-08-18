const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WRAPPER = path.join(__dirname, '..', 'scripts', 'billing', 'asaas_production_one_shot_charge.mjs');

// F3A: o wrapper NÃO pode mais depender de config/supabase (@supabase/supabase-js),
// que instancia Realtime/WebSocket e derrubava o processo no Windows.
test('wrapper NÃO importa config/supabase nem @supabase/supabase-js', () => {
  const src = fs.readFileSync(WRAPPER, 'utf8');
  // Ignora linhas de comentário ao procurar require/import reais.
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/require\(\s*['"][^'"]*config\/supabase['"]\s*\)/.test(codigo), false, 'não deve requerer config/supabase');
  assert.equal(/@supabase\/supabase-js/.test(codigo), false, 'não deve referenciar supabase-js');
  assert.ok(/oneShotSupabaseRestClient/.test(codigo), 'deve usar o cliente REST mínimo');
});

// Dry-run puro (sem env, sem --empresa-id): deve sair com EXIT CODE 0, sem
// assertion de handle e sem warning de WebSocket. Prova o hardening de runtime.
test('dry-run puro: exit 0, sem Assertion/UV_HANDLE_CLOSING, sem WebSocket warning', () => {
  let stdout = ''; let stderr = ''; let code = 0;
  try {
    stdout = execFileSync(process.execPath, [WRAPPER], {
      env: { PATH: process.env.PATH }, // sem SUPABASE/ASAAS: dry-run puro
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (err) {
    code = err.status == null ? 1 : err.status;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }
  assert.equal(code, 0, `esperado exit 0, veio ${code}. stderr=${stderr}`);
  assert.match(stdout, /"modo":"dry-run"/);
  assert.match(stdout, /"execucao_real":false/);
  assert.equal(/Assertion failed|UV_HANDLE_CLOSING/.test(stderr), false, `assertion no stderr: ${stderr}`);
  assert.equal(/WebSocket|ws does not work|Realtime/i.test(stderr), false, `warning de websocket: ${stderr}`);
});
