const { z } = require('zod');

const vazioComoIndefinido = (schema) =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), schema);

const TIPOS_OCORRENCIA = ['atraso', 'avaria', 'recusa', 'reentrega', 'extravio', 'divergencia', 'outro'];
const STATUS_OCORRENCIA = ['aberta', 'em_analise', 'resolvida'];

// Criação (POST): tipo + descrição obrigatórios; data/impacto opcionais.
const criarOcorrenciaSchema = z.object({
  tipo: z.enum(TIPOS_OCORRENCIA, { invalid_type_error: 'Tipo de ocorrência inválido.' }),
  descricao: z.string().trim().min(3, 'Descreva a ocorrência.').max(2000, 'Descrição muito longa.'),
  ocorrido_em: vazioComoIndefinido(z.string().datetime({ message: 'Data/hora da ocorrência inválida (use ISO 8601).' }).optional()),
  impacto: vazioComoIndefinido(z.string().trim().max(500, 'Impacto muito longo.').optional()),
});

// Edição/andamento (PATCH): editar campos e/ou mudar status. Ao resolver, o
// controller exige admin e carimba resolvida_em/resolvida_por.
const atualizarOcorrenciaSchema = z.object({
  tipo: vazioComoIndefinido(z.enum(TIPOS_OCORRENCIA, { invalid_type_error: 'Tipo de ocorrência inválido.' }).optional()),
  descricao: vazioComoIndefinido(z.string().trim().min(3, 'Descrição muito curta.').max(2000, 'Descrição muito longa.').optional()),
  ocorrido_em: vazioComoIndefinido(z.string().datetime({ message: 'Data/hora inválida (use ISO 8601).' }).optional()),
  impacto: vazioComoIndefinido(z.string().trim().max(500, 'Impacto muito longo.').optional()),
  status: vazioComoIndefinido(z.enum(STATUS_OCORRENCIA, { invalid_type_error: 'Status inválido.' }).optional()),
  resolucao: vazioComoIndefinido(z.string().trim().max(2000, 'Resolução muito longa.').optional()),
}).refine((d) => Object.keys(d).length > 0, { message: 'Nenhum campo fornecido para atualização.' })
  .superRefine((d, ctx) => {
    if (d.status === 'resolvida' && !d.resolucao) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolucao'], message: 'Informe a resolução ao marcar como resolvida.' });
    }
  });

module.exports = { TIPOS_OCORRENCIA, STATUS_OCORRENCIA, criarOcorrenciaSchema, atualizarOcorrenciaSchema };
