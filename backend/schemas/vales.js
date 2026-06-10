const { z } = require('zod');

const createValeSchema = z.object({
  valor: z.coerce.number({ invalid_type_error: 'Valor deve ser um número.' }).positive('Valor do vale deve ser maior que zero.'),
  descricao: z.string().max(300).optional(),
  quem_pagou: z.enum(['proprietario', 'motorista']).optional(),
  posto: z.string().max(200).optional(),
  litros: z.coerce.number().nonnegative().optional(),
  frete_id: z.string().uuid('ID do frete inválido.').optional().nullable(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
});

module.exports = { createValeSchema };
