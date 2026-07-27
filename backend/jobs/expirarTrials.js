const supabase = require('../config/supabase');
const { decidirSuspensaoPorInadimplencia, lerDiasCarenciaSuspensao } = require('../services/paymentDomainService');
const { patchSuspensaoFinanceiraAutomatica } = require('../utils/suspensao');
const { gerarFaturaRegularizacao } = require('../services/regularizacaoService');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const { isArquivada } = require('../services/empresaArquivamentoService');

// Config Asaas SOMENTE quando o ambiente é sandbox (fail-closed, mesma trava do
// job de recorrência): fora do sandbox o job volta ao comportamento antigo
// (não gera cobrança nenhuma). Erro de leitura/descriptografia → null.
async function configAsaasSandbox() {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();
    if (error) return null;
    const integ = (data && data.dados && data.dados.integracao_asaas) || {};
    if (integ.environment !== 'sandbox') return null;
    return { apiKey: resolveAsaasApiKey(integ), baseURL: 'https://sandbox.asaas.com/api/v3' };
  } catch (_) {
    return null;
  }
}

// Garante a fatura de regularização do trial vencido (primeira mensalidade).
// Idempotente por natureza (fatura aberta existente é devolvida; chave única
// por empresa/mês) — seguro mesmo com o setInterval rodando em várias
// instâncias. Best-effort: falha aqui NÃO impede a avaliação de suspensão.
async function garantirFaturaTrialVencido(config, empresaId) {
  if (!config) return { resultado: 'pulada', motivo: 'ambiente_nao_sandbox' };
  try {
    // require tardio do axios: só o caminho sandbox usa HTTP.
    const axios = require('axios');
    const r = await gerarFaturaRegularizacao({ supabase, http: axios, config, empresaId });
    console.log('[expirarTrials] Regularização de trial vencido', {
      empresa_id: empresaId,
      resultado: r.resultado,
      motivo: r.motivo,
    });
    return r;
  } catch (err) {
    console.error('[expirarTrials] Falha ao garantir fatura de regularização', {
      empresa_id: empresaId,
      motivo: (err && (err.motivo || err.message)) || 'desconhecido',
    });
    return { resultado: 'erro', motivo: 'excecao' };
  }
}

async function buscarFaturaElegivel(empresaId, hoje) {
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

async function expirarTrials() {
  try {
    const now = new Date().toISOString();
    const hoje = now.slice(0, 10);

    // Expirar trials vencidos. `*` traz arquivada_em só se a coluna existir
    // (deploy-safe). Contas arquivadas (tiradas da operação) são ignoradas — não
    // geram fatura de regularização nem suspensão.
    const { data: expiradosRaw, error: queryError } = await supabase
      .from('empresas')
      .select('*')
      .eq('status', 'trial')
      .lt('trial_ends_at', now);

    if (queryError) {
      console.error('[expirarTrials] Erro na consulta:', queryError.message);
      return;
    }
    const expirados = (expiradosRaw || []).filter((e) => !isArquivada(e));

    if (expirados && expirados.length > 0) {
      let suspensas = 0;
      let preservadas = 0;
      // Config resolvida uma vez por rodada; null fora do sandbox (fail-closed).
      const configSandbox = await configAsaasSandbox();
      // Carência de suspensão (config; default 3). Lida uma vez por rodada.
      let diasCarencia;
      try {
        const { data: cfgCar } = await supabase.from('configuracoes').select('dados').eq('id', 1).single();
        diasCarencia = lerDiasCarenciaSuspensao(cfgCar && cfgCar.dados);
      } catch (_) { diasCarencia = undefined; } // undefined → default do domínio

      for (const empresa of expirados) {
        // Trial venceu → a conta precisa de um caminho de pagamento. Garante a
        // fatura de regularização ANTES de avaliar suspensão: a fatura nova
        // (due_date futuro) não suspende hoje, mas já aparece no app/painel;
        // se nunca for paga, vence e a suspensão ocorre nas próximas rodadas.
        await garantirFaturaTrialVencido(configSandbox, empresa.id);

        const { data: fatura, error: faturaError } = await buscarFaturaElegivel(empresa.id, hoje);
        const decisao = decidirSuspensaoPorInadimplencia({
          empresa,
          fatura,
          hoje,
          erroConsulta: faturaError,
          diasCarencia,
        });

        if (!decisao.deveSuspender) {
          preservadas += 1;
          console.log('[expirarTrials] Trial preservado sem suspensão financeira comprovada', {
            empresa_id: empresa.id,
            razao: decisao.razao,
          });
          continue;
        }

        // Suspensão por inadimplência é FINANCEIRA e AUTOMÁTICA: grava os
        // metadados da 024, senão o pagamento da fatura nunca reativa a conta
        // (o webhook exige reason='financial' para limpar a suspensão).
        const { error: updateError } = await supabase
          .from('empresas')
          .update(patchSuspensaoFinanceiraAutomatica())
          .eq('id', empresa.id);

        if (updateError) {
          console.error('[expirarTrials] Erro ao atualizar:', updateError.message);
        } else {
          suspensas += 1;
        }
      }

      console.log(`[expirarTrials] Trials avaliados: ${expirados.length}; suspensos: ${suspensas}; preservados: ${preservadas}.`);
    } else {
      console.log('[expirarTrials] Nenhuma trial a expirar.');
    }

    // Verificar planos inativos
    const { data: empresasAtivas } = await supabase
      .from('empresas')
      .select('id, nome, planos!inner(ativo)')
      .eq('status', 'ativo');

    if (empresasAtivas) {
      console.log(`[expirarTrials] ${empresasAtivas.length} empresas ativas verificadas.`);
    }
  } catch (err) {
    console.error('[expirarTrials] Erro geral:', err.message);
  }
}

function iniciarExpiracaoTrials() {
  expirarTrials();
  return setInterval(expirarTrials, 60 * 60 * 1000);
}

// Executar imediatamente e a cada hora em runtime normal; testes importam sem iniciar timer.
if (process.env.NODE_ENV !== 'test') {
  iniciarExpiracaoTrials();
}

module.exports = { expirarTrials, iniciarExpiracaoTrials };
