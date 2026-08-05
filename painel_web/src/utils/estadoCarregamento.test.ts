import { describe, test, expect } from 'vitest';
import { estadoInicial, reduzir, derivarView, classificarErro, ehErroRetriavel } from './estadoCarregamento';

const erroHttp = (status: number) => ({ response: { status } });

describe('estadoCarregamento — estados distintos', () => {
  test('1. sucesso com dados → status sucesso, mostra dados', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'sucesso', reqId: 1, dados: [1, 2, 3] });
    expect(e.status).toBe('sucesso');
    const v = derivarView(e);
    expect(v.mostrarDados).toBe(true);
    expect(v.mostrarVazio).toBe(false);
    expect(v.mostrarErro).toBe(false);
  });

  test('2. sucesso vazio → status vazio (NÃO erro)', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'sucesso', reqId: 1, dados: [] });
    expect(e.status).toBe('vazio');
    const v = derivarView(e);
    expect(v.mostrarVazio).toBe(true);
    expect(v.mostrarErro).toBe(false);
  });

  test('3. erro NÃO exibe estado vazio (erro e vazio nunca coincidem)', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'falha', reqId: 1, erro: erroHttp(500) });
    expect(e.status).toBe('erro');
    const v = derivarView(e);
    expect(v.mostrarErro).toBe(true);
    expect(v.mostrarVazio).toBe(false); // NUNCA "Nenhum registro cadastrado" após erro
    expect(v.podeTentarNovamente).toBe(true);
    expect(v.mensagemErro).toBeTruthy();
  });

  test('4-8. classificação: timeout/401/403/429/500', () => {
    expect((classificarErro({ code: 'ECONNABORTED' }) as any).tipo).toBe('timeout');
    expect((classificarErro(erroHttp(401)) as any).tipo).toBe('nao_autorizado');
    expect((classificarErro(erroHttp(403)) as any).tipo).toBe('proibido');
    expect((classificarErro(erroHttp(429)) as any).tipo).toBe('rate_limited');
    expect((classificarErro(erroHttp(500)) as any).tipo).toBe('servidor');
    expect((classificarErro({}) as any).tipo).toBe('rede');
  });

  test('9/16. cancelado NÃO vira erro (sem toast, sem mensagem)', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'falha', reqId: 1, erro: { name: 'CanceledError' } });
    expect(e.status).not.toBe('erro');
    expect(e.erro).toBeNull();
    expect(derivarView(e).mostrarErro).toBe(false);
  });

  test('10/11. loading encerra em sucesso e em erro', () => {
    let ok = reduzir(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }), { tipo: 'sucesso', reqId: 1, dados: [1] });
    expect(ok.status).not.toBe('loading');
    let err = reduzir(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }), { tipo: 'falha', reqId: 1, erro: erroHttp(500) });
    expect(err.status).not.toBe('loading');
  });

  test('12. durante loading mostra loading (não estado vazio final)', () => {
    let e = reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 });
    const v = derivarView(e);
    expect(v.mostrarLoading).toBe(true);
    expect(v.mostrarVazio).toBe(false);
  });

  test('15. resposta antiga NÃO sobrescreve resposta mais nova', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'iniciar', reqId: 2 });          // nova requisição
    e = reduzir(e, { tipo: 'sucesso', reqId: 2, dados: [9] }); // nova chega primeiro
    e = reduzir(e, { tipo: 'sucesso', reqId: 1, dados: [1] }); // antiga chega depois
    expect(e.dados).toEqual([9]); // manteve a nova
  });

  test('14. erro após dados mantém dados marcados como desatualizados', () => {
    let e = estadoInicial<number[]>();
    e = reduzir(e, { tipo: 'iniciar', reqId: 1 });
    e = reduzir(e, { tipo: 'sucesso', reqId: 1, dados: [1, 2] });
    e = reduzir(e, { tipo: 'iniciar', reqId: 2 });
    e = reduzir(e, { tipo: 'falha', reqId: 2, erro: erroHttp(500) });
    expect(e.status).toBe('erro');
    expect(e.desatualizado).toBe(true);
    expect(e.dados).toEqual([1, 2]);
  });

  test('ehErroRetriavel: só rede/timeout/5xx/429 (nunca 4xx de negócio nem cancelamento)', () => {
    expect(ehErroRetriavel({ tipo: 'timeout', mensagem: '' })).toBe(true);
    expect(ehErroRetriavel({ tipo: 'rede', mensagem: '' })).toBe(true);
    expect(ehErroRetriavel({ tipo: 'servidor', mensagem: '' })).toBe(true);
    expect(ehErroRetriavel({ tipo: 'rate_limited', mensagem: '' })).toBe(true);
    expect(ehErroRetriavel({ tipo: 'nao_autorizado', mensagem: '' })).toBe(false);
    expect(ehErroRetriavel({ tipo: 'proibido', mensagem: '' })).toBe(false);
    expect(ehErroRetriavel({ tipo: 'generico', mensagem: '' })).toBe(false);
    expect(ehErroRetriavel({ cancelado: true })).toBe(false);
  });

  test('stale-while-revalidate: loading COM dados = atualizando (não some a tabela)', () => {
    let e = reduzir(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }), { tipo: 'sucesso', reqId: 1, dados: [1] });
    e = reduzir(e, { tipo: 'iniciar', reqId: 2 }); // revalidação em segundo plano
    const v = derivarView(e);
    expect(v.atualizando).toBe(true);
    expect(v.mostrarLoading).toBe(false);
    expect(v.mostrarDados).toBe(true);
    expect(v.temDados).toBe(true);
  });

  test('temDados=false em loading inicial e em erro sem dados (contador não é 0 falso)', () => {
    const inicial = derivarView(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }));
    expect(inicial.temDados).toBe(false);
    const erro = derivarView(reduzir(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }), { tipo: 'falha', reqId: 1, erro: erroHttp(500) }));
    expect(erro.temDados).toBe(false);
  });

  test('ultimaAtualizacao é registrada no sucesso', () => {
    const e = reduzir(reduzir(estadoInicial<number[]>(), { tipo: 'iniciar', reqId: 1 }), { tipo: 'sucesso', reqId: 1, dados: [1] });
    expect(typeof e.ultimaAtualizacao).toBe('number');
  });

  // Nota sobre 304: NÃO há teste de "304 = sucesso" porque este reducer opera
  // sobre EVENTOS (iniciar/sucesso/falha), nunca sobre status HTTP. O status 304
  // é resolvido pelo navegador (entrega o corpo em cache como resposta utilizável
  // ao axios); o JS não recebe 304. Por isso validateStatus NÃO foi alterado — a
  // hipótese de "304 vira erro no axios" não foi comprovada.
});
