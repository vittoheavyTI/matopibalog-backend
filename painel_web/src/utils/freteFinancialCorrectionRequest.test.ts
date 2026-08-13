import { describe, expect, it } from 'vitest';
import {
  limparRequestIdFreteFinancialCorrection,
  obterRequestIdFreteFinancialCorrection,
  type FreteFinancialCorrectionRequestState,
} from './freteFinancialCorrectionRequest';

const criarSequencia = () => {
  let n = 0;
  return () => `req-${++n}`;
};

const novaRef = () => ({ current: null as FreteFinancialCorrectionRequestState | null });

describe('freteFinancialCorrectionRequest', () => {
  it('reutiliza o mesmo request_id para retry do mesmo payload logico', () => {
    const ref = novaRef();
    const createId = criarSequencia();
    const intent = {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245, km_final: 800 },
      reason: 'correcao financeira legado',
    };

    const primeiro = obterRequestIdFreteFinancialCorrection(ref, intent, createId);
    const retry = obterRequestIdFreteFinancialCorrection(ref, {
      ...intent,
      fields: { km_final: 800, valor_tonelada_km: 0.245 },
    }, createId);

    expect(retry).toBe(primeiro);
  });

  it('gera novo request_id quando o payload financeiro muda', () => {
    const ref = novaRef();
    const createId = criarSequencia();
    const primeiro = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado',
    }, createId);
    const alterado = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.5 },
      reason: 'correcao financeira legado',
    }, createId);

    expect(alterado).not.toBe(primeiro);
  });

  it('gera novo request_id quando o motivo muda', () => {
    const ref = novaRef();
    const createId = criarSequencia();
    const primeiro = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado',
    }, createId);
    const alterado = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira revisada',
    }, createId);

    expect(alterado).not.toBe(primeiro);
  });

  it('gera novo request_id quando o frete muda', () => {
    const ref = novaRef();
    const createId = criarSequencia();
    const primeiro = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado',
    }, createId);
    const outroFrete = obterRequestIdFreteFinancialCorrection(ref, {
      freteId: 'frete-2',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado',
    }, createId);

    expect(outroFrete).not.toBe(primeiro);
  });

  it('apos sucesso limpo, a proxima correcao recebe novo request_id', () => {
    const ref = novaRef();
    const createId = criarSequencia();
    const intent = {
      freteId: 'frete-1',
      fields: { valor_tonelada_km: 0.245 },
      reason: 'correcao financeira legado',
    };

    const primeiro = obterRequestIdFreteFinancialCorrection(ref, intent, createId);
    limparRequestIdFreteFinancialCorrection(ref);
    const proximo = obterRequestIdFreteFinancialCorrection(ref, intent, createId);

    expect(proximo).not.toBe(primeiro);
  });
});
