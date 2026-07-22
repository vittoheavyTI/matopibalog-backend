const supabase = require('../config/supabase');
const { decidirSuspensaoPorInadimplencia } = require('../services/paymentDomainService');
const { patchSuspensaoFinanceiraAutomatica } = require('../utils/suspensao');

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

    // Expirar trials vencidos
    const { data: expirados, error: queryError } = await supabase
      .from('empresas')
      .select('id, nome, status, trial_ends_at')
      .eq('status', 'trial')
      .lt('trial_ends_at', now);

    if (queryError) {
      console.error('[expirarTrials] Erro na consulta:', queryError.message);
      return;
    }

    if (expirados && expirados.length > 0) {
      let suspensas = 0;
      let preservadas = 0;

      for (const empresa of expirados) {
        const { data: fatura, error: faturaError } = await buscarFaturaElegivel(empresa.id, hoje);
        const decisao = decidirSuspensaoPorInadimplencia({
          empresa,
          fatura,
          hoje,
          erroConsulta: faturaError,
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
