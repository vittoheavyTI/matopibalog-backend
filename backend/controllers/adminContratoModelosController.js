const supabase = require('../config/supabase');
const {
  STATUS_MODELO,
  hashConteudo,
  proximaVersao,
} = require('../services/contratoModeloDomainService');

// CRUD super-admin dos modelos de contrato por plano. Espelha adminTermos:
// criar rascunho, editar SÓ rascunho, publicar (arquiva o publicado anterior do
// plano), arquivar. Não toca Asaas/faturas/planos comerciais.

// GET /admin/contrato-modelos — lista todos os modelos (todas as versões).
exports.listar = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('contrato_modelos')
      .select('id, plano_id, versao, titulo, status, conteudo_hash, publicado_em, criado_em, atualizado_em, criado_por')
      .order('plano_id', { ascending: true })
      .order('versao', { ascending: false });
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (error) {
    console.error('[adminContratoModelos.listar]', error.message || error);
    res.status(500).json({ message: 'Erro ao listar modelos de contrato.' });
  }
};

// GET /admin/contrato-modelos/overview — planos comerciais ativos + modelo vigente.
// Base para a tela: mostra por plano a versão vigente/status e ALERTA os planos
// sem modelo publicado (contratação usa o texto técnico padrão como fallback).
exports.overview = async (_req, res) => {
  try {
    const [{ data: planos, error: ePlanos }, { data: modelos, error: eModelos }] = await Promise.all([
      supabase
        .from('planos')
        .select('id, nome, ativo, requer_negociacao, preco_mensal')
        .eq('ativo', true)
        .order('preco_mensal', { ascending: true }),
      supabase
        .from('contrato_modelos')
        .select('id, plano_id, versao, titulo, status, publicado_em, atualizado_em, criado_em'),
    ]);
    if (ePlanos) throw ePlanos;
    if (eModelos) throw eModelos;

    const porPlano = new Map();
    for (const m of modelos || []) {
      const arr = porPlano.get(m.plano_id) || [];
      arr.push(m);
      porPlano.set(m.plano_id, arr);
    }

    const comerciais = (planos || []).filter((p) => p.requer_negociacao !== true);
    const linhas = comerciais.map((p) => {
      const versoes = porPlano.get(p.id) || [];
      const vigente = versoes.find((m) => m.status === STATUS_MODELO.PUBLICADO) || null;
      const rascunho = versoes.find((m) => m.status === STATUS_MODELO.RASCUNHO) || null;
      const ultimaAtualizacao = versoes
        .map((m) => m.atualizado_em || m.publicado_em || m.criado_em)
        .filter(Boolean)
        .sort()
        .pop() || null;
      return {
        plano_id: p.id,
        plano_nome: p.nome,
        preco_mensal: p.preco_mensal,
        vigente: vigente ? { id: vigente.id, versao: vigente.versao, titulo: vigente.titulo, publicado_em: vigente.publicado_em } : null,
        tem_rascunho: Boolean(rascunho),
        rascunho_id: rascunho ? rascunho.id : null,
        total_versoes: versoes.length,
        ultima_atualizacao: ultimaAtualizacao,
        // Alerta de produto: sem modelo publicado, a contratação usa o texto padrão.
        sem_modelo_vigente: !vigente,
      };
    });

    res.status(200).json({ planos: linhas });
  } catch (error) {
    console.error('[adminContratoModelos.overview]', error.message || error);
    res.status(500).json({ message: 'Erro ao carregar visão de modelos por plano.' });
  }
};

// GET /admin/contrato-modelos/:id — detalhe (inclui conteúdo, para visualizar/editar).
exports.obter = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contrato_modelos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Modelo não encontrado.' });
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminContratoModelos.obter]', error.message || error);
    res.status(500).json({ message: 'Erro ao carregar modelo.' });
  }
};

// POST /admin/contrato-modelos — cria rascunho (status='rascunho', versao=max+1 do plano).
exports.criar = async (req, res) => {
  const { plano_id, titulo, conteudo, vigencia_inicio, vigencia_fim } = req.body;
  try {
    const { data: plano, error: ePlano } = await supabase
      .from('planos')
      .select('id')
      .eq('id', plano_id)
      .maybeSingle();
    if (ePlano) throw ePlano;
    if (!plano) return res.status(404).json({ message: 'Plano não encontrado.' });

    const { data: ultima, error: eUlt } = await supabase
      .from('contrato_modelos')
      .select('versao')
      .eq('plano_id', plano_id)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eUlt) throw eUlt;

    const registro = {
      plano_id,
      versao: proximaVersao(ultima && ultima.versao),
      titulo,
      conteudo,
      conteudo_hash: hashConteudo(conteudo),
      status: STATUS_MODELO.RASCUNHO,
      vigencia_inicio: vigencia_inicio || null,
      vigencia_fim: vigencia_fim || null,
      criado_por: req.user.uid,
    };
    const { data, error } = await supabase
      .from('contrato_modelos')
      .insert(registro)
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('[adminContratoModelos.criar]', error.message || error);
    res.status(500).json({ message: 'Erro ao criar modelo de contrato.' });
  }
};

