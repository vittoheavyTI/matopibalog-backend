// Trava de limite de motoristas por plano (Billing v2, frente #7).
// Funções injetáveis (recebem `supabase`) no mesmo estilo de planoAdminService:
// testáveis sem rede/DB. Este serviço é READ-ONLY de dados de plano/motoristas:
// NÃO cria usuário, motorista, plano, fatura ou pagamento, e NÃO depende de
// Asaas/pagamentos/faturas.
//
// Decisões de produto (frente #7):
//  - Conta como "vaga ocupada" quem é motorista utilizável:
//      usuarios.tipo='motorista' AND usuarios.status='ativo'
//      AND motoristas.status_cadastro IN ('pendente','aprovado').
//  - Pendente e aprovado CONTAM; bloqueado NÃO conta; hard-deleted não existe.
//  - Admin/proprietário/super-admin não são tipo='motorista' → nunca contam.
//  - limite_motoristas = null (ou empresa sem plano) → ILIMITADO (fail-open:
//    nunca bloqueia criação por falta de dado de plano; o sistema é operacional).

// Estados de motoristas.status_cadastro que ocupam vaga.
const STATUS_CADASTRO_UTILIZAVEL = ['pendente', 'aprovado'];

// Mensagem exata levantada pelo trigger legado trg_check_motorista_limit
// (sql/01_init.sql): RAISE EXCEPTION 'Limite de motoristas do plano atingido (%)'.
const TRIGGER_LIMITE_SNIPPET = 'limite de motoristas do plano atingido';

// Conta motoristas utilizáveis da empresa. Reusa o padrão de embed-filter
// motoristas⋈usuarios já comprovado em adminController.getPendentes/getAllMotoristas.
// Lança em caso de erro de consulta (o chamador decide como tratar — fail-open).
async function contarMotoristasUtilizaveis(supabase, empresaId) {
  const { count, error } = await supabase
    .from('motoristas')
    .select('id, usuarios!inner(status, tipo, empresa_id)', { count: 'exact', head: true })
    .eq('usuarios.empresa_id', empresaId)
    .eq('usuarios.tipo', 'motorista')
    .eq('usuarios.status', 'ativo')
    .in('status_cadastro', STATUS_CADASTRO_UTILIZAVEL);

  if (error) {
    const e = new Error('Erro ao contar motoristas utilizáveis.');
    e.cause = error;
    throw e;
  }
  return count || 0;
}

// Carrega o limite e o nome do plano da empresa (somente leitura de plano).
// Retorna { encontrada, semPlano, limite, planoAtual }. limite=null => ilimitado.
async function carregarLimiteMotoristas(supabase, empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('plano_id, planos(nome, limite_motoristas)')
    .eq('id', empresaId)
    .maybeSingle();

  if (error) {
    const e = new Error('Erro ao carregar o limite do plano.');
    e.cause = error;
    throw e;
  }
  if (!data) {
    return { encontrada: false, semPlano: true, limite: null, planoAtual: null };
  }
  const plano = Array.isArray(data.planos) ? (data.planos[0] || null) : (data.planos || null);
  const semPlano = !data.plano_id || !plano;
  return {
    encontrada: true,
    semPlano,
    limite: plano && plano.limite_motoristas !== undefined ? plano.limite_motoristas : null,
    planoAtual: plano ? plano.nome ?? null : null,
  };
}

// Avalia se a empresa pode receber MAIS um motorista.
// Retorna { ok, ilimitado, limite, totalAtual, planoAtual }.
//  - ilimitado (limite null / empresa sem plano) → ok:true, não conta.
//  - caso contrário → ok = (totalAtual < limite).
// Lança se alguma consulta falhar (o chamador aplica fail-open e mantém o
// trigger legado como backstop — nunca bloqueia por erro de infra da trava).
async function avaliarLimiteMotoristas(supabase, empresaId) {
  const info = await carregarLimiteMotoristas(supabase, empresaId);

  if (info.limite === null || info.limite === undefined) {
    return {
      ok: true,
      ilimitado: true,
      limite: null,
      totalAtual: null,
      planoAtual: info.planoAtual,
    };
  }

  const totalAtual = await contarMotoristasUtilizaveis(supabase, empresaId);
  const limite = Number(info.limite);
  return {
    ok: totalAtual < limite,
    ilimitado: false,
    limite,
    totalAtual,
    planoAtual: info.planoAtual,
  };
}

// Monta o payload 409 amigável (contrato fixo da frente #7).
function montarErroLimiteMotoristas({ limite, totalAtual, planoAtual }) {
  const nome = planoAtual || 'atual';
  const usados = totalAtual != null ? totalAtual : limite;
  return {
    limiteMotoristasAtingido: true,
    limite,
    totalAtual: usados,
    planoAtual: planoAtual || null,
    message: `Seu plano ${nome} permite ${limite} motorista(s) e você já utiliza ${usados}. Faça upgrade do plano para adicionar mais motoristas.`,
  };
}

// Reconhece o erro do trigger legado (Postgres) para mapeá-lo a 409 amigável
// em vez de deixar virar 500 genérico. Tolerante a variações de formatação.
function ehErroTriggerLimiteMotoristas(err) {
  if (!err) return false;
  const alvo = `${err.message || ''} ${err.hint || ''} ${err.details || ''}`.toLowerCase();
  return alvo.includes(TRIGGER_LIMITE_SNIPPET);
}

module.exports = {
  STATUS_CADASTRO_UTILIZAVEL,
  contarMotoristasUtilizaveis,
  carregarLimiteMotoristas,
  avaliarLimiteMotoristas,
  montarErroLimiteMotoristas,
  ehErroTriggerLimiteMotoristas,
};
