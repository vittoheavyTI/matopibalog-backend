// backend/jobs/notificarInadimplencia.js
// Pacote 3 — JOB ONE-SHOT determinístico de NOTIFICAÇÃO PROATIVA de inadimplência.
//
// Roda UMA vez e SAI (process.exit) — agendamento EXTERNO (Railway Cron), fora do
// código, no mesmo padrão de gerarFaturasRecorrentes/expirarTrials. O núcleo
// (executarNotificacaoInadimplencia) recebe supabase/notificar injetados e é
// testável sem rede/DB/Firebase.
//
// O QUE FAZ, por conta (não-arquivada) em status trial-vencido/ativo, sobre a
// fatura vencida MAIS ANTIGA (pendente/vencida, due_date <= hoje):
//   * decide o passo da escada (D+0/D+1/D+2 ou 'suspensao' no dia da carência) via
//     inadimplenciaNotificacaoDomainService (REGRA PURA);
//   * cria a notificação interna para os ADMINS da empresa (fonte da verdade). O
//     push best-effort sai acoplado ao notificacaoService.
//
// IMPORTANTE — MODO SEGURO (--dry-run):
//   * criar notificação interna DISPARA PUSH REAL ao cliente (via notificacaoService
//     → pushService). Por isso este job é implantado com --dry-run (só AVALIA e
//     CONTA; NÃO cria notificação, NÃO empurra push). Ligar o modo real exige
//     autorização explícita — remover --dry-run do config-as-code.
// Idempotência: dedupe_key determinística por (passo, fatura) + índice único
// parcial (ux_notificacoes_dedupe_key). Rodar 2x no mesmo dia não duplica.
//
// NÃO toca faturas pagas, preços, Asaas, nem executa SQL de escrita fora da
// tabela notificacoes. NÃO altera o cron de suspensão.
//
// Uso: node backend/jobs/notificarInadimplencia.js [--dry-run] [--limite=N]

const { isArquivada } = require('../services/empresaArquivamentoService');
const { lerDiasCarenciaSuspensao, DIAS_CARENCIA_PADRAO } = require('../services/paymentDomainService');
const {
  avaliarEscadaInadimplencia,
  montarNotificacao,
} = require('../services/inadimplenciaNotificacaoDomainService');

const LIMITE_PADRAO = 500;
const LIMITE_MAX = 2000;

// ─── Parsing de CLI (puro) ───────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, limite: null };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--limite=')) args.limite = a.slice('--limite='.length);
  }
  return args;
}

function normalizarLimite(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return LIMITE_PADRAO;
  return Math.min(n, LIMITE_MAX);
}

// Fatura vencida elegível: a MAIS ANTIGA pendente/vencida com vencimento <= hoje
// (inclui o D+0 = vence hoje).
async function buscarFaturaElegivel(supabase, empresaId, hoje) {
  return supabase
    .from('faturas')
    .select('id, empresa_id, invoice_url, bank_slip_url, due_date, status')
    .eq('empresa_id', empresaId)
    .in('status', ['pendente', 'vencido'])
    .lte('due_date', hoje)
    .order('due_date', { ascending: true })
    .limit(1)
    .maybeSingle();
}

const PASSOS = ['d0', 'd1', 'd2', 'suspensao'];

