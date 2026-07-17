const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { criarEmpresaCompleta } = require('../services/empresaService');
const { plano_idValido, normalizarPlanoId } = require('../utils/plano');
const { conflitoUnico } = require('../utils/pgError');
const { montarPatchArquivamento, excluirPlano } = require('../services/planoAdminService');
const {
  bodyTocaPreco,
  decidirEdicaoPreco,
  montarErroReprecificacao,
  resolverCriacaoPreco,
} = require('../services/planoPrecoService');

router.use(verifyToken, isAdmin, isSuperAdmin);

// Valida/resolve o plano_id recebido do cliente ANTES de tocar o banco.
// Retorna { plano_id: string|null } em caso de sucesso, ou { status, message }
// para o handler responder direto. Nunca deixa texto não-UUID chegar ao Postgres
// (evita 22P02 → 500) e barra UUID válido porém inexistente com 400.
async function resolverPlanoId(valor) {
  const plano_id = normalizarPlanoId(valor);
  if (plano_id === null) return { plano_id: null };
  if (!plano_idValido(plano_id)) {
    return { status: 400, message: 'Plano informado é inválido.' };
  }
  const { data, error } = await supabase
    .from('planos')
    .select('id')
    .eq('id', plano_id)
    .maybeSingle();
  if (error) return { status: 500, message: 'Erro ao validar plano.' };
  if (!data) return { status: 400, message: 'Plano informado não foi encontrado.' };
  return { plano_id };
}

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
    // Só validamos plano_id quando o cliente informou algum. Se veio vazio, o
    // serviço aplica sua própria resolução (alias/default) e pode nascer sem plano.
    let planoIdValidado;
    if (req.body.plano_id !== undefined && req.body.plano_id !== null && String(req.body.plano_id).trim() !== '') {
      const r = await resolverPlanoId(req.body.plano_id);
      if (r.status) return res.status(r.status).json({ message: r.message });
      planoIdValidado = r.plano_id;
    }
    const { empresa, error, status } = await criarEmpresaCompleta({
      nome: req.body.nome,
      cnpj: req.body.cnpj,
      email_contato: req.body.email,
      telefone: req.body.telefone,
      plano_id: planoIdValidado,
      planoAlias: req.body.plano,
      tipo: req.body.tipo || 'transportadora',
    });
    if (error || !empresa) {
      // Status vindo do serviço tem precedência (409 = documento duplicado).
      // Sem status: erros de plano saem como 400; o resto como 500.
      const httpStatus = status || (/plano/i.test(error || '') ? 400 : 500);
      return res.status(httpStatus).json({ message: error || 'Erro ao criar empresa.' });
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
  if (req.body.plano_id !== undefined) {
    // Valida antes de gravar: '' → null (sem plano); não-UUID → 400;
    // UUID inexistente → 400. Nunca deixa 22P02 virar 500.
    const r = await resolverPlanoId(req.body.plano_id);
    if (r.status) return res.status(r.status).json({ message: r.message });
    upd.plano_id = r.plano_id;
  }
  if (req.body.status !== undefined) upd.status = req.body.status;
  const { data, error } = await supabase.from('empresas').update(upd).eq('id', req.params.id).select().single();
  if (error) {
    // Trocar o documento para um já usado por outra conta → 409 amigável.
    // (Manter o próprio documento não gera 23505: o valor não muda.)
    const conflito = conflitoUnico(error);
    if (conflito) return res.status(conflito.status).json({ message: conflito.message });
    return res.status(500).json({ message: 'Erro ao atualizar empresa.' });
  }
  res.json(data);
});

router.delete('/empresas/:id', async (req, res) => {
  const { error } = await supabase.from('empresas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao excluir empresa.' });
  res.json({ message: 'Empresa excluída.' });
});

