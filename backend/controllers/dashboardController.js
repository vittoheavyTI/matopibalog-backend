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

    // [PR2A] Mapa motorista_id → tipo de empresa (autonomo|transportadora).
    // Usado SÓ para alimentar os campos novos segmentados; não afeta o cálculo antigo.
    // Filtra pela coluna `id` (não `motorista_id`), por isso não usa comFiltroEmpresa.
    // Fallback de lista vazia: UUID impossível (não usar string vazia em coluna UUID).
    const UUID_IMPOSSIVEL = '00000000-0000-0000-0000-000000000000';

    // [PR2A] Mesmo escopo do comFiltroEmpresa, mas com fallback de UUID impossível
    // (coluna motorista_id é UUID). Usado SÓ nas queries novas deste PR.
    const comFiltroEmpresaUuid = (query) => {
      if (idsPermitidos === null) return query;
      return query.in('motorista_id', idsPermitidos.length ? idsPermitidos : [UUID_IMPOSSIVEL]);
    };

    let motTipoQuery = supabase.from('motoristas').select('id, empresas!left(tipo)');
    if (idsPermitidos !== null) {
      motTipoQuery = motTipoQuery.in('id', idsPermitidos.length ? idsPermitidos : [UUID_IMPOSSIVEL]);
    }

    // Todas as consultas abaixo dependem apenas de `idsPermitidos` (já resolvido acima) e
    // NÃO uma da outra. Antes eram ~10 awaits sequenciais (latência somada de 10 round-trips
    // ao Supabase). Agora vão em um único Promise.all → tempo ≈ o da consulta mais lenta.
    // Filtros, selects, escopo de empresa, cálculos e shape da resposta seguem idênticos.
    // Cada query supabase-js resolve para { data, error }; os erros são checados logo após,
    // na mesma ordem, preservando o "throw na falha" → catch → 500.
    const [
      { data: motsTipoRaw, error: eMotsTipo },
      { data: fretesRaw, error: eFretes },
      { data: canceladosRaw, error: eCancelados },
      { data: despesasRaw, error: eDespesas },
      { data: abastecimentosOwnerRaw, error: eAbastOwner },
      { data: allAbastecimentosRaw, error: eAllAbast },
      { data: valesRaw, error: eVales },
      { data: despesasMotRaw, error: eDespesasMot },
      { data: abastMotRaw, error: eAbastMot },
      { data: valesMotRaw, error: eValesMot }
    ] = await Promise.all([
      motTipoQuery,
      // 1. Todos os fretes do período (finalizados)
      comFiltroEmpresa(supabase.from('fretes')
        .select('*, motoristas(usuarios(nome), percentual_comissao)')
        .eq('status', 'finalizado')
        .gte('data', dataInicio)
        .lte('data', dataFim))
        .order('data', { ascending: false }),
      // [PR-C2] Conjunto de fretes CANCELADOS no mesmo escopo (empresa/motoristas), SEM filtro de
      // data: um lançamento do período pode estar vinculado a um frete cancelado de outro mês.
      // Lançamentos vinculados a esses fretes ficam FORA de todas as somas; soltos (sem frete_id)
      // são preservados. Os fretes cancelados em si já estão fora (fretes acima filtra 'finalizado').
      comFiltroEmpresa(supabase.from('fretes').select('id').eq('status', 'cancelado')),
      // 2. Deduções e abastecimentos FINALIZADOS (pagos pelo proprietário)
      comFiltroEmpresa(supabase.from('despesas').select('valor, motorista_id, frete_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      comFiltroEmpresa(supabase.from('abastecimentos').select('valor_total, motorista_id, frete_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      comFiltroEmpresa(supabase.from('abastecimentos').select('litros, motorista_id, frete_id').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      comFiltroEmpresa(supabase.from('vales').select('valor, motorista_id, frete_id').eq('quem_pagou', 'proprietario').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      // [PR2A] Lançamentos pagos pelo MOTORISTA — usados SÓ para gasto do autônomo.
      // Não entram em nenhum campo antigo nem em deducoes_vinculado.
      comFiltroEmpresaUuid(supabase.from('despesas').select('valor, motorista_id, frete_id').eq('quem_pagou', 'motorista').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      comFiltroEmpresaUuid(supabase.from('abastecimentos').select('valor_total, motorista_id, frete_id').eq('quem_pagou', 'motorista').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim)),
      comFiltroEmpresaUuid(supabase.from('vales').select('valor, motorista_id, frete_id').eq('quem_pagou', 'motorista').in('status', ['aprovado', 'finalizado']).gte('data', dataInicio).lte('data', dataFim))
    ]);

    // Checagem de erros na mesma ordem das queries (preserva o "throw na 1ª falha" → 500).
    if (eMotsTipo) throw eMotsTipo;
    if (eFretes) throw eFretes;
    if (eCancelados) throw eCancelados;
    if (eDespesas) throw eDespesas;
    if (eAbastOwner) throw eAbastOwner;
    if (eAllAbast) throw eAllAbast;
    if (eVales) throw eVales;
    if (eDespesasMot) throw eDespesasMot;
    if (eAbastMot) throw eAbastMot;
    if (eValesMot) throw eValesMot;

    const tipoDe = {};
    (motsTipoRaw || []).forEach(m => {
      const t = Array.isArray(m.empresas) ? m.empresas[0]?.tipo : m.empresas?.tipo;
      tipoDe[m.id] = t || null;
    });
    const isAuto = (id) => tipoDe[id] === 'autonomo';

    const fretesCanceladosIds = new Set((canceladosRaw || []).map(f => f.id));
    const ehDeFreteCancelado = (item) => {
      const fid = item.frete_id;
      if (fid === null || fid === undefined || fid === '') return false; // sem frete_id → preserva
      return fretesCanceladosIds.has(fid);
    };
    const naoCancelado = (item) => !ehDeFreteCancelado(item);

    // Garantir arrays nunca nulos.
    // [PR-C2] Lançamentos vinculados a fretes cancelados são removidos AQUI (uma vez), antes de
    // qualquer agregação — os pontos de consumo/somas abaixo permanecem intactos. Lançamentos sem
    // frete_id passam pelo filtro (naoCancelado retorna true). `fretes` não é filtrado: já vem só
    // com status 'finalizado'.
    const fretes = fretesRaw || [];
    const despesas = (despesasRaw || []).filter(naoCancelado);
    const abastecimentosOwner = (abastecimentosOwnerRaw || []).filter(naoCancelado);
    const allAbastecimentos = (allAbastecimentosRaw || []).filter(naoCancelado);
    const vales = (valesRaw || []).filter(naoCancelado);
    const despesasMot = (despesasMotRaw || []).filter(naoCancelado);
    const abastMot = (abastMotRaw || []).filter(naoCancelado);
    const valesMot = (valesMotRaw || []).filter(naoCancelado);

    // Cálculos Globais
    let totalFretes = 0;
    let totalComissoes = 0;
    let totalDeducoes = 0;
    // [PR2A] acumuladores segmentados (paralelos — não afetam os antigos acima)
    let comissoesVinc = 0;
    let deducoesVinc = 0;
    let faturamentoAuto = 0;
    let gastosAuto = 0;
    const motoristaStats = {};

    fretes.forEach(f => {
      const valor = parseFloat(f.valor_frete);
      const comissaoPercent = f.motoristas.percentual_comissao;
      const comissao = valor * (comissaoPercent / 100);
      const km = (f.km_final && f.km_inicial) ? (f.km_final - f.km_inicial) : 0;
      const auto = isAuto(f.motorista_id); // [PR2A]

      totalFretes += valor;
      totalComissoes += comissao;
      // [PR2A] segmentado: autônomo soma faturamento; vinculado soma comissão
      if (auto) faturamentoAuto += valor; else comissoesVinc += comissao;

      if (!motoristaStats[f.motorista_id]) {
        motoristaStats[f.motorista_id] = {
          nome: f.motoristas.usuarios.nome,
          placa: f.placa,
          total_fretes: 0,
          comissao: 0,
          deducoes: 0,
          total_km: 0,
          total_litros: 0,
          ultima_rota: `${f.origem} > ${f.destino}`,
          // [PR2A] campos novos por motorista (não trocam os antigos)
          empresa_tipo: auto ? 'autonomo' : (tipoDe[f.motorista_id] || 'transportadora'),
          is_autonomo: auto,
          comissao_vinculado: 0,
          deducoes_vinculado: 0,
          faturamento_autonomo: 0,
          gastos_autonomo: 0
        };
      }
      motoristaStats[f.motorista_id].total_fretes += valor;
      motoristaStats[f.motorista_id].comissao += comissao;
      motoristaStats[f.motorista_id].total_km += km;
      // [PR2A]
      if (auto) motoristaStats[f.motorista_id].faturamento_autonomo += valor;
      else      motoristaStats[f.motorista_id].comissao_vinculado   += comissao;
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
      totalDeducoes += valor;                                   // ANTIGO — intacto
      if (motoristaStats[d.motorista_id]) {
        motoristaStats[d.motorista_id].deducoes += valor;       // ANTIGO — intacto
      }
      // [PR2A] segmentado: autônomo → gasto; vinculado → dedução vinculada.
      // Valor separado e seguro só para os campos novos (evita NaN; não toca os antigos).
      const valorSegmentado = Number.parseFloat(d.valor ?? d.valor_total ?? 0);
      if (!Number.isFinite(valorSegmentado)) return;
      // Campos novos do autônomo mantêm a base de fretes finalizados:
      // gastosAuto só soma se o autônomo tiver entrada em motoristaStats (frete finalizado).
      const stats = motoristaStats[d.motorista_id];
      if (isAuto(d.motorista_id)) {
        if (stats) {
          gastosAuto += valorSegmentado;
          stats.gastos_autonomo += valorSegmentado;
        }
      } else if (stats) {
        // [PR2A.1] vinculado também mantém a base de fretes finalizados (exige stats),
        // alinhando deducoes_vinculados a total_comissoes_vinculados. Não toca os antigos.
        deducoesVinc += valorSegmentado;
        stats.deducoes_vinculado += valorSegmentado;
      }
    });

    // [PR2A] Lançamentos pagos pelo próprio motorista — contam SÓ como gasto do autônomo
    // E SÓ para autônomos com frete finalizado no período (presentes em motoristaStats),
    // mantendo a base coerente com faturamento_autonomos. Parse seguro (evita NaN).
    [...despesasMot, ...abastMot, ...valesMot].forEach(d => {
      const stats = motoristaStats[d.motorista_id];
      if (!isAuto(d.motorista_id) || !stats) return; // vinculado ou sem frete finalizado: ignora
      const valor = Number.parseFloat(d.valor ?? d.valor_total ?? 0);
      if (!Number.isFinite(valor)) return;
      gastosAuto += valor;
      stats.gastos_autonomo += valor;
    });

    const fretes_por_motorista = Object.values(motoristaStats).map(m => {
      const media = m.total_litros > 0 ? (m.total_km / m.total_litros).toFixed(2) : '0.00';
      return {
        ...m,
        media_consumo: media,
        saldo: m.comissao - m.deducoes, // ANTIGO — preservado
        // [PR2A] novos: saldo vinculado e resultado autônomo
        saldo_vinculado: m.comissao_vinculado - m.deducoes_vinculado,
        resultado_autonomo: m.faturamento_autonomo - m.gastos_autonomo
      };
    });

    // [PR2A] escopo (quantos vinculados/autônomos no recorte atual)
    const tipos = Object.values(tipoDe);
    const scope = {
      tem_vinculados: tipos.some(t => t !== 'autonomo'),
      tem_autonomos:  tipos.some(t => t === 'autonomo'),
      qtd_vinculados: tipos.filter(t => t !== 'autonomo').length,
      qtd_autonomos:  tipos.filter(t => t === 'autonomo').length
    };

    res.status(200).json({
      total_fretes: totalFretes,
      total_comissoes: totalComissoes,
      total_deducoes: totalDeducoes,
      saldo_a_pagar: totalComissoes - totalDeducoes,
      fretes_por_motorista,
      // [PR2A] segmentado — vinculados
      total_comissoes_vinculados: comissoesVinc,
      deducoes_vinculados: deducoesVinc,
      saldo_a_pagar_vinculados: comissoesVinc - deducoesVinc,
      // [PR2A] segmentado — autônomos
      faturamento_autonomos: faturamentoAuto,
      gastos_autonomos: gastosAuto,
      resultado_autonomos: faturamentoAuto - gastosAuto,
      // [PR2A] escopo
      scope
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao gerar resumo do dashboard.' });
  }
};
