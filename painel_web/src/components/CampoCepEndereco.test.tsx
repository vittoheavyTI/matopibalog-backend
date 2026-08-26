import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import axios from 'axios';
import { CampoCepEndereco, type EnderecoValores } from './CampoCepEndereco';

// TEAM-FUNC-03 — o que estes testes protegem.
//
// O bug reportado como "a máscara/busca de CEP não funciona sempre" não era da
// API: o `buscarCep` capturava o objeto de estado no closure e, ao responder,
// gravava `{...estadoAntigo, endereco, bairro, cidade}` — apagando o CEP que a
// pessoa acabara de digitar. O teste `preserva o CEP digitado` abaixo falha
// contra aquela implementação e passa contra esta.

vi.mock('axios');
const axiosMock = vi.mocked(axios, true);

// Hospedeiro com estado real: é o updater funcional do pai que fecha o bug, então
// testar o componente com props estáticas não provaria nada.
function Hospedeiro({ inicial }: { inicial?: Partial<EnderecoValores> }) {
  const [valores, setValores] = useState<EnderecoValores>({
    cep: '', endereco: '', bairro: '', cidade: '', ...inicial,
  });
  return (
    <CampoCepEndereco
      idPrefixo="teste"
      valores={valores}
      aoAlterar={(patch) => setValores((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const cep = () => screen.getByLabelText(/^CEP$/i) as HTMLInputElement;
const endereco = () => screen.getByLabelText(/^Endereço$/i) as HTMLInputElement;
const bairro = () => screen.getByLabelText(/^Bairro$/i) as HTMLInputElement;
const cidade = () => screen.getByLabelText(/Cidade \/ UF/i) as HTMLInputElement;

describe('CampoCepEndereco', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  test('1. máscara: 12345678 vira 12345-678 enquanto digita', async () => {
    axiosMock.get.mockResolvedValue({ data: { erro: true } });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '12345678' } });
    expect(cep().value).toBe('12345-678');
  });

  test('2. lookup com 8 dígitos preenche logradouro, bairro e cidade/UF', async () => {
    axiosMock.get.mockResolvedValue({
      data: { logradouro: 'Av. Brasil', bairro: 'Centro', localidade: 'Balsas', uf: 'MA' },
    });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '65800000' } });

    await waitFor(() => expect(endereco().value).toBe('Av. Brasil'));
    expect(bairro().value).toBe('Centro');
    expect(cidade().value).toBe('Balsas - MA');
    expect(axiosMock.get).toHaveBeenCalledWith('https://viacep.com.br/ws/65800000/json/');
  });

  test('3. o CEP digitado NÃO é apagado quando a consulta responde', async () => {
    // A regressão exata: estado obsoleto sobrescrevendo o campo.
    axiosMock.get.mockResolvedValue({
      data: { logradouro: 'Av. Brasil', bairro: 'Centro', localidade: 'Balsas', uf: 'MA' },
    });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '65800000' } });

    await waitFor(() => expect(endereco().value).toBe('Av. Brasil'));
    expect(cep().value).toBe('65800-000');
  });

  test('4. CEP inexistente avisa e mantém os campos editáveis', async () => {
    axiosMock.get.mockResolvedValue({ data: { erro: true } });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '00000000' } });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/CEP não encontrado/i));
    expect(endereco()).not.toBeDisabled();
    fireEvent.change(endereco(), { target: { value: 'Rua Manual, 100' } });
    expect(endereco().value).toBe('Rua Manual, 100');
  });

  test('5. falha de rede avisa sem corromper o que já estava preenchido', async () => {
    axiosMock.get.mockRejectedValue(new Error('offline'));
    render(<Hospedeiro inicial={{ endereco: 'Rua Existente', bairro: 'Bairro X' }} />);
    fireEvent.change(cep(), { target: { value: '65800000' } });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível consultar/i));
    expect(endereco().value).toBe('Rua Existente');
    expect(bairro().value).toBe('Bairro X');
  });

  test('6. não consulta antes dos 8 dígitos', async () => {
    axiosMock.get.mockResolvedValue({ data: {} });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '6580' } });
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('7. não repete a consulta do mesmo CEP a cada tecla', async () => {
    axiosMock.get.mockResolvedValue({
      data: { logradouro: 'Av. Brasil', bairro: 'Centro', localidade: 'Balsas', uf: 'MA' },
    });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '65800000' } });
    await waitFor(() => expect(endereco().value).toBe('Av. Brasil'));
    // Reenviar o mesmo CEP (o que acontece a cada tecla depois do 8º dígito,
    // já que a máscara satura em 8) não pode virar requisição nova.
    fireEvent.change(cep(), { target: { value: '65800-000' } });
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
  });

  test('8. o que a pessoa digita à mão sobrevive — número e complemento não são fabricados', async () => {
    axiosMock.get.mockResolvedValue({
      data: { logradouro: 'Av. Brasil', bairro: 'Centro', localidade: 'Balsas', uf: 'MA' },
    });
    render(<Hospedeiro />);
    fireEvent.change(cep(), { target: { value: '65800000' } });
    await waitFor(() => expect(endereco().value).toBe('Av. Brasil'));

    fireEvent.change(endereco(), { target: { value: 'Av. Brasil, 1200, sala 3' } });
    expect(endereco().value).toBe('Av. Brasil, 1200, sala 3');
    expect(cep().value).toBe('65800-000');
  });
});