// TRIAL — prorrogar/liberar trial de uma empresa (super-admin only, herda do router.use)
// Aceita { dias: 7|15 } (prorrogação relativa) OU { trial_ends_at: 'YYYY-MM-DD' } (data personalizada).
// Não altera plano_id, faturas, cobrança ou Asaas. Limite: no máximo hoje + 90 dias.
router.patch('/empresas/:id/trial', async (req, res) => {
  const MS_DIA = 24 * 60 * 60 * 1000;
  const { dias, trial_ends_at } = req.body || {};

  // Exatamente uma das opções deve vir preenchida
  const temDias = dias !== undefined && dias !== null && dias !== '';
  const temData = trial_ends_at !== undefined && trial_ends_at !== null && trial_ends_at !== '';
  if (temDias === temData) {
    return res.status(400).json({ message: 'Informe "dias" (7 ou 15) ou "trial_ends_at" (data), mas não ambos.' });
  }

  // Empresa precisa existir
  const { data: empresa, error: findErr } = await supabase
    .from('empresas')
    .select('id, status, trial_started_at, trial_ends_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ message: 'Erro ao buscar empresa.' });
  if (!empresa) return res.status(404).json({ message: 'Empresa não encontrada.' });

  const agora = new Date();
  // Teto: fim do 90º dia a partir de hoje (permite escolher exatamente o dia 90)
  const limiteMax = new Date(agora.getTime() + 90 * MS_DIA);
  limiteMax.setHours(23, 59, 59, 999);
  let novaData;

  if (temDias) {
    const n = Number(dias);
    if (n !== 7 && n !== 15) {
      return res.status(400).json({ message: 'O parâmetro "dias" deve ser 7 ou 15.' });
    }
    // Base = maior data entre hoje e o trial atual, se ainda futuro
    let base = agora;
    if (empresa.trial_ends_at) {
      const atual = new Date(empresa.trial_ends_at);
      if (!isNaN(atual.getTime()) && atual > agora) base = atual;
    }
    novaData = new Date(base.getTime() + n * MS_DIA);
  } else {
    // Data personalizada. 'YYYY-MM-DD' (input date) → fim daquele dia, para o trial
    // valer o dia inteiro e exibir a data correta no fuso local.
    let raw = String(trial_ends_at).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T23:59:59';
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ message: 'Data de trial inválida.' });
    }
    if (parsed <= agora) {
      return res.status(400).json({ message: 'A data de trial deve ser futura.' });
    }
    novaData = parsed;
  }

  // Teto de 90 dias a partir de hoje (vale para prorrogação relativa e data personalizada)
  if (novaData > limiteMax) {
    return res.status(400).json({ message: 'A data de trial não pode passar de 90 dias a partir de hoje.' });
  }

  const upd = {
    status: 'trial',
    trial_ends_at: novaData.toISOString(),
    trial_started_at: empresa.trial_started_at || agora.toISOString(),
  };

  const { data, error } = await supabase
    .from('empresas')
    .update(upd)
    .eq('id', req.params.id)
    .select('id, status, trial_started_at, trial_ends_at')
    .single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar trial.' });
  res.json(data);
});

// PLANOS
router.get('/planos', async (req, res) => {
  const { data, error } = await supabase.from('planos').select('*').order('preco_mensal', { ascending: true });
  if (error) return res.status(500).json({ message: 'Erro ao listar planos.' });
  // `excluivel` deriva de ja_utilizado (critério B): só é excluível quem nunca foi
  // usado. A UI usa isso para só mostrar o botão Excluir quando for seguro.
  const planos = (data || []).map((p) => ({ ...p, excluivel: p.ja_utilizado !== true }));
  res.json(planos);
});

// Categorias validas de plano (a quem ele se destina).
const CATEGORIAS_PLANO = ['empresa', 'autonomo', 'ambos'];

router.post('/planos', async (req, res) => {
  const categoria = req.body.categoria !== undefined ? String(req.body.categoria) : 'ambos';
  if (!CATEGORIAS_PLANO.includes(categoria)) {
    return res.status(400).json({ message: 'Categoria inválida. Use empresa, autonomo ou ambos.' });
  }
  // Precificação é do backend, não do cliente. Sem modelo_cobranca no body →
  // resolve 'fixo' (o payload atual do painel). Em por_motorista o preco_mensal
  // enviado é IGNORADO e recalculado como unitário × quantidade. O patch já traz
  // modelo_cobranca, preco_mensal, preco_por_motorista e limite_motoristas.
  const preco = resolverCriacaoPreco(req.body);
  if (!preco.ok) return res.status(preco.status).json(preco.body);

  const { data, error } = await supabase.from('planos').insert({
    nome: req.body.nome,
    descricao: req.body.descricao || '',
    recursos: req.body.recursos || [],
    dias_trial: req.body.dias_trial !== undefined ? Number(req.body.dias_trial) : 7,
    ativo: req.body.ativo !== undefined ? req.body.ativo === true : true,
    categoria,
    ...preco.patch
  }).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao criar plano.' });
  res.status(201).json(data);
});

