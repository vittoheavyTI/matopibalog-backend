// backend/jobs/gerarFaturasRecorrentes.js
// Frente #5 (Billing v2) — PR 4: JOB ONE-SHOT de geração de faturas recorrentes.
//
// Roda UMA vez e SAI (process.exit). NÃO usa setInterval/cron interno e NÃO é
// carregado por server.js — o agendamento é externo (Railway Cron) e fica FORA
// do código. Isso evita o antipadrão do expirarTrials (setInterval em toda
// instância → execuções concorrentes). Como o disparo é único (one-shot) e a
// idempotência mora no banco (índice único parcial da 031 + client_request_id da
// 021 + reconciliação por externalReference), não há necessidade de lease neste PR.
//
// SEGURANÇA (fail-closed, nesta ordem):
//   1. ambiente Asaas TEM que ser 'sandbox' — senão aborta ANTES de qualquer
//      chamada ao serviço/Asaas (mesma trava do bloquearSeNaoSandbox da rota);
//   2. allowlist (env) OBRIGATÓRIA — vazia/ausente ⇒ não processa ninguém.
// Reusa o SERVIÇO (gerarFaturaRecorrenteEmLote), nunca a rota HTTP. Cobrança é
// sempre avulsa PIX; NÃO cria assinatura Asaas, NÃO toca webhook/frontend/app.
//
// Uso:
//   node backend/jobs/gerarFaturasRecorrentes.js [--dry-run] [--data-referencia=YYYY-MM-DD] [--limite=N]
// Env:
//   FATURAS_RECORRENTES_ALLOWLIST="uuid1,uuid2,..."  (UUIDs separados por vírgula)

const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const {
  gerarFaturaRecorrenteEmLote,
  selecionarEmpresasRecorrentes,
} = require('../services/faturaRecorrenteService');

const LIMITE_PADRAO = 20;
const LIMITE_MAX = 100;
const ENV_ALLOWLIST = 'FATURAS_RECORRENTES_ALLOWLIST';

// ─── Parsing de CLI/env (puro) ───────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, dataReferencia: null, limite: null };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--data-referencia=')) args.dataReferencia = a.slice('--data-referencia='.length);
    else if (a.startsWith('--limite=')) args.limite = a.slice('--limite='.length);
  }
  return args;
}

function normalizarLimite(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return LIMITE_PADRAO;
  return Math.min(n, LIMITE_MAX);
}

function normalizarDataReferencia(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  // Default: HOJE. Sem backfill automático de meses passados — a competência é
  // sempre a do mês corrente, salvo se o operador passar --data-referencia.
  return new Date().toISOString().slice(0, 10);
}

// Allowlist a partir da env: UUIDs separados por vírgula, deduplicados. Vazia se
// ausente/branca. Não valida formato de UUID (o filtro no banco não casa lixo).
function lerAllowlist(env) {
  const bruto = (env && env[ENV_ALLOWLIST]) || '';
  const ids = String(bruto)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

// ─── Núcleo testável (sem process.exit, sem ler process.* diretamente) ───────
// Recebe supabase/http injetados e as opções já parseadas. Retorna
// { relatorio, exitCode }. NÃO lança para decisões controladas (sandbox/allowlist);
// erros técnicos inesperados propagam para o wrapper tratar como exit 1.
async function executarJob({ supabase, http, allowlist, dryRun = false, dataReferencia, limite }) {
  const inicio = Date.now();
  const periodoBase = { dryRun: Boolean(dryRun) };

  // 1. GATE DE SANDBOX — antes de qualquer chamada ao serviço/Asaas. Fail-closed:
  //    qualquer valor != 'sandbox' (inclusive ausente) aborta.
  const { data: cfg, error: cfgErr } = await supabase
    .from('configuracoes')
    .select('dados')
    .eq('id', 1)
    .single();
  if (cfgErr) {
    return { relatorio: { abort: 'erro_ler_configuracao', ...periodoBase, dur_ms: Date.now() - inicio }, exitCode: 1 };
  }
  const integ = (cfg && cfg.dados && cfg.dados.integracao_asaas) || {};
  if (integ.environment !== 'sandbox') {
    return {
      relatorio: { abort: 'ambiente_nao_sandbox', ambiente: integ.environment || null, ...periodoBase, dur_ms: Date.now() - inicio },
      exitCode: 1,
    };
  }

  // 2. ALLOWLIST fail-closed — vazia/ausente ⇒ não processa ninguém (exit 0).
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return {
      relatorio: {
        abort: 'allowlist_vazia', ...periodoBase,
        totalCandidatas: 0, geradas: [], puladas: [], erros: [], dur_ms: Date.now() - inicio,
      },
      exitCode: 0,
    };
  }

  // 3. Config Asaas só no modo real (dry-run não resolve a apiKey nem chama Asaas).
  let config = {};
  if (!dryRun) {
    config = { apiKey: resolveAsaasApiKey(integ), baseURL: 'https://sandbox.asaas.com/api/v3' };
  }

  // 4. Seleção grossa (ativas, sem assinatura, dentro da allowlist, com plano).
  const empresas = await selecionarEmpresasRecorrentes(supabase, { allowlist, limite });

  // 5. Lote (o domínio decide elegibilidade fina por empresa).
  const resumo = await gerarFaturaRecorrenteEmLote({ supabase, http, config, empresas, dataReferencia, dryRun });

  return {
    relatorio: {
      periodo: resumo.periodo,
      dryRun: Boolean(dryRun),
      totalCandidatas: empresas.length,
      geradas: resumo.geradas,
      puladas: resumo.puladas,
      erros: resumo.erros,
      dur_ms: Date.now() - inicio,
    },
    exitCode: 0,
  };
}

// ─── Wrapper CLI (só executa quando invocado diretamente) ────────────────────
async function runCli() {
  // require tardio: só o CLI toca supabase/axios reais; o teste importa o núcleo
  // sem abrir conexão nem exigir env.
  const supabase = require('../config/supabase');
  const axios = require('axios');

  const args = parseArgs(process.argv.slice(2));
  const opts = {
    supabase,
    http: axios,
    allowlist: lerAllowlist(process.env),
    dryRun: args.dryRun,
    dataReferencia: normalizarDataReferencia(args.dataReferencia),
    limite: normalizarLimite(args.limite),
  };

  try {
    const { relatorio, exitCode } = await executarJob(opts);
    console.log(JSON.stringify(relatorio));
    process.exit(exitCode);
  } catch (err) {
    // Falha técnica estrutural inesperada → exit 1, sem vazar segredo/payload.
    console.error(JSON.stringify({ erro_fatal: (err && (err.motivo || err.message)) || 'desconhecido' }));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  executarJob,
  parseArgs,
  normalizarLimite,
  normalizarDataReferencia,
  lerAllowlist,
  LIMITE_PADRAO,
  LIMITE_MAX,
  ENV_ALLOWLIST,
};
