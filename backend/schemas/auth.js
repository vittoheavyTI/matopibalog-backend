const { z } = require('zod');

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
  cpf: z.string().max(20).optional(),
  placa_veiculo: z.string().max(20).optional(),
});

const esqueceuSenhaSchema = z.object({
  email: z.string().email('E-mail inválido.'),
});

const registerEmpresaSchema = z.object({
  nome: z.string().min(2, 'Nome do responsável obrigatório.').max(100),
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres.').max(100),
  empresa: z.string().min(2, 'Nome da empresa obrigatório.').max(150),
  cnpj: z.string().max(20).optional(),
  telefone: z.string().max(20).optional(),
  plano: z.enum(['basico', 'profissional', 'empresarial']).optional(),
});

module.exports = { loginSchema, registerSchema, esqueceuSenhaSchema, registerEmpresaSchema };
