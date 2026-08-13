import { describe, expect, it } from 'vitest';
import {
  campoFreteEditavelNoInline,
  formatarErroLimiteFrete,
  freteTonKmIncompativelAtual,
  montarRecuperacaoInlineFrete,
  obterErroLimiteFrete,
} from './freteOperationalLimit';

const normalizarEspacos = (texto: string) => texto.replace(/\s/g, ' ');

describe('freteOperationalLimit', () => {
  it('extrai erro operacional sem depender de parse da mensagem', () => {
    const err = { response: { status: 422, data: { error: 'frete_operational_limit', field: 'valor_tonelada_km', current_value: 245, max_value: 10, message: 'x' } } };
    expect(obterErroLimiteFrete(err)?.field).toBe('valor_tonelada_km');
  });

  it('formata mensagem de recuperacao com campo, valor, limite e CTA', () => {
    const msg = formatarErroLimiteFrete({ error: 'frete_operational_limit', field: 'valor_tonelada_km', current_value: 245, max_value: 10 });
    const texto = normalizarEspacos(msg);
    expect(msg).toContain('Não foi possível salvar este frete.');
    expect(msg).toContain('Valor por tonelada/km');
    expect(texto).toContain('R$ 245,00/t·km');
    expect(texto).toContain('R$ 10,00/t·km');
    expect(msg).toContain('Editar frete completo');
  });

  it('prepara recuperacao inline apontando para o mesmo frete no editor completo', () => {
    const freteLegado = { id: 'frete-1', origem: 'Luis Eduardo Magalhaes', valor_tonelada_km: 245 };
    const recovery = montarRecuperacaoInlineFrete(
      [freteLegado],
      'frete-1',
      { km_final: 800 },
      { error: 'frete_operational_limit', field: 'valor_tonelada_km', current_value: 245, max_value: 10 },
    );

    expect(recovery.frete).toBe(freteLegado);
    expect(recovery.mostrarEditorCompleto).toBe(true);
    expect(recovery.message).toContain('Editar frete completo');
  });

  it('identifica campo financeiro fora do alcance do editor rapido', () => {
    expect(campoFreteEditavelNoInline('valor_tonelada_km')).toBe(false);
    expect(campoFreteEditavelNoInline('km_final')).toBe(false);
  });

  it('marca frete tonelada_km legado incompatível com regra atual', () => {
    expect(freteTonKmIncompativelAtual({
      modalidade_calculo: 'tonelada_km',
      toneladas: 5,
      valor_tonelada_km: 245,
      km_inicial: 1,
      km_final: null,
    })).toBe(true);
    expect(freteTonKmIncompativelAtual({
      modalidade_calculo: 'tonelada_km',
      toneladas: 5,
      valor_tonelada_km: 0.245,
      km_inicial: 1,
      km_final: null,
    })).toBe(false);
  });
});
