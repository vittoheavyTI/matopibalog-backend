const express = require('express');
const router = express.Router();
const adminTermosController = require('../controllers/adminTermosController');
const { verifyToken, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const validate = require('../middlewares/validate');
const { criarTermoSchema, atualizarTermoSchema } = require('../schemas/termos');

// Base: exige apenas autenticação. Cada rota declara a própria autoridade: o
// catálogo é documento legal de plataforma (super-admin); o relatório de aceites
// da empresa é informação sobre usuários (users.view).
router.use(verifyToken);

// Relatório de aceites da empresa — admin comum vê a própria (verificarEmpresa).
// Declarada ANTES das rotas /:id para não colidir com elas.
// RBV9-INV-110: o relatório devolve `termos_aceites.*`, que inclui IP e user-agent por
// usuário — dado pessoal. Com `isAdmin` no topo do router, qualquer usuário interno lia
// isso. É informação SOBRE os usuários da empresa, logo `users.view` (que o Operador
// não tem no baseline).
router.get('/empresas/:id/aceites', verificarEmpresa, requirePermission('users.view'), adminTermosController.listarAceitesDaEmpresa);

// Catálogo (super-admin).
router.get('/', isSuperAdmin, adminTermosController.listar);
router.post('/', isSuperAdmin, validate(criarTermoSchema), adminTermosController.criar);
router.patch('/:id/publicar', isSuperAdmin, adminTermosController.publicar);
router.get('/:id/aceites', isSuperAdmin, adminTermosController.listarAceitesDoTermo);
router.patch('/:id', isSuperAdmin, validate(atualizarTermoSchema), adminTermosController.atualizar);

module.exports = router;
