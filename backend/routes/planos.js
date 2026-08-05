const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Normaliza o campo `recursos` para um array simples de strings.
// Defesa: pode vir como array (jsonb/text[]), string JSON, string separada
// por vírgula/; ou null. Nunca devolvemos JSON cru para o público.
function normalizarRecursos(recursos) {
  if (Array.isArray(recursos)) {
    return recursos.map((r) => String(r).trim()).filter(Boolean);
  }
  if (recursos == null) return [];
  if (typeof recursos === 'string') {
    const s = recursos.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map((r) => String(r).trim()).filter(Boolean);
      } catch (_) {
        /* cai no split abaixo */
      }
    }
    return s.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  }
  return [];
}

// GET /planos/publicos — catálogo público de planos ATIVOS (sem autenticação,
// read-only). Fonte única para página pública de planos e cadastro web/app.
// Retorna apenas campos seguros (whitelist explícita, sem SELECT *) e nunca
// dados de empresa, faturas ou segredos.
router.get('/publicos', async (req, res) => {
  // Filtro opcional por publico-alvo. 'autonomo' → planos autonomo/ambos;
  // 'empresa' → empresa/ambos. Sem o parametro, retorna todos (compatibilidade).
  const categoria = String(req.query.categoria || '').trim().toLowerCase();

  let query = supabase
    .from('planos')
    // `*` traz os campos comerciais (capacidade_inclusa, preco_motorista_extra,
    // valor_implantacao, requer_negociacao) SÓ SE existirem — deploy-safe antes
    // da migration 038. A whitelist de saída abaixo continua explícita.
    .select('*')
    .eq('ativo', true);

  if (categoria === 'autonomo') {
    query = query.in('categoria', ['autonomo', 'ambos']);
  } else if (categoria === 'empresa') {
    query = query.in('categoria', ['empresa', 'ambos']);
  }

  const { data, error } = await query
    .order('preco_mensal', { ascending: true })
    .order('nome', { ascending: true });

  if (error) {
    console.error('[planos/publicos] Erro ao listar planos:', error.message);
    return res.status(500).json({ message: 'Erro ao carregar planos.' });
  }

  const planos = (data || [])
    // Visibilidade explícita no cadastro: plano marcado visivel_cadastro=false NÃO
    // aparece na vitrine/cadastro. NULL (nunca setado) e true seguem a regra legada
    // (aparece se ativo) — deploy-safe: antes da migration 059 o campo vem undefined.
    .filter((p) => p.visivel_cadastro !== false)
    .map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao || '',
    // preco_mensal é o VALOR FINAL cobrado em qualquer modelo. Os dois campos
    // abaixo só contam COMO ele foi formado — a vitrine anuncia o final e usa a
    // composição como subtítulo. Nunca o contrário.
    preco_mensal: Number(p.preco_mensal) || 0,
    modelo_cobranca: p.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
    preco_por_motorista: p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
    limite_motoristas: p.limite_motoristas,
    dias_trial: p.dias_trial,
    recursos: normalizarRecursos(p.recursos),
    ativo: p.ativo === true,
    categoria: p.categoria || 'ambos',
    // Campos comerciais (mega-frente). Podem vir undefined antes da migration 038;
    // normalizamos para null/false para a vitrine/cadastro exibirem com segurança.
    capacidade_inclusa: p.capacidade_inclusa != null ? Number(p.capacidade_inclusa) : null,
    preco_motorista_extra: p.preco_motorista_extra != null ? Number(p.preco_motorista_extra) : null,
    valor_implantacao: p.valor_implantacao != null ? Number(p.valor_implantacao) : null,
    requer_negociacao: p.requer_negociacao === true,
  }));

  res.json({ planos });
});

// POST /planos/validar-promocao — validação PÚBLICA de código promocional para o
// cadastro/checkout (sem autenticação; rate-limited pelo apiLimiter global).
// Body: { codigo, plano_id }. Read-only: não resgata nada, só faz a PRÉVIA de
// preço (original × promocional) para o cliente ver antes de se cadastrar.
router.post('/validar-promocao', async (req, res) => {
  const {
    normalizarCodigo, avaliarResgate, aplicarPromocao,
  } = require('../services/promocaoDomainService');

  const codigo = normalizarCodigo(req.body && req.body.codigo);
  const plano_id = req.body && req.body.plano_id;
  if (!codigo) return res.status(400).json({ codigoInvalido: true, message: 'Informe o código.' });

  // Código → promoção (join). Índice único é em upper(codigo); ilike bate igual.
  const { data: cod, error: e1 } = await supabase
    .from('promocao_codigos')
    .select('*, promocoes(*)')
    .ilike('codigo', codigo)
    .maybeSingle();
  if (e1) {
    if (/relation .* does not exist|could not find the table|does not exist/i.test(e1.message || '') || e1.code === '42P01' || e1.code === 'PGRST205') {
      return res.status(503).json({ message: 'Promoções ainda não disponíveis.' });
    }
    return res.status(500).json({ message: 'Erro ao validar código.' });
  }
  if (!cod || !cod.promocoes) return res.status(404).json({ codigoInvalido: true, message: 'Código não encontrado.' });

  const promocao = cod.promocoes;

  // Plano (para calcular o preço promocional). Opcional: se não vier plano_id,
  // devolve só a validade da promoção sem preço.
  let plano = null;
  if (plano_id) {
    const { data: p } = await supabase
      .from('planos')
      .select('id, nome, preco_mensal, valor_implantacao')
      .eq('id', plano_id)
      .maybeSingle();
    plano = p || null;
  }

  // Elegibilidade (fluxo automático: respeita janela/ativo/limites; empresa
  // ainda não existe → preview sem uso-único).
  const aval = avaliarResgate({
    promocao, codigoRegistro: cod,
    empresa: { id: '__preview__' },
    planoEscolhidoId: plano_id || null,
    resgatesDaEmpresa: [], agora: new Date(), manual: false,
  });
  if (!aval.ok) return res.status(422).json({ codigoInvalido: true, motivo: aval.motivo, message: aval.message });

  const efeito = plano
    ? aplicarPromocao({ promocao, precoMensalidade: Number(plano.preco_mensal), valorImplantacao: plano.valor_implantacao != null ? Number(plano.valor_implantacao) : null })
    : { ok: true, alvo: null, mensalidade_final: null, implantacao_final: null, desconto_mensalidade: 0, desconto_implantacao: 0 };
  if (!efeito.ok) return res.status(422).json({ codigoInvalido: true, motivo: efeito.motivo, message: efeito.message });

  res.json({
    valido: true,
    tipo: promocao.tipo,
    campanha: promocao.nome,
    validade: promocao.data_fim,
    plano_nome: plano ? plano.nome : null,
    preco_original: plano ? Number(plano.preco_mensal) : null,
    preco_promocional: efeito.mensalidade_final,
    implantacao_original: plano && plano.valor_implantacao != null ? Number(plano.valor_implantacao) : null,
    implantacao_promocional: efeito.implantacao_final,
    desconto_mensalidade: efeito.desconto_mensalidade,
    desconto_implantacao: efeito.desconto_implantacao,
  });
});

module.exports = router;
