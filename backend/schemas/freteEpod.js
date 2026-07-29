const { z } = require('zod');

// null/'' → undefined (o painel manda null em campos vazios; sem isso o coerce
// viraria 0/erro). Mesmo padrão do schemas/fretes.js.
const vazioComoIndefinido = (schema) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), schema);

const STATUS_EPOD = ['registrado', 'validado', 'rejeitado'];

// Campos que o motorista/admin preenche ao comprovar (ou editar) a entrega.
// GPS (latitude/longitude) e assinatura ficam opcionais — o app preenche depois.
const camposComprovacao = {
  recebido_por: vazioComoIndefinido(z.string().trim().max(200, 'Nome de quem recebeu muito longo.').optional()),
  observacao: vazioComoIndefinido(z.string().trim().max(2000, 'Observação muito longa.').optional()),
  latitude: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'Latitude inválida.' }).min(-90, 'Latitude fora do intervalo.').max(90, 'Latitude fora do intervalo.').optional()),
  longitude: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'Longitude inválida.' }).min(-180, 'Longitude fora do intervalo.').max(180, 'Longitude fora do intervalo.').optional()),
  comprovado_em: vazioComoIndefinido(z.string().datetime({ message: 'Data/hora da comprovação inválida (use ISO 8601).' }).optional()),
};

// Registro (POST): pelo menos permite corpo vazio — a comprovação mínima é
// "houve entrega agora"; os detalhes são opcionais.
const registrarEpodSchema = z.object({ ...camposComprovacao });

// Edição (PATCH): mesmos campos, exige ao menos um.
const atualizarEpodSchema = z.object({ ...camposComprovacao })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nenhum campo fornecido para atualização.' });

// Validação administrativa (POST /validacao): aprova ou rejeita a comprovação.
const validarEpodSchema = z.object({
  status: z.enum(['validado', 'rejeitado'], { invalid_type_error: 'Status inválido.' }),
  motivo_rejeicao: vazioComoIndefinido(z.string().trim().max(1000, 'Motivo muito longo.').optional()),
}).superRefine((d, ctx) => {
  if (d.status === 'rejeitado' && !d.motivo_rejeicao) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo_rejeicao'], message: 'Informe o motivo da rejeição.' });
  }
});

module.exports = { STATUS_EPOD, registrarEpodSchema, atualizarEpodSchema, validarEpodSchema };
