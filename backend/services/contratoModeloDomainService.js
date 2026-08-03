const crypto = require('crypto');

// Domínio PURO dos modelos de contrato por plano. Sem I/O — testável direto.
// Espelha a semântica de versionamento de `termos` (rascunho → publicado →
// arquivado), com a regra: no máximo UM modelo publicado (vigente) por plano.

const STATUS_MODELO = Object.freeze({
  RASCUNHO: 'rascunho',
  PUBLICADO: 'publicado',
  ARQUIVADO: 'arquivado',
});

// SHA-256 hex sobre os bytes UTF-8 — consistente com adminTermosController/Postgres.
function hashConteudo(conteudo) {
  return crypto.createHash('sha256').update(String(conteudo), 'utf8').digest('hex');
}

// Próxima versão de um plano: max(versao) + 1 (começa em 1).
function proximaVersao(ultimaVersao) {
  const n = Number(ultimaVersao);
  return (Number.isFinite(n) && n > 0 ? n : 0) + 1;
}

// Snapshot congelável para gravar no contrato emitido. Retorna null se não houver
// modelo vigente (fallback: o contrato usa o texto técnico padrão).
function snapshotDoModelo(modelo) {
  if (!modelo || !modelo.id) return null;
  return {
    modelo_id: modelo.id,
    modelo_versao: modelo.versao != null ? Number(modelo.versao) : null,
    modelo_conteudo_snapshot: modelo.conteudo != null ? String(modelo.conteudo) : null,
    modelo_conteudo_hash: modelo.conteudo_hash || (modelo.conteudo != null ? hashConteudo(modelo.conteudo) : null),
  };
}

// Só rascunho pode ser editado. Publicado/arquivado exigem NOVA versão.
function podeEditarRascunho(modelo) {
  return Boolean(modelo) && modelo.status === STATUS_MODELO.RASCUNHO;
}

// Só rascunho pode ser publicado (idempotente: publicado já é publicado).
function podePublicar(modelo) {
  return Boolean(modelo) && modelo.status === STATUS_MODELO.RASCUNHO;
}

module.exports = {
  STATUS_MODELO,
  hashConteudo,
  proximaVersao,
  snapshotDoModelo,
  podeEditarRascunho,
  podePublicar,
};
