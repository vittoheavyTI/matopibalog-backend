const supabase = require('../config/supabase');

exports.getFichaViagem = async (req, res) => {
  const { motorista_id, fretes_ids } = req.query;

  if (!motorista_id || !fretes_ids) {
    return res.status(400).json({ message: 'motorista_id e fretes_ids são obrigatórios.' });
  }

  const idsArray = fretes_ids.split(',').filter(Boolean);

  try {
    // 1. Dados do Motorista
    const { data: motorista, error: motError } = await supabase
      .from('motoristas')
      .select('*, usuarios(nome)')
      .eq('id', motorista_id)
      .single();

    if (motError || !motorista) {
      return res.status(404).json({ message: 'Motorista não encontrado.' });
    }

    // 2. Fretes Selecionados
    const { data: fretesRaw, error: fretesError } = await supabase
      .from('fretes')
      .select('*')
      .in('id', idsArray);

    if (fretesError) throw fretesError;

    // 3. Movimentações vinculadas
    const { data: abastecimentosRaw, error: eAbast } = await supabase
      .from('abastecimentos')
      .select('*')
      .in('frete_id', idsArray);

    if (eAbast) throw eAbast;

    const { data: despesasRaw, error: eDespesas } = await supabase
      .from('despesas')
      .select('*')
      .in('frete_id', idsArray);

    if (eDespesas) throw eDespesas;

    const { data: valesRaw, error: eVales } = await supabase
      .from('vales')
      .select('*')
      .in('frete_id', idsArray);

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

    const comissao = freteBruto * ((motorista.percentual_comissao || 0) / 100);

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
