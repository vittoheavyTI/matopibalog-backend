import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Correção da aceitação visual do owner — TEAM-VIS-01..05 e TEAM-FUNC-01.
//
// Estes testes exercitam a PÁGINA REAL com a API mockada, no contexto de
// super-admin, que é o caso mais pesado: conta + perfil + seções no mesmo modal.
// O que eles travam não é aparência, é comportamento: a lista que não pode ficar
// aberta, o gate que não pode voltar, e a troca de perfil que precisa chamar o
// endpoint canônico em vez de gravar ponteiro pela tela.

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  avaliarErroResposta: vi.fn(() => ({ sessaoExpirada: false, rateLimited: false })),
  newClientRequestId: () => 'test-id',
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'admin1',
      is_super_admin: true,
      effective_permissions: { 'users.manage': true, 'permissions.manage': true },
    },
  }),
}));

import api from '../api';
import { Usuarios } from './Usuarios';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

// Perfis como o servidor os devolve — já filtrados pela contenção.
const PERFIS = [
  { id: 'tpl-admin', stable_key: 'administrador', nome: 'Administrador', descricao: 'Administra o tenant.', resumo: ['Gerenciar usuários e permissões'], editavel: true },
  { id: 'tpl-operador', stable_key: 'operador', nome: 'Operador', descricao: 'Operação do dia a dia.', resumo: ['Fretes e operação'], editavel: true },
  { id: 'tpl-gerente', stable_key: 'gerente_frota', nome: 'Gerente de Frota', descricao: 'Gestão da frota.', resumo: ['Frota'], editavel: true },
];

const CONTAS = [
  { id: 'emp-1', nome: 'Transportes Cerrado', tipo: 'transportadora' },
  { id: 'emp-2', nome: 'Fazenda Boa Vista', tipo: 'transportadora' },
  { id: 'emp-3', nome: 'Joao Autonomo', tipo: 'autonomo' },
];

const USUARIO = {
  id: 'u1', nome: 'Fulano de Teste', email: 'f@x.com', tipo: 'admin',
  empresa_id: 'emp-1', status: 'ativo',
  permission_template_id: 'tpl-admin', perfil_acesso_nome: 'Administrador',
};

function montar(usuarios: any[] = [USUARIO]) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/admin/usuarios') return Promise.resolve({ data: usuarios });
    if (url === '/admin/perfis-acesso') return Promise.resolve({ data: { itens: PERFIS } });
    return Promise.resolve({ data: CONTAS });
  });
  return render(<MemoryRouter><Usuarios /></MemoryRouter>);
}

const esperarLista = () => waitFor(() => expect(screen.getByText('Fulano de Teste')).toBeInTheDocument());

// O modal é um diálogo: escopar nele separa o que é do formulário do que é da
// lista atrás dele (há um botão "Editar usuário" em cada).
const modal = () => screen.getByRole('dialog');

async function abrirNovoUsuario() {
  montar();
  await esperarLista();
  fireEvent.click(screen.getByRole('button', { name: /novo usuário/i }));
}

async function abrirEdicao() {
  montar();
  await esperarLista();
  fireEvent.click(screen.getByRole('button', { name: /editar usuário/i }));
}

// A página tem um <select> de filtro de contas FORA do modal, cujas <option> também
// respondem a getByRole('option'). Por isso toda busca de opção do typeahead é
// escopada ao seu listbox.
const semListaContas = () => expect(screen.queryByRole('listbox')).toBeNull();

