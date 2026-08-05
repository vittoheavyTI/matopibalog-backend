// backend/jobs/expirarTrials.js
// JOB ONE-SHOT determinístico de trial/inadimplência/suspensão (Pacote 2).
//
// Roda UMA vez e SAI (process.exit) — agendamento EXTERNO (Railway Cron), fora do
// código, no mesmo padrão de gerarFaturasRecorrentes. NÃO é mais carregado por
// server.js e NÃO usa setInterval (o antigo antipadrão que rodava em toda
// instância da web). O núcleo (executarVerificacaoSuspensao) recebe supabase/http
// injetados e é testável sem rede/DB.
//
// O QUE FAZ, por conta (não-arquivada), reutilizando a REGRA CENTRAL do domínio
// (paymentDomainService — carência D+3 + extensão manual suspensao_prazo_ate):
//   * status 'suspenso'            → NÃO faz nada (ja_suspensa) — idempotente, não regride;
//   * 'trial' ainda vigente        → NÃO faz nada (trial_ativa);
//   * 'trial' vencido              → garante fatura de regularização (SÓ sandbox) e avalia suspensão;
//   * 'ativo'                      → avalia suspensão sobre fatura vencida (sem gerar fatura);
//   * elegível (D+3, sem extensão) → suspende (status='suspenso' + metadados financeiros da 024).
//
// Idempotência: rodar 2× não duplica nem regride — conta já suspensa vira
// ja_suspensa (sem ação); a fatura de regularização é idempotente (fatura aberta
// existente é reutilizada). Suspensão NÃO toca fatura paga/emitida (só status da
// empresa). Geração de fatura é SANDBOX-GATED (fail-closed): fora do sandbox,
// nenhuma cobrança é criada. Não toca Asaas production, não deleta nada.

const { decidirSuspensaoPorInadimplencia, lerDiasCarenciaSuspensao } = require('../services/paymentDomainService');
const { patchSuspensaoFinanceiraAutomatica } = require('../utils/suspensao');
const { gerarFaturaRegularizacao } = require('../services/regularizacaoService');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { isArquivada } = require('../services/empresaArquivamentoService');

// Config Asaas SOMENTE quando o ambiente é sandbox (fail-closed, mesma trava do
// job de recorrência). Fora do sandbox → null → nenhuma fatura é gerada.
async function configAsaasSandbox(supabase) {
  try {
    const { data, error } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
    if (error) return null;
    const integ = (data && data.dados && data.dados.integracao_asaas) || {};
    if (integ.environment !== 'sandbox') return null;
    return { apiKey: resolveAsaasApiKey(integ), baseURL: 'https://sandbox.asaas.com/api/v3' };
  } catch (_) {
    return null;
  }
}

// Fatura de regularização do trial vencido (idempotente). Best-effort: falha aqui
// NÃO impede a avaliação de suspensão.
async function garantirFaturaTrialVencido(supabase, http, config, empresaId) {
  if (!config) return { resultado: 'pulada', motivo: 'ambiente_nao_sandbox' };
  try {
    return await gerarFaturaRegularizacao({ supabase, http, config, empresaId });
  } catch (err) {
    return { resultado: 'erro', motivo: (err && (err.motivo || err.message)) || 'excecao' };
  }
}

// Fatura vencida elegível (a mais antiga pendente/vencida com vencimento passado).
async function buscarFaturaElegivel(supabase, empresaId, hoje) {
  return supabase
    .from('faturas')
    .select('id, empresa_id, invoice_url, bank_slip_url, due_date, status')
    .eq('empresa_id', empresaId)
    .in('status', ['pendente', 'vencido'])
    .lt('due_date', hoje)
    .order('due_date', { ascending: true })
    .limit(1)
    .maybeSingle();
}

// Trial vencido = trial_ends_at no passado (comparado ao instante `agora`).
function trialVencido(empresa, agoraISO) {
  if (empresa.status !== 'trial') return false;
  const fim = empresa.trial_ends_at ? new Date(empresa.trial_ends_at) : null;
  return !!(fim && !Number.isNaN(fim.getTime()) && fim.toISOString() < agoraISO);
}

