const { z } = require('zod');

const createDespesaSchema = z.object({
  descricao: z.string().min(2, 'Descrição é obrigatória.').max(300),
  valor: z.coerce.number({ invalid_type_error: 'Valor deve ser um número.' }).positive('Valor deve ser maior que zero.'),
  tipo: z.string().max(50).optional(),
  quem_pagou: z.enum(['proprietario', 'motorista']).optional(),
  frete_id: z.string().uuid('ID do frete inválido.').optional().nullable(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
});

module.exports = { createDespesaSchema };
