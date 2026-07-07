// Motivo pelo qual a sessão do painel foi encerrada. Persistido em sessionStorage
// para que a tela de Login exiba a mensagem correta após o redirecionamento.
// Convenção única do projeto — NÃO armazenar token nem dados pessoais aqui.
export type MotivoSessao = 'idle' | 'expired' | 'invalid' | 'manual';

const CHAVE = 'matopibalog_session_expired_reason';

// Grava o motivo APENAS se ainda não houver um registrado. Usado pelos fluxos
// automáticos (interceptor do axios) para não sobrescrever um motivo mais
// específico já definido por um fluxo explícito (ex.: 'idle' do watcher de
// inatividade ou 'manual' do botão de sair).
export function registrarMotivoSessao(motivo: MotivoSessao): void {
  try {
    if (sessionStorage.getItem(CHAVE)) return;
    sessionStorage.setItem(CHAVE, motivo);
  } catch (e) { /* ignore */ }
}

// Grava o motivo SEMPRE. Usado pelos fluxos explícitos (logout manual e
// inatividade), que gravam o motivo antes de qualquer chamada de rede — assim,
// se o /auth/logout falhar e o interceptor disparar, o registrarMotivoSessao
// (soft) não troca o motivo já definido.
export function definirMotivoSessao(motivo: MotivoSessao): void {
  try { sessionStorage.setItem(CHAVE, motivo); } catch (e) { /* ignore */ }
}

// Lê e remove o motivo (consumo único pela tela de Login, para não reaparecer
// após um refresh).
export function consumirMotivoSessao(): MotivoSessao | null {
  try {
    const v = sessionStorage.getItem(CHAVE) as MotivoSessao | null;
    if (v) sessionStorage.removeItem(CHAVE);
    return v;
  } catch (e) {
    return null;
  }
}
