import { useRef, useState } from 'react';
import axios from 'axios';
import { maskCEP } from '../utils/masks';
import { Campo, CLASSE_INPUT, CLASSE_GRADE_2 } from './ModalFormulario';

// CampoCepEndereco — CEP + endereço, em UM lugar só.
//
// POR QUE ISTO EXISTE (`TEAM-FUNC-03`). Havia duas cópias idênticas de
// `buscarCep` (Usuários e Motoristas) e uma terceira variação no modal de edição
// do motorista, que disparava no `onBlur` enquanto a criação disparava no
// `onChange`. Quatro superfícies, três comportamentos.
//
// E havia um bug que explica o "às vezes não funciona" relatado:
//
//     const masked = maskCEP(e.target.value);
//     setNewUser({ ...newUser, cep: masked });   // grava o CEP
//     buscarCep(masked);                          // async, com `newUser` do closure
//
// Quando a busca voltava, ela fazia `setNewUser({ ...newUser, endereco, ... })`
// usando o `newUser` capturado ANTES da digitação — e o CEP recém-digitado
// desaparecia do campo. Não era instabilidade da API: era estado obsoleto.
//
// A correção é estrutural: este componente nunca monta o objeto inteiro. Ele
// entrega um PATCH e o pai aplica com updater funcional (`setX(prev => ...)`),
// então o que a busca preenche não pode apagar o que a pessoa digitou.

export type EnderecoValores = {
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
};

type Patch = Partial<EnderecoValores>;

export function CampoCepEndereco({
  valores, aoAlterar, idPrefixo, desabilitado = false,
}: {
  valores: EnderecoValores;
  /** Recebe um patch parcial. O pai DEVE aplicar com updater funcional. */
  aoAlterar: (patch: Patch) => void;
  idPrefixo: string;
  desabilitado?: boolean;
}) {
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Evita repetir a consulta do mesmo CEP a cada tecla depois do 8º dígito.
  const ultimoConsultado = useRef<string>('');

  const buscar = async (digitos: string) => {
    if (ultimoConsultado.current === digitos) return;
    ultimoConsultado.current = digitos;
    setBuscando(true);
    setAviso(null);
    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${digitos}/json/`);
      if (data?.erro) {
        // §26: falha precisa ser dizível. Antes, um CEP inexistente não produzia
        // nenhum sinal — a pessoa ficava esperando um preenchimento que nunca vinha.
        setAviso('CEP não encontrado. Preencha o endereço manualmente.');
        return;
      }
      // §24/§25: preenche o que a base tem; número e complemento são de quem
      // conhece o endereço, e inventá-los seria pior que deixá-los vazios.
      aoAlterar({
        endereco: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.localidade ? `${data.localidade} - ${data.uf}` : '',
      });
    } catch {
      setAviso('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
    } finally {
      setBuscando(false);
    }
  };

  const aoDigitarCep = (bruto: string) => {
    const mascarado = maskCEP(bruto);
    aoAlterar({ cep: mascarado });
    const digitos = mascarado.replace(/\D/g, '');
    if (digitos.length === 8) {
      buscar(digitos);
    } else {
      ultimoConsultado.current = '';
      if (aviso) setAviso(null);
    }
  };

  return (
    <>
      <div className={CLASSE_GRADE_2}>
        <Campo
          id={`${idPrefixo}-cep`}
          rotulo="CEP"
          erro={aviso}
          ajuda={buscando ? 'Buscando endereço…' : undefined}
        >
          <input
            id={`${idPrefixo}-cep`}
            className={CLASSE_INPUT}
            placeholder="00000-000"
            inputMode="numeric"
            maxLength={9}
            disabled={desabilitado}
            value={valores.cep}
            onChange={(e) => aoDigitarCep(e.target.value)}
          />
        </Campo>
        <Campo id={`${idPrefixo}-endereco`} rotulo="Endereço">
          <input
            id={`${idPrefixo}-endereco`}
            className={CLASSE_INPUT}
            placeholder="Rua, número, complemento"
            disabled={desabilitado}
            value={valores.endereco}
            onChange={(e) => aoAlterar({ endereco: e.target.value })}
          />
        </Campo>
      </div>

      <div className={CLASSE_GRADE_2}>
        <Campo id={`${idPrefixo}-bairro`} rotulo="Bairro">
          <input
            id={`${idPrefixo}-bairro`}
            className={CLASSE_INPUT}
            disabled={desabilitado}
            value={valores.bairro}
            onChange={(e) => aoAlterar({ bairro: e.target.value })}
          />
        </Campo>
        <Campo id={`${idPrefixo}-cidade`} rotulo="Cidade / UF">
          <input
            id={`${idPrefixo}-cidade`}
            className={CLASSE_INPUT}
            placeholder="Cidade - UF"
            disabled={desabilitado}
            value={valores.cidade}
            onChange={(e) => aoAlterar({ cidade: e.target.value })}
          />
        </Campo>
      </div>
    </>
  );
}
