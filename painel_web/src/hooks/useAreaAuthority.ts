import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from './usePermissions';

// S1-HIGH-04 — FINANCE_ACCESS_DOES_NOT_IMPLY_CONTRACT_ACCESS.
//
// `/minhas-faturas` é um HUB com DUAS áreas de autoridade distintas. A rodada
// anterior fechou a fronteira em uma direção só (contratação não abre finanças) e
// deixou a outra aberta: quem tinha `finance.saas.view` e NÃO tinha autoridade de
// contratação continuava vendo a aba "Plano e contratação", montando os
// componentes contratuais e chamando `/contratacao/*` — endpoints que o backend
// nega. UI oferecendo uma ação que termina em 403 é um convite ao erro.
//
// As duas autoridades são explícitas e espelham o SERVIDOR:
//
//   FINANCE_ACCESS   = `finance.saas.view`
//                      (rotas `/pagamentos/plano-status`, `/cobrancas/:id`,
//                       `/minhas-faturas/sincronizar`, `/faturas/:id/pix`)
//
//   CONTRACT_ACCESS  = `company.settings.manage` OU empresa `tipo === 'autonomo'`
//                      (é literalmente o `permitirAssinaturaCliente` de
//                       `routes/contratacao.js`)
//
// `empresa_tipo` não é campo inventado aqui: o `AuthContext` já o mapeia de
// `/auth/me` (`data.empresas?.tipo`). Espelhar o servidor é o ponto — um gate de
// frontend com critério próprio foi exatamente o BUG-002.
//
// `role === 'admin'` NÃO é autoridade em lugar nenhum disto.
export type AutoridadeDeArea = {
  /** Pode ver faturas, status de plano e sincronizar. */
  podeFinancas: boolean;
  /** Pode consultar e agir sobre a contratação/contrato. */
  podeContratacao: boolean;
  /** Nenhuma das duas áreas — o hub não tem o que mostrar. */
  semNenhumaArea: boolean;
};

export function useAreaAuthority(): AutoridadeDeArea {
  const { user } = useAuth();
  const { can } = usePermissions();

  const podeFinancas = can('finance.saas.view');
  const podeContratacao = can('company.settings.manage') || user?.empresa_tipo === 'autonomo';

  return {
    podeFinancas,
    podeContratacao,
    semNenhumaArea: !podeFinancas && !podeContratacao,
  };
}
