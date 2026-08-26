import React, { useState } from 'react';
import { Users, UserPlus, Copy, Check, Ban, PlayCircle, PauseCircle } from 'lucide-react';
import api from '../api';
import { useCarregamento } from '../hooks/useCarregamento';
import { ErroCarregamento } from '../components/ErroCarregamento';
import { mensagemErro } from '../utils/mensagemErro';
import {
  ModalFormulario, Campo, CLASSE_INPUT, CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, CLASSE_GRADE_2,
} from '../components/ModalFormulario';

// Rede de parceiros (E3.6A) — a lista de organizações com quem esta empresa
// escolheu compartilhar oportunidades.
//
// O que esta tela NÃO é: um diretório, uma busca de transportadoras, um
// marketplace. Não existe descoberta — cada parceiro entra por convite explícito
// desta empresa, e some daqui quando é revogado.
//
// Divulgação progressiva (§49): a linha mostra nome, tipo, situação e última
// atividade. Nada de matriz de edição inline.

type Parceiro = {
  id: string;
  nome: string;
  documento: string | null;
  tipo: 'LITE' | 'CLIENTE';
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  criado_em: string;
  ativado_em: string | null;
  revogado_em: string | null;
  ultima_atividade_em: string | null;
};

const ROTULO_SITUACAO: Record<Parceiro['status'], string> = {
  INVITED: 'Convite enviado',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  REVOKED: 'Revogado',
};

const TOM_SITUACAO: Record<Parceiro['status'], string> = {
  INVITED: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-gray-100 text-gray-600',
  REVOKED: 'bg-red-100 text-red-700',
};