router.put('/planos/:id', async (req, res) => {
  const upd = {};
  if (req.body.nome !== undefined) upd.nome = req.body.nome;
  if (req.body.descricao !== undefined) upd.descricao = req.body.descricao;
  if (req.body.recursos !== undefined) upd.recursos = req.body.recursos;
  if (req.body.limite_motoristas !== undefined) upd.limite_motoristas = Number(req.body.limite_motoristas);
  if (req.body.dias_trial !== undefined) upd.dias_trial = Number(req.body.dias_trial);
  if (req.body.ativo !== undefined) upd.ativo = req.body.ativo === true;
  else if (req.body.status !== undefined) upd.ativo = req.body.status === 'ativo';
  if (req.body.categoria !== undefined) {
    const categoria = String(req.body.categoria);
    if (!CATEGORIAS_PLANO.includes(categoria)) {
      return res.status(400).json({ message: 'Categoria inválida. Use empresa, autonomo ou ambos.' });
    }
    upd.categoria = categoria;
  }

  // ─── Precificação ──────────────────────────────────────────────────────────
  // O PUT é PARCIAL, mas a fórmula precisa do quadro completo: `PUT
  // { limite_motoristas: 20 }` num plano por_motorista traz a quantidade no body
  // e o unitário só no banco. Por isso carregamos a linha atual e mesclamos antes
  // de calcular — senão a quantidade mudaria e o preço não.
  //
  // Só carrega/recalcula quando o body toca preço/modelo/quantidade. Arquivar,
  // desarquivar, ativar e inativar mandam só { arquivar } ou { ativo }: não
  // pagam query nem recálculo, e seguem exatamente como na frente #6.
  if (bodyTocaPreco(req.body)) {
    const { data: planoAtual, error: loadErr } = await supabase
      .from('planos')
      .select('id, preco_mensal, preco_por_motorista, limite_motoristas, modelo_cobranca, ja_utilizado')
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadErr) return res.status(500).json({ message: 'Erro ao carregar o plano.' });

    const decisao = decidirEdicaoPreco({ planoAtual, body: req.body });

    if (decisao.acao === 'erro') return res.status(decisao.status).json(decisao.body);

    // Plano já usado + preço efetivo mudando: 409 com o diff, e nada é aplicado.
    // A trava é aqui no backend, não no modal — um curl ou um painel
    // desatualizado não podem furar mudança de preço de plano em uso.
    if (decisao.acao === 'confirmar') {
      const { count } = await supabase
        .from('empresas')
        .select('id', { count: 'exact', head: true })
        .eq('plano_id', req.params.id);
      return res.status(409).json(montarErroReprecificacao({
        preco_atual: decisao.preco_atual,
        preco_novo: decisao.preco_novo,
        empresas_afetadas: count || 0,
      }));
    }

    if (decisao.acao === 'aplicar') Object.assign(upd, decisao.patch);
  }

  // Arquivar/desarquivar (autoria vem do token, nunca do body). Arquivar seta
  // ativo=false; desarquivar NÃO reativa (reativar no app é ação separada).
  Object.assign(upd, montarPatchArquivamento(req.body, req.user.uid));
  const { data, error } = await supabase.from('planos').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar plano.' });
  res.json(data);
});

// Exclusão FÍSICA segura (super-admin, herdado do router.use acima). Só remove
// planos que nunca foram usados; qualquer vínculo → 409 amigável (nunca 500).
router.delete('/planos/:id', async (req, res) => {
  const resultado = await excluirPlano({ supabase, planoId: req.params.id });
  res.status(resultado.status).json(resultado.body);
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
  const { data, error } = await supabase.from('motoristas').select('*, usuarios(nome, email), empresas(nome, tipo)');
  if (error) return res.status(500).json({ message: 'Erro ao listar motoristas.' });
  res.json(data || []);
});

router.patch('/motoristas/:id/aprovar', async (req, res) => {
  const { error } = await supabase.from('motoristas').update({ status_cadastro: 'aprovado' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao aprovar.' });
  res.json({ message: 'Motorista aprovado.' });
});

router.patch('/motoristas/:id/reprovar', async (req, res) => {
  const { error } = await supabase.from('motoristas').update({ status_cadastro: 'reprovado' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao reprovar.' });
  res.json({ message: 'Motorista reprovado.' });
});

module.exports = router;
