// Domínio PURO de entitlements e projeção pública do catálogo (sem I/O).
//
// Regras centrais (macrofrente Catálogo de Funcionalidades):
//   - Separar estado TÉCNICO (funcionalidade.status_ciclo_vida) do ENTITLEMENT
//     comercial (plano_funcionalidades.disponibilidade) e da VISIBILIDADE.
//   - NUNCA exibir como disponível/incluída algo que não está tecnicamente
//     implementado (status != 'disponivel'). Futuro só aparece como "Em breve",
//     e apenas quando visivel_publicamente=true.
//   - Backend é a autoridade: o frontend pode ocultar/desabilitar, mas a decisão
//     de acesso vem de resolverEntitlement.

const ROTULO = Object.freeze({
  INCLUIDO: 'Incluído',
  ADICIONAL: 'Adicional',
  EM_BREVE: 'Em breve',
  SOB_CONSULTA: 'Sob consulta',
});

// Estado técnico que autoriza exibir como REALMENTE disponível.
function tecnicamenteDisponivel(func) {
  return func && func.status_ciclo_vida === 'disponivel' && func.ativo === true;
}

// Rótulo público de uma funcionalidade em um plano. Retorna null quando NÃO deve
// aparecer no card (indisponível, oculta, ou futura sem visibilidade pública).
function rotuloPublico({ funcionalidade, planoFunc }) {
  if (!funcionalidade || !planoFunc) return null;
  if (funcionalidade.ativo !== true) return null;
  if (funcionalidade.visivel_publicamente !== true) return null;
  if (planoFunc.exibir_no_card === false) return null;

  const disp = planoFunc.disponibilidade;
  if (disp === 'indisponivel') return null;

  // Guarda dura: futuro/não-implementado NUNCA vira Incluído/Adicional.
  if (!tecnicamenteDisponivel(funcionalidade)) {
    // Só pode aparecer como "Em breve" (e só porque visivel_publicamente já foi checado).
    if (disp === 'em_breve' || funcionalidade.status_ciclo_vida === 'em_breve') return ROTULO.EM_BREVE;
    return null;
  }

  switch (disp) {
    case 'incluida': return ROTULO.INCLUIDO;
    case 'opcional_paga': return ROTULO.ADICIONAL;
    case 'sob_negociacao': return ROTULO.SOB_CONSULTA;
    case 'em_breve': return ROTULO.EM_BREVE;
    default: return null;
  }
}

// Projeta a lista de funcionalidades do card público de um plano, já ordenada e
// rotulada, filtrando o que não deve aparecer.
//   funcionalidades: [{ id, codigo, nome, status_ciclo_vida, ativo, visivel_publicamente, ordem_exibicao, ... }]
//   planoFuncs:      [{ funcionalidade_id, disponibilidade, exibir_no_card, destaque, texto_publico, ordem_exibicao }]
function projetarFuncionalidadesDoCard({ funcionalidades = [], planoFuncs = [] }) {
  const porId = new Map(funcionalidades.map((f) => [f.id, f]));
  const itens = [];
  for (const pf of planoFuncs) {
    const func = porId.get(pf.funcionalidade_id);
    const rotulo = rotuloPublico({ funcionalidade: func, planoFunc: pf });
    if (!rotulo) continue;
    itens.push({
      codigo: func.codigo,
      texto: pf.texto_publico || func.nome,
      rotulo,
      destaque: pf.destaque === true,
      ordem: pf.ordem_exibicao != null ? pf.ordem_exibicao : (func.ordem_exibicao || 0),
    });
  }
  itens.sort((a, b) => (a.ordem - b.ordem) || a.texto.localeCompare(b.texto));
  return itens.map(({ ordem, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

// Resolve o entitlement de UMA funcionalidade para uma empresa/usuário.
// Ordem (Seção 5): kill switch → estado técnico → plano → override empresa →
// limites → papel. Retorna decisão canônica. PURO: recebe tudo carregado.
//   killSwitchGlobal: true desliga a feature globalmente (segurança).
//   funcionalidade:   linha de funcionalidades (status técnico).
//   planoFunc:        vínculo do plano da empresa (disponibilidade/limite) | null.
//   empresaFunc:      override da empresa (status/origem/vigência/quantidade) | null.
//   consumo:          uso atual (para checar limite) | 0.
//   papelPermitido:   se o papel do usuário permite (default true).
//   agora:            Date para checar vigência do override.
function resolverEntitlement({
  codigo,
  killSwitchGlobal = false,
  funcionalidade = null,
  planoFunc = null,
  empresaFunc = null,
  consumo = 0,
  papelPermitido = true,
  agora = new Date(),
} = {}) {
  const nega = (motivo, extra = {}) => ({
    codigo, permitido: false, origem: null, disponibilidade: null,
    limite: null, consumo, motivo, proxima_acao: extra.proxima_acao || null, ...extra,
  });

  if (killSwitchGlobal) return nega('desligada_globalmente');
  if (!funcionalidade || funcionalidade.ativo !== true) return nega('funcionalidade_inativa');
  if (funcionalidade.status_ciclo_vida !== 'disponivel') {
    return nega('nao_implementada', { proxima_acao: 'aguardar_disponibilidade' });
  }

  // Override da empresa tem precedência sobre o plano (adicional/cortesia/negociação).
  const overrideVigente = empresaFunc && empresaFunc.status === 'ativa'
    && (!empresaFunc.vigencia_inicio || new Date(empresaFunc.vigencia_inicio) <= agora)
    && (!empresaFunc.vigencia_fim || new Date(empresaFunc.vigencia_fim) >= agora);

  let origem = null;
  let disponibilidade = null;
  let limite = null;

  if (overrideVigente) {
    origem = empresaFunc.origem || 'adicional';
    disponibilidade = 'incluida';
    limite = empresaFunc.quantidade != null ? empresaFunc.quantidade : null;
  } else if (planoFunc && planoFunc.disponibilidade === 'incluida') {
    origem = 'plano';
    disponibilidade = 'incluida';
    limite = planoFunc.limite_incluso != null ? planoFunc.limite_incluso : null;
  } else if (planoFunc && planoFunc.disponibilidade === 'opcional_paga') {
    return nega('requer_adicional', { disponibilidade: 'opcional_paga', proxima_acao: 'contratar_adicional' });
  } else if (planoFunc && planoFunc.disponibilidade === 'sob_negociacao') {
    return nega('sob_negociacao', { disponibilidade: 'sob_negociacao', proxima_acao: 'falar_comercial' });
  } else {
    return nega('nao_incluida_no_plano', { proxima_acao: 'ver_planos' });
  }

  if (!papelPermitido) return nega('sem_permissao_do_papel', { origem, disponibilidade, limite });

  if (limite != null && consumo >= limite) {
    return { codigo, permitido: false, origem, disponibilidade, limite, consumo, motivo: 'limite_atingido', proxima_acao: 'aumentar_limite' };
  }

  return { codigo, permitido: true, origem, disponibilidade, limite, consumo, motivo: null, proxima_acao: null };
}

module.exports = {
  ROTULO,
  tecnicamenteDisponivel,
  rotuloPublico,
  projetarFuncionalidadesDoCard,
  resolverEntitlement,
};
