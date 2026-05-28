const supabase = require('../config/supabase');

exports.get = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    if (error) throw error;
    res.json(data?.dados || {});
  } catch (err) {
    res.status(500).json({ message: 'Erro ao carregar configurações.' });
  }
};

exports.update = async (req, res) => {
  try {
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ id: 1, dados: req.body, atualizado_em: new Date() });

    if (error) throw error;
    res.json({ message: 'Configurações salvas com sucesso.' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao salvar configurações.' });
  }
};
