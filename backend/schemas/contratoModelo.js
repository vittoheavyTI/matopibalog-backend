const { z } = require('zod');

// Criação de rascunho de modelo de contrato. versao e conteudo_hash são
// calculados no backend; status nasce 'rascunho'. plano_id é obrigatório.
const criarContratoModeloSchema = z.object({
  plano_id: z.string().uuid('Plano inválido.'),
  titulo: z.string().min(1, 'Título é obrigatório.').max(200, 'Título muito longo.'),
  conteudo: z.string().min(1, 'Conteúdo é obrigatório.'),
  vigencia_inicio: z.string().datetime().optional(),
  vigencia_fim: z.string().datetime().optional(),
});

// Atualização: só rascunho, campos opcionais. plano_id/versao/status NÃO mudam aqui.
const atualizarContratoModeloSchema = z
  .object({
    titulo: z.string().min(1, 'Título não pode ser vazio.').max(200).optional(),
    conteudo: z.string().min(1, 'Conteúdo não pode ser vazio.').optional(),
    vigencia_inicio: z.string().datetime().nullable().optional(),
    vigencia_fim: z.string().datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' });

module.exports = {
  criarContratoModeloSchema,
  atualizarContratoModeloSchema,
};
