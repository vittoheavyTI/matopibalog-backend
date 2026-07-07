// Traduz erros de violação de unicidade do Postgres/Supabase (SQLSTATE 23505)
// para uma resposta amigável, SEM vazar constraint, código SQL, payload ou
// stack trace ao usuário. Usado nos fluxos de criação/edição de contas.
//
// Retorna { status, message } quando reconhece um conflito de unicidade, ou
// null quando o erro NÃO é 23505 (para não mascarar erros conhecidos, como
// validação de plano). Sempre HTTP 409 para conflito.
function conflitoUnico(error) {
  if (!error) return null;

  const code = error.code || error.sqlState || '';
  const texto = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const ehUnico =
    code === '23505' ||
    texto.includes('duplicate key') ||
    texto.includes('unique constraint');
  if (!ehUnico) return null;

  // Documento (CPF/CNPJ) é o conflito esperado no cadastro de contas.
  if (texto.includes('cnpj') || texto.includes('cpf') || texto.includes('documento')) {
    return { status: 409, message: 'Já existe uma conta cadastrada com este CPF/CNPJ.' };
  }

  // Qualquer outro conflito de unicidade → fallback seguro e genérico.
  return { status: 409, message: 'Já existe um cadastro com os dados informados.' };
}

module.exports = { conflitoUnico };
