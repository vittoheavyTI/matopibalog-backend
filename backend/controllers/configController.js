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

exports.getPublic = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('dados')
      .eq('id', 1)
      .single();

    if (error) {
      return res.status(200).json({});
    }
    res.json(data?.dados || {});
  } catch (err) {
    res.status(200).json({});
  }
};

exports.updatePublic = async (req, res) => {
  try {
    const dados = req.body;
    const empresa_id = dados.empresa_id || '00000000-0000-0000-0000-000000000001';

    const { error } = await supabase
      .from('configuracoes')
      .upsert({ 
        id: 1, 
        empresa_id: empresa_id,
        dados: dados,
        atualizado_em: new Date()
      });

    if (error) throw error;
    res.json({ message: 'Configurações salvas com sucesso.' });
  } catch (err) {
    console.error('Erro ao salvar config pública:', err);
    res.status(500).json({ message: 'Erro ao salvar configurações.' });
  }
};

exports.update = async (req, res) => {
  try {
    // Buscar empresa_id atual para respeitar a restrição NOT NULL na tabela
    const { data: current } = await supabase
      .from('configuracoes')
      .select('empresa_id')
      .eq('id', 1)
      .single();

    const empresaId = current?.empresa_id || '00000000-0000-0000-0000-000000000001';

    const { error } = await supabase
      .from('configuracoes')
      .upsert({ 
        id: 1, 
        dados: req.body, 
        atualizado_em: new Date(),
        empresa_id: empresaId
      });

    if (error) throw error;
    res.json({ message: 'Configurações salvas com sucesso.' });
  } catch (err) {
    console.error('Erro ao salvar configuracoes:', err);
    res.status(500).json({ message: 'Erro ao salvar configurações.' });
  }
};
