const { z } = require('zod');

const createValeSchema = z.object({
  valor: z.coerce.number({ invalid_type_error: 'Valor deve ser um número.' }).positive('Valor do vale deve ser maior que zero.'),
  // Onda 1 (§11): descrição/observação obrigatória no create manual (paridade
  // web↔app; backend é a autoridade). Registros históricos podem ter descricao nula.
  descricao: z.string().min(2, 'Descrição é obrigatória.').max(300),
  quem_pagou: z.enum(['proprietario', 'motorista']).optional(),
  posto: z.string().max(200).optional(),
  litros: z.coerce.number().nonnegative().optional(),
  frete_id: z.string().uuid('ID do frete inválido.').optional().nullable(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
  // Idempotência: id gerado pelo app por tentativa de lançamento. Opcional —
  // sem ele o comportamento é idêntico ao atual. validate.js faz
  // `req.body = result.data`, então o campo PRECISA estar no schema para
  // sobreviver até o controller.
  client_request_id: z.string().trim().max(80).optional(),
});

module.exports = { createValeSchema };
