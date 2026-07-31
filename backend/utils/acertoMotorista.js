const { calcularComissao } = require('./comissao');

const STATUS_LANCAMENTO_EFETIVADO = new Set(['aprovado', 'finalizado']);
const STATUS_FRETE_FINALIZADO = 'finalizado';
const TIPO_ITEM = {
  CREDITO: 'credito',
  DEBITO: 'debito',
  INFORMATIVO: 'informativo',
  INCOMPLETO: 'incompleto',
};

const arred2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const statusDe = (v) => (v == null ? '' : String(v));
const efetivado = (l) => STATUS_LANCAMENTO_EFETIVADO.has(statusDe(l.status));
const dataItem = (v) => (v ? String(v).slice(0, 10) : null);

function criarResumoVazio() {
  return {
    total_creditos: 0,
    total_debitos: 0,
    total_informativo: 0,
    saldo_acerto: 0,
    motoristas: 0,
    viagens_consideradas: 0,
    itens_incompletos: 0,
  };
}

function interpretarSaldo(saldo) {
  if (saldo > 0) return 'A pagar ao motorista';
  if (saldo < 0) return 'Saldo a compensar';
  return 'Sem saldo';
}

function itemBase({ data, frete, natureza, descricao, origem, origemId, quemPagou, status, valor, classificacao, sinal, alerta }) {
  return {
    data: dataItem(data || frete?.data),
    frete_id: frete?.id || null,
    rota: frete ? [frete.origem, frete.destino].filter(Boolean).join(' → ') : null,
    natureza,
    descricao,
    origem,
    origem_id: origemId || null,
    quem_pagou: quemPagou || null,
    status: status || null,
    valor: arred2(valor),
    classificacao,
    sinal,
    alerta: alerta || null,
  };
}

