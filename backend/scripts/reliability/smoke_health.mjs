// smoke_health.mjs — Diagnóstico NÍVEL 1, prod-safe, read-only.
// Não cria dados. Não usa token. Não imprime segredos.
//
// Verifica:
//   1. GET /health → 200 e body.status === 'UP'
//   2. Header de resposta: x-powered-by AUSENTE (hardening) + x-content-type-options
//   3. Rota protegida sem token (GET /fretes) → 401
//
// Uso direto:   node backend/scripts/reliability/smoke_health.mjs
// Env:          MATOPIBA_API_URL (opcional; default produção Railway)
// Exit:         0 se tudo PASS, 1 se houver FAIL.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.MATOPIBA_API_URL || 'https://matopibalog-backend-production.up.railway.app').replace(/\/+$/, '');

// Contrato de resultado compartilhado com reliability_report.mjs:
//   { name, ok, checks: [{ check, status: 'PASS'|'FAIL'|'SKIP', detail }] }
export async function run() {
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });

  // 1. /health
  try {
    const res = await fetch(`${API_URL}/health`, { method: 'GET' });
    let body = null;
    try { body = await res.json(); } catch { /* não-JSON */ }
    if (res.status === 200 && body && body.status === 'UP') {
      add('GET /health', 'PASS', `200 status=UP`);
    } else {
      add('GET /health', 'FAIL', `HTTP ${res.status} body=${JSON.stringify(body)}`);
    }

    // 2. Headers de hardening (na mesma resposta)
    const xpb = res.headers.get('x-powered-by');
    add('header x-powered-by ausente', xpb ? 'FAIL' : 'PASS', xpb ? `presente: ${xpb}` : 'ausente (ok)');
    const xcto = res.headers.get('x-content-type-options');
    add('header x-content-type-options', xcto === 'nosniff' ? 'PASS' : 'SKIP', xcto ? `${xcto}` : 'ausente');
  } catch (e) {
    add('GET /health', 'FAIL', `erro de rede: ${e.message}`);
    add('header x-powered-by ausente', 'SKIP', 'sem resposta');
    add('header x-content-type-options', 'SKIP', 'sem resposta');
  }

  // 3. Rota protegida sem token → 401
  try {
    const res = await fetch(`${API_URL}/fretes`, { method: 'GET' });
    add('GET /fretes sem token', res.status === 401 ? 'PASS' : 'FAIL', `HTTP ${res.status} (esperado 401)`);
  } catch (e) {
    add('GET /fretes sem token', 'FAIL', `erro de rede: ${e.message}`);
  }

  const ok = checks.every((c) => c.status !== 'FAIL');
  return { name: 'health', ok, checks };
}

// CLI: roda standalone, imprime e define exit code.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const r = await run();
  console.log(`# smoke_health — API_URL: ${API_URL}`);
  for (const c of r.checks) console.log(`  [${c.status}] ${c.check} — ${c.detail}`);
  console.log(r.ok ? '✅ health OK' : '❌ health FALHOU');
  process.exit(r.ok ? 0 : 1);
}
