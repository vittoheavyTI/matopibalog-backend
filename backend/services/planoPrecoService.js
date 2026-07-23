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

// ─── PR 3: ligação com as rotas de planos ────────────────────────────────────
// Tudo abaixo continua PURO. A rota faz as leituras (plano atual, contagem de
// empresas) e passa os dados prontos — assim a decisão sobre dinheiro é testável
// sem banco, e este módulo segue sem I/O.

// Campos cuja presença no body significa "o preço pode ter mudado".
const CAMPOS_PRECO = ['modelo_cobranca', 'preco_mensal', 'preco_por_motorista', 'limite_motoristas'];

// Default histórico do POST /painel-admin/planos quando limite_motoristas não vem.
const LIMITE_MOTORISTAS_PADRAO = 5;

// O body mexe em precificação? Se NÃO, o PUT não recalcula nada — é o que mantém
// arquivar/desarquivar (frente #6) e ativar/inativar intactos: eles mandam só
// { arquivar } ou { ativo }.
function bodyTocaPreco(body) {
  if (!body) return false;
  return CAMPOS_PRECO.some((campo) => body[campo] !== undefined);
}

// Dois valores representam o mesmo dinheiro? Compara em centavos, nunca em float.
// Valor irrecuperável (lixo, mais de 2 casas) → false: sem certeza, trata como
// "mudou" e exige confirmação. Conservador de propósito.
function mesmoPreco(a, b) {
  const ca = paraCentavos(a);
  const cb = paraCentavos(b);
  if (!ca.ok || !cb.ok) return false;
  return ca.centavos === cb.centavos;
}

// Quantidade chega como string em JSON de formulário; o serviço puro recusa
// string de propósito (ver validarQuantidade). A normalização é responsabilidade
// de quem monta a entrada — e é aqui.
function normalizarQuantidade(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    if (Number.isFinite(n)) return n;
  }
  return valor; // null/undefined/lixo seguem crus — quem recusa é validarQuantidade
}

// Mescla plano atual + body para ter o QUADRO COMPLETO antes de calcular.
// Sem isso, `PUT { limite_motoristas: 20 }` num plano por_motorista traria a
// quantidade no body e o unitário só no banco: a quantidade mudaria e o preço
// NÃO — o bug original entrando pela porta dos fundos.
function mesclarParaPrecificacao(planoAtual, body) {
  const atual = planoAtual || {};
  const b = body || {};
  const pick = (campo) => (b[campo] !== undefined ? b[campo] : atual[campo]);
  return {
    modelo_cobranca: pick('modelo_cobranca'),
    preco_mensal: pick('preco_mensal'),
    preco_por_motorista: pick('preco_por_motorista'),
    limite_motoristas: normalizarQuantidade(pick('limite_motoristas')),
  };
}

// Payload do 409 de reprecificação. A mensagem precisa dizer o que NÃO acontece:
// assinatura Asaas já criada não é atualizada (sync é frente futura, fora daqui).
function montarErroReprecificacao({ preco_atual, preco_novo, empresas_afetadas }) {
  return {
    reprecificacaoRequerConfirmacao: true,
    preco_atual,
    preco_novo,
    empresas_afetadas: empresas_afetadas || 0,
    message:
      'Este plano já está em uso. Alterar o preço NÃO atualiza automaticamente assinaturas Asaas já criadas — elas continuarão cobrando o valor antigo até uma frente futura de sincronização. Confirme para aplicar a mudança ao catálogo.',
  };
}

// POST /painel-admin/planos — resolve a precificação de um plano NOVO.
// Preserva o default histórico de limite_motoristas = 5 quando ausente, e
// devolve limite_motoristas no patch para a rota persistir de uma vez só.
function resolverCriacaoPreco(body) {
  const b = body || {};
  const limite_motoristas =
    b.limite_motoristas !== undefined ? normalizarQuantidade(b.limite_motoristas) : LIMITE_MOTORISTAS_PADRAO;

  const r = resolverPrecificacao({
    modelo_cobranca: b.modelo_cobranca,
    preco_mensal: b.preco_mensal,
    preco_por_motorista: b.preco_por_motorista,
    limite_motoristas,
  });
  if (!r.ok) return r;
  return { ok: true, patch: { ...r.patch, limite_motoristas } };
}

