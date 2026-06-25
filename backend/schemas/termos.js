const { z } = require('zod');

// Tipos de termo aceitos (espelha o CHECK da migration 014).
const TIPOS_TERMO = [
  'termos_uso',
  'politica_privacidade',
  'termo_motorista',
  'consentimento_documentos',
];

// Papéis que podem ser obrigados a aceitar um termo.
const PAPEIS = ['admin', 'motorista'];

// Aceite: o corpo só carrega a origem; ids/hash/versão vêm do termo no servidor.
const aceitarTermoSchema = z.object({
  origem: z.enum(['web', 'app']).default('web'),
});

// Criação de rascunho (sempre ativo=false). versao e conteudo_hash são
// calculados no backend, nunca recebidos do cliente.
const criarTermoSchema = z.object({
  tipo: z.enum(TIPOS_TERMO),
  titulo: z.string().min(1, 'Título é obrigatório.').max(200, 'Título muito longo.'),
  conteudo: z.string().min(1, 'Conteúdo é obrigatório.'),
  resumo: z.string().max(2000).optional(),
  base_legal: z.string().max(100).optional(),
  obrigatorio_para: z.array(z.enum(PAPEIS)).min(1, 'Informe ao menos um papel.').optional(),
});

// Atualização de rascunho: todos opcionais; tipo/versao/ativo NÃO mudam por aqui.
const atualizarTermoSchema = z
  .object({
    titulo: z.string().min(1, 'Título não pode ser vazio.').max(200).optional(),
    conteudo: z.string().min(1, 'Conteúdo não pode ser vazio.').optional(),
    resumo: z.string().max(2000).optional(),
    base_legal: z.string().max(100).optional(),
    obrigatorio_para: z.array(z.enum(PAPEIS)).min(1, 'Informe ao menos um papel.').optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' });

module.exports = {
  aceitarTermoSchema,
  criarTermoSchema,
  atualizarTermoSchema,
  TIPOS_TERMO,
  PAPEIS,
};
