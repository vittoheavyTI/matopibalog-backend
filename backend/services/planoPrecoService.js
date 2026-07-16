// backend/services/planoPrecoService.js
// Frente #4 (Billing v2) — PR 2: regras PURAS de precificação de plano.
//
// Sem I/O: não toca banco, não fala com o Asaas, não importa supabase, não cria
// nada. Mesmo estilo testável de upgradeDomainService e utils/plano. Neste PR
// NINGUÉM importa este módulo — ele é ligado às rotas no PR 3.
//
// REGRA CENTRAL (decisão de produto — não reinterpretar):
//   `preco_mensal` é SEMPRE o valor final cobrado.
//     * modelo_cobranca='fixo'          → preco_mensal é o valor digitado;
//     * modelo_cobranca='por_motorista' → preco_mensal é DERIVADO como
//                                         preco_por_motorista × limite_motoristas.
//   O backend é a autoridade: em por_motorista o preco_mensal que vier do cliente
//   é IGNORADO e recalculado aqui.
//
// ARITMÉTICA EM CENTAVOS INTEIROS, sempre — e isto foi MEDIDO, não suposto.
// Varrendo todo unitário de R$ 0,01 a R$ 200,00 contra quantidades de 2 a 20,
// a multiplicação em float diverge do resultado exato em 80.040 de 380.000 casos
// (21%). Exemplos reais:
//     149.9 * 3 === 449.70000000000005   (149,90 é o preço do Plano Básico hoje)
//     0.07  * 3 === 0.21000000000000002
//     0.05  * 3 === 0.15000000000000002
// Uma divergência dessas viraria diferença de centavo entre faturas.valor e o
// `value` enviado ao Asaas. Em centavos inteiros o problema não existe.
// (Nota: casos como 99.9 * 10 acertam por sorte em float. Não dá para escolher
// os que dão certo — por isso a conta é sempre inteira.)
//
// Valor com mais de 2 casas decimais é REJEITADO, nunca arredondado: a coluna é
// numeric(10,2) e o Postgres arredondaria em silêncio, então a recusa precisa
// acontecer aqui, antes de chegar lá.
//
// FRONTEIRA COM O BANCO (ver migration 029): o banco garante o invariante
// ESTRUTURAL e permanente (plano por_motorista sempre tem unitário > 0 e
// quantidade >= 1). Aqui mora a POLÍTICA, que muda com o negócio e não deveria
// exigir migration: sentinela 999, tetos e casas decimais.

const MODELOS_COBRANCA = ['fixo', 'por_motorista'];
const MODELO_PADRAO = 'fixo';

// ─── Política (ajustável sem migration) ──────────────────────────────────────
// 999 é a sentinela de "ilimitado" gravada no Plano Enterprise. Multiplicar por
// ela geraria ~R$ 99.900,00 de cobrança. Ilimitado e por_motorista são
// incompatíveis por definição: não há multiplicador.
const SENTINELA_ILIMITADO = 999;
const LIMITE_MOTORISTAS_MAX = 200;
const VALOR_FINAL_MAX = 500000;
const VALOR_FINAL_MAX_CENTAVOS = VALOR_FINAL_MAX * 100;

function erro(campo, motivo, message) {
  return { ok: false, campo, motivo, message };
}