function formatarData(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const RedeParceiros: React.FC = () => {
  const { estado, view, recarregar } = useCarregamento<Parceiro>(
    (signal) => api.get('/rede-parceiros/parceiros', { signal }).then((r) => r.data?.itens || []),
  );

  const parceiros: Parceiro[] = estado.dados || [];
  const carregando = view.mostrarLoading;
  const erroCarga = view.mostrarErro ? view.mensagemErro : null;

  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroValidacao, setErroValidacao] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState({ nome: '', email: '', documento: '' });
  // O link de convite aparece UMA vez, logo após criar. Não é recuperável depois:
  // o servidor guarda apenas o hash do token.
  const [convite, setConvite] = useState<{ nome: string; url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const convidar = async () => {
    const erros: Record<string, string> = {};
    if (!novo.nome.trim()) erros.nome = 'Informe o nome do parceiro.';
    if (!novo.email.trim() || !novo.email.includes('@')) erros.email = 'Informe um e-mail válido.';
    if (Object.keys(erros).length) { setErroValidacao(erros); return; }

    setSalvando(true);
    setErroValidacao({});
    try {
      const { data } = await api.post('/rede-parceiros/parceiros', {
        nome: novo.nome.trim(),
        email: novo.email.trim(),
        documento: novo.documento.trim() || null,
      });
      const url = `${window.location.origin}${import.meta.env.BASE_URL}portal/parceiro/ativar?token=${encodeURIComponent(data.convite.token)}`;
      setConvite({ nome: data.nome, url });
      setModalAberto(false);
      setNovo({ nome: '', email: '', documento: '' });
      recarregar();
    } catch (e) {
      setErroValidacao({ geral: mensagemErro(e, 'Não foi possível convidar o parceiro.') });
    } finally {
      setSalvando(false);
    }
  };

  const alterarSituacao = async (parceiro: Parceiro, status: Parceiro['status']) => {
    try {
      await api.patch(`/rede-parceiros/parceiros/${parceiro.id}/situacao`, { status });
      recarregar();
    } catch { /* a lista recarrega no próximo ciclo; o erro não some com o estado */ }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-800">Rede de parceiros</h1>
          <p className="mt-1 text-sm text-gray-500">
            Empresas com quem você pode compartilhar lacunas de capacidade das suas campanhas.
            Cada parceiro entra por convite seu — não há busca pública nem diretório.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setModalAberto(true); setErroValidacao({}); }}
          className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-green-800 active:scale-95"
        >
          <UserPlus size={16} />
          Convidar parceiro
        </button>
      </div>

      {/* O link do convite aparece uma única vez — depois disso o servidor só tem
          o hash. Dizer isso na tela evita a pergunta "onde vejo de novo?". */}
      {convite && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-bold text-blue-900">Convite criado para {convite.nome}</p>
          <p className="mt-1 text-xs text-blue-800">
            Envie este link ao parceiro. Ele aparece só agora — depois de fechar, não é possível vê-lo de novo.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
              {convite.url}
            </code>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(convite.url); setCopiado(true); }}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              {copiado ? <Check size={14} /> : <Copy size={14} />}
              {copiado ? 'Copiado' : 'Copiar link'}
            </button>
            <button
              type="button"
              onClick={() => { setConvite(null); setCopiado(false); }}
              className="shrink-0 text-xs font-bold text-blue-700 hover:underline"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {carregando ? (
          <p className="p-8 text-center text-gray-500">Carregando parceiros…</p>
        ) : erroCarga ? (
          <div className="p-4"><ErroCarregamento mensagem={erroCarga} onTentar={recarregar} compacto /></div>
        ) : parceiros.length === 0 ? (
          <div className="p-8 text-center">
            <Users size={28} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-medium text-gray-600">Sua rede ainda está vazia.</p>
            <p className="mt-1 text-xs text-gray-500">
              Convide um parceiro para poder compartilhar a lacuna de capacidade de uma campanha.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse text-left">
              <thead>
                <tr className="bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-600">
                  <th className="border-b p-3">Parceiro</th>
                  <th className="border-b p-3">Tipo</th>
                  <th className="border-b p-3">Situação</th>
                  <th className="border-b p-3">Última atividade</th>
                  <th className="border-b p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {parceiros.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/60">
                    <td className="p-3 align-top">
                      <p className="font-bold text-gray-800">{p.nome}</p>
                      {p.documento && <p className="text-xs text-gray-500">{p.documento}</p>}
                    </td>
                    <td className="p-3 align-top">
                      {/* Lite = sem conta Matopiba. É informação operacional real:
                          muda por onde a pessoa responde. */}
                      <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                        {p.tipo === 'CLIENTE' ? 'Cliente Matopiba' : 'Parceiro convidado'}
                      </span>
                    </td>
                    <td className="p-3 align-top">
                      <span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${TOM_SITUACAO[p.status]}`}>
                        {ROTULO_SITUACAO[p.status]}
                      </span>
                    </td>
                    <td className="p-3 align-top text-sm text-gray-600">
                      {formatarData(p.ultima_atividade_em)}
                    </td>
                    <td className="p-3 text-right align-top">
                      <div className="flex items-center justify-end gap-2">
                        {p.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => alterarSituacao(p, 'SUSPENDED')}
                            className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            title="Suspender temporariamente"
                          >
                            <PauseCircle size={16} /> Suspender
                          </button>
                        )}
                        {p.status === 'SUSPENDED' && (
                          <button
                            type="button"
                            onClick={() => alterarSituacao(p, 'ACTIVE')}
                            className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
                          >
                            <PlayCircle size={16} /> Reativar
                          </button>
                        )}
                        {p.status !== 'REVOKED' && (
                          <button
                            type="button"
                            onClick={() => alterarSituacao(p, 'REVOKED')}
                            className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            title="Encerra o acesso imediatamente"
                          >
                            <Ban size={16} /> Revogar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModalFormulario
        aberto={modalAberto}
        titulo="Convidar parceiro"
        icone={<UserPlus size={20} className="text-blue-600" />}
        aoFechar={() => setModalAberto(false)}
        rodape={(
          <>
            <button type="button" onClick={() => setModalAberto(false)} className={CLASSE_BOTAO_SECUNDARIO}>
              Cancelar
            </button>
            <button type="button" onClick={convidar} disabled={salvando} className={CLASSE_BOTAO_PRIMARIO}>
              {salvando ? 'Criando convite…' : 'Criar convite'}
            </button>
          </>
        )}
      >
        {erroValidacao.geral && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {erroValidacao.geral}
          </p>
        )}

        <div className={CLASSE_GRADE_2}>
          <Campo id="parceiro-nome" rotulo="Nome do parceiro" obrigatorio erro={erroValidacao.nome}>
            <input
              id="parceiro-nome" className={CLASSE_INPUT}
              placeholder="Ex.: Transportes Cerrado"
              value={novo.nome}
              onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            />
          </Campo>
          <Campo id="parceiro-email" rotulo="E-mail para o convite" obrigatorio erro={erroValidacao.email}>
            <input
              id="parceiro-email" type="email" className={CLASSE_INPUT}
              placeholder="contato@parceiro.com.br"
              value={novo.email}
              onChange={(e) => setNovo((p) => ({ ...p, email: e.target.value }))}
            />
          </Campo>
        </div>

        <Campo id="parceiro-doc" rotulo="CNPJ" ajuda="Opcional. Serve para você identificar o parceiro — não cria vínculo automático com nenhuma conta.">
          <input
            id="parceiro-doc" className={CLASSE_INPUT}
            value={novo.documento}
            onChange={(e) => setNovo((p) => ({ ...p, documento: e.target.value }))}
          />
        </Campo>

        <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          O convite gera um link que você mesmo envia ao parceiro. Ele terá acesso apenas às
          oportunidades que você compartilhar — nunca aos seus fretes, motoristas ou financeiro.
        </p>
      </ModalFormulario>
    </div>
  );
};

export default RedeParceiros;
