const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { criarEmpresaCompleta } = require('../services/empresaService');
const { plano_idValido, normalizarPlanoId } = require('../utils/plano');
const { conflitoUnico } = require('../utils/pgError');
const { montarPatchArquivamento, excluirPlano } = require('../services/planoAdminService');
const { aplicarFiltroArquivamento, montarPatchArquivamentoEmpresa } = require('../services/empresaArquivamentoService');
const {
  bodyTocaPreco,
  decidirEdicaoPreco,
  montarErroReprecificacao,
  resolverCriacaoPreco,
  montarImpactoPreco,
} = require('../services/planoPrecoService');
const { categoriaCompativelComTipo, mensagemIncompatibilidade } = require('../utils/planoCategoria');
const { resumirBillingHealth } = require('../services/billingHealthService');
const { recomendarPlano } = require('../services/calculadoraComercialService');
const {
  TIPOS: PROMO_TIPOS,
  normalizarCodigo,
  avaliarResgate,
  aplicarPromocao,
  montarResgate,
} = require('../services/promocaoDomainService');

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
    .select('id, categoria')
    .eq('id', plano_id)
    .maybeSingle();
  if (error) return { status: 500, message: 'Erro ao validar plano.' };
  if (!data) return { status: 400, message: 'Plano informado não foi encontrado.' };
  return { plano_id, categoria: data.categoria };
}

// Trava de compatibilidade categoria×tipo. Retorna { status, message } quando
// incompatível (o handler responde direto), ou null quando ok / não aplicável
// (sem plano ou categoria 'ambos'). tipoEmpresa 'autonomo' vs demais.
function checarCategoriaPlano(tipoEmpresa, categoriaPlano) {
  if (categoriaPlano == null) return null; // sem plano definido
  if (categoriaCompativelComTipo(tipoEmpresa, categoriaPlano)) return null;
  return { status: 400, message: mensagemIncompatibilidade(tipoEmpresa) };
}

// BILLING HEALTH (go-live — observabilidade read-only, super-admin).
// Lê faturas, empresas (com categoria do plano) e eventos de webhook e devolve
// o retrato de saúde do billing (reservas órfãs, vencidas, duplicidade,
// suspensas sem fatura / com fatura paga, webhooks com erro, categoria
// incompatível). NÃO escreve nada e NÃO chama o Asaas.
router.get('/billing-health', async (req, res) => {
  try {
    const [faturasR, empresasR, eventosR, promocoesR, resgatesR, planosR, motoristasR] = await Promise.all([
      supabase.from('faturas').select('id, empresa_id, status, valor, origem, periodo_referencia, asaas_id, invoice_url, bank_slip_url, due_date, pago_em'),
      // `planos(*)` (em vez de lista explícita) traz capacidade_inclusa/
      // requer_negociacao SÓ SE as colunas existirem — deploy-safe: antes da
      // migration 038 elas somem do retorno sem erro (idem `*` em empresas p/ 036).
      supabase.from('empresas').select('*, planos(*)'),
      supabase.from('asaas_webhook_events').select('event_type, status, last_error, asaas_payment_id').order('created_at', { ascending: false }).limit(500),
      // FASE 4 (comercial) — leituras OPCIONAIS. Se a tabela ainda não existe
      // (migration 040 pendente) ou dá erro, seguimos com [] (fail-closed).
      supabase.from('promocoes').select('id, nome, tipo, ativo, data_inicio, data_fim'),
      supabase.from('promocao_resgates').select('promocao_id, empresa_id, manual, criado_em'),
      supabase.from('planos').select('*'),
      supabase.from('motoristas').select('empresa_id, status_cadastro'),
    ]);
    if (faturasR.error) return res.status(500).json({ message: 'Erro ao ler faturas.' });
    if (empresasR.error) return res.status(500).json({ message: 'Erro ao ler empresas.' });
    // Eventos de webhook são opcionais: se a leitura falhar, seguimos sem eles.
    const webhookEvents = eventosR && !eventosR.error ? (eventosR.data || []) : [];
    const promocoes = promocoesR && !promocoesR.error ? (promocoesR.data || []) : [];
    const promocaoResgates = resgatesR && !resgatesR.error ? (resgatesR.data || []) : [];
    const planos = planosR && !planosR.error ? (planosR.data || []) : [];
    // Contagem de motoristas APROVADOS por empresa (base de "acima da capacidade").
    const contagemMotoristasPorEmpresa = {};
    if (motoristasR && !motoristasR.error) {
      for (const m of motoristasR.data || []) {
        if (!m || !m.empresa_id) continue;
        if (m.status_cadastro && m.status_cadastro !== 'aprovado') continue;
        contagemMotoristasPorEmpresa[m.empresa_id] = (contagemMotoristasPorEmpresa[m.empresa_id] || 0) + 1;
      }
    }

    const resumo = resumirBillingHealth({
      faturas: faturasR.data || [],
      empresas: empresasR.data || [],
      webhookEvents,
      promocoes,
      promocaoResgates,
      planos,
      contagemMotoristasPorEmpresa,
    });
    if (eventosR && eventosR.error) resumo.aviso_webhook = 'nao_foi_possivel_ler_eventos_webhook';
    return res.json(resumo);
  } catch (err) {
    console.error('[painel-admin/billing-health] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao gerar billing health.' });
  }
});

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
// Por padrão a listagem OCULTA empresas arquivadas (contas de teste tiradas da
// operação). `?includeArchived=true` (super-admin, herdado do router.use) traz
// todas — para a visão de "Arquivadas" no painel. O filtro é em nível de aplicação
// (empresaArquivamentoService): onde a coluna arquivada_em ainda não existe, nada
// é filtrado e o comportamento é idêntico ao de hoje.
router.get('/empresas', async (req, res) => {
  const { data, error } = await supabase.from('empresas').select('*, planos(id, nome, preco_mensal)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar empresas.' });
  const includeArchived = req.query.includeArchived === 'true';
  res.json(aplicarFiltroArquivamento(data || [], { includeArchived }));
});

