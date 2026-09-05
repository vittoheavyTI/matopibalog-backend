import { describe, expect, test } from 'vitest';
import {
  resolverEstadoComercial, copyComercial, classesDaSeveridade,
  type EntradaEstadoComercial,
} from './commercialAccountState';

// S1-HIGH-02 — a matriz comercial tem UMA autoridade semântica, usada pelo banner
// global do Layout e pelo banner de MinhasFaturas. Estes testes provam duas coisas
// diferentes e igualmente importantes:
//   1. o ESTADO derivado está correto para cada combinação alcançável;
//   2. as DUAS superfícies dizem a mesma coisa (podendo variar em tamanho).
//
// E provam também o que a copy NÃO pode dizer, porque a versão anterior exagerava:
// leitura nunca é bloqueada pelo backend (`verificarPlano` libera GET sempre), e
// contrato pendente não bloqueia escrita em conta v2 ativa.

const CENARIOS: Record<string, EntradaEstadoComercial> = {
  'trial ativo': { status: 'trial', trialAtivo: true },
  'trial ativo + assinatura iniciada': { status: 'trial', trialAtivo: true, assinaturaPendente: true },
  'plano ativo': { status: 'ativo' },
  'plano ativo + contrato obrigatório': { status: 'ativo', contratoPendente: true },
  'contrato obrigatório sem status financeiro': { contratoPendente: true },
  'trial expirado': { status: 'trial', trialExpirado: true },
  'suspenso': { status: 'suspenso' },
  'expirado': { status: 'expirado' },
  'bloqueado': { status: 'bloqueado' },
};

describe('estado comercial — derivação', () => {
  test('plano ativo sem pendência é o único estado plenamente "ok"', () => {
    const e = resolverEstadoComercial(CENARIOS['plano ativo']);
    expect(e.motivo).toBe('plano_ativo');
    expect(e.severidade).toBe('ok');
    expect(e.operacao).toBe('liberada');
  });

  test('plano ativo + contrato obrigatório é atenção, sem afirmar bloqueio', () => {
    const e = resolverEstadoComercial(CENARIOS['plano ativo + contrato obrigatório']);
    expect(e.motivo).toBe('plano_ativo_contrato_pendente');
    expect(e.severidade).toBe('atencao');
    expect(e.contratoPendente).toBe(true);
    expect(e.planoAtivo).toBe(true);
  });

  test('estados de bloqueio real negam a operação', () => {
    for (const nome of ['trial expirado', 'suspenso', 'expirado', 'bloqueado']) {
      const e = resolverEstadoComercial(CENARIOS[nome]);
      expect(e.operacao, nome).toBe('bloqueada');
      expect(e.severidade, nome).toBe('critico');
    }
  });

  test('bloqueio efetivo vence pendência de contrato (o pior estado manda)', () => {
    const e = resolverEstadoComercial({ status: 'suspenso', contratoPendente: true });
    expect(e.motivo).toBe('conta_suspensa');
    expect(e.severidade).toBe('critico');
  });

  test('assinatura pendente não bloqueante no trial é informativa, não alarmante', () => {
    const e = resolverEstadoComercial(CENARIOS['trial ativo + assinatura iniciada']);
    expect(e.motivo).toBe('trial_ativo_assinatura_pendente');
    expect(e.severidade).toBe('informativo');
    expect(e.operacao).toBe('liberada');
  });

  test('toda combinação alcançável produz um motivo e uma severidade válidos', () => {
    for (const [nome, entrada] of Object.entries(CENARIOS)) {
      const e = resolverEstadoComercial(entrada);
      expect(e.motivo, nome).toBeTruthy();
      expect(classesDaSeveridade(e.severidade), nome).toBeTruthy();
    }
  });
});

