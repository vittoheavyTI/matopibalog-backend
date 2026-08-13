const { z } = require('zod');

// Trata null/'' como "campo não enviado" — o modal do painel manda null quando KM
// está vazio, e z.coerce.number() converteria null para 0 (reprovando no positive
// ou gravando KM 0 indevido).
const vazioComoIndefinido = (schema) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), schema);

// Modalidade de cálculo (PR-1 tonelada/km). Ausente → tratada como 'valor_fixo'
// no controller, preservando o contrato de clientes antigos (app/APK que não
// enviam o campo). null/'' viram undefined para não reprovar no enum.
const modalidadeSchema = vazioComoIndefinido(
  z.enum(['valor_fixo', 'tonelada_km'], { invalid_type_error: 'Modalidade inválida.' }).optional()
);

// Regra condicional compartilhada por create/update:
//  - modalidade 'tonelada_km' exige toneladas > 0 e valor_tonelada_km > 0
//    (o valor_frete é calculado na finalização, então não é exigido aqui);
//  - modalidade 'valor_fixo' (ou ausente no create) exige valor_frete > 0.
// No update, valor_frete e os campos de tonelada só são cobrados quando o próprio
// update declara a modalidade — edição parcial de outros campos não é bloqueada.
const aplicarRegraModalidade = (data, ctx, { exigirValorFixo }) => {
  if (data.modalidade_calculo === 'tonelada_km') {
    if (data.toneladas === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toneladas'], message: 'Informe as toneladas para frete por tonelada/km.' });
    }
    if (data.valor_tonelada_km === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor_tonelada_km'], message: 'Informe o valor por tonelada/km.' });
    }
  } else if (exigirValorFixo && (data.valor_frete === undefined || data.valor_frete === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor_frete'], message: 'Valor do frete deve ser maior que zero.' });
  }
};

// PR-G2: KM inicial/final são OPCIONAIS na criação (são preenchidos depois / na
// finalização). null/'' viram undefined para não coagir a 0 e reprovar no positive.
// PR-1 tonelada/km: valor_frete passa a ser OPCIONAL no create (exigido só na
// modalidade valor_fixo, via superRefine); na modalidade tonelada_km ele é
// calculado na finalização.
const createFreteSchema = z.object({
  origem: z.string().min(2, 'Origem é obrigatória.').max(200),
  destino: z.string().min(2, 'Destino é obrigatório.').max(200),
  km_inicial: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'KM inicial deve ser um número.' }).positive('KM inicial deve ser maior que zero.').optional()),
  km_final: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'KM final deve ser um número.' }).positive('KM final deve ser maior que zero.').optional()),
  valor_frete: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'Valor do frete deve ser um número.' }).positive('Valor do frete deve ser maior que zero.').optional()),
  modalidade_calculo: modalidadeSchema,
  toneladas: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'Toneladas deve ser um número.' }).positive('Toneladas deve ser maior que zero.').optional()),
  valor_tonelada_km: vazioComoIndefinido(z.coerce.number({ invalid_type_error: 'Valor por tonelada/km deve ser um número.' }).positive('Valor por tonelada/km deve ser maior que zero.').optional()),
  quem_recebeu: z.enum(['proprietario', 'motorista']).optional(),
  motorista_id: z.string().uuid('ID do motorista inválido.').optional(),
  odometro_obrigatorio: z.boolean().optional(),
}).superRefine((data, ctx) => aplicarRegraModalidade(data, ctx, { exigirValorFixo: true }));

// Whitelist da edição: somente campos editáveis pelo painel.
// motorista_id, empresa_id e placa NÃO são editáveis via update.
const updateFreteSchema = z.object({
  origem: z.string().min(2).max(200).optional(),
  destino: z.string().min(2).max(200).optional(),
  km_inicial: vazioComoIndefinido(z.coerce.number().positive('KM inicial deve ser maior que zero.').optional()),
  km_final: vazioComoIndefinido(z.coerce.number().positive('KM final deve ser maior que zero.').optional()),
  valor_frete: z.coerce.number().nonnegative('Valor do frete não pode ser negativo.').optional(),
  modalidade_calculo: modalidadeSchema,
  toneladas: vazioComoIndefinido(z.coerce.number().positive('Toneladas deve ser maior que zero.').optional()),
  valor_tonelada_km: vazioComoIndefinido(z.coerce.number().positive('Valor por tonelada/km deve ser maior que zero.').optional()),
  quem_recebeu: z.enum(['proprietario', 'motorista']).optional(),
  status: z.enum(['ativo', 'finalizado', 'cancelado', 'pendente']).optional(),
  data: vazioComoIndefinido(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').optional()),
})
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo fornecido para atualização.' })
  // No update só exige valor_fixo quando a própria requisição muda a modalidade
  // para valor_fixo — edição parcial de outros campos não é bloqueada.
  .superRefine((data, ctx) => aplicarRegraModalidade(data, ctx, { exigirValorFixo: data.modalidade_calculo === 'valor_fixo' }));

const campoCorrecaoFinanceiraSchema = z.object({
  modalidade_calculo: modalidadeSchema,
  toneladas: vazioComoIndefinido(z.coerce.number().positive('Toneladas deve ser maior que zero.').optional()),
  valor_tonelada_km: vazioComoIndefinido(z.coerce.number().positive('Valor por tonelada/km deve ser maior que zero.').optional()),
  valor_frete: vazioComoIndefinido(z.coerce.number().nonnegative('Valor do frete nao pode ser negativo.').optional()),
  km_inicial: vazioComoIndefinido(z.coerce.number().positive('KM inicial deve ser maior que zero.').optional()),
  km_final: vazioComoIndefinido(z.coerce.number().positive('KM final deve ser maior que zero.').optional()),
}).strict();

const correcaoFinanceiraFreteSchema = z.object({
  fields: campoCorrecaoFinanceiraSchema.refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo financeiro para corrigir.',
  }),
  reason: z.string().trim().min(8, 'Informe o motivo da correcao.').max(500),
  request_id: z.string().trim().min(8).max(128),
}).strict();

module.exports = { createFreteSchema, updateFreteSchema, correcaoFinanceiraFreteSchema };
