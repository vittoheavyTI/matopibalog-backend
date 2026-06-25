const express = require('express');
const router = express.Router();
const adminTermosController = require('../controllers/adminTermosController');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const validate = require('../middlewares/validate');
const { criarTermoSchema, atualizarTermoSchema } = require('../schemas/termos');

// Base: exige admin autenticado. Ações de escrita exigem super-admin (catálogo
// de termos é documento legal de plataforma).
router.use(verifyToken, isAdmin);

// Relatório de aceites da empresa — admin comum vê a própria (verificarEmpresa).
// Declarada ANTES das rotas /:id para não colidir com elas.
router.get('/empresas/:id/aceites', verificarEmpresa, adminTermosController.listarAceitesDaEmpresa);

// Catálogo (super-admin).
router.get('/', isSuperAdmin, adminTermosController.listar);
router.post('/', isSuperAdmin, validate(criarTermoSchema), adminTermosController.criar);
router.patch('/:id/publicar', isSuperAdmin, adminTermosController.publicar);
router.get('/:id/aceites', isSuperAdmin, adminTermosController.listarAceitesDoTermo);
router.patch('/:id', isSuperAdmin, validate(atualizarTermoSchema), adminTermosController.atualizar);

module.exports = router;
