const { z } = require('zod');

const createFreteSchema = z.object({
  origem: z.string().min(2, 'Origem é obrigatória.').max(200),
  destino: z.string().min(2, 'Destino é obrigatório.').max(200),
  km_inicial: z.coerce.number({ invalid_type_error: 'KM inicial deve ser um número.' }).positive('KM inicial deve ser maior que zero.').optional(),
  valor_frete: z.coerce.number({ invalid_type_error: 'Valor do frete deve ser um número.' }).nonnegative('Valor do frete não pode ser negativo.'),
  quem_recebeu: z.enum(['proprietario', 'motorista']).optional(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
});

// Trata null/'' como "campo não enviado" — o modal do painel manda null quando KM
// está vazio, e z.coerce.number() converteria null para 0 (reprovando no positive
// ou gravando KM 0 indevido).
const vazioComoIndefinido = (schema) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), schema);

// Whitelist da edição: somente campos editáveis pelo painel.
// motorista_id, empresa_id e placa NÃO são editáveis via update.
const updateFreteSchema = z.object({
  origem: z.string().min(2).max(200).optional(),
  destino: z.string().min(2).max(200).optional(),
  km_inicial: vazioComoIndefinido(z.coerce.number().positive('KM inicial deve ser maior que zero.').optional()),
  km_final: vazioComoIndefinido(z.coerce.number().positive('KM final deve ser maior que zero.').optional()),
  valor_frete: z.coerce.number().nonnegative('Valor do frete não pode ser negativo.').optional(),
  quem_recebeu: z.enum(['proprietario', 'motorista']).optional(),
  status: z.enum(['ativo', 'finalizado', 'cancelado', 'pendente']).optional(),
  data: vazioComoIndefinido(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').optional()),
}).refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo fornecido para atualização.' });

module.exports = { createFreteSchema, updateFreteSchema };