router.post('/empresas', async (req, res) => {
  try {
    // Só validamos plano_id quando o cliente informou algum. Se veio vazio, o
    // serviço aplica sua própria resolução (alias/default) e pode nascer sem plano.
    const tipoEmpresa = req.body.tipo || 'transportadora';
    let planoIdValidado;
    if (req.body.plano_id !== undefined && req.body.plano_id !== null && String(req.body.plano_id).trim() !== '') {
      const r = await resolverPlanoId(req.body.plano_id);
      if (r.status) return res.status(r.status).json({ message: r.message });
      // Trava categoria×tipo: autônomo não pode nascer em plano de empresa (e vice-versa).
      const incompat = checarCategoriaPlano(tipoEmpresa, r.categoria);
      if (incompat) return res.status(incompat.status).json({ message: incompat.message });
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
    // Trava categoria×tipo. O tipo vem do body (se enviado) ou do registro atual;
    // só consulta o banco quando há plano com categoria restritiva a checar.
    if (r.categoria != null) {
      let tipoEmpresa = req.body.tipo;
      if (tipoEmpresa === undefined) {
        const { data: atual, error: tipoErr } = await supabase
          .from('empresas').select('tipo').eq('id', req.params.id).maybeSingle();
        if (tipoErr) return res.status(500).json({ message: 'Erro ao validar plano.' });
        if (!atual) return res.status(404).json({ message: 'Empresa não encontrada.' });
        tipoEmpresa = atual.tipo;
      }
      const incompat = checarCategoriaPlano(tipoEmpresa, r.categoria);
      if (incompat) return res.status(incompat.status).json({ message: incompat.message });
    }
    upd.plano_id = r.plano_id;
  }
  if (req.body.status !== undefined) upd.status = req.body.status;
  // Arquivar/desarquivar (autoria vem do token, nunca do body). Ortogonal a
  // status — arquivar NÃO altera suspensão. Mesmo padrão dos planos (frente #6).
  Object.assign(upd, montarPatchArquivamentoEmpresa(req.body, req.user.uid));
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

// PREVIEW de impacto de reprecificação (FASE 5 / mega-frente go-live). READ-ONLY:
// não grava nada, só simula o preço novo e mede o alcance para o super-admin
// decidir antes de aplicar o PUT. Query params (todos opcionais; ausentes = sem
// mudança, impacto zero):
//   novo_preco               → preco_mensal (planos fixos);
//   novo_modelo              → modelo_cobranca ('fixo' | 'por_motorista');
//   novo_preco_por_motorista → preco_por_motorista (planos por motorista);
//   novo_limite_motoristas   → limite_motoristas (planos por motorista).
router.get('/planos/:id/impacto-preco', async (req, res) => {
  const { data: planoAtual, error: planoErr } = await supabase
    .from('planos')
    .select('id, nome, preco_mensal, preco_por_motorista, limite_motoristas, modelo_cobranca')
    .eq('id', req.params.id)
    .maybeSingle();
  if (planoErr) return res.status(500).json({ message: 'Erro ao carregar o plano.' });
  if (!planoAtual) return res.status(404).json({ message: 'Plano não encontrado.' });

  // Traduz a query (só o que veio) para os campos que o serviço puro entende.
  const q = req.query || {};
  const novo = {};
  if (q.novo_preco !== undefined) novo.preco_mensal = q.novo_preco;
  if (q.novo_modelo !== undefined) novo.modelo_cobranca = q.novo_modelo;
  if (q.novo_preco_por_motorista !== undefined) novo.preco_por_motorista = q.novo_preco_por_motorista;
  if (q.novo_limite_motoristas !== undefined) novo.limite_motoristas = q.novo_limite_motoristas;

  // Alcance: empresas no plano, faturas abertas dessas empresas (não mudam), e
  // quantas receberiam o novo valor na próxima recorrência (ativas, sem assinatura).
  const [afetadasR, recorrentesR] = await Promise.all([
    supabase.from('empresas').select('id', { count: 'exact', head: true }).eq('plano_id', req.params.id),
    supabase.from('empresas')
      .select('id', { count: 'exact', head: true })
      .eq('plano_id', req.params.id)
      .eq('status', 'ativo')
      .is('asaas_subscription_id', null),
  ]);
  if (afetadasR.error) return res.status(500).json({ message: 'Erro ao contar empresas afetadas.' });

  const empresas_afetadas = afetadasR.count || 0;
  const proximas_recorrencias = recorrentesR && !recorrentesR.error ? (recorrentesR.count || 0) : 0;

  // Faturas abertas das empresas afetadas (só conta; não são alteradas).
  let faturas_abertas = 0;
  if (empresas_afetadas > 0) {
    const { data: empIds } = await supabase.from('empresas').select('id').eq('plano_id', req.params.id);
    const ids = (empIds || []).map((e) => e.id);
    if (ids.length) {
      const fatR = await supabase
        .from('faturas')
        .select('id', { count: 'exact', head: true })
        .in('empresa_id', ids)
        .in('status', ['pendente', 'vencido']);
      faturas_abertas = fatR && !fatR.error ? (fatR.count || 0) : 0;
    }
  }

  const r = montarImpactoPreco({ planoAtual, novo, empresas_afetadas, faturas_abertas, proximas_recorrencias });
  if (!r.ok) return res.status(r.status).json(r.body);
  return res.json(r.impacto);
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

// ═══════════════════════════════════════════════════════════════════════════
// MEGA-FRENTE Billing Comercial Avançado — endpoints (FASE 3 + FASE 5)
//
// Adaptadores FINOS sobre serviços PUROS já testados
// (calculadoraComercialService, promocaoDomainService). A decisão/dinheiro mora
// nos serviços; aqui só há leitura/escrita no banco. As tabelas de promoção
// (migration 040) podem ainda NÃO estar aplicadas — por isso todo acesso trata
// "tabela ausente" como 503 amigável, sem quebrar o painel.
// ═══════════════════════════════════════════════════════════════════════════

// Detecta relação inexistente (migration ainda não aplicada) para responder 503
// em vez de 500 genérico.
function tabelaAusente(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table|does not exist/i.test(error.message || '');
}
function erroPromocao(res, error, contexto) {
  if (tabelaAusente(error)) {
    return res.status(503).json({ message: 'Recurso de promoções ainda não provisionado (migration 040 pendente).' });
  }
  return res.status(500).json({ message: contexto || 'Erro ao processar promoção.' });
}

// ── FASE 3: recomendação de plano (read-only) ────────────────────────────────
// GET /painel-admin/planos/recomendar?quantidade=10&planoAtualId=<uuid>
// Compara o custo real (base + extras) entre os planos de empresa ativos e
// devolve o mais barato + economia. 41+ → sob negociação.
router.get('/planos/recomendar', async (req, res) => {
  const quantidade = Number(req.query.quantidade);
  const planoAtualId = req.query.planoAtualId ? String(req.query.planoAtualId) : null;
  const { data, error } = await supabase
    .from('planos')
    .select('*')
    .eq('ativo', true)
    .is('arquivado_em', null);
  if (error) return res.status(500).json({ message: 'Erro ao carregar planos.' });
  // Recomendação é para empresa: só planos de empresa/ambos, e nunca os marcados
  // como sob negociação (não têm preço de tabela).
  const candidatos = (data || []).filter(
    (p) => (p.categoria === 'empresa' || p.categoria === 'ambos') && p.requer_negociacao !== true,
  );
  const r = recomendarPlano({ planos: candidatos, quantidade, planoAtualId });
  if (!r.ok) return res.status(400).json({ message: r.message || 'Parâmetros inválidos.' });
  res.json(r);
});

// ── FASE 5: promoções / tickets (super-admin) ────────────────────────────────

// POST /painel-admin/promocoes — criar campanha.
router.post('/promocoes', async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ message: 'Informe o nome da campanha.' });
  if (!PROMO_TIPOS.includes(b.tipo)) return res.status(400).json({ message: 'Tipo de promoção inválido.' });
  if (!b.data_inicio || !b.data_fim) return res.status(400).json({ message: 'Informe início e fim da campanha.' });
  if (new Date(b.data_fim) < new Date(b.data_inicio)) return res.status(400).json({ message: 'A data de fim deve ser posterior ao início.' });

  const linha = {
    nome: String(b.nome).trim(),
    descricao: b.descricao != null ? String(b.descricao) : null,
    tipo: b.tipo,
    percentual: b.percentual != null ? Number(b.percentual) : null,
    valor: b.valor != null ? Number(b.valor) : null,
    duracao_meses: b.duracao_meses != null ? Number(b.duracao_meses) : null,
    dias_trial_extra: b.dias_trial_extra != null ? Number(b.dias_trial_extra) : null,
    data_inicio: b.data_inicio,
    data_fim: b.data_fim,
    ativo: b.ativo !== undefined ? b.ativo === true : true,
    limite_usos_total: b.limite_usos_total != null ? Number(b.limite_usos_total) : null,
    uso_unico_por_empresa: b.uso_unico_por_empresa !== undefined ? b.uso_unico_por_empresa === true : true,
    plano_alvo_id: b.plano_alvo_id || null,
    criado_por: req.user && req.user.uid ? req.user.uid : null,
  };
  const { data, error } = await supabase.from('promocoes').insert(linha).select().single();
  if (error) return erroPromocao(res, error, 'Erro ao criar promoção.');
  res.status(201).json(data);
});

// GET /painel-admin/promocoes — listar campanhas (com códigos).
router.get('/promocoes', async (req, res) => {
  const { data, error } = await supabase
    .from('promocoes')
    .select('*, promocao_codigos(*)')
    .order('criado_em', { ascending: false });
  if (error) return erroPromocao(res, error, 'Erro ao listar promoções.');
  res.json(data || []);
});

// PATCH /painel-admin/promocoes/:id — ativar/desativar, editar datas/limites.
router.patch('/promocoes/:id', async (req, res) => {
  const b = req.body || {};
  const upd = { atualizado_em: new Date().toISOString() };
  if (b.ativo !== undefined) upd.ativo = b.ativo === true;
  if (b.data_inicio !== undefined) upd.data_inicio = b.data_inicio;
  if (b.data_fim !== undefined) upd.data_fim = b.data_fim;
  if (b.limite_usos_total !== undefined) upd.limite_usos_total = b.limite_usos_total != null ? Number(b.limite_usos_total) : null;
  if (b.nome !== undefined) upd.nome = String(b.nome);
  if (b.descricao !== undefined) upd.descricao = b.descricao != null ? String(b.descricao) : null;
  if (upd.data_inicio && upd.data_fim && new Date(upd.data_fim) < new Date(upd.data_inicio)) {
    return res.status(400).json({ message: 'A data de fim deve ser posterior ao início.' });
  }
  const { data, error } = await supabase.from('promocoes').update(upd).eq('id', req.params.id).select().single();
  if (error) return erroPromocao(res, error, 'Erro ao atualizar promoção.');
  if (!data) return res.status(404).json({ message: 'Promoção não encontrada.' });
  res.json(data);
});

// POST /painel-admin/promocoes/:id/codigos — gerar código/ticket.
router.post('/promocoes/:id/codigos', async (req, res) => {
  const codigo = normalizarCodigo(req.body && req.body.codigo);
  if (!codigo) return res.status(400).json({ message: 'Informe o código.' });
  const linha = {
    promocao_id: req.params.id,
    codigo,
    limite_usos: req.body.limite_usos != null ? Number(req.body.limite_usos) : null,
    ativo: req.body.ativo !== undefined ? req.body.ativo === true : true,
  };
  const { data, error } = await supabase.from('promocao_codigos').insert(linha).select().single();
  if (error) {
    if (conflitoUnico(error)) return res.status(409).json({ message: 'Já existe um código com esse nome.' });
    return erroPromocao(res, error, 'Erro ao gerar código.');
  }
  res.status(201).json(data);
});

// POST /painel-admin/promocoes/validar — validar um código (preview, read-only).
// Body: { codigo, empresa_id?, planoEscolhidoId?, precoMensalidade?, valorImplantacao?, trialDiasBase? }
router.post('/promocoes/validar', async (req, res) => {
  const codigo = normalizarCodigo(req.body && req.body.codigo);
  if (!codigo) return res.status(400).json({ message: 'Informe o código.' });
  const { data: cod, error: e1 } = await supabase
    .from('promocao_codigos')
    .select('*, promocoes(*)')
    .ilike('codigo', codigo)
    .maybeSingle();
  if (e1) return erroPromocao(res, e1, 'Erro ao validar código.');
  if (!cod || !cod.promocoes) return res.status(404).json({ codigoInvalido: true, message: 'Código não encontrado.' });

  const promocao = cod.promocoes;
  const empresa = req.body.empresa_id ? { id: req.body.empresa_id } : { id: '__preview__' };
  let resgatesDaEmpresa = [];
  if (req.body.empresa_id && promocao.uso_unico_por_empresa) {
    const { data: rs } = await supabase
      .from('promocao_resgates')
      .select('id')
      .eq('promocao_id', promocao.id)
      .eq('empresa_id', req.body.empresa_id);
    resgatesDaEmpresa = rs || [];
  }
  const aval = avaliarResgate({
    promocao,
    codigoRegistro: cod,
    empresa,
    planoEscolhidoId: req.body.planoEscolhidoId || null,
    resgatesDaEmpresa,
    agora: new Date(),
    manual: false,
  });
  if (!aval.ok) return res.status(422).json({ codigoInvalido: true, motivo: aval.motivo, message: aval.message });

  const efeito = aplicarPromocao({
    promocao,
    precoMensalidade: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : null,
    valorImplantacao: req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null,
    trialDiasBase: req.body.trialDiasBase != null ? Number(req.body.trialDiasBase) : null,
  });
  if (!efeito.ok) return res.status(422).json({ codigoInvalido: true, motivo: efeito.motivo, message: efeito.message });
  res.json({ ok: true, promocao_id: promocao.id, tipo: promocao.tipo, efeito });
});

// POST /painel-admin/promocoes/:id/aplicar — aplicar MANUALMENTE a uma empresa
// (super-admin), inclusive após o fim da campanha. Registra o resgate (auditoria).
// Body: { empresa_id, motivo?, precoMensalidade?, valorImplantacao?, trialDiasBase?, planoEscolhidoId?, fatura_id? }
router.post('/promocoes/:id/aplicar', async (req, res) => {
  const empresa_id = req.body && req.body.empresa_id;
  if (!empresa_id) return res.status(400).json({ message: 'Informe a empresa.' });

  const { data: promocao, error: e1 } = await supabase.from('promocoes').select('*').eq('id', req.params.id).maybeSingle();
  if (e1) return erroPromocao(res, e1, 'Erro ao carregar promoção.');
  if (!promocao) return res.status(404).json({ message: 'Promoção não encontrada.' });

  let resgatesDaEmpresa = [];
  if (promocao.uso_unico_por_empresa) {
    const { data: rs } = await supabase.from('promocao_resgates').select('id').eq('promocao_id', promocao.id).eq('empresa_id', empresa_id);
    resgatesDaEmpresa = rs || [];
  }
  const aval = avaliarResgate({
    promocao,
    empresa: { id: empresa_id },
    planoEscolhidoId: req.body.planoEscolhidoId || null,
    resgatesDaEmpresa,
    agora: new Date(),
    manual: true, // super-admin fura janela/ativo, não os limites
  });
  if (!aval.ok) return res.status(422).json({ motivo: aval.motivo, message: aval.message });

  const efeito = aplicarPromocao({
    promocao,
    precoMensalidade: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : null,
    valorImplantacao: req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null,
    trialDiasBase: req.body.trialDiasBase != null ? Number(req.body.trialDiasBase) : null,
  });
  if (!efeito.ok) return res.status(422).json({ motivo: efeito.motivo, message: efeito.message });

  const resgate = montarResgate({
    promocao,
    empresa: { id: empresa_id },
    aplicadoPor: req.user && req.user.uid ? req.user.uid : null,
    manual: true,
    efeito,
    motivo: req.body.motivo || null,
    faturaId: req.body.fatura_id || null,
    precoOriginal: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : (req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null),
  });
  const { data: inserido, error: e2 } = await supabase.from('promocao_resgates').insert(resgate).select().single();
  if (e2) return erroPromocao(res, e2, 'Erro ao registrar aplicação.');

  // Incrementa contadores (best-effort; não desfaz o resgate se falhar).
  await supabase.from('promocoes').update({ usos_total: (Number(promocao.usos_total) || 0) + 1 }).eq('id', promocao.id);

  res.status(201).json({ ok: true, resgate: inserido, efeito });
});

module.exports = router;