async function escolherConta(termo: string, nome: RegExp) {
  fireEvent.change(screen.getByLabelText(/buscar conta/i), { target: { value: termo } });
  const lista = await screen.findByRole('listbox');
  fireEvent.click(within(lista).getByRole('option', { name: nome }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.put.mockResolvedValue({ data: { ok: true } });
});

describe('Usuarios — correção da aceitação visual', () => {
  test('TEAM-VIS-01: nenhuma conta é renderizada antes de buscar', async () => {
    await abrirNovoUsuario();
    expect(screen.getByLabelText(/buscar conta/i)).toBeInTheDocument();
    // O filtro da página lista contas num <select> próprio; o que não pode existir
    // é o listbox do typeahead aberto sem ninguém ter buscado.
    semListaContas();
  });

  test('TEAM-VIS-01: digitar mostra resultados filtrados; escolher fecha a lista', async () => {
    await abrirNovoUsuario();
    fireEvent.change(screen.getByLabelText(/buscar conta/i), { target: { value: 'cerrado' } });

    const lista = await screen.findByRole('listbox');
    const opcao = within(lista).getByRole('option', { name: /transportes cerrado/i });
    expect(within(lista).queryByRole('option', { name: /fazenda boa vista/i })).toBeNull();

    fireEvent.click(opcao);
    await waitFor(() => semListaContas());
    expect(within(modal()).getByText('Transportes Cerrado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /alterar conta/i })).toBeInTheDocument();
  });

  test('TEAM-VIS-01: "Alterar conta" devolve o campo de busca', async () => {
    await abrirNovoUsuario();
    await escolherConta('cerrado', /transportes cerrado/i);
    fireEvent.click(await screen.findByRole('button', { name: /alterar conta/i }));
    expect(screen.getByLabelText(/buscar conta/i)).toBeInTheDocument();
  });

  test('TEAM-VIS-02: o seletor de perfil começa fechado e fecha ao escolher', async () => {
    await abrirNovoUsuario();
    await escolherConta('cerrado', /transportes cerrado/i);

    const abrir = await screen.findByRole('button', { name: /selecionar perfil de acesso/i });
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(abrir);
    expect(screen.getAllByRole('radio').length).toBe(3);

    fireEvent.click(screen.getByRole('radio', { name: /operador/i }));
    await waitFor(() => expect(screen.queryByRole('radio')).toBeNull());
    expect(screen.getByRole('button', { name: /alterar perfil/i })).toBeInTheDocument();
    expect(screen.getByText(/esta pessoa poderá/i)).toBeInTheDocument();
  });

  test('TEAM-VIS-03/04: as seções existem e não têm gate de Mostrar/Ocultar', async () => {
    await abrirNovoUsuario();
    expect(screen.getByText(/opções de acesso/i)).toBeInTheDocument();
    expect(screen.getByText(/informações adicionais/i)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^mostrar$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ocultar$/i })).toBeNull();

    // O conteúdo está visível de saída, que é o ponto.
    expect(screen.getByLabelText(/senha temporária personalizada/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^CEP$/i)).toBeInTheDocument();
  });

  test('TEAM-VIS-05: "Dados do usuário" oferece a ação de editar', async () => {
    montar();
    await esperarLista();
    fireEvent.click(screen.getByRole('button', { name: /ver usuário/i }));

    const editar = within(modal()).getByRole('button', { name: /^editar usuário$/i });
    fireEvent.click(editar);
    expect(await screen.findByRole('button', { name: /salvar alterações/i })).toBeInTheDocument();
  });

  test('TEAM-FUNC-01: a edição troca o perfil pelo endpoint canônico', async () => {
    await abrirEdicao();

    fireEvent.click(await screen.findByRole('button', { name: /alterar perfil/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /gerente de frota/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => {
      const urls = mockApi.put.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain('/admin/usuarios/u1/perfil-acesso');
    });
    const chamada = mockApi.put.mock.calls.find((c: any[]) => String(c[0]).endsWith('/perfil-acesso'));
    expect(chamada?.[1]).toEqual({ perfil_acesso_id: 'tpl-gerente' });
    // Super-admin age dentro do contexto explícito da conta do usuário (§29).
    expect(chamada?.[2]?.params).toEqual({ empresa_id: 'emp-1' });
  });

  test('TEAM-FUNC-01: sem trocar o perfil, o endpoint de perfil não é chamado', async () => {
    await abrirEdicao();
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    const urls = mockApi.put.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/perfil-acesso'))).toBe(false);
  });

  test('TEAM-FUNC-01: o 409 do último administrador aparece junto do campo', async () => {
    mockApi.put.mockImplementation((url: string) => (String(url).endsWith('/perfil-acesso')
      ? Promise.reject({
        response: {
          status: 409,
          data: { message: 'Não é possível mudar o perfil do último administrador da empresa.' },
        },
      })
      : Promise.resolve({ data: {} })));

    await abrirEdicao();
    fireEvent.click(await screen.findByRole('button', { name: /alterar perfil/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /operador/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));

    expect(await screen.findByText(/último administrador/i)).toBeInTheDocument();
  });

  test('§33: a conta vinculada é somente-leitura e não há como movê-la', async () => {
    await abrirEdicao();
    const conta = await screen.findByLabelText(/conta vinculada/i);
    expect(conta).toHaveAttribute('readonly');
    expect(screen.queryByLabelText(/buscar conta/i)).toBeNull();
  });

  test('§55/§56: trocar de conta limpa o perfil — nunca template estrangeiro', async () => {
    await abrirNovoUsuario();
    await escolherConta('cerrado', /transportes cerrado/i);

    fireEvent.click(await screen.findByRole('button', { name: /selecionar perfil de acesso/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /operador/i }));
    expect(await screen.findByRole('button', { name: /alterar perfil/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /alterar conta/i }));
    await escolherConta('boa vista', /fazenda boa vista/i);

    expect(await screen.findByRole('button', { name: /selecionar perfil de acesso/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alterar perfil/i })).toBeNull();
  });

  test('TEAM-FUNC-04: quem tem permissions.manage vê o atalho para o editor canônico', async () => {
    await abrirNovoUsuario();
    await escolherConta('cerrado', /transportes cerrado/i);
    fireEvent.click(await screen.findByRole('button', { name: /selecionar perfil de acesso/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /operador/i }));

    const link = await screen.findByRole('link', { name: /editar permissões do perfil/i });
    // Aponta para a tela canônica já com perfil e conta — não é um segundo editor.
    expect(link.getAttribute('href')).toContain('/perfis-permissoes');
    expect(link.getAttribute('href')).toContain('perfil=tpl-operador');
    expect(link.getAttribute('href')).toContain('empresa_id=emp-1');
  });
});
