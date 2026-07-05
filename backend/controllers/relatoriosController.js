const supabase = require('../config/supabase');
const { calcularComissao } = require('../utils/comissao');

exports.getFichaViagem = async (req, res) => {
  const { motorista_id, fretes_ids } = req.query;

  if (!motorista_id || !fretes_ids) {
    return res.status(400).json({ message: 'motorista_id e fretes_ids são obrigatórios.' });
  }

  const idsArray = fretes_ids.split(',').filter(Boolean);

  try {
    // Validar que o motorista pertence à empresa do admin (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', motorista_id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    }

    // 1. Dados do Motorista
    const { data: motorista, error: motError } = await supabase
      .from('motoristas')
      .select('*, usuarios(nome), empresas!left(tipo)')
      .eq('id', motorista_id)
      .single();

    if (motError || !motorista) {
      return res.status(404).json({ message: 'Motorista não encontrado.' });
    }

    // 2. Fretes Selecionados
    const { data: fretesRaw, error: fretesError } = await supabase
      .from('fretes')
      .select('*')
      .in('id', idsArray)
      .eq('motorista_id', motorista_id);

    if (fretesError) throw fretesError;

    // 3. Movimentações vinculadas
    const { data: abastecimentosRaw, error: eAbast } = await supabase
      .from('abastecimentos')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

    if (eAbast) throw eAbast;

    const { data: despesasRaw, error: eDespesas } = await supabase
      .from('despesas')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

    if (eDespesas) throw eDespesas;

    const { data: valesRaw, error: eVales } = await supabase
      .from('vales')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

    if (eVales) throw eVales;

    // Garantir arrays nunca nulos
    const fretes = fretesRaw || [];
    const abastecimentos = abastecimentosRaw || [];
    const despesas = despesasRaw || [];
    const vales = valesRaw || [];

    // Totais
    let freteBruto = 0;
    let deducoes = 0;

    fretes.forEach(f => {
      freteBruto += parseFloat(f.valor_frete) || 0;
    });

    // Comissão só para vinculado (empresa.tipo conhecido e ≠ 'autonomo'). Autônomo e
    // tipo desconhecido → 0 (nunca assume percentual). `percentual` no retorno mantém o
    // valor cadastral; apenas o cálculo (comissao/saldo_liquido) respeita a regra.
    const empresaTipo = Array.isArray(motorista.empresas)
      ? motorista.empresas[0]?.tipo
      : motorista.empresas?.tipo;
    const comissao = calcularComissao(freteBruto, motorista.percentual_comissao, empresaTipo);

    [...abastecimentos, ...despesas, ...vales].forEach(d => {
      if (d.quem_pagou === 'proprietario') {
        deducoes += parseFloat(d.valor || d.valor_total || 0);
      }
    });

    res.status(200).json({
      motorista: {
        nome: motorista.usuarios?.nome || 'Não informado',
        placa: motorista.placa_veiculo,
        percentual: motorista.percentual_comissao
      },
      fretes,
      abastecimentos,
      despesas,
      vales,
      resumo: {
        frete_bruto: freteBruto,
        comissao,
        deducoes,
        saldo_liquido: comissao - deducoes
      }
    });
  } catch (error) {
    console.error('Erro ao consolidar ficha de viagem:', error);
    res.status(500).json({ message: 'Erro ao consolidar ficha de viagem.' });
  }
};
