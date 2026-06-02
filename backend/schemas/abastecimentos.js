const { z } = require('zod');

const createAbastecimentoSchema = z.object({
  litros: z.coerce.number({ invalid_type_error: 'Litros deve ser um número.' }).positive('Litros deve ser maior que zero.'),
  valor_total: z.coerce.number({ invalid_type_error: 'Valor total deve ser um número.' }).positive('Valor total deve ser maior que zero.'),
  quem_pagou: z.enum(['proprietario', 'motorista']).optional(),
  arla_litros: z.coerce.number().nonnegative().optional(),
  arla_valor: z.coerce.number().nonnegative().optional(),
  posto: z.string().max(200).optional(),
  frete_id: z.string().uuid('ID do frete inválido.').optional().nullable(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
});

module.exports = { createAbastecimentoSchema };
