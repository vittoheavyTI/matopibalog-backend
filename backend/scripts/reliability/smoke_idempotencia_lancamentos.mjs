#!/usr/bin/env node
// smoke_idempotencia_lancamentos.mjs — Smoke do PR #175 (idempotência backend).
// DRY-RUN É O PADRÃO: só envia POST (cria dados) com a flag explícita --send.
// Sem --send, mesmo com MATOPIBA_TOKEN no ambiente, NADA é enviado. Não contém
// segredo: o token vem de env e NUNCA é impresso.
//
// Testa que o backend deduplica POSTs com o mesmo client_request_id:
//   POST 1 (client_request_id = X) -> 201, cria o lançamento
//   POST 2 (client_request_id = X) -> 201 com { idempotent: true }, mesmo id
// E (com --no-idempotency) que um POST sem o campo segue funcionando (compat).
//
// Requisitos: Node 20+ (fetch e crypto.randomUUID nativos). Sem dependências.
//
// ─── Variáveis de ambiente ───────────────────────────────────────────────────
//   MATOPIBA_TOKEN    (obrigatório SÓ com --send) JWT Bearer do motorista/admin.
//   MATOPIBA_API_URL  (opcional) base da API. Default: produção Railway.
//
// ─── Uso ─────────────────────────────────────────────────────────────────────
//   # dry-run (padrão; não envia, não exige token):
//   node backend/scripts/reliability/smoke_idempotencia_lancamentos.mjs
//   # envio REAL (cria dados — exige --send E MATOPIBA_TOKEN):
//   MATOPIBA_TOKEN=... node backend/scripts/reliability/smoke_idempotencia_lancamentos.mjs --send --endpoint=despesas --valor=1.50
//
//   Flags:
//     --endpoint=despesas|abastecimentos|vales   (default: despesas)
//     --valor=NN                                  (default: 1.00)
//     --descricao="texto"                         (despesas/vales)
//     --tipo=alimentacao|pedagio|manutencao|outros (despesas; default: outros)
//     --litros=NN                                 (abastecimentos; default: 1)
//     --quem-pagou=proprietario|motorista         (default: proprietario)
//     --frete-id=UUID                             (opcional; frete ativo)
//     --motorista-id=UUID                         (opcional; só admin lançando p/ outro)
//     --client-request-id=UUID                    (opcional; default: gerado)
//     --no-idempotency                            (1 POST sem o campo — teste de compat; exige --send)
//     --send | --real                             (ENVIO REAL — cria dados; exige MATOPIBA_TOKEN)
//     --dry-run                                   (redundante: sem --send já é dry-run)
//     --verbose                                   (imprime corpo das respostas; nunca o token)
//
// NOTA: o envio real (--send) CRIA lançamentos de verdade na conta do token. Use conta de
// teste, valor baixo e marcador na descrição. O backend não tem DELETE de
// lançamento — limpeza é manual (neutralizar por status no painel).

import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, ...rest] = a.slice(2).split('=');
    flags[k] = rest.length ? rest.join('=') : true;
  }
}

// DRY-RUN É O PADRÃO REAL: só envia POST com a flag explícita --send (ou --real).
// Assim, mesmo com MATOPIBA_TOKEN no ambiente, rodar sem --send NUNCA cria dados.
// --dry-run continua aceito (e é redundante: sem --send já é dry-run).
const REAL = !!flags.send || !!flags.real;
const DRY_RUN = !REAL;
const VERBOSE = !!flags['verbose'];
const NO_IDEMPOTENCY = !!flags['no-idempotency'];

const API_URL = (process.env.MATOPIBA_API_URL || 'https://matopibalog-backend-production.up.railway.app').replace(/\/+$/, '');
const TOKEN = process.env.MATOPIBA_TOKEN || '';

const endpoint = String(flags.endpoint || 'despesas');
const ENDPOINTS = ['despesas', 'abastecimentos', 'vales'];
if (!ENDPOINTS.includes(endpoint)) {
  console.error(`endpoint inválido: ${endpoint}. Use: ${ENDPOINTS.join(', ')}`);
  process.exit(2);
}

