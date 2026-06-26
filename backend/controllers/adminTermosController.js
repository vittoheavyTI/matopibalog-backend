const crypto = require('crypto');
const supabase = require('../config/supabase');

// Hash do conteúdo em SHA-256 hex, equivalente a encode(sha256(conteudo::bytea),'hex')
// no Postgres (ambos sobre os bytes UTF-8 do texto) — mantém os hashes consistentes
// com os seeds da migration 014.
function hashConteudo(conteudo) {
  return crypto.createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

// GET /admin/termos  (super-admin) — lista todos os termos/versões.
exports.listar = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('termos')
      .select('*')
      .order('tipo', { ascending: true })
      .order('versao', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminTermos.listar]', error.message || error);
    res.status(500).json({ message: 'Erro ao listar termos.' });
  }
};

// POST /admin/termos  (super-admin) — cria rascunho ativo=false, versao = max+1 por tipo.
exports.criar = async (req, res) => {
  const { tipo, titulo, conteudo, resumo, base_legal, obrigatorio_para } = req.body;
  try {
    const { data: ultima, error: errUlt } = await supabase
      .from('termos')
      .select('versao')
      .eq('tipo', tipo)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (errUlt) throw errUlt;

    const versao = (ultima && ultima.versao ? ultima.versao : 0) + 1;

    const registro = {
      tipo,
      versao,
      titulo,
      conteudo,
      conteudo_hash: hashConteudo(conteudo),
      resumo: resumo || null,
      base_legal: base_legal || null,
      ativo: false,
      created_by: req.user.uid,
    };
    if (Array.isArray(obrigatorio_para) && obrigatorio_para.length > 0) {
      registro.obrigatorio_para = obrigatorio_para;
    }

    const { data, error } = await supabase
      .from('termos')
      .insert(registro)
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('[adminTermos.criar]', error.message || error);
    res.status(500).json({ message: 'Erro ao criar termo.' });
  }
};

// PATCH /admin/termos/:id  (super-admin) — edita SOMENTE rascunho (ativo=false).
exports.atualizar = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: termo, error: errBusca } = await supabase
      .from('termos')
      .select('id, ativo')
      .eq('id', id)
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (!termo) return res.status(404).json({ message: 'Termo não encontrado.' });
    if (termo.ativo === true) {
      return res.status(422).json({
        message: 'Termo publicado não pode ser editado. Crie uma nova versão.',
      });
    }

    const { titulo, conteudo, resumo, base_legal, obrigatorio_para } = req.body;
    const patch = { updated_at: new Date().toISOString() };
    if (titulo !== undefined) patch.titulo = titulo;
    if (conteudo !== undefined) {
      patch.conteudo = conteudo;
      patch.conteudo_hash = hashConteudo(conteudo); // recalcula hash se o conteúdo mudou
    }
    if (resumo !== undefined) patch.resumo = resumo;
    if (base_legal !== undefined) patch.base_legal = base_legal;
    if (obrigatorio_para !== undefined) patch.obrigatorio_para = obrigatorio_para;

    const { data, error } = await supabase
      .from('termos')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminTermos.atualizar]', error.message || error);
    res.status(500).json({ message: 'Erro ao atualizar termo.' });
  }
};

// PATCH /admin/termos/:id/publicar  (super-admin)
// Estratégia idempotente: se já ativo → 200 sem alterar. Senão, desativa o ativo
// anterior do mesmo tipo (libera o índice parcial uq_termo_ativo_por_tipo) e ativa este.
exports.publicar = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: termo, error: errBusca } = await supabase
      .from('termos')
      .select('id, tipo, ativo')
      .eq('id', id)
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (!termo) return res.status(404).json({ message: 'Termo não encontrado.' });

    if (termo.ativo === true) {
      return res.status(200).json({ message: 'Termo já está publicado.', ja_publicado: true });
    }

    // Desativa o termo ativo anterior do mesmo tipo (se houver).
    const { error: errDesativa } = await supabase
      .from('termos')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('tipo', termo.tipo)
      .eq('ativo', true);
    if (errDesativa) throw errDesativa;

    const { data, error } = await supabase
      .from('termos')
      .update({
        ativo: true,
        publicado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.status(200).json({ message: 'Termo publicado com sucesso.', termo: data });
  } catch (error) {
    console.error('[adminTermos.publicar]', error.message || error);
    res.status(500).json({ message: 'Erro ao publicar termo.' });
  }
};

// GET /admin/termos/:id/aceites  (super-admin) — lista aceites de um termo.
// Enriquece cada aceite com nome/email do usuário (vínculo termos_aceites.usuario_id
// → usuarios.id). Sem alterar a tabela, o POST de aceite, hash, RLS ou publicação.
exports.listarAceitesDoTermo = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: aceites, error } = await supabase
      .from('termos_aceites')
      .select('*')
      .eq('termo_id', id)
      .order('aceito_em', { ascending: false });
    if (error) throw error;

    // Busca os usuários correspondentes em uma única query (ids únicos).
    const ids = [...new Set((aceites || []).map((a) => a.usuario_id).filter(Boolean))];
    let mapaUsuarios = {};
    if (ids.length > 0) {
      const { data: usuarios, error: errUsuarios } = await supabase
        .from('usuarios')
        .select('id, nome, email')
        .in('id', ids);
      if (errUsuarios) throw errUsuarios;
      mapaUsuarios = Object.fromEntries((usuarios || []).map((u) => [u.id, u]));
    }

    // Se o usuário não for encontrado, mantém o usuario_id e nome/email = null.
    const enriquecidos = (aceites || []).map((a) => {
      const u = mapaUsuarios[a.usuario_id];
      return {
        ...a,
        usuario_nome: u ? u.nome : null,
        usuario_email: u ? u.email : null,
      };
    });

    res.status(200).json(enriquecidos);
  } catch (error) {
    console.error('[adminTermos.listarAceitesDoTermo]', error.message || error);
    res.status(500).json({ message: 'Erro ao listar aceites do termo.' });
  }
};

// GET /admin/termos/empresas/:id/aceites  (admin + verificarEmpresa)
// Admin comum só enxerga a PRÓPRIA empresa (req.empresa_id). Super-admin pode
// consultar qualquer empresa pelo param (impersonação já tratada no verificarEmpresa).
exports.listarAceitesDaEmpresa = async (req, res) => {
  const empresaIdParam = req.params.id;
  const isSuper = req.user.is_super_admin === true;

  if (!isSuper && empresaIdParam && empresaIdParam !== req.empresa_id) {
    return res.status(403).json({ message: 'Acesso restrito à sua empresa.' });
  }

  const empresaId = isSuper ? empresaIdParam : req.empresa_id;
  if (!empresaId) {
    return res.status(400).json({ message: 'Empresa não identificada.' });
  }

  try {
    const { data, error } = await supabase
      .from('termos_aceites')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('aceito_em', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminTermos.listarAceitesDaEmpresa]', error.message || error);
    res.status(500).json({ message: 'Erro ao listar aceites da empresa.' });
  }
};
