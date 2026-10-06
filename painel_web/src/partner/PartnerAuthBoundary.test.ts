import { describe, expect, it } from 'vitest';
import { CHAVE_SESSAO, deveEncerrarSessaoParceiro } from './PartnerApp';

describe('Partner Lite — fronteira de sessão externa', () => {
  it('encerra sessão local em 401 e só em 403 com code de identidade/sessão', () => {
    expect(deveEncerrarSessaoParceiro(401)).toBe(true);
    expect(deveEncerrarSessaoParceiro(403, 'parceiro_bloqueado')).toBe(true);
    expect(deveEncerrarSessaoParceiro(403, 'sem_acesso_de_parceiro')).toBe(true);
    expect(deveEncerrarSessaoParceiro(403, 'sessao_invalida')).toBe(true);
    expect(deveEncerrarSessaoParceiro(403, 'credencial_portal_parceiro_invalida')).toBe(true);
    expect(deveEncerrarSessaoParceiro(403)).toBe(false);
    expect(deveEncerrarSessaoParceiro(403, 'relacionamento_inativo')).toBe(false);
    expect(deveEncerrarSessaoParceiro(403, 'convite_email_divergente')).toBe(false);
    expect(deveEncerrarSessaoParceiro(403, 'contexto_invalido')).toBe(false);
    expect(deveEncerrarSessaoParceiro(404)).toBe(false);
    expect(deveEncerrarSessaoParceiro(429)).toBe(false);
    expect(deveEncerrarSessaoParceiro(500)).toBe(false);
    expect(deveEncerrarSessaoParceiro(undefined)).toBe(false);
  });

  it('usa uma chave própria, separada do painel interno e do Portal do Embarcador', () => {
    expect(CHAVE_SESSAO).toBe('matopibalog_partner_token');
    expect(CHAVE_SESSAO).not.toBe('auth_token');
    expect(CHAVE_SESSAO).not.toBe('matopibalog_portal_token');
  });
});