describe('S1-HIGH-02 — as duas superfícies não se contradizem', () => {
  test('mesmo estado ⇒ mesma severidade e mesmo motivo nas duas superfícies', () => {
    for (const [nome, entrada] of Object.entries(CENARIOS)) {
      const estado = resolverEstadoComercial(entrada);
      const global = copyComercial(estado, 'global');
      const financeiro = copyComercial(estado, 'financeiro');
      expect(global.severidade, nome).toBe(financeiro.severidade);
      expect(global.titulo, nome).toBeTruthy();
      expect(financeiro.titulo, nome).toBeTruthy();
    }
  });

  test('a copy do contrato pendente revela o efeito operacional nas duas superfícies', () => {
    const estado = resolverEstadoComercial({ status: 'ativo', contratoPendente: true });
    for (const superficie of ['global', 'financeiro'] as const) {
      const c = copyComercial(estado, superficie);
      // §11 — não pode esconder o efeito atrás de "formalizar continuidade comercial".
      expect(c.texto, superficie).toMatch(/restrit/i);
      expect(c.texto, superficie).not.toMatch(/formalizar a continuidade comercial/i);
      // ...e não pode exagerar: leitura NUNCA é bloqueada pelo backend.
      expect(c.texto, superficie).not.toMatch(/acesso bloqueado|tudo bloqueado|uso total/i);
      expect(c.texto, superficie).toMatch(/consulta/i);
    }
  });

  test('a copy do plano ativo não afirma liberação total quando há contrato pendente', () => {
    const semPendencia = copyComercial(resolverEstadoComercial({ status: 'ativo' }), 'financeiro');
    const comPendencia = copyComercial(
      resolverEstadoComercial({ status: 'ativo', contratoPendente: true }), 'financeiro',
    );
    expect(semPendencia.texto).toBe('Seu plano está ativo.');
    expect(comPendencia.texto).not.toBe('Seu plano está ativo.');
    expect(comPendencia.titulo).toMatch(/pendente/i);
  });

  test('trial ativo com assinatura iniciada NÃO diz que algo está restrito', () => {
    // O backend é explícito: durante trial válido o contrato pendente não bloqueia
    // operação — ele é apenas a próxima ação. Dizer "restrito" aqui seria mentira.
    const estado = resolverEstadoComercial({ status: 'trial', trialAtivo: true, assinaturaPendente: true });
    for (const superficie of ['global', 'financeiro'] as const) {
      const c = copyComercial(estado, superficie);
      // A copy evita a palavra de propósito: negar uma restrição ("nenhuma ação
      // está restrita") confunde tanto quanto afirmá-la. Durante o trial válido o
      // contrato é a próxima ação, e ponto.
      expect(c.texto, superficie).not.toMatch(/restrit|bloquead/i);
      expect(c.texto, superficie).toMatch(/teste segue ativo/i);
    }
  });
});

describe('copy — contexto e datas', () => {
  test('suspensão com link de pagamento direciona ao pagamento; sem link, ao suporte', () => {
    const e = resolverEstadoComercial({ status: 'suspenso' });
    expect(copyComercial(e, 'financeiro', { temFaturaComLink: true }).texto).toMatch(/pague a fatura/i);
    expect(copyComercial(e, 'financeiro', { temFaturaComLink: false }).texto).toMatch(/suporte/i);
  });

  test('trial expirado usa a data quando existe', () => {
    const e = resolverEstadoComercial({ status: 'trial', trialExpirado: true });
    expect(copyComercial(e, 'financeiro', { trialData: '01/08/2026' }).texto).toMatch(/01\/08\/2026/);
  });

  test('estado indefinido não inventa liberação nem status técnico ao usuário', () => {
    const e = resolverEstadoComercial({ status: 'coisa_nova_do_backend' });
    expect(e.operacao).toBe('indeterminada');
    const c = copyComercial(e, 'financeiro');
    expect(c.texto).not.toMatch(/coisa_nova_do_backend/);
  });
});

describe('S1-HIGH-05 — certeza sobre a operação não é inventada', () => {
  test('contrato pendente é INDETERMINADO, nunca "liberada"', () => {
    // Em conta v2 ativa a escrita segue permitida; em conta legada, não. O frontend
    // não recebe `pode_operar` e portanto não pode escolher um dos dois lados.
    for (const entrada of [
      { status: 'ativo', contratoPendente: true },
      { status: null, contratoPendente: true },
    ]) {
      const e = resolverEstadoComercial(entrada);
      expect(e.operacao, JSON.stringify(entrada)).toBe('indeterminada');
    }
  });

  test('desconhecido NUNCA vira liberada', () => {
    for (const status of ['coisa_nova', '', null, undefined]) {
      const e = resolverEstadoComercial({ status: status as string | null });
      expect(e.operacao, String(status)).not.toBe('liberada');
    }
  });

  test('só há "liberada" onde o backend comprovadamente permite', () => {
    expect(resolverEstadoComercial({ status: 'ativo' }).operacao).toBe('liberada');
    expect(resolverEstadoComercial({ status: 'trial', trialAtivo: true }).operacao).toBe('liberada');
  });

  test('a copy não afirma liberação nem bloqueio quando a operação é indeterminada', () => {
    const estado = resolverEstadoComercial({ status: 'ativo', contratoPendente: true });
    expect(estado.operacao).toBe('indeterminada');
    for (const superficie of ['global', 'financeiro'] as const) {
      const c = copyComercial(estado, superficie);
      expect(c.texto, superficie).not.toMatch(/opera[çc][ãa]o liberada|tudo liberado/i);
      expect(c.texto, superficie).not.toMatch(/opera[çc][ãa]o bloqueada|uso bloqueado/i);
      // E não vaza o enum técnico. Note que "liberada"/"bloqueada" são palavras
      // normais do português ("a consulta continua liberada") — só "indeterminada"
      // seria jargão vazando para o usuário.
      expect(c.texto, superficie).not.toMatch(/indeterminad/i);
    }
  });
});
