// Passthrough validado dos campos comerciais do plano que NÃO entram na fórmula
// de preço (planoPrecoService cuida de preco_mensal/modelo/limite).
//
// Extraído de routes/painel-admin.js para ser testável sem carregar o router.
//
// Campos:
//   - capacidade_inclusa      inteiro >= 0
//   - preco_motorista_extra   dinheiro >= 0 (ou null p/ "não aplicável")
//   - valor_implantacao       dinheiro >= 0 (0 = "implantação grátis")
//   - requer_negociacao       boolean (Enterprise/sob negociação)
//   - limite_negociacao       inteiro >= 0 — teto self-service (acima disso vira negociação)
//   - visivel_cadastro        boolean — controle EXPLÍCITO de aparecer no cadastro público
//
// Editar estes campos NÃO reescreve contratos já emitidos (o contrato congela o
// snapshot do modelo na emissão).

const { paraCentavos } = require('./planoPrecoService');

function montarPatchComercial(body) {
  const patch = {};

  if (body.capacidade_inclusa !== undefined && body.capacidade_inclusa !== null && body.capacidade_inclusa !== '') {
    const n = Number(body.capacidade_inclusa);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, status: 422, body: { message: 'Capacidade inclusa deve ser um inteiro maior ou igual a zero.' } };
    }
    patch.capacidade_inclusa = n;
  }

  for (const campo of ['preco_motorista_extra', 'valor_implantacao']) {
    if (body[campo] !== undefined) {
      if (body[campo] === null || body[campo] === '') {
        patch[campo] = null;
      } else {
        const c = paraCentavos(body[campo]);
        if (!c.ok) {
          return { ok: false, status: 422, body: { message: `Valor inválido em ${campo} (use no máximo 2 casas decimais).` } };
        }
        if (c.centavos < 0) {
          return { ok: false, status: 422, body: { message: `${campo} não pode ser negativo.` } };
        }
        patch[campo] = c.centavos / 100;
      }
    }
  }

  if (body.requer_negociacao !== undefined) {
    patch.requer_negociacao = body.requer_negociacao === true;
  }

  // Teto self-service (limite_negociacao): quantidade acima disso exige negociação.
  // Vazio/null limpa o teto. Coluna já existente no schema.
  if (body.limite_negociacao !== undefined) {
    if (body.limite_negociacao === null || body.limite_negociacao === '') {
      patch.limite_negociacao = null;
    } else {
      const n = Number(body.limite_negociacao);
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, status: 422, body: { message: 'Limite self-service deve ser um inteiro maior ou igual a zero.' } };
      }
      patch.limite_negociacao = n;
    }
  }

  // Visibilidade EXPLÍCITA no cadastro público. Só entra no patch quando o body
  // envia o campo — planos existentes que nunca setaram ficam NULL e o listador
  // público cai na regra legada (ativo && !requer_negociacao).
  if (body.visivel_cadastro !== undefined) {
    patch.visivel_cadastro = body.visivel_cadastro === true;
  }

  return { ok: true, patch };
}

module.exports = { montarPatchComercial };
