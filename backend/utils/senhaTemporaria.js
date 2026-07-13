const crypto = require('crypto');

// Gera senha temporária aleatória e forte (sem caracteres ambíguos: 0/O/1/l/I)
// usando o crypto nativo do Node. Usada quando o backend cria um usuário e
// precisa devolver uma senha provisória UMA única vez (nunca logada nem
// persistida em texto puro). Espelha a lógica já usada em adminController.
function gerarSenhaTemporaria(tamanho = 14) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += alfabeto[crypto.randomInt(alfabeto.length)];
  }
  return senha;
}

module.exports = { gerarSenhaTemporaria };
