const supabase = require('../config/supabase');

// Helper reutilizável (também usado pelo authController em /auth/me).
// Retorna { pendentes, count } dos termos ATIVOS que se aplicam ao papel do
// usuário e que ele ainda NÃO aceitou. Super-admin nunca tem pendência.
async function getTermosPendentes(usuarioId, role, isSuperAdmin = false) {
  if (isSuperAdmin === true) {
    return { pendentes: [], count: 0 };
  }

  // 1) termos ativos cujo obrigatorio_para CONTÉM o papel do usuário (text[] @>)
  const { data: ativos, error: errAtivos } = await supabase
    .from('termos')
    .select('id, tipo, versao, titulo, conteudo, resumo, conteudo_hash, obrigatorio_para, publicado_em')
    .eq('ativo', true)
    .contains('obrigatorio_para', [role]);

  if (errAtivos) throw errAtivos;
  if (!ativos || ativos.length === 0) {
    return { pendentes: [], count: 0 };
  }

  // 2) termo_id já aceitos por este usuário
  const { data: aceites, error: errAceites } = await supabase
    .from('termos_aceites')
    .select('termo_id')
    .eq('usuario_id', usuarioId);

  if (errAceites) throw errAceites;
  const aceitos = new Set((aceites || []).map((a) => a.termo_id));

  const pendentes = ativos.filter((t) => !aceitos.has(t.id));
  return { pendentes, count: pendentes.length };
}

// GET /termos/pendentes
exports.getPendentes = async (req, res) => {
  try {
    const { pendentes, count } = await getTermosPendentes(
      req.user.uid,
      req.user.role,
      req.user.is_super_admin === true
    );
    res.status(200).json({ pendentes, count });
  } catch (error) {
    console.error('[termos.getPendentes]', error.message || error);
    res.status(500).json({ message: 'Erro ao buscar termos pendentes.' });
  }
};

// POST /termos/:id/aceitar
exports.aceitarTermo = async (req, res) => {
  const { id } = req.params;
  const origem = (req.body && req.body.origem) || 'web';

  try {
    // O termo pode não existir → maybeSingle()
    const { data: termo, error: errTermo } = await supabase
      .from('termos')
      .select('id, tipo, versao, conteudo_hash, ativo, obrigatorio_para')
      .eq('id', id)
      .maybeSingle();

    if (errTermo) throw errTermo;
    if (!termo) {
      return res.status(404).json({ message: 'Termo não encontrado.' });
    }
    if (termo.ativo !== true) {
      return res.status(422).json({ message: 'Termo não está ativo para aceite.' });
    }

    const role = req.user.role;
    if (!Array.isArray(termo.obrigatorio_para) || !termo.obrigatorio_para.includes(role)) {
      return res.status(403).json({ message: 'Este termo não se aplica ao seu perfil.' });
    }

    // Já aceitou? → idempotente (o aceite pode não existir → maybeSingle)
    const { data: existente, error: errExist } = await supabase
      .from('termos_aceites')
      .select('id')
      .eq('termo_id', termo.id)
      .eq('usuario_id', req.user.uid)
      .maybeSingle();

    if (errExist) throw errExist;
    if (existente) {
      return res.status(200).json({
        message: 'Termo já aceito anteriormente.',
        aceite_id: existente.id,
        ja_aceito: true,
      });
    }

    // Aceite com dados denormalizados (trilha imutável de auditoria).
    const registro = {
      termo_id: termo.id,
      usuario_id: req.user.uid,
      empresa_id: req.empresa_id || null,
      tipo: termo.tipo,
      versao: termo.versao,
      conteudo_hash: termo.conteudo_hash,
      aceito: true,
      ip: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
      origem,
    };

    const { data: novo, error: errInsert } = await supabase
      .from('termos_aceites')
      .insert(registro)
      .select('id')
      .single();

    if (errInsert) {
      // Corrida: UNIQUE(termo_id, usuario_id) → trata como idempotente
      if (errInsert.code === '23505') {
        return res.status(200).json({ message: 'Termo já aceito anteriormente.', ja_aceito: true });
      }
      throw errInsert;
    }

    res.status(201).json({ message: 'Termo aceito com sucesso.', aceite_id: novo.id });
  } catch (error) {
    console.error('[termos.aceitarTermo]', error.message || error);
    res.status(500).json({ message: 'Erro ao registrar aceite do termo.' });
  }
};

// Exporta o helper para uso direto no authController (/auth/me).
exports.getTermosPendentes = getTermosPendentes;
