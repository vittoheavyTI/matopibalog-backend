// reliability_report.mjs — Agregador NÍVEL 1, prod-safe, read-only.
// Executa os módulos de diagnóstico (health + schema opt-in), agrega o
// resultado e grava em tmp/ (NÃO versionado). Não cria dados, não usa token,
// não imprime segredos. Não inclui o smoke de idempotência (esse cria dados).
//
// Saídas:  <repo>/tmp/reliability_report.json e <repo>/tmp/reliability_report.md
// Uso:     node backend/scripts/reliability/reliability_report.mjs
// Exit:    0 se nenhum FAIL (SKIP é tolerado), 1 se houver FAIL.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { run as runHealth } from './smoke_health.mjs';
import { run as runSchema } from './check_db_schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/scripts/reliability → sobe 3 níveis até a raiz do repositório.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP_DIR = path.join(REPO_ROOT, 'tmp');
const API_URL = (process.env.MATOPIBA_API_URL || 'https://matopibalog-backend-production.up.railway.app').replace(/\/+$/, '');

function summarize(results) {
  let pass = 0, fail = 0, skip = 0;
  for (const r of results) for (const c of r.checks) {
    if (c.status === 'PASS') pass++;
    else if (c.status === 'FAIL') fail++;
    else skip++;
  }
  return { pass, fail, skip, ok: fail === 0 };
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`# Relatório de Confiabilidade — Nível 1`);
  lines.push('');
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- API: ${report.apiUrl}`);
  lines.push(`- Resumo: ${report.summary.pass} PASS · ${report.summary.fail} FAIL · ${report.summary.skip} SKIP`);
  lines.push(`- Veredito: ${report.summary.ok ? '✅ OK' : '❌ FALHOU'}`);
  lines.push('');
  for (const mod of report.results) {
    lines.push(`## ${mod.name} ${mod.ok ? '✅' : '❌'}`);
    lines.push('');
    lines.push('| Status | Check | Detalhe |');
    lines.push('|---|---|---|');
    for (const c of mod.checks) lines.push(`| ${c.status} | ${c.check} | ${String(c.detail).replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function run() {
  const results = [];
  results.push(await runHealth());
  results.push(await runSchema());
  const summary = summarize(results);
  return {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    summary,
    results,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const report = await run();
  await mkdir(TMP_DIR, { recursive: true });
  const jsonPath = path.join(TMP_DIR, 'reliability_report.json');
  const mdPath = path.join(TMP_DIR, 'reliability_report.md');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, toMarkdown(report), 'utf8');

  console.log(`# reliability_report — ${report.apiUrl}`);
  for (const mod of report.results) {
    for (const c of mod.checks) console.log(`  [${c.status}] ${mod.name}: ${c.check} — ${c.detail}`);
  }
  console.log(`Resumo: ${report.summary.pass} PASS · ${report.summary.fail} FAIL · ${report.summary.skip} SKIP`);
  console.log(`Relatórios: ${path.relative(REPO_ROOT, jsonPath)} , ${path.relative(REPO_ROOT, mdPath)}`);
  console.log(report.summary.ok ? '✅ CONFIABILIDADE OK' : '❌ FALHAS DETECTADAS');
  process.exit(report.summary.ok ? 0 : 1);
}