function calcularAcertoMotoristas({ fretes = [], despesas = [], abastecimentos = [], vales = [] } = {}) {
  const resumo = criarResumoVazio();
  const porMotorista = new Map();
  const fretesPorId = new Map();

  for (const frete of fretes || []) {
    if (!frete || statusDe(frete.status) !== STATUS_FRETE_FINALIZADO) continue;
    fretesPorId.set(frete.id, frete);
    const motoristaId = frete.motorista_id;
    if (!porMotorista.has(motoristaId)) {
      const mot = frete.motoristas || {};
      const empresaTipo = Array.isArray(mot.empresas) ? mot.empresas[0]?.tipo : mot.empresas?.tipo;
      porMotorista.set(motoristaId, {
        motorista_id: motoristaId,
        motorista_nome: mot.usuarios?.nome || 'Não informado',
        empresa_id: frete.empresa_id || null,
        empresa_nome: mot.empresas?.nome || null,
        empresa_tipo: empresaTipo || null,
        resumo: criarResumoVazio(),
        itens: [],
      });
    }

    const grupo = porMotorista.get(motoristaId);
    const mot = frete.motoristas || {};
    const empresaTipo = Array.isArray(mot.empresas) ? mot.empresas[0]?.tipo : mot.empresas?.tipo;
    const comissao = arred2(calcularComissao(num(frete.valor_frete), mot.percentual_comissao, empresaTipo));
    if (comissao > 0) {
      grupo.itens.push(itemBase({
        data: frete.data,
        frete,
        natureza: 'Comissão',
        descricao: `Comissão sobre frete finalizado (${num(mot.percentual_comissao)}%)`,
        origem: 'fretes',
        origemId: frete.id,
        quemPagou: 'empresa',
        status: frete.status,
        valor: comissao,
        classificacao: TIPO_ITEM.CREDITO,
        sinal: 'credito',
      }));
      grupo.resumo.total_creditos = arred2(grupo.resumo.total_creditos + comissao);
    }
    grupo.resumo.viagens_consideradas += 1;
  }

  const garantirGrupo = (motoristaId, linha) => {
    if (porMotorista.has(motoristaId)) return porMotorista.get(motoristaId);
    porMotorista.set(motoristaId, {
      motorista_id: motoristaId,
      motorista_nome: linha?.motoristas?.usuarios?.nome || 'Não informado',
      empresa_id: linha?.empresa_id || null,
      empresa_nome: null,
      empresa_tipo: null,
      resumo: criarResumoVazio(),
      itens: [],
    });
    return porMotorista.get(motoristaId);
  };

  const adicionarLancamento = (linha, cfg) => {
    if (!linha || !efetivado(linha)) return;
    const frete = fretesPorId.get(linha.frete_id);
    if (!frete) return;
    const grupo = garantirGrupo(linha.motorista_id, linha);
    const valor = arred2(num(cfg.valor(linha)));
    const quemPagou = linha.quem_pagou || null;
    let classificacao = TIPO_ITEM.INFORMATIVO;
    let sinal = 'informativo';
    let alerta = null;

    if (!quemPagou) {
      classificacao = TIPO_ITEM.INCOMPLETO;
      sinal = 'incompleto';
      alerta = 'Informações incompletas: responsável pelo pagamento ausente.';
      grupo.resumo.itens_incompletos += 1;
    } else if (cfg.origem === 'vales') {
      if (quemPagou === 'proprietario') {
        classificacao = TIPO_ITEM.DEBITO;
        sinal = 'debito';
      }
    } else if (quemPagou === 'motorista') {
      classificacao = TIPO_ITEM.CREDITO;
      sinal = 'credito';
    }

    grupo.itens.push(itemBase({
      data: linha.data,
      frete,
      natureza: cfg.natureza(linha),
      descricao: cfg.descricao(linha),
      origem: cfg.origem,
      origemId: linha.id,
      quemPagou,
      status: linha.status,
      valor,
      classificacao,
      sinal,
      alerta,
    }));

    if (classificacao === TIPO_ITEM.CREDITO) {
      grupo.resumo.total_creditos = arred2(grupo.resumo.total_creditos + valor);
    } else if (classificacao === TIPO_ITEM.DEBITO) {
      grupo.resumo.total_debitos = arred2(grupo.resumo.total_debitos + valor);
    } else if (classificacao === TIPO_ITEM.INFORMATIVO) {
      grupo.resumo.total_informativo = arred2(grupo.resumo.total_informativo + valor);
    }
  };

  for (const d of despesas || []) {
    adicionarLancamento(d, {
      origem: 'despesas',
      valor: (x) => x.valor,
      natureza: (x) => String(x.tipo || 'Despesa'),
      descricao: (x) => x.descricao || 'Despesa operacional',
    });
  }
  for (const a of abastecimentos || []) {
    adicionarLancamento(a, {
      origem: 'abastecimentos',
      valor: (x) => x.valor_total,
      natureza: () => 'Combustível',
      descricao: (x) => x.posto || 'Abastecimento',
    });
  }
  for (const v of vales || []) {
    adicionarLancamento(v, {
      origem: 'vales',
      valor: (x) => x.valor,
      natureza: () => 'Vale / adiantamento',
      descricao: (x) => x.descricao || x.posto || 'Vale / adiantamento',
    });
  }

  const motoristas = Array.from(porMotorista.values()).map((grupo) => {
    grupo.itens.sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
    grupo.resumo.saldo_acerto = arred2(grupo.resumo.total_creditos - grupo.resumo.total_debitos);
    grupo.resumo.situacao = interpretarSaldo(grupo.resumo.saldo_acerto);
    resumo.total_creditos = arred2(resumo.total_creditos + grupo.resumo.total_creditos);
    resumo.total_debitos = arred2(resumo.total_debitos + grupo.resumo.total_debitos);
    resumo.total_informativo = arred2(resumo.total_informativo + grupo.resumo.total_informativo);
    resumo.viagens_consideradas += grupo.resumo.viagens_consideradas;
    resumo.itens_incompletos += grupo.resumo.itens_incompletos;
    return grupo;
  }).sort((a, b) => a.motorista_nome.localeCompare(b.motorista_nome));

  resumo.motoristas = motoristas.length;
  resumo.saldo_acerto = arred2(resumo.total_creditos - resumo.total_debitos);
  resumo.situacao = interpretarSaldo(resumo.saldo_acerto);

  return {
    resumo,
    motoristas,
    regra: {
      formula: 'saldo_acerto = créditos_do_motorista - débitos_do_motorista',
      creditos: ['comissões de fretes finalizados', 'despesas e abastecimentos efetivados pagos pelo motorista'],
      debitos: ['vales e adiantamentos efetivados pagos pelo proprietário'],
      informativos: ['despesas e abastecimentos efetivados pagos pelo proprietário', 'receita do frete'],
      observacao: 'Acerto não representa rentabilidade, pagamento, quitação ou cobrança automática.',
    },
  };
}

module.exports = {
  calcularAcertoMotoristas,
  arred2,
  STATUS_LANCAMENTO_EFETIVADO,
};