// PATCH /admin/contrato-modelos/:id — edita SOMENTE rascunho.
exports.atualizar = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: modelo, error: eBusca } = await supabase
      .from('contrato_modelos')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (eBusca) throw eBusca;
    if (!modelo) return res.status(404).json({ message: 'Modelo não encontrado.' });
    if (modelo.status !== STATUS_MODELO.RASCUNHO) {
      return res.status(422).json({ message: 'Modelo publicado/arquivado não pode ser editado. Crie uma nova versão.' });
    }

    const { titulo, conteudo, vigencia_inicio, vigencia_fim } = req.body;
    const patch = { atualizado_em: new Date().toISOString() };
    if (titulo !== undefined) patch.titulo = titulo;
    if (conteudo !== undefined) {
      patch.conteudo = conteudo;
      patch.conteudo_hash = hashConteudo(conteudo);
    }
    if (vigencia_inicio !== undefined) patch.vigencia_inicio = vigencia_inicio;
    if (vigencia_fim !== undefined) patch.vigencia_fim = vigencia_fim;

    const { data, error } = await supabase
      .from('contrato_modelos')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('[adminContratoModelos.atualizar]', error.message || error);
    res.status(500).json({ message: 'Erro ao atualizar modelo.' });
  }
};

// PATCH /admin/contrato-modelos/:id/publicar — arquiva o publicado anterior do
// plano (libera o índice parcial) e publica este. Idempotente.
exports.publicar = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: modelo, error: eBusca } = await supabase
      .from('contrato_modelos')
      .select('id, plano_id, status')
      .eq('id', id)
      .maybeSingle();
    if (eBusca) throw eBusca;
    if (!modelo) return res.status(404).json({ message: 'Modelo não encontrado.' });
    if (modelo.status === STATUS_MODELO.PUBLICADO) {
      return res.status(200).json({ message: 'Modelo já está publicado.', ja_publicado: true });
    }
    if (modelo.status === STATUS_MODELO.ARQUIVADO) {
      return res.status(422).json({ message: 'Modelo arquivado não pode ser publicado. Crie uma nova versão.' });
    }

    const agora = new Date().toISOString();
    // Arquiva o publicado anterior do mesmo plano (se houver).
    const { error: eArquiva } = await supabase
      .from('contrato_modelos')
      .update({ status: STATUS_MODELO.ARQUIVADO, atualizado_em: agora })
      .eq('plano_id', modelo.plano_id)
      .eq('status', STATUS_MODELO.PUBLICADO);
    if (eArquiva) throw eArquiva;

    const { data, error } = await supabase
      .from('contrato_modelos')
      .update({ status: STATUS_MODELO.PUBLICADO, publicado_em: agora, atualizado_em: agora })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.status(200).json({ message: 'Modelo publicado com sucesso.', modelo: data });
  } catch (error) {
    console.error('[adminContratoModelos.publicar]', error.message || error);
    res.status(500).json({ message: 'Erro ao publicar modelo.' });
  }
};

// PATCH /admin/contrato-modelos/:id/arquivar — arquiva (rascunho ou publicado).
exports.arquivar = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: modelo, error: eBusca } = await supabase
      .from('contrato_modelos')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (eBusca) throw eBusca;
    if (!modelo) return res.status(404).json({ message: 'Modelo não encontrado.' });
    if (modelo.status === STATUS_MODELO.ARQUIVADO) {
      return res.status(200).json({ message: 'Modelo já está arquivado.', ja_arquivado: true });
    }
    const { data, error } = await supabase
      .from('contrato_modelos')
      .update({ status: STATUS_MODELO.ARQUIVADO, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    res.status(200).json({ message: 'Modelo arquivado.', modelo: data });
  } catch (error) {
    console.error('[adminContratoModelos.arquivar]', error.message || error);
    res.status(500).json({ message: 'Erro ao arquivar modelo.' });
  }
};
