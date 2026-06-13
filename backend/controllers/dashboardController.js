const supabase = require('../config/supabase');

exports.getSummary = async (req, res) => {
  const { mes, ano } = req.query;
  const mesInt = parseInt(mes);
  const anoInt = parseInt(ano);

  if (!mes || !ano) return res.status(400).json({ message: 'Mês e Ano são obrigatórios.' });

  try {
    const dataInicio = new Date(anoInt, mesInt - 1, 1).toISOString();
    const dataFim = new Date(anoInt, mesInt, 0, 23, 59, 59).toISOString();

    // Calcular escopo de empresa
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;

    let idsPermitidos = null; // null = super-admin global, sem filtro
    if (empresaAlvo) {
      const { data: uids, error: uidsError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('empresa_id', empresaAlvo)
        .eq('tipo', 'motorista');
      if (uidsError) throw uidsError;
      idsPermitidos = uids.map(u => u.id);
    }

    // null → sem filtro | [ids] → filtra | [] → [''] para retornar zero sem vazar
    const comFiltroEmpresa = (query) => {
      if (idsPermitidos === null) return query;
      return query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    };

    // 1. Buscar todos os fretes do período
    const { data: fretesRaw, error: eFretes } = await comFiltroEmpresa(supabase.from('fretes')
      .select('*, motoristas(usuarios(nome), percentual_comissao)')
      .eq('status', 'finalizado')
      .gte('data', dataInicio)
      .lte('data', dataFim))
      .order('data', { ascending: false });
    if (eFretes) throw eFretes;

    // 2. Buscar deduções e abastecimentos FINALIZADOS
    const { data: despesasRaw, error: eDespesas } = await comFiltroEmpresa(supabase.from('despesas').select('valor, motorista_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim));
    if (eDespesas) throw eDespesas;

    const { data: abastecimentosOwnerRaw, error: eAbastOwner } = await comFiltroEmpresa(supabase.from('abastecimentos').select('valor_total, motorista_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim));
    if (eAbastOwner) throw eAbastOwner;

    const { data: allAbastecimentosRaw, error: eAllAbast } = await comFiltroEmpresa(supabase.from('abastecimentos').select('litros, motorista_id').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim));
    if (eAllAbast) throw eAllAbast;

    const { data: valesRaw, error: eVales } = await comFiltroEmpresa(supabase.from('vales').select('valor, motorista_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim));
    if (eVales) throw eVales;

    // Garantir arrays nunca nulos
    const fretes = fretesRaw || [];
    const despesas = despesasRaw || [];
    const abastecimentosOwner = abastecimentosOwnerRaw || [];
    const allAbastecimentos = allAbastecimentosRaw || [];
    const vales = valesRaw || [];

    // Cálculos Globais
    let totalFretes = 0;
    let totalComissoes = 0;
    let totalDeducoes = 0;
    const motoristaStats = {};

    fretes.forEach(f => {
      const valor = parseFloat(f.valor_frete);
      const comissaoPercent = f.motoristas.percentual_comissao;
      const comissao = valor * (comissaoPercent / 100);
      const km = (f.km_final && f.km_inicial) ? (f.km_final - f.km_inicial) : 0;
      
      totalFretes += valor;
      totalComissoes += comissao;

      if (!motoristaStats[f.motorista_id]) {
        motoristaStats[f.motorista_id] = { 
          nome: f.motoristas.usuarios.nome, 
          placa: f.placa, 
          total_fretes: 0, 
          comissao: 0, 
          deducoes: 0,
          total_km: 0,
          total_litros: 0,
          ultima_rota: `${f.origem} > ${f.destino}`
        };
      }
      motoristaStats[f.motorista_id].total_fretes += valor;
      motoristaStats[f.motorista_id].comissao += comissao;
      motoristaStats[f.motorista_id].total_km += km;
    });

    // Somar litros (independente de quem pagou para cálculo de média real)
    allAbastecimentos.forEach(a => {
      if (motoristaStats[a.motorista_id]) {
        motoristaStats[a.motorista_id].total_litros += parseFloat(a.litros || 0);
      }
    });

    // Somar deduções (apenas proprietário)
    [...despesas, ...abastecimentosOwner, ...vales].forEach(d => {
      const valor = parseFloat(d.valor || d.valor_total);
      totalDeducoes += valor;
      if (motoristaStats[d.motorista_id]) {
        motoristaStats[d.motorista_id].deducoes += valor;
      }
    });

    const fretes_por_motorista = Object.values(motoristaStats).map(m => {
      const media = m.total_litros > 0 ? (m.total_km / m.total_litros).toFixed(2) : '0.00';
      return {
        ...m,
        media_consumo: media,
        saldo: m.comissao - m.deducoes
      };
    });

    res.status(200).json({
      total_fretes: totalFretes,
      total_comissoes: totalComissoes,
      total_deducoes: totalDeducoes,
      saldo_a_pagar: totalComissoes - totalDeducoes,
      fretes_por_motorista
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao gerar resumo do dashboard.' });
  }
};