// ─── Núcleo testável (supabase/notificar injetados; sem process.exit) ────────
// dryRun: apenas AVALIA e CONTA (notificadas = "quantas SERIAM notificadas"),
// sem criar notificação nem empurrar push.
async function executarNotificacaoInadimplencia({
  supabase,
  notificar,
  agora = new Date().toISOString(),
  dryRun = false,
  diasCarencia = null,
  limite = LIMITE_PADRAO,
}) {
  const inicio = Date.now();
  const hoje = agora.slice(0, 10);
  const rel = {
    total_avaliadas: 0, notificadas: 0,
    por_passo: { d0: 0, d1: 0, d2: 0, suspensao: 0 },
    sem_fatura: 0, ainda_nao_venceu: 0, fora_da_escada: 0, prazo_estendido: 0,
    sem_caminho_regularizacao: 0, trial_ativa: 0, ja_suspensa: 0, arquivadas: 0,
    erros: 0, outras: [],
  };

  const { data: linhas, error: queryError } = await supabase
    .from('empresas')
    .select('*')
    .in('status', ['trial', 'ativo']);
  if (queryError) {
    return { relatorio: { ...rel, abort: 'erro_consulta_empresas', dry_run: Boolean(dryRun), dur_ms: Date.now() - inicio }, exitCode: 1 };
  }

  // Carência da config (mesma fonte do cron de suspensão). Injetável nos testes.
  let carencia = diasCarencia;
  if (carencia == null) {
    try {
      const { data: cfg } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
      carencia = lerDiasCarenciaSuspensao(cfg && cfg.dados);
    } catch (_) { carencia = DIAS_CARENCIA_PADRAO; }
  }

  let processadas = 0;
  for (const empresa of linhas || []) {
    if (isArquivada(empresa)) { rel.arquivadas += 1; continue; }
    if (processadas >= limite) break;
    processadas += 1;
    rel.total_avaliadas += 1;

    const { data: fatura, error: faturaError } = await buscarFaturaElegivel(supabase, empresa.id, hoje);
    const decisao = avaliarEscadaInadimplencia({ empresa, fatura, hoje: agora, erroConsulta: faturaError, diasCarencia: carencia });

    if (!decisao.deveNotificar) {
      switch (decisao.razao) {
        case 'sem_fatura': rel.sem_fatura += 1; break;
        case 'prazo_estendido': rel.prazo_estendido += 1; break;
        case 'sem_caminho_regularizacao': rel.sem_caminho_regularizacao += 1; break;
        case 'trial_ativa': rel.trial_ativa += 1; break;
        case 'ja_suspensa': rel.ja_suspensa += 1; break;
        case 'ainda_nao_venceu': rel.ainda_nao_venceu += 1; break;
        case 'fora_da_escada': rel.fora_da_escada += 1; break;
        default: rel.outras.push({ empresa_id: empresa.id, razao: decisao.razao });
      }
      continue;
    }

    const passo = PASSOS.includes(decisao.passo) ? decisao.passo : null;
    if (!passo) { rel.outras.push({ empresa_id: empresa.id, razao: `passo_invalido_${decisao.passo}` }); continue; }

    // Em dry-run só conta (não cria notificação, não empurra push).
    if (dryRun) {
      rel.notificadas += 1;
      rel.por_passo[passo] += 1;
      continue;
    }

    try {
      const dados = montarNotificacao({ empresa, fatura, passo: decisao.passo, diasVencido: decisao.diasVencido });
      await notificar(empresa.id, dados);
      rel.notificadas += 1;
      rel.por_passo[passo] += 1;
    } catch (_) {
      rel.erros += 1;
    }
  }

  rel.dry_run = Boolean(dryRun);
  rel.dur_ms = Date.now() - inicio;
  return { relatorio: rel, exitCode: 0 };
}

// ─── Wrapper CLI (só executa quando invocado diretamente) ────────────────────
async function runCli() {
  // require tardio: só o CLI toca supabase/notificacaoService reais; o teste
  // importa o núcleo sem abrir conexão nem exigir Firebase.
  const supabase = require('../config/supabase');
  const notificacaoService = require('../services/notificacaoService');
  const notificar = (empresaId, dados) =>
    notificacaoService.criarParaEmpresa(empresaId, dados, { somenteAdmins: true });

  const args = parseArgs(process.argv.slice(2));
  try {
    const { relatorio, exitCode } = await executarNotificacaoInadimplencia({
      supabase,
      notificar,
      dryRun: args.dryRun,
      limite: normalizarLimite(args.limite),
    });
    console.log(JSON.stringify({ job: 'notificacao_inadimplencia', ...relatorio }));
    process.exit(exitCode);
  } catch (err) {
    console.error(JSON.stringify({ job: 'notificacao_inadimplencia', erro_fatal: (err && err.message) || 'desconhecido' }));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  executarNotificacaoInadimplencia,
  buscarFaturaElegivel,
  parseArgs,
  normalizarLimite,
  LIMITE_PADRAO,
  LIMITE_MAX,
};
