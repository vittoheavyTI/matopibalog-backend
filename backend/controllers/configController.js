const supabase = require('../config/supabase');

function gerarCodigoConvite() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo = 'MATO-';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

exports.getCodigoConvite = async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('empresa_id')
      .eq('id', req.user.uid)
      .single();

    if (!usuario?.empresa_id) {
      return res.status(404).json({ message: 'Empresa não encontrada para este usuário.' });
    }

    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('codigo_convite')
      .eq('id', usuario.empresa_id)
      .single();

    if (error || !empresa) {
      return res.status(404).json({ message: 'Empresa não encontrada.' });
    }

    res.json({ codigo_convite: empresa.codigo_convite });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar código de convite.' });
  }
};

exports.regenerarCodigoConvite = async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('empresa_id')
      .eq('id', req.user.uid)
      .single();

    if (!usuario?.empresa_id) {
      return res.status(404).json({ message: 'Empresa não encontrada para este usuário.' });
    }

    let novoCodigo = null;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const candidato = gerarCodigoConvite();
      const { data: existente } = await supabase
        .from('empresas').select('id').eq('codigo_convite', candidato).maybeSingle();
      if (!existente) { novoCodigo = candidato; break; }
    }

    if (!novoCodigo) {
      return res.status(500).json({ message: 'Não foi possível gerar um código único. Tente novamente.' });
    }

    const { error } = await supabase
      .from('empresas')
      .update({ codigo_convite: novoCodigo })
      .eq('id', usuario.empresa_id);

    if (error) throw error;

    res.json({ codigo_convite: novoCodigo, message: 'Código regenerado com sucesso.' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao regenerar código de convite.' });
  }
};

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