const quemPagou = String(flags['quem-pagou'] || 'proprietario');
const valor = String(flags.valor || '1.00');
const clientRequestId = String(flags['client-request-id'] || randomUUID());

function buildPayload(withId) {
  let p;
  if (endpoint === 'despesas') {
    p = { tipo: String(flags.tipo || 'outros'), descricao: String(flags.descricao || '[smoke] idempotencia'), valor, quem_pagou: quemPagou };
  } else if (endpoint === 'abastecimentos') {
    p = { litros: String(flags.litros || '1'), valor_total: valor, quem_pagou: quemPagou };
  } else {
    p = { valor, descricao: String(flags.descricao || '[smoke] idempotencia'), quem_pagou: quemPagou };
  }
  if (flags['frete-id']) p.frete_id = String(flags['frete-id']);
  if (flags['motorista-id']) p.motorista_id = String(flags['motorista-id']);
  if (withId) p.client_request_id = clientRequestId;
  return p;
}

async function post(payload, label) {
  const res = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, // construído, nunca logado
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch { /* não-JSON */ }
  const id = body && (body.id ?? null);
  const idempotent = !!(body && body.idempotent === true);
  console.log(`[${label}] HTTP ${res.status} | id=${id ?? '—'} | idempotent=${idempotent}`);
  if (VERBOSE && body) console.log(`[${label}] body:`, JSON.stringify(body));
  return { status: res.status, id, idempotent };
}

console.log(`API_URL: ${API_URL}`);
console.log(`endpoint: ${endpoint}`);
console.log(`token: ${TOKEN ? 'present (hidden)' : 'AUSENTE'}`);
console.log(`modo: ${DRY_RUN ? 'DRY-RUN (padrão; não envia — use --send para enviar)' : NO_IDEMPOTENCY ? 'COMPAT REAL (sem client_request_id)' : 'IDEMPOTÊNCIA REAL (2 POSTs com mesmo id)'}`);

if (NO_IDEMPOTENCY) {
  const payload = buildPayload(false);
  console.log('payload (sem client_request_id):', JSON.stringify(payload));
  if (DRY_RUN) { console.log('dry-run: nada enviado.'); process.exit(0); }
  if (!TOKEN) { console.error('ERRO: defina MATOPIBA_TOKEN para enviar.'); process.exit(3); }
  const r = await post(payload, 'COMPAT');
  console.log(r.status === 201 ? '✅ compat OK (201 sem o campo).' : `⚠️ esperado 201, veio ${r.status}.`);
  process.exit(r.status === 201 ? 0 : 1);
}

const payload = buildPayload(true);
console.log(`client_request_id: ${clientRequestId}`);
console.log('payload:', JSON.stringify(payload));

if (DRY_RUN) {
  console.log('dry-run: POST 1 e POST 2 usariam o payload acima (id idêntico). Nada enviado.');
  process.exit(0);
}
if (!TOKEN) { console.error('ERRO: defina MATOPIBA_TOKEN para enviar.'); process.exit(3); }

const r1 = await post(payload, 'POST 1');
const r2 = await post(payload, 'POST 2');

const okStatus = r1.status === 201 && r2.status === 201;
const okIdempotent = r2.idempotent === true;
const okSameId = r1.id && r2.id ? r1.id === r2.id : true;
console.log('─'.repeat(50));
console.log(`status 201/201:        ${okStatus ? '✅' : '❌'} (${r1.status}/${r2.status})`);
console.log(`POST 2 idempotent:     ${okIdempotent ? '✅' : '❌'}`);
console.log(`mesmo id nos dois:     ${okSameId ? '✅' : '❌'} (${r1.id ?? '—'} / ${r2.id ?? '—'})`);
const pass = okStatus && okIdempotent && okSameId;
console.log(pass ? '✅ IDEMPOTÊNCIA OK — sem duplicação.' : '❌ FALHOU — verificar backend/migration.');
process.exit(pass ? 0 : 1);
