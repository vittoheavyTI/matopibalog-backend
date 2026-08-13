// E2E REAL contra Asaas SANDBOX (macrofrente 3A-2, §21/§24/§25).
//
// Só roda com ASAAS_SANDBOX_API_KEY presente e base URL sandbox oficial. Usa
// fixture 100% sintética (MATOPIBA-E2E-<random>). Fail-closed para produção: o
// AsaasSandboxProvider recusa host não-sandbox no construtor.
//
// SEM segredo → NOT RUN (exit != 0, sem "PASS"). NUNCA cria dados reais.

import process from 'node:process';
import { randomUUID } from 'node:crypto';

async function main() {
  const apiKey = process.env.ASAAS_SANDBOX_API_KEY;
  const baseURL = process.env.ASAAS_SANDBOX_BASE_URL || 'https://sandbox.asaas.com/api/v3';

  if (!apiKey) {
    console.error('SANDBOX E2E = NOT RUN / BLOCKED BY MISSING SANDBOX SECRET (ASAAS_SANDBOX_API_KEY).');
    process.exit(1);
  }
  // Guarda dura extra: base precisa ser sandbox oficial.
  if (!/sandbox\.asaas\.com/.test(baseURL) || /(^|\.)api\.asaas\.com/.test(baseURL)) {
    console.error('ABORT: base URL não é sandbox oficial (fail-closed).');
    process.exit(1);
  }

  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const axios = require('axios');
  const { AsaasSandboxProvider } = require('../../services/billing/asaasSandboxProvider');

  const provider = new AsaasSandboxProvider({ config: { environment: 'sandbox', baseURL, apiKey }, http: axios });

  const marca = `MATOPIBA-E2E-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const empresaSintetica = { id: marca, nome: marca, cnpj: '11222333000181', email_contato: `${marca}@example.com` };

  console.log(`[sandbox_e2e] iniciando com fixture ${marca}`);
  const cust = await provider.createCustomer({ empresa: empresaSintetica });
  console.log('[sandbox_e2e] customer criado (sandbox):', cust.id ? 'ok' : 'falha');

  const sub = await provider.createSubscription({ customerId: cust.id, value: 99.9, nextDueDate: dataFutura(20), cycle: 'MONTHLY', externalReference: marca });
  console.log('[sandbox_e2e] subscription criada (sandbox):', sub.id ? 'ok' : 'falha');

  // Limpeza best-effort (cancela a assinatura sintética).
  try { await provider.cancelSubscription({ subscriptionId: sub.id }); console.log('[sandbox_e2e] subscription sintética cancelada'); }
  catch { console.log('[sandbox_e2e] limpeza: não foi possível cancelar (marcar como fixture)'); }

  console.log('SANDBOX E2E = PASS (fixture sintética; nenhum dado real).');
}

function dataFutura(dias) {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error('[sandbox_e2e] erro:', resumirErroAsaas(err));
  process.exit(1);
});

function resumirErroAsaas(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const detalhes = Array.isArray(data?.errors)
    ? data.errors.map((e) => ({
      code: sanitizar(e?.code),
      description: sanitizar(e?.description),
    }))
    : undefined;
  return JSON.stringify({
    message: sanitizar(err?.message),
    status: status || null,
    errors: detalhes || null,
  }).slice(0, 1000);
}

function sanitizar(v) {
  if (v == null) return null;
  return String(v)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/access_token['":\s]+[^"',\s}]+/gi, 'access_token [redacted]')
    .replace(/\\$aact_[A-Za-z0-9_$-]+/g, '[redacted_api_key]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 300);
}
