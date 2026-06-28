const { z } = require('zod');

const createDespesaSchema = z.object({
  descricao: z.string().min(2, 'Descrição é obrigatória.').max(300),
  valor: z.coerce.number({ invalid_type_error: 'Valor deve ser um número.' }).positive('Valor deve ser maior que zero.'),
  tipo: z.string().max(50).optional(),
  quem_pagou: z.enum(['proprietario', 'motorista']).optional(),
  frete_id: z.string().uuid('ID do frete inválido.').optional().nullable(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
  // Idempotência: id gerado pelo app por tentativa de lançamento. Opcional —
  // sem ele o comportamento é idêntico ao atual. validate.js faz
  // `req.body = result.data`, então o campo PRECISA estar no schema para
  // sobreviver até o controller.
  client_request_id: z.string().trim().max(80).optional(),
});

module.exports = { createDespesaSchema };
