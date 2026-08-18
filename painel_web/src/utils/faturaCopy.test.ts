import { describe, it, expect } from 'vitest';
import { brl, mensagemRodapePagamento, ORIGEM_PRODUCTION_ONE_SHOT } from './faturaCopy';

describe('brl (formatação pt-BR)', () => {
  it('formata 5 como R$ 5,00 (vírgula, nunca ponto)', () => {
    const s = brl(5);
    expect(s.replace(/ /g, ' ')).toBe('R$ 5,00');
    expect(s).not.toContain('5.00');
  });
  it('formata 149.9 como R$ 149,90', () => {
    expect(brl(149.9).replace(/ /g, ' ')).toBe('R$ 149,90');
  });
  it('trata null/undefined como 0', () => {
    expect(brl(null).replace(/ /g, ' ')).toBe('R$ 0,00');
    expect(brl(undefined).replace(/ /g, ' ')).toBe('R$ 0,00');
  });
});

describe('mensagemRodapePagamento', () => {
  it('cobrança production (homologacao_one_shot): NÃO diz sandbox nem "sem valor real"', () => {
    const msg = mensagemRodapePagamento(ORIGEM_PRODUCTION_ONE_SHOT);
    expect(msg.toLowerCase()).not.toContain('sandbox');
    expect(msg.toLowerCase()).not.toContain('sem valor real');
    expect(msg).toContain('cobrança real');
    expect(msg).toContain('Asaas');
    expect(msg.toLowerCase()).toContain('trial');
  });
  it('cobrança legado/sandbox: preserva a copy antiga', () => {
    const msg = mensagemRodapePagamento('regularizacao');
    expect(msg.toLowerCase()).toContain('sandbox');
  });
  it('origem ausente: default sandbox (não declara production sem evidência)', () => {
    const msg = mensagemRodapePagamento(undefined);
    expect(msg.toLowerCase()).toContain('sandbox');
    expect(msg).not.toContain('cobrança real');
  });
});
