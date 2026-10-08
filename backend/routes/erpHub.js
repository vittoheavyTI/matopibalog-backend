'use strict';

// Rotas do ERP Integration Hub V1 (E3.7A) — SOMENTE verifiability, read-only.
//   GET /erp-hub/status — estado seguro/inerte do Hub (mode, capabilities, contrato,
//                         estado técnico do entitlement). Nenhuma chamada externa,
//                         nenhuma escrita de negócio, nenhum segredo.
//
// Autoridade: sessão válida + tenant + permissão efetiva integracoes_erp.gerenciar
// (reuso — §11; nunca isAdmin). Super-admin passa por ser autoridade de plataforma.
//
// Esta rota NÃO ativa nada, NÃO conecta nenhum ERP e NUNCA mostra "conectado"/
// "sincronizando". display_status é sempre "em_preparacao".

const express = require('express');
const router = express.Router();

const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { buildHubDiagnostics } = require('../services/erpHub/diagnostics');

// Toda rota exige sessão válida + tenant. Sem acesso anônimo.
router.use(verifyToken, verificarEmpresa);

// Lê o estado técnico REAL da funcionalidade ERP (read-only). Nunca muta.
// Reflete honestamente que o acesso é negado por 'nao_implementada' enquanto o
// status_ciclo_vida não for 'disponivel'.
async function lerEntitlementErp() {
  try {
    const { data, error } = await supabase
      .from('funcionalidades')
      .select('codigo, status_ciclo_vida, ativo')
      .eq('codigo', 'integracoes_erp')
      .maybeSingle();
    if (error || !data) {
      return { codigo: 'integracoes_erp', technical_state: 'unknown', access: 'nao_implementada' };
    }
    const disponivel = data.status_ciclo_vida === 'disponivel' && data.ativo === true;
    return {
      codigo: 'integracoes_erp',
      technical_state: data.status_ciclo_vida,
      // Enquanto não for 'disponivel', o resolverEntitlement nega por nao_implementada.
      access: disponivel ? 'depende_do_plano' : 'nao_implementada',
    };
  } catch (_) {
    return { codigo: 'integracoes_erp', technical_state: 'unknown', access: 'nao_implementada' };
  }
}

// GET /erp-hub/status
router.get('/status', requirePermission('integracoes_erp.gerenciar'), async (req, res) => {
  const entitlement = await lerEntitlementErp();
  const diag = buildHubDiagnostics({ entitlement });
  return res.json(diag);
});

module.exports = router;
