// backend/schemas/promocao.js
// Hardening de segurança dos endpoints de promoções (mega-frente comercial).
// Validação de INPUT com Zod. NÃO altera regra de negócio — só recusa entrada
// malformada com mensagem amigável (o caller devolve 422). A autoridade sobre a
// promoção continua no promocaoDomainService; aqui só barramos lixo antes do banco.

const { z } = require('zod');

const TIPOS = [
  'desconto_percentual_mensalidade',
  'desconto_fixo_mensalidade',
  'desconto_percentual_implantacao',
  'desconto_fixo_implantacao',
  'isencao_implantacao',
  'trial_estendido',
  'preco_promocional',
];

// UUID no formato completo (aceita os IDs legados sem bits RFC de versão/variante,
// mesmo critério do planoIdSchema em schemas/auth.js).
const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Identificador inválido.',
);

// Data ISO parseável.
const dataISO = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Data inválida.');

// Numéricos toleram string ("20") vinda de formulário via coerce.
const percentual = z.coerce.number().min(0, 'Percentual deve ser ≥ 0.').max(100, 'Percentual deve ser ≤ 100.');
const valorNaoNegativo = z.coerce.number().min(0, 'Valor deve ser ≥ 0.');
const inteiroPositivo = z.coerce.number().int('Deve ser inteiro.').min(1, 'Deve ser ≥ 1.');
const inteiroNaoNegativo = z.coerce.number().int('Deve ser inteiro.').min(0, 'Deve ser ≥ 0.');

// Coerência tipo↔campo obrigatório (a mesma que o aplicarPromocao exige no uso).
function checarCoerencia(data, ctx) {
  const precisaPercentual = ['desconto_percentual_mensalidade', 'desconto_percentual_implantacao'].includes(data.tipo);
  const precisaValor = ['desconto_fixo_mensalidade', 'desconto_fixo_implantacao', 'preco_promocional'].includes(data.tipo);
  const precisaDias = data.tipo === 'trial_estendido';
  if (precisaPercentual && data.percentual == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentual'], message: 'Este tipo de promoção exige percentual (0–100).' });
  }
  if (precisaValor && data.valor == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor'], message: 'Este tipo de promoção exige um valor (≥ 0).' });
  }
  if (precisaDias && data.dias_trial_extra == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dias_trial_extra'], message: 'Trial estendido exige dias extras (≥ 1).' });
  }
}

function checarJanela(data, ctx) {
  if (data.data_inicio && data.data_fim && new Date(data.data_fim) < new Date(data.data_inicio)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data_fim'], message: 'A data de fim deve ser posterior ao início.' });
  }
}

// POST /painel-admin/promocoes — criação (campos obrigatórios).
const criarPromocaoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da campanha.').max(120, 'Nome muito longo.'),
  descricao: z.string().max(500, 'Descrição muito longa.').optional().nullable(),
  tipo: z.enum(TIPOS, { errorMap: () => ({ message: 'Tipo de promoção inválido.' }) }),
  percentual: percentual.optional().nullable(),
  valor: valorNaoNegativo.optional().nullable(),
  duracao_meses: inteiroPositivo.optional().nullable(),
  dias_trial_extra: inteiroPositivo.optional().nullable(),
  data_inicio: dataISO,
  data_fim: dataISO,
  ativo: z.boolean().optional(),
  limite_usos_total: inteiroNaoNegativo.optional().nullable(),
  uso_unico_por_empresa: z.boolean().optional(),
  plano_alvo_id: uuid.optional().nullable(),
}).superRefine((data, ctx) => { checarJanela(data, ctx); checarCoerencia(data, ctx); });

// PATCH /painel-admin/promocoes/:id — edição parcial (tudo opcional).
const editarPromocaoSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().max(500).optional().nullable(),
  ativo: z.boolean().optional(),
  data_inicio: dataISO.optional(),
  data_fim: dataISO.optional(),
  limite_usos_total: inteiroNaoNegativo.optional().nullable(),
}).superRefine((data, ctx) => { checarJanela(data, ctx); });

// POST /painel-admin/promocoes/:id/codigos — geração de código/ticket.
// Código: 2–40, só A–Z, 0–9, hífen e underscore (após normalizar em maiúsculas).
const gerarCodigoSchema = z.object({
  codigo: z.string().trim().min(2, 'Código muito curto.').max(40, 'Código muito longo.')
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/, 'Código deve ter apenas letras, números, hífen ou underscore.'),
  limite_usos: inteiroNaoNegativo.optional().nullable(),
  ativo: z.boolean().optional(),
});

// Helper: aplica um schema e devolve { ok, data } ou { ok:false, status:422, body }.
function validar(schema, body) {
  const r = schema.safeParse(body || {});
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    status: 422,
    body: {
      message: 'Dados inválidos.',
      errors: r.error.issues.map((e) => ({ campo: e.path.join('.') || 'body', mensagem: e.message })),
    },
  };
}

module.exports = { TIPOS, criarPromocaoSchema, editarPromocaoSchema, gerarCodigoSchema, validar };
