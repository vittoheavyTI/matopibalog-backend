const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { criarEmpresaCompleta } = require('../services/empresaService');

router.use(verifyToken, isAdmin, isSuperAdmin);

// DASHBOARD
router.get('/dashboard', async (req, res) => {
  try {
    const { count: totalEmpresas } = await supabase.from('empresas').select('*', { count: 'exact', head: true });
    const { count: totalMotoristas } = await supabase.from('motoristas').select('*', { count: 'exact', head: true });
    const { count: totalFretes } = await supabase.from('fretes').select('*', { count: 'exact', head: true });
    const { data: empresas } = await supabase.from('empresas').select('status');
    const ativas = (empresas || []).filter(e => e.status === 'ativo').length;
    const trial = (empresas || []).filter(e => e.status === 'trial').length;
    res.json({ totalEmpresas: totalEmpresas || 0, totalMotoristas: totalMotoristas || 0, totalFretes: totalFretes || 0, empresasAtivas: ativas, empresasTrial: trial });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao carregar dashboard.' });
  }
});

// EMPRESAS
router.get('/empresas', async (req, res) => {
  const { data, error } = await supabase.from('empresas').select('*, planos(id, nome, preco_mensal)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar empresas.' });
  res.json(data);
});

router.post('/empresas', async (req, res) => {
  try {
    const { empresa, error } = await criarEmpresaCompleta({
      nome: req.body.nome,
      cnpj: req.body.cnpj,
      email_contato: req.body.email,
      telefone: req.body.telefone,
      plano_id: req.body.plano_id,
      planoAlias: req.body.plano,
      tipo: req.body.tipo || 'transportadora',
    });
    if (error || !empresa) {
      return res.status(500).json({ message: error || 'Erro ao criar empresa.' });
    }
    res.status(201).json(empresa);
  } catch (err) {
    console.error('[painel-admin POST /empresas] Exceção:', err);
    res.status(500).json({ message: 'Erro ao criar empresa.' });
  }
});

router.put('/empresas/:id', async (req, res) => {
  const upd = {};
  if (req.body.nome !== undefined) upd.nome = req.body.nome;
  if (req.body.cnpj !== undefined) upd.cnpj = req.body.cnpj;
  if (req.body.email !== undefined) upd.email_contato = req.body.email;
  if (req.body.telefone !== undefined) upd.telefone_contato = req.body.telefone;
  if (req.body.plano_id !== undefined) upd.plano_id = req.body.plano_id;
  if (req.body.status !== undefined) upd.status = req.body.status;
  const { data, error } = await supabase.from('empresas').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar empresa.' });
  res.json(data);
});

router.delete('/empresas/:id', async (req, res) => {
  const { error } = await supabase.from('empresas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao excluir empresa.' });
  res.json({ message: 'Empresa excluída.' });
});

// PLANOS
router.get('/planos', async (req, res) => {
  const { data, error } = await supabase.from('planos').select('*').order('preco_mensal', { ascending: true });
  if (error) return res.status(500).json({ message: 'Erro ao listar planos.' });
  res.json(data || []);
});

router.post('/planos', async (req, res) => {
  const { data, error } = await supabase.from('planos').insert({
    nome: req.body.nome,
    preco_mensal: Number(req.body.preco_mensal) || 0,
    descricao: req.body.descricao || '',
    recursos: req.body.recursos || '',
    limite_motoristas: Number(req.body.limite_motoristas) || 5,
    dias_trial: Number(req.body.dias_trial) || 7,
    ativo: true
  }).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao criar plano.' });
  res.status(201).json(data);
});

router.put('/planos/:id', async (req, res) => {
  const upd = {};
  if (req.body.nome !== undefined) upd.nome = req.body.nome;
  if (req.body.preco_mensal !== undefined) upd.preco_mensal = Number(req.body.preco_mensal);
  if (req.body.descricao !== undefined) upd.descricao = req.body.descricao;
  if (req.body.recursos !== undefined) upd.recursos = req.body.recursos;
  if (req.body.limite_motoristas !== undefined) upd.limite_motoristas = Number(req.body.limite_motoristas);
  if (req.body.dias_trial !== undefined) upd.dias_trial = Number(req.body.dias_trial);
  if (req.body.status !== undefined) upd.ativo = req.body.status === 'ativo';
  const { data, error } = await supabase.from('planos').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar plano.' });
  res.json(data);
});

// ASSINATURAS (virtuais - derivadas de empresas + planos)
router.get('/assinaturas', async (req, res) => {
  const { data: empresas, error } = await supabase.from('empresas').select('*, planos(id, nome, preco_mensal)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar assinaturas.' });
  const assinaturas = (empresas || []).map(e => ({
    id: e.id,
    empresa_id: e.id,
    plano_id: e.plano_id,
    empresa_nome: e.nome,
    plano_nome: e.planos?.nome || null,
    valor: e.planos?.preco_mensal || 0,
    status: e.status || 'pendente',
    created_at: e.created_at
  }));
  res.json(assinaturas);
});

// MOTORISTAS GLOBAL
router.get('/motoristas', async (req, res) => {
  const { data, error } = await supabase.from('motoristas').select('*, usuarios(nome, email), empresas(nome)');
  if (error) return res.status(500).json({ message: 'Erro ao listar motoristas.' });
  res.json(data || []);
});

router.patch('/motoristas/:id/aprovar', async (req, res) => {
  const { error } = await supabase.from('motoristas').update({ status_cadastro: 'aprovado' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao aprovar.' });
  res.json({ message: 'Motorista aprovado.' });
});

module.exports = router;
