import { describe, expect, test, beforeEach } from 'vitest';
import {
  OPERATIONAL_GROUP_CONTEXT_KEY,
  OPERATIONAL_UNIT_CONTEXT_KEY,
  gravarGrupoOperacional,
  gravarUnidadeOperacional,
  limparContextoOperacional,
  montarHeadersContextoOperacional,
} from './operationalContextStorage';

describe('operationalContextStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('monta headers de grupo e unidade quando contexto foi escolhido', () => {
    gravarGrupoOperacional('grupo-x');
    gravarUnidadeOperacional('unidade-a');

    expect(montarHeadersContextoOperacional()).toEqual({
      'X-Operational-Group-Id': 'grupo-x',
      'X-Operational-Unit-Id': 'unidade-a',
    });
  });

  test('nao envia headers quando contexto esta vazio', () => {
    expect(montarHeadersContextoOperacional()).toEqual({});
  });

  test('limparContextoOperacional remove grupo e unidade no logout', () => {
    localStorage.setItem(OPERATIONAL_GROUP_CONTEXT_KEY, 'grupo-x');
    localStorage.setItem(OPERATIONAL_UNIT_CONTEXT_KEY, 'unidade-a');

    limparContextoOperacional();

    expect(localStorage.getItem(OPERATIONAL_GROUP_CONTEXT_KEY)).toBeNull();
    expect(localStorage.getItem(OPERATIONAL_UNIT_CONTEXT_KEY)).toBeNull();
  });
});
