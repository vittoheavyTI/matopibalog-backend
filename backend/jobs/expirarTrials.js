const supabase = require('../config/supabase');

async function expirarTrials() {
  try {
    const now = new Date().toISOString();

    // Expirar trials vencidos
    const { data: expirados, error: queryError } = await supabase
      .from('empresas')
      .select('id, nome')
      .eq('status', 'trial')
      .lt('trial_ends_at', now);

    if (queryError) {
      console.error('[expirarTrials] Erro na consulta:', queryError.message);
      return;
    }

    if (expirados && expirados.length > 0) {
      const ids = expirados.map(e => e.id);
      const { error: updateError } = await supabase
        .from('empresas')
        .update({ status: 'expirado' })
        .in('id', ids);

      if (updateError) {
        console.error('[expirarTrials] Erro ao atualizar:', updateError.message);
      } else {
        console.log(`[expirarTrials] ${ids.length} empresas expiradas:`, expirados.map(e => e.nome).join(', '));
      }
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

// Executar imediatamente e a cada hora
expirarTrials();
setInterval(expirarTrials, 60 * 60 * 1000);

module.exports = { expirarTrials };
