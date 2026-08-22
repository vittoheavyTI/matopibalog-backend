'use strict';

const supabase = require('../config/supabase');
const fleet = require('../services/fleet/fleetService');

function responderErro(res, error) {
  if (error instanceof fleet.FleetError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  console.error('[fleetController] erro:', error?.message || error);
  return res.status(500).json({ message: 'Erro ao processar frota.' });
}

const visaoOperacional = async (req, res) => {
  try {
    const dados = await fleet.getOverview(supabase, { empresaId: req.empresa_id, query: req.query, operationalScope: req.operationalScope });
    return res.json(dados);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarAtivos = async (req, res) => {
  try {
    const itens = await fleet.listAssets(supabase, { empresaId: req.empresa_id, query: req.query, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const detalharAtivo = async (req, res) => {
  try {
    const item = await fleet.getAssetDetail(supabase, { empresaId: req.empresa_id, assetId: req.params.id, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarAtivo = async (req, res) => {
  try {
    const item = await fleet.createAsset(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const atualizarAtivo = async (req, res) => {
  try {
    const item = await fleet.updateAsset(supabase, { empresaId: req.empresa_id, user: req.user, id: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarComposicoes = async (req, res) => {
  try {
    const itens = await fleet.listCompositions(supabase, { empresaId: req.empresa_id, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarComposicao = async (req, res) => {
  try {
    const item = await fleet.createComposition(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const adicionarMembroComposicao = async (req, res) => {
  try {
    const item = await fleet.addCompositionMember(supabase, {
      empresaId: req.empresa_id,
      user: req.user,
      compositionId: req.params.id,
      body: req.body || {},
      operationalScope: req.operationalScope,
    });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const encerrarMembroComposicao = async (req, res) => {
  try {
    const item = await fleet.endCompositionMember(supabase, {
      empresaId: req.empresa_id,
      memberId: req.params.memberId,
      body: req.body || {},
      operationalScope: req.operationalScope,
    });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarVinculoMotorista = async (req, res) => {
  try {
    const item = await fleet.createDriverAssignment(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const encerrarVinculoMotorista = async (req, res) => {
  try {
    const item = await fleet.endDriverAssignment(supabase, { empresaId: req.empresa_id, assignmentId: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarVinculoFrete = async (req, res) => {
  try {
    const item = await fleet.createFreightAssignment(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarPneus = async (req, res) => {
  try {
    const itens = await fleet.listTires(supabase, { empresaId: req.empresa_id, query: req.query, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarPneu = async (req, res) => {
  try {
    const item = await fleet.createTire(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const instalarPneu = async (req, res) => {
  try {
    const item = await fleet.installTire(supabase, { empresaId: req.empresa_id, user: req.user, tireId: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const removerInstalacaoPneu = async (req, res) => {
  try {
    const item = await fleet.removeTireInstallation(supabase, { empresaId: req.empresa_id, installationId: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarEventoPneu = async (req, res) => {
  try {
    const item = await fleet.createTireEvent(supabase, { empresaId: req.empresa_id, user: req.user, tireId: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarManutencoes = async (req, res) => {
  try {
    const itens = await fleet.listMaintenanceEvents(supabase, { empresaId: req.empresa_id, query: req.query, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarManutencao = async (req, res) => {
  try {
    const item = await fleet.createMaintenanceEvent(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarOdometros = async (req, res) => {
  try {
    const itens = await fleet.listOdometerEvents(supabase, { empresaId: req.empresa_id, query: req.query, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarOdometro = async (req, res) => {
  try {
    const item = await fleet.createOdometerEvent(supabase, { empresaId: req.empresa_id, user: req.user, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

const listarDocumentosAtivo = async (req, res) => {
  try {
    const itens = await fleet.listDocuments(supabase, { empresaId: req.empresa_id, assetId: req.params.id, operationalScope: req.operationalScope });
    return res.json({ itens });
  } catch (error) {
    return responderErro(res, error);
  }
};

const criarDocumentoAtivo = async (req, res) => {
  try {
    const item = await fleet.createAssetDocument(supabase, { empresaId: req.empresa_id, user: req.user, assetId: req.params.id, body: req.body || {}, operationalScope: req.operationalScope });
    return res.status(201).json(item);
  } catch (error) {
    return responderErro(res, error);
  }
};

module.exports = {
  visaoOperacional,
  listarAtivos,
  detalharAtivo,
  criarAtivo,
  atualizarAtivo,
  listarComposicoes,
  criarComposicao,
  adicionarMembroComposicao,
  encerrarMembroComposicao,
  criarVinculoMotorista,
  encerrarVinculoMotorista,
  criarVinculoFrete,
  listarPneus,
  criarPneu,
  instalarPneu,
  removerInstalacaoPneu,
  criarEventoPneu,
  listarManutencoes,
  criarManutencao,
  listarOdometros,
  criarOdometro,
  listarDocumentosAtivo,
  criarDocumentoAtivo,
};
