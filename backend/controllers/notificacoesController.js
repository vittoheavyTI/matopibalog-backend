const supabase = require('../config/supabase');

const COLUNAS = 'id, usuario_id, empresa_id, tipo, titulo, mensagem, referencia_tipo, referencia_id, lida, metadata, created_at, read_at';

async function resolverEscopoNotificacoes(req) {
  if (req.user?.is_super_admin === true && req.impersonating && req.empresa_id) {
    const { data: admins, error } = await supabase
      .from('usuarios')
      .select('id')
      .eq('empresa_id', req.empresa_id)
      .eq('tipo', 'admin')
      .eq('status', 'ativo');

    if (error) throw error;

    return {
      tipo: 'empresa_admins',
      empresaId: req.empresa_id,
      usuarioIds: (admins || []).map((admin) => admin.id).filter(Boolean),
    };
  }

  return {
    tipo: 'usuario',
    usuarioId: req.user.uid,
  };
}

function aplicarEscopoNotificacoes(query, escopo) {
  if (escopo.tipo === 'empresa_admins') {
    return query
      .eq('empresa_id', escopo.empresaId)
      .in('usuario_id', escopo.usuarioIds);
  }

  return query.eq('usuario_id', escopo.usuarioId);
}

function parseFiltroLida(valor) {
  if (valor === undefined) return null;
  if (valor === 'true' || valor === true) return true;
  if (valor === 'false' || valor === false) return false;
  return undefined;
}

exports.getAll = async (req, res) => {
  const filtroLida = parseFiltroLida(req.query.lida);
  if (filtroLida === undefined) {
    return res.status(400).json({ message: 'Filtro lida deve ser true ou false.' });
  }

  const limiteInformado = Number.parseInt(req.query.limite, 10);
  const limite = Number.isFinite(limiteInformado)
    ? Math.min(Math.max(limiteInformado, 1), 100)
    : 50;

  try {
    const escopo = await resolverEscopoNotificacoes(req);
    if (escopo.tipo === 'empresa_admins' && escopo.usuarioIds.length === 0) {
      return res.status(200).json([]);
    }

    let query = aplicarEscopoNotificacoes(supabase
      .from('notificacoes')
      .select(COLUNAS), escopo)
      .order('created_at', { ascending: false })
      .limit(limite);

    if (filtroLida !== null) query = query.eq('lida', filtroLida);

    const { data, error } = await query;
    if (error) throw error;
    return res.status(200).json(data || []);
  } catch (error) {
    console.error('[notificacoesController.getAll] Falha', { erro: error?.message || String(error) });
    return res.status(500).json({ message: 'Erro ao buscar notificacoes.' });
  }
};

exports.contarNaoLidas = async (req, res) => {
  try {
    const escopo = await resolverEscopoNotificacoes(req);
    if (escopo.tipo === 'empresa_admins' && escopo.usuarioIds.length === 0) {
      return res.status(200).json({ count: 0 });
    }

    const { count, error } = await aplicarEscopoNotificacoes(supabase
      .from('notificacoes')
      .select('id', { count: 'exact', head: true }), escopo)
      .eq('lida', false);
    if (error) throw error;
    return res.status(200).json({ count: count || 0 });
  } catch (error) {
    console.error('[notificacoesController.contarNaoLidas] Falha', { erro: error?.message || String(error) });
    return res.status(500).json({ message: 'Erro ao contar notificacoes.' });
  }
};

exports.marcarLida = async (req, res) => {
  try {
    const agora = new Date().toISOString();
    const { data, error } = await supabase
      .from('notificacoes')
      .update({ lida: true, read_at: agora })
      .eq('id', req.params.id)
      .eq('usuario_id', req.user.uid)
      .select('id, lida, read_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Notificacao nao encontrada.' });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[notificacoesController.marcarLida] Falha', { erro: error?.message || String(error) });
    return res.status(500).json({ message: 'Erro ao marcar notificacao.' });
  }
};

exports.marcarTodasLidas = async (req, res) => {
  try {
    const { error } = await supabase
      .from('notificacoes')
      .update({ lida: true, read_at: new Date().toISOString() })
      .eq('usuario_id', req.user.uid)
      .eq('lida', false);
    if (error) throw error;
    return res.status(200).json({ message: 'Todas as notificacoes foram marcadas como lidas.' });
  } catch (error) {
    console.error('[notificacoesController.marcarTodasLidas] Falha', { erro: error?.message || String(error) });
    return res.status(500).json({ message: 'Erro ao marcar notificacoes.' });
  }
};
