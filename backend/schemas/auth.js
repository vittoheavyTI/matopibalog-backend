const { z } = require('zod');

// O catálogo legado contém IDs UUID-shaped sem bits RFC de versão/variante
// (ex.: 00000000-0000-0000-0000-000000000002). Validamos o formato completo
// sem rejeitar esses IDs já publicados.
const planoIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Plano inválido.'
);

const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.'),
});

const registerSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres.').max(100),
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.').max(100),
  tipo: z.enum(['motorista', 'proprietario', 'admin']).optional(),
  codigo_convite: z.string().max(20).optional(),
  plano_id: planoIdSchema.optional(),
  cpf: z.string().max(20).optional(),
  documento_billing: z.string().max(20).optional(),
  documento: z.string().max(20).optional(),
  cnpj: z.string().max(20).optional(),
  placa_veiculo: z.string().max(20).optional(),
  // Fluxo "Autônomo com administrador": dados opcionais do admin a ser criado
  // vinculado à mesma empresa autônoma. Só nome+email; a senha é temporária,
  // gerada no backend. Ignorado no fluxo vinculado (com código de convite).
  administrador: z.object({
    nome: z.string().min(2, 'Nome do administrador deve ter pelo menos 2 caracteres.').max(100),
    email: z.string().email('E-mail do administrador inválido.'),
  }).optional(),
});

const esqueceuSenhaSchema = z.object({
  email: z.string().email('E-mail inválido.'),
});

const resetSenhaSchema = z.object({
  nova_senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.'),
});

const registerEmpresaSchema = z.object({
  nome: z.string().min(2, 'Nome do responsável obrigatório.').max(100),
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.').max(100),
  empresa: z.string().min(2, 'Nome da empresa obrigatório.').max(150),
  cnpj: z.string().max(20).optional(),
  telefone: z.string().max(20).optional(),
  // plano_id (UUID do catálogo público) tem precedência; `plano` (alias legado) é fallback.
  plano_id: planoIdSchema.optional(),
  plano: z.enum(['basico', 'profissional', 'empresarial']).optional(),
  // Código promocional opcional (mega-frente comercial). Validado/aplicado no
  // controller; código inválido NÃO bloqueia o cadastro.
  codigo_promocional: z.string().max(40).optional(),
});

module.exports = { loginSchema, registerSchema, esqueceuSenhaSchema, resetSenhaSchema, registerEmpresaSchema };
