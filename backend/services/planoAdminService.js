// Lógica de arquivamento e exclusão segura de planos (Billing v2, frente #6).
// Funções puras/injetáveis (recebem supabase) para serem testáveis sem rede/DB,
// no mesmo estilo de paymentDomainService. As rotas em routes/painel-admin.js
// só orquestram (auth + res.status(...).json(...)).

// Monta o patch de arquivar/desarquivar a partir do corpo do PUT. A autoria
// (arquivado_por) vem SEMPRE do token (actorUid), nunca do body.
//   arquivar === true  → arquiva: arquivado_em=agora, arquivado_por=actor, ativo=false
//   arquivar === false → desarquiva: arquivado_em=null, arquivado_por=null
//                        (NÃO reativa: `ativo` permanece como está — reativar é ação separada)
// Retorna {} quando `arquivar` não veio (nada a fazer nessa dimensão).
function montarPatchArquivamento(body, actorUid) {
  if (!body || body.arquivar === undefined) return {};
  if (body.arquivar === true) {
    return {
      arquivado_em: new Date().toISOString(),
      arquivado_por: actorUid || null,
      ativo: false,
    };
  }
  // Desarquivar: volta para a visão principal do painel, sem reativar no app.
  return { arquivado_em: null, arquivado_por: null };
}

// Exclusão FÍSICA segura (critério B — só quem nunca foi usado).
// Retorna sempre { status, body } — o handler faz res.status(status).json(body).
// NUNCA deixa vazar 500 quando o plano está referenciado (FK 23503 → 409).
async function excluirPlano({ supabase, planoId }) {
  const { data: plano, error: loadErr } = await supabase
    .from('planos')
    .select('id, ja_utilizado')
    .eq('id', planoId)
    .maybeSingle();

  if (loadErr) {
    return { status: 500, body: { message: 'Erro ao carregar o plano.' } };
  }
  if (!plano) {
    return { status: 404, body: { message: 'Plano não encontrado.' } };
  }

  // 1) Já usado alguma vez → nunca exclui fisicamente. Oferece arquivar.
  if (plano.ja_utilizado === true) {
    return {
      status: 409,
      body: {
        excluivel: false,
        motivo: 'ja_utilizado',
        message: 'Este plano já foi usado e não pode ser excluído. Arquive-o para tirá-lo da tela.',
      },
    };
  }

  // 2) Rede de segurança: alguma empresa referencia agora? (flag pode estar
  // dessincronizada se um caminho de atribuição esquecer de marcá-la). Se sim,
  // auto-cura a flag e recusa a exclusão.
  const { count, error: countErr } = await supabase
    .from('empresas')
    .select('id', { count: 'exact', head: true })
    .eq('plano_id', planoId);

  if (countErr) {
    return { status: 500, body: { message: 'Erro ao verificar uso do plano.' } };
  }
  if ((count || 0) > 0) {
    await supabase.from('planos').update({ ja_utilizado: true }).eq('id', planoId);
    return {
      status: 409,
      body: {
        excluivel: false,
        motivo: 'empresas',
        empresas: count,
        message: 'Há empresas usando este plano. Arquive-o em vez de excluir.',
      },
    };
  }

  // 3) Exclui de fato — capturando violação de FK (23503) como 409, nunca 500.
  const { error: delErr } = await supabase.from('planos').delete().eq('id', planoId);
  if (delErr) {
    if (delErr.code === '23503') {
      return {
        status: 409,
        body: {
          excluivel: false,
          motivo: 'fk',
          message: 'Este plano está vinculado a registros e não pode ser excluído. Arquive-o.',
        },
      };
    }
    return { status: 500, body: { message: 'Erro ao excluir o plano.' } };
  }

  return { status: 200, body: { excluido: true } };
}

module.exports = { montarPatchArquivamento, excluirPlano };
