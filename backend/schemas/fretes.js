const { z } = require('zod');

const createFreteSchema = z.object({
  origem: z.string().min(2, 'Origem é obrigatória.').max(200),
  destino: z.string().min(2, 'Destino é obrigatório.').max(200),
  km_inicial: z.coerce.number({ invalid_type_error: 'KM inicial deve ser um número.' }).positive('KM inicial deve ser maior que zero.'),
  valor_frete: z.coerce.number({ invalid_type_error: 'Valor do frete deve ser um número.' }).nonnegative('Valor do frete não pode ser negativo.'),
  quem_recebeu: z.enum(['proprietario', 'motorista']).optional(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
});

const updateFreteSchema = z.object({
  km_final: z.coerce.number().positive('KM final deve ser maior que zero.').optional(),
  valor_frete: z.coerce.number().nonnegative('Valor do frete não pode ser negativo.').optional(),
  status: z.enum(['ativo', 'finalizado', 'cancelado', 'pendente']).optional(),
  destino: z.string().min(2).max(200).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo fornecido para atualização.' });

module.exports = { createFreteSchema, updateFreteSchema };
