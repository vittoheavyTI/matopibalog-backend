// E2E real contra Asaas SANDBOX.
// Usa fixture sintetica e valida lookup por externalReference para subscription
// e payment. Nunca usa ASAAS_API_KEY production.

import process from 'node:process';
import { randomUUID } from 'node:crypto';

async function main() {
  const apiKey = process.env.ASAAS_SANDBOX_API_KEY;
  const baseURL = process.env.ASAAS_SANDBOX_BASE_URL || 'https://api-sandbox.asaas.com/v3';

  if (!apiKey) {
    console.error('SANDBOX E2E = NOT RUN / BLOCKED BY MISSING SANDBOX SECRET (ASAAS_SANDBOX_API_KEY).');
    process.exit(1);
  }
  if (!/api-sandbox\.asaas\.com|sandbox\.asaas\.com/.test(baseURL) || /(^|\.)api\.asaas\.com/.test(baseURL)) {
    console.error('ABORT: base URL nao e sandbox oficial (fail-closed).');
    process.exit(1);
  }

  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const axios = require('axios');
  const { AsaasSandboxProvider } = require('../../services/billing/asaasSandboxProvider');

  const provider = new AsaasSandboxProvider({ config: { environment: 'sandbox', baseURL, apiKey }, http: axios });

  const marca = `MATOPIBA-E2E-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const empresaSintetica = {
    id: marca,
    nome: marca,
    cnpj: '11222333000181',
    email_contato: `${marca}@example.com`,
  };

  console.log(`[sandbox_e2e] iniciando com fixture ${marca}`);
  const cust = await provider.createCustomer({ empresa: empresaSintetica });
  console.log('[sandbox_e2e] customer criado (sandbox):', cust.id ? 'ok' : 'falha');

  const sub = await provider.createSubscription({
    customerId: cust.id,
    value: 99.9,
    nextDueDate: dataFutura(20),
    cycle: 'MONTHLY',
    externalReference: marca,
  });
  console.log('[sandbox_e2e] subscription criada (sandbox):', sub.id ? 'ok' : 'falha');

  const subReconciliada = await provider.createSubscription({
    customerId: cust.id,
    value: 99.9,
    nextDueDate: dataFutura(20),
    cycle: 'MONTHLY',
    externalReference: marca,
  });
  if (subReconciliada.id !== sub.id) throw new Error('subscription externalReference lookup falhou');
  console.log('[sandbox_e2e] subscription lookup por externalReference: ok');

  const paymentRef = `${marca}:implantation`;
  const pay = await provider.createCharge({
    customerId: cust.id,
    value: 10,
    dueDate: dataFutura(10),
    description: 'Fixture Matopiba E2E',
    externalReference: paymentRef,
  });
  const payReconciliado = await provider.createCharge({
    customerId: cust.id,
    value: 10,
    dueDate: dataFutura(10),
    description: 'Fixture Matopiba E2E',
    externalReference: paymentRef,
  });
  if (payReconciliado.id !== pay.id) throw new Error('payment externalReference lookup falhou');
  console.log('[sandbox_e2e] payment lookup por externalReference: ok');

  try { await provider.cancelComponent({ componentId: pay.id }); console.log('[sandbox_e2e] payment sintetico removido'); }
  catch { console.log('[sandbox_e2e] limpeza: nao foi possivel remover payment sintetico'); }
  try { await provider.cancelSubscription({ subscriptionId: sub.id }); console.log('[sandbox_e2e] subscription sintetica cancelada'); }
  catch { console.log('[sandbox_e2e] limpeza: nao foi possivel cancelar subscription sintetica'); }

  console.log('SANDBOX E2E = PASS (fixture sintetica; nenhum dado real).');
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
    .replace(/\$aact_[A-Za-z0-9_$-]+/g, '[redacted_api_key]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 300);
}
