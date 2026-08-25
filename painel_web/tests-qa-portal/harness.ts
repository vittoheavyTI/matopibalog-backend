import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route, Request } from '@playwright/test';

// Harness do pacote de aceitação visual. Substitui APENAS as respostas de API:
// componentes, rotas, CSS e textos são o código de produção, sem alteração.
//
// Por que a API fictícia vive no PRÓPRIO localhost, sob o prefixo `/__api`:
// o `index.html` de produção traz uma CSP com `connect-src` restrito a `'self'`
// e aos domínios reais da Matopiba. Um host inventado é bloqueado pelo próprio
// navegador antes de chegar ao interceptador. Usar `'self'` com um prefixo que
// não colide com nenhuma rota do SPA respeita a CSP real (sem afrouxá-la) e, de
// quebra, dá uma garantia mais forte que um host inexistente: a "API" do pacote
// é o próprio servidor local, então não existe caminho para a internet.
//
// A prova de contenção (§46) fica no catch-all abaixo: todo request que sai do
// navegador é inspecionado, e qualquer um cujo destino não seja o servidor local
// é registrado como ESCAPE e abortado. O teste falha se a lista não estiver vazia.

export const PORTA = 5188;
export const ORIGEM_LOCAL = `http://localhost:${PORTA}`;
export const PREFIXO_API = '/__api';
export const API_BASE = `${ORIGEM_LOCAL}${PREFIXO_API}`;

export type Escape = { metodo: string; url: string; motivo: string };

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type Rotas = Record<string, unknown | ((req: Request) => unknown)>;

export type Cenario = {
  // Mapa "MÉTODO /caminho" → corpo da resposta (o caminho é o da API real, sem
  // o prefixo do harness). Um valor numérico vira status de erro (ex.: 403).
  rotas: Rotas;
  tokenPortal?: string;
  tokenInterno?: string;
};

export type Sessao = { escapes: Escape[]; atendidas: string[]; naoMapeadas: string[] };

function corpoDeErro(status: number) {
  if (status === 403) return { message: 'Você não tem permissão para esta ação.', code: 'FORBIDDEN' };
  if (status === 401) return { message: 'Sessão expirada.', code: 'UNAUTHORIZED' };
  return { message: 'Não foi possível concluir a operação.', code: 'ERRO' };
}

export async function instalarFixtures(page: Page, cenario: Cenario): Promise<Sessao> {
  const sessao: Sessao = { escapes: [], atendidas: [], naoMapeadas: [] };

  await page.route('**/*', async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const metodo = request.method();
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    // Qualquer destino que não seja o servidor local é escape — inclui qualquer
    // tentativa de alcançar produção. Abortado e registrado.
    if (!local) {
      sessao.escapes.push({ metodo, url: request.url(), motivo: 'destino fora do harness' });
      await route.abort('blockedbyclient');
      return;
    }

    // Fora do prefixo da API: é o app sendo servido pelo Vite.
    if (!url.pathname.startsWith(PREFIXO_API)) {
      await route.continue();
      return;
    }

    const caminho = url.pathname.slice(PREFIXO_API.length) || '/';
    const chave = `${metodo} ${caminho}`;
    const definida = Object.prototype.hasOwnProperty.call(cenario.rotas, chave)
      ? cenario.rotas[chave]
      : undefined;

    if (definida === undefined) {
      // Sem fixture: escrita é falha dura; leitura fica registrada para revisão.
      const motivo = METODOS_DE_ESCRITA.has(metodo) ? 'ESCRITA sem fixture' : 'leitura sem fixture';
      if (METODOS_DE_ESCRITA.has(metodo)) {
        sessao.escapes.push({ metodo, url: request.url(), motivo });
      } else {
        sessao.naoMapeadas.push(chave);
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"sem fixture"}' });
      return;
    }

    sessao.atendidas.push(chave);
    const valor = typeof definida === 'function' ? (definida as (r: Request) => unknown)(request) : definida;

    if (typeof valor === 'number') {
      await route.fulfill({
        status: valor,
        contentType: 'application/json',
        body: JSON.stringify(corpoDeErro(valor)),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(valor),
    });
  });

  return sessao;
}

// Grava as credenciais fictícias no localStorage da origem do app. Feito por
// navegação real (e não por script de inicialização) porque o localStorage só
// existe depois que a origem foi carregada.
export async function estabelecerSessao(page: Page, cenario: Cenario) {
  if (!cenario.tokenPortal && !cenario.tokenInterno) return;
  await page.goto('/portal/embarcador/entrar');
  await page.evaluate(([tp, ti]) => {
    if (tp) localStorage.setItem('matopibalog_portal_token', tp);
    if (ti) localStorage.setItem('auth_token', ti);
  }, [cenario.tokenPortal || '', cenario.tokenInterno || ''] as const);
}

// Espera a rede assentar e as animações pararem, para o screenshot não pegar um
// spinner no meio do giro.
export async function assentar(page: Page, ms = 450) {
  await page.waitForLoadState('networkidle').catch(() => { /* dev server mantém HMR aberto */ });
  await page.waitForTimeout(ms);
}

export const PASTA_SAIDA = path.resolve(process.cwd(), '..', 'portal-v1-owner-visual');

// Pacote "depois" da correção: fica separado do original, que continua sendo a
// evidência do estado anterior.
export const PASTA_SAIDA_AFTER = path.resolve(process.cwd(), '..', 'portal-v1-owner-visual-after');

export function caminhoDeSaida(sub: string, arquivo: string) {
  const dir = path.join(PASTA_SAIDA, sub);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, arquivo);
}

const REGISTRO: { arquivo: string; cena: string; viewport: string }[] = [];

export function registrar(arquivo: string, cena: string, viewport: string) {
  REGISTRO.push({ arquivo, cena, viewport });
}

export function gravarRegistro(nome = 'registro.json') {
  fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  fs.writeFileSync(path.join(PASTA_SAIDA, nome), JSON.stringify(REGISTRO, null, 2), 'utf8');
}

export const DESKTOP = { width: 1440, height: 900 };
export const TABLET = { width: 768, height: 1024 };
export const MOBILE = { width: 390, height: 844 };
