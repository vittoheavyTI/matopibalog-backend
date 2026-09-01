import { describe, expect, test } from 'vitest';
import { resolverBannerPlano, classesDoTom } from './planoStatusCopy';

// Matriz de ESTADO COMERCIAL (§21). Cada combinação alcançável é exercitada e o
// que se afirma é COERÊNCIA SEMÂNTICA, não a redação exata: nenhum estado que
// bloqueia a operação pode comunicar-se como se estivesse tudo liberado.
//
// Nada aqui toca dinheiro, cobrança ou Asaas — é a camada de comunicação.

describe('matriz comercial — plano ativo x contrato pendente', () => {
  test('plano ativo sem pendência afirma liberação', () => {
    const b = resolverBannerPlano({ status: 'ativo' });
    expect(b.titulo).toBe('Plano ativo');
    expect(b.operacaoLiberada).toBe(true);
    expect(b.tom).toBe('ok');
  });

  test('BUG-005: plano ativo COM contrato obrigatório pendente não afirma liberação', () => {
    const b = resolverBannerPlano({ status: 'ativo', pendenciaObrigatoria: true });
    expect(b.operacaoLiberada).toBe(false);
    // O plano continua ativo — isso é verdade e precisa ser dito...
    expect(b.titulo).toMatch(/Plano ativo/);
    // ...mas a restrição operacional também.
    expect(b.titulo).toMatch(/pendente/i);
    expect(b.texto).toMatch(/restrito|assinatura/i);
    expect(b.tom).toBe('atencao');
    // E jamais a frase que dizia só a metade agradável.
    expect(b.texto).not.toBe('Seu plano está ativo.');
  });

  test('trial ativo com contrato pendente também não afirma liberação', () => {
    const b = resolverBannerPlano({ status: 'trial', trialData: '10/09/2026', pendenciaObrigatoria: true });
    expect(b.operacaoLiberada).toBe(false);
    expect(b.texto).toMatch(/10\/09\/2026/);
    expect(b.texto).toMatch(/assine o contrato/i);
  });

  test('trial ativo sem pendência segue liberado e sem alarme', () => {
    const b = resolverBannerPlano({ status: 'trial', trialData: '10/09/2026' });
    expect(b.operacaoLiberada).toBe(true);
    expect(b.tom).toBe('neutro');
  });

  test('trial expirado vence a pendência de contrato (o pior estado manda)', () => {
    const b = resolverBannerPlano({ status: 'trial', trialExpirado: true, pendenciaObrigatoria: true });
    expect(b.titulo).toBe('Período de teste expirado');
    expect(b.operacaoLiberada).toBe(false);
    expect(b.tom).toBe('critico');
  });
});

describe('matriz comercial — regularização', () => {
  test('suspenso com fatura pagável direciona ao pagamento', () => {
    const b = resolverBannerPlano({ status: 'suspenso', temFaturaComLink: true });
    expect(b.texto).toMatch(/pague a fatura/i);
    expect(b.operacaoLiberada).toBe(false);
  });

  test('suspenso sem fatura pagável direciona ao suporte (não promete um link que não existe)', () => {
    const b = resolverBannerPlano({ status: 'suspenso', temFaturaComLink: false });
    expect(b.texto).toMatch(/suporte/i);
    expect(b.texto).not.toMatch(/pague a fatura/i);
  });

  test('expirado e bloqueado são distinguidos e ambos bloqueiam', () => {
    expect(resolverBannerPlano({ status: 'expirado' }).titulo).toBe('Plano expirado');
    expect(resolverBannerPlano({ status: 'bloqueado' }).titulo).toBe('Plano bloqueado');
    expect(resolverBannerPlano({ status: 'expirado' }).operacaoLiberada).toBe(false);
    expect(resolverBannerPlano({ status: 'bloqueado' }).operacaoLiberada).toBe(false);
  });
});

describe('matriz comercial — invariantes', () => {
  const estados = ['ativo', 'trial', 'suspenso', 'expirado', 'bloqueado', 'desconhecido', null];

  test('nenhuma combinação alcançável fica sem copy', () => {
    for (const status of estados) {
      for (const pendenciaObrigatoria of [true, false]) {
        for (const trialExpirado of [true, false]) {
          const b = resolverBannerPlano({ status, pendenciaObrigatoria, trialExpirado });
          expect(b.titulo, `${status}/${pendenciaObrigatoria}/${trialExpirado}`).toBeTruthy();
          expect(b.texto).toBeTruthy();
          expect(classesDoTom(b.tom)).toBeTruthy();
        }
      }
    }
  });

  test('contrato obrigatório pendente NUNCA convive com operação liberada', () => {
    for (const status of estados) {
      const b = resolverBannerPlano({ status, pendenciaObrigatoria: true });
      expect(b.operacaoLiberada, `${status} liberou a operação com contrato pendente`).toBe(false);
    }
  });

  test('operação liberada implica tom não-alarmante, e vice-versa', () => {
    for (const status of estados) {
      for (const pendenciaObrigatoria of [true, false]) {
        const b = resolverBannerPlano({ status, pendenciaObrigatoria });
        if (b.operacaoLiberada) expect(['ok', 'neutro']).toContain(b.tom);
        else expect(['atencao', 'critico', 'neutro']).toContain(b.tom);
      }
    }
  });

  test('status desconhecido não inventa liberação', () => {
    const b = resolverBannerPlano({ status: 'coisa_nova_do_backend' });
    expect(b.operacaoLiberada).toBe(false);
    expect(b.texto).toMatch(/coisa_nova_do_backend/);
  });
});