function formatarBRL(valor) {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Converte valor monetário para centavos INTEIROS.
// Aceita number ou string numérica (JSON de formulário costuma mandar string).
// Recusa qualquer coisa que não seja um número exato de centavos.
function paraCentavos(valor) {
  let n;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string' && valor.trim() !== '') n = Number(valor);
  else return { ok: false, motivo: 'nao_numerico' };

  if (!Number.isFinite(n)) return { ok: false, motivo: 'nao_numerico' };

  const centavos = n * 100;
  const inteiro = Math.round(centavos);
  // A tolerância existe só para o ruído binário de valores legítimos de 2 casas
  // (99.9 * 100 === 9990.000000000002, erro da ordem de 1e-12). Um valor de 3
  // casas cai a ~0.5 do inteiro (100.005 * 100 === 10000.499999999998) e é
  // recusado — dinheiro não se arredonda em silêncio.
  if (Math.abs(centavos - inteiro) > 1e-6) {
    return { ok: false, motivo: 'mais_de_2_casas' };
  }
  return { ok: true, centavos: inteiro };
}

// Ausente ('' / null / undefined) resolve como 'fixo'. Isso é o que mantém o
// payload atual do painel funcionando sem alteração quando o PR 3 entrar: ele
// não manda modelo_cobranca, e o plano continua fixo, como hoje.
function normalizarModelo(valor) {
  if (valor === undefined || valor === null || valor === '') return MODELO_PADRAO;
  return String(valor).trim();
}

function validarPrecoFixo(preco_mensal) {
  const c = paraCentavos(preco_mensal);
  if (!c.ok) {
    if (c.motivo === 'mais_de_2_casas') {
      return erro('preco_mensal', 'mais_de_2_casas', 'O preço mensal deve ter no máximo 2 casas decimais.');
    }
    return erro('preco_mensal', 'nao_numerico', 'Informe um preço mensal válido para o plano.');
  }
  // Preço 0 é legítimo: plano gratuito (asaasSubscriptionService trata como isento).
  if (c.centavos < 0) {
    return erro('preco_mensal', 'negativo', 'O preço mensal não pode ser negativo.');
  }
  return { ok: true, centavos: c.centavos };
}

function validarUnitario(preco_por_motorista) {
  const c = paraCentavos(preco_por_motorista);
  if (!c.ok) {
    if (c.motivo === 'mais_de_2_casas') {
      return erro('preco_por_motorista', 'mais_de_2_casas', 'O valor por motorista deve ter no máximo 2 casas decimais.');
    }
    return erro('preco_por_motorista', 'nao_numerico', 'Informe o valor por motorista.');
  }
  if (c.centavos <= 0) {
    return erro('preco_por_motorista', 'nao_positivo', 'O valor por motorista deve ser maior que zero.');
  }
  return { ok: true, centavos: c.centavos };
}

// A quantidade é EXIGIDA como number inteiro — não aceita '10'. Quem chama já
// normaliza tipo (routes/painel-admin.js faz Number(...) hoje); string aqui
// denuncia caller que esqueceu de normalizar, e num campo que multiplica dinheiro
// isso é bug que a gente quer ver, não absorver.
function validarQuantidade(limite_motoristas) {
  const limite = limite_motoristas;

  if (limite === undefined || limite === null) {
    return erro('limite_motoristas', 'ilimitado',
      'Planos por motorista exigem quantidade finita de motoristas. Este plano está sem limite (ilimitado).');
  }
  if (typeof limite !== 'number' || !Number.isInteger(limite)) {
    return erro('limite_motoristas', 'nao_inteiro',
      'A quantidade de motoristas contratados deve ser um número inteiro.');
  }
  if (limite < 1) {
    return erro('limite_motoristas', 'menor_que_um',
      'A quantidade de motoristas contratados deve ser de pelo menos 1.');
  }
  // Antes do teto: 999 > 200 cairia na mensagem genérica, e a específica é que
  // explica o problema real (sentinela, não excesso).
  if (limite === SENTINELA_ILIMITADO) {
    return erro('limite_motoristas', 'sentinela_999',
      '999 é reservado como sentinela de ilimitado; planos por motorista exigem quantidade finita.');
  }
  if (limite > LIMITE_MOTORISTAS_MAX) {
    return erro('limite_motoristas', 'acima_do_teto',
      `Planos por motorista aceitam no máximo ${LIMITE_MOTORISTAS_MAX} motoristas. Acima disso, use um plano de valor fixo.`);
  }
  return { ok: true, limite };
}

// Calcula o VALOR FINAL do plano a partir da sua composição.
// Sucesso → { ok:true, modelo_cobranca, preco_mensal, centavos, ... }
// Falha   → { ok:false, campo, motivo, message }
//
// `centavos` é exportado junto de propósito: é a representação exata (inteira) do
// valor. Comparar centavos em teste prova a conta sem passar por float.
function calcularPrecoFinal(plano) {
  const p = plano || {};
  const modelo = normalizarModelo(p.modelo_cobranca);

  if (!MODELOS_COBRANCA.includes(modelo)) {
    return erro('modelo_cobranca', 'modelo_invalido',
      'Modelo de cobrança inválido. Use "fixo" ou "por_motorista".');
  }

  if (modelo === MODELO_PADRAO) {
    const preco = validarPrecoFixo(p.preco_mensal);
    if (!preco.ok) return preco;
    if (preco.centavos > VALOR_FINAL_MAX_CENTAVOS) {
      return erro('preco_mensal', 'valor_final_acima_do_teto',
        `O valor final do plano (${formatarBRL(preco.centavos / 100)}) ultrapassa o teto de ${formatarBRL(VALOR_FINAL_MAX)}.`);
    }
    return {
      ok: true,
      modelo_cobranca: MODELO_PADRAO,
      centavos: preco.centavos,
      preco_mensal: preco.centavos / 100,
      preco_por_motorista: null,
      limite_motoristas: p.limite_motoristas,
    };
  }

  // por_motorista — preco_mensal do cliente NÃO é lido aqui. Só a composição.
  const unitario = validarUnitario(p.preco_por_motorista);
  if (!unitario.ok) return unitario;

  const quantidade = validarQuantidade(p.limite_motoristas);
  if (!quantidade.ok) return quantidade;

  const totalCentavos = unitario.centavos * quantidade.limite;
  if (totalCentavos > VALOR_FINAL_MAX_CENTAVOS) {
    return erro('preco_mensal', 'valor_final_acima_do_teto',
      `O valor final do plano (${formatarBRL(totalCentavos / 100)}) ultrapassa o teto de ${formatarBRL(VALOR_FINAL_MAX)}.`);
  }

  return {
    ok: true,
    modelo_cobranca: 'por_motorista',
    centavos: totalCentavos,
    preco_mensal: totalCentavos / 100,
    preco_por_motorista: unitario.centavos / 100,
    limite_motoristas: quantidade.limite,
  };
}

// Entrada única do PR 3. Devolve o patch pronto para persistir, ou {status, body}
// prontos para res.status(...).json(...) — mesmo contrato de
// planoAdminService.excluirPlano.
//
// Em 'fixo', preco_por_motorista é ZERADO (null). Não é higiene: sem isso, um
// plano que sai de por_motorista para fixo deixaria um unitário fantasma na linha,
// esperando que algum leitor futuro o multiplique.
function resolverPrecificacao(plano) {
  const r = calcularPrecoFinal(plano);
  if (!r.ok) {
    return {
      ok: false,
      status: 422,
      body: {
        precoInvalido: true,
        campo: r.campo,
        motivo: r.motivo,
        message: r.message,
      },
    };
  }
  return {
    ok: true,
    patch: {
      modelo_cobranca: r.modelo_cobranca,
      preco_mensal: r.preco_mensal,
      preco_por_motorista: r.modelo_cobranca === MODELO_PADRAO ? null : r.preco_por_motorista,
    },
  };
}

module.exports = {
  MODELOS_COBRANCA,
  MODELO_PADRAO,
  SENTINELA_ILIMITADO,
  LIMITE_MOTORISTAS_MAX,
  VALOR_FINAL_MAX,
  calcularPrecoFinal,
  resolverPrecificacao,
  // exportados para teste isolado
  paraCentavos,
  normalizarModelo,
};
