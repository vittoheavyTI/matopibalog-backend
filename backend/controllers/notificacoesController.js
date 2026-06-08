const supabase = require('../config/supabase');

exports.getAll = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notificacoes')
      .select('*')
      .eq('usuario_id', req.user.uid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar notificações.' });
  }
};

exports.marcarLida = async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('notificacoes')
      .update({ lida: true })
      .eq('id', id)
      .eq('usuario_id', req.user.uid);
    if (error) throw error;
    res.status(200).json({ message: 'Notificação marcada como lida.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar notificação.' });
  }
};

exports.marcarTodasLidas = async (req, res) => {
  try {
    const { error } = await supabase
      .from('notificacoes')
      .update({ lida: true })
      .eq('usuario_id', req.user.uid)
      .eq('lida', false);
    if (error) throw error;
    res.status(200).json({ message: 'Todas notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar notificações.' });
  }
};
