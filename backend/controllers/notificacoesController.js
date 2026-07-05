const supabase = require('../config/supabase');

const COLUNAS = 'id, usuario_id, empresa_id, tipo, titulo, mensagem, referencia_tipo, referencia_id, lida, metadata, created_at, read_at';

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
    let query = supabase
      .from('notificacoes')
      .select(COLUNAS)
      .eq('usuario_id', req.user.uid)
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
    const { count, error } = await supabase
      .from('notificacoes')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', req.user.uid)
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
