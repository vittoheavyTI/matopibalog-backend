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
    .select('id, nome, descricao, preco_mensal, modelo_cobranca, preco_por_motorista, limite_motoristas, dias_trial, recursos, ativo, categoria')
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

  const planos = (data || []).map((p) => ({
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
  }));

  res.json({ planos });
});

module.exports = router;