// PUT /painel-admin/planos/:id — decide o que fazer com a precificação.
// PURA: recebe o plano atual já carregado. A contagem de empresas afetadas é
// buscada pela rota SÓ quando a ação for 'confirmar' (não custa query à toa).
//
// Ações:
//   'ignorar'   → body não toca preço; a rota segue com o patch normal (nome,
//                 descrição, ativo, arquivar...) sem recalcular nada;
//   'aplicar'   → { patch } com o preço derivado, pronto para persistir;
//   'confirmar' → plano ja_utilizado E o preço efetivo mudou, sem
//                 confirmar_reprecificacao no body → a rota devolve 409;
//   'erro'      → { status, body } prontos para res.status(...).json(...).
function decidirEdicaoPreco({ planoAtual, body }) {
  if (!bodyTocaPreco(body)) return { acao: 'ignorar' };

  if (!planoAtual || !planoAtual.id) {
    return { acao: 'erro', status: 404, body: { message: 'Plano não encontrado.' } };
  }

  const pre = resolverPrecificacao(mesclarParaPrecificacao(planoAtual, body));
  if (!pre.ok) return { acao: 'erro', status: pre.status, body: pre.body };

  const precoNovo = pre.patch.preco_mensal;
  const mudouPreco = !mesmoPreco(planoAtual.preco_mensal, precoNovo);

  // Renomear, mudar categoria ou salvar sem alterar valor não exige confirmação:
  // o gate é sobre DINHEIRO mudando, não sobre o plano ser tocado.
  if (planoAtual.ja_utilizado === true && mudouPreco && (body || {}).confirmar_reprecificacao !== true) {
    return {
      acao: 'confirmar',
      preco_atual: Number(planoAtual.preco_mensal),
      preco_novo: precoNovo,
    };
  }

  return { acao: 'aplicar', patch: pre.patch };
}

// ─── FASE 5 (mega-frente go-live): PREVIEW de impacto de reprecificação ──────
// Read-only. Serve para o super-admin DECIDIR um preço novo antes de aplicar:
// mostra preço atual × preço novo derivado, e o alcance (empresas, faturas
// abertas, próximas recorrências). PURA — a rota faz as leituras e passa os
// números prontos.
//
// Regra que a preview deixa explícita (a mesma de montarErroReprecificacao):
//   * faturas JÁ EMITIDAS não mudam — snapshot congelado (migration 030);
//   * assinaturas Asaas já criadas seguem cobrando o valor antigo (sync é frente futura);
//   * o preço novo só vale para a PRÓXIMA recorrência das contas elegíveis.
function montarImpactoPreco({ planoAtual, novo, empresas_afetadas = 0, faturas_abertas = 0, proximas_recorrencias = 0 }) {
  if (!planoAtual || !planoAtual.id) {
    return { ok: false, status: 404, body: { message: 'Plano não encontrado.' } };
  }

  // Deriva o preço novo pelo MESMO caminho do PUT: mescla plano atual + campos
  // enviados e recalcula. Sem campos de preço no `novo`, o resultado é o próprio
  // preço atual (impacto zero) — a preview continua respondendo.
  const pre = resolverPrecificacao(mesclarParaPrecificacao(planoAtual, novo || {}));
  if (!pre.ok) return { ok: false, status: pre.status, body: pre.body };

  const preco_atual = Number(planoAtual.preco_mensal);
  const preco_novo = pre.patch.preco_mensal;
  const mudou_preco = !mesmoPreco(planoAtual.preco_mensal, preco_novo);

  return {
    ok: true,
    impacto: {
      plano_id: planoAtual.id,
      plano_nome: planoAtual.nome != null ? String(planoAtual.nome) : null,
      modelo_atual: normalizarModelo(planoAtual.modelo_cobranca),
      modelo_novo: pre.patch.modelo_cobranca,
      preco_atual,
      preco_novo,
      preco_por_motorista_atual:
        planoAtual.preco_por_motorista != null ? Number(planoAtual.preco_por_motorista) : null,
      preco_por_motorista_novo: pre.patch.preco_por_motorista,
      limite_motoristas_atual:
        planoAtual.limite_motoristas != null ? Number(planoAtual.limite_motoristas) : null,
      limite_motoristas_novo:
        novo && novo.limite_motoristas !== undefined
          ? normalizarQuantidade(novo.limite_motoristas)
          : (planoAtual.limite_motoristas != null ? Number(planoAtual.limite_motoristas) : null),
      mudou_preco,
      // Alcance (números vindos da rota).
      empresas_afetadas: Number(empresas_afetadas) || 0,
      faturas_abertas: Number(faturas_abertas) || 0,          // NÃO mudam (snapshot)
      proximas_recorrencias: Number(proximas_recorrencias) || 0, // passam a usar o novo valor
      aviso_snapshot:
        'Faturas já emitidas (incluindo as abertas) NÃO mudam — o valor foi congelado no snapshot da fatura. Assinaturas Asaas já criadas seguem cobrando o valor antigo até uma frente futura de sincronização. O novo preço vale a partir da PRÓXIMA recorrência das contas elegíveis.',
    },
  };
}

module.exports = {
  MODELOS_COBRANCA,
  MODELO_PADRAO,
  SENTINELA_ILIMITADO,
  LIMITE_MOTORISTAS_MAX,
  LIMITE_MOTORISTAS_PADRAO,
  VALOR_FINAL_MAX,
  CAMPOS_PRECO,
  calcularPrecoFinal,
  resolverPrecificacao,
  // PR 3 — ligação com as rotas (tudo puro)
  bodyTocaPreco,
  mesmoPreco,
  mesclarParaPrecificacao,
  montarErroReprecificacao,
  resolverCriacaoPreco,
  decidirEdicaoPreco,
  montarImpactoPreco,
  // exportados para teste isolado
  paraCentavos,
  normalizarModelo,
};