// ─── Núcleo testável (supabase/http injetados; sem process.exit) ─────────────
// dryRun: apenas AVALIA e CONTA — não cria fatura de regularização nem suspende
// (para validar o cron com segurança). suspensas então é "quantas SERIAM suspensas".
async function executarVerificacaoSuspensao({ supabase, http, agora = new Date().toISOString(), dryRun = false }) {
  const inicio = Date.now();
  const hoje = agora.slice(0, 10);
  const rel = {
    total_avaliadas: 0, suspensas: 0, dentro_carencia: 0, prazo_estendido: 0,
    sem_fatura: 0, sem_caminho_regularizacao: 0, trial_ativa: 0, ja_suspensa: 0,
    arquivadas: 0, regularizacoes_geradas: 0, erros: 0, fluxo_v2_trial: 0, outras: [],
  };

  // Universo: contas não-terminais. `*` traz suspensao_prazo_ate/arquivada_em só
  // se as colunas existirem (deploy-safe). Terminais (bloqueado/expirado) e o
  // resto ficam de fora — não são suspensos por inadimplência aqui.
  const { data: linhas, error: queryError } = await supabase
    .from('empresas')
    .select('*')
    .in('status', ['trial', 'ativo', 'suspenso']);
  if (queryError) {
    return { relatorio: { ...rel, abort: 'erro_consulta_empresas', dur_ms: Date.now() - inicio }, exitCode: 1 };
  }

  // Config resolvida uma vez por rodada.
  const configSandbox = await configAsaasSandbox(supabase);
  let diasCarencia;
  try {
    const { data: cfg } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
    diasCarencia = lerDiasCarenciaSuspensao(cfg && cfg.dados);
  } catch (_) { diasCarencia = undefined; } // undefined → default do domínio (3)

  for (const empresa of linhas || []) {
    // Arquivadas: fora da operação (não geram fatura nem suspensão).
    if (isArquivada(empresa)) { rel.arquivadas += 1; continue; }

    // Fluxo comercial v2 em trial: o ciclo pós-trial é DECISÃO EXPLÍCITA do
    // cliente (conversão), não inadimplência. Não gera fatura de regularização
    // nem suspende. Após a conversão a conta vira 'ativo' e volta ao fluxo normal.
    if (empresa.commercial_flow_version === 'v2' && empresa.status === 'trial') {
      rel.fluxo_v2_trial += 1;
      continue;
    }
    rel.total_avaliadas += 1;

    // Já suspensa: idempotente — não faz nada (não regride, não reativa).
    if (empresa.status === 'suspenso') { rel.ja_suspensa += 1; continue; }

    // Trial ainda vigente: nada a fazer.
    if (empresa.status === 'trial' && !trialVencido(empresa, agora)) { rel.trial_ativa += 1; continue; }

    // Trial vencido: garante a fatura de regularização (só sandbox) antes de
    // avaliar. Em dry-run não cria nada.
    if (empresa.status === 'trial' && !dryRun) {
      const r = await garantirFaturaTrialVencido(supabase, http, configSandbox, empresa.id);
      if (r && r.resultado === 'gerada') rel.regularizacoes_geradas += 1;
    }

    const { data: fatura, error: faturaError } = await buscarFaturaElegivel(supabase, empresa.id, hoje);
    const decisao = decidirSuspensaoPorInadimplencia({ empresa, fatura, hoje, erroConsulta: faturaError, diasCarencia });

    if (!decisao.deveSuspender) {
      switch (decisao.razao) {
        case 'dentro_carencia': rel.dentro_carencia += 1; break;
        case 'prazo_estendido': rel.prazo_estendido += 1; break;
        case 'fatura_ausente': rel.sem_fatura += 1; break;
        case 'sem_caminho_regularizacao': rel.sem_caminho_regularizacao += 1; break;
        default: rel.outras.push({ empresa_id: empresa.id, razao: decisao.razao });
      }
      continue;
    }

    // Elegível para suspensão. Em dry-run só conta (não grava).
    if (dryRun) { rel.suspensas += 1; continue; }

    // Suspensão FINANCEIRA e AUTOMÁTICA (metadados da 024 → o pagamento reativa).
    const { error: updateError } = await supabase
      .from('empresas')
      .update(patchSuspensaoFinanceiraAutomatica())
      .eq('id', empresa.id);
    if (updateError) rel.erros += 1; else rel.suspensas += 1;
  }

  rel.dry_run = Boolean(dryRun);
  rel.dur_ms = Date.now() - inicio;
  return { relatorio: rel, exitCode: 0 };
}

// ─── Wrapper CLI (só executa quando invocado diretamente) ────────────────────
async function runCli() {
  const supabase = require('../config/supabase');
  const axios = require('axios');
  const dryRun = process.argv.slice(2).includes('--dry-run');
  try {
    const { relatorio, exitCode } = await executarVerificacaoSuspensao({ supabase, http: axios, dryRun });
    console.log(JSON.stringify({ job: 'verificacao_suspensao', ...relatorio }));
    process.exit(exitCode);
  } catch (err) {
    console.error(JSON.stringify({ job: 'verificacao_suspensao', erro_fatal: (err && err.message) || 'desconhecido' }));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  executarVerificacaoSuspensao,
  configAsaasSandbox,
  garantirFaturaTrialVencido,
  buscarFaturaElegivel,
  trialVencido,
};
