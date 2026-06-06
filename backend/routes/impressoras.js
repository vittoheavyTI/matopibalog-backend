const express = require('express');
const router = express.Router();

// ⚠️ Rotas de impressora DESATIVADAS no backend (auditoria #17).
// Detecção/teste de impressora roda na MÁQUINA onde o código executa
// (registro do Windows / lpstat). No servidor (Railway/Linux) nunca
// funcionou e o exec() com input do usuário era RCE não autenticado.
// Impressão é função de CLIENTE (print do navegador / agente local).
// NÃO recolocar lógica de exec/child_process aqui.
// Respostas inócuas para o frontend degradar sem erro (sem 404).

router.get('/todas', (req, res) => res.json([]));
router.get('/buscar/:nome', (req, res) => res.json([]));
router.post('/testar', (req, res) =>
  res.status(410).json({ success: false, error: 'Impressão não disponível no servidor.' })
);
router.get('/health', (req, res) => res.json({ status: 'disabled' }));

module.exports = router;
