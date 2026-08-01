import React, { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import api from '../api';

type Localizacao = {
  captured_at: string | null;
  received_at: string | null;
  accuracy_m: number | null;
  estado?: string | null;
  rotulo?: string | null;
};

type EstadoLocalizacao = {
  estado: string | null;
  detalhe?: string | null;
  atualizado_em?: string | null;
};

const fmtDataHora = (valor: string | null) => {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export const FreteLocalizacao: React.FC<{ freteId: string }> = ({ freteId }) => {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [ativa, setAtiva] = useState(false);
  const [ultima, setUltima] = useState<Localizacao | null>(null);
  const [estado, setEstado] = useState<EstadoLocalizacao | null>(null);
  const [historicoQtd, setHistoricoQtd] = useState(0);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await api.get(`/fretes/${freteId}/localizacao`);
      setAtiva(res.data?.ativa === true);
      setUltima(res.data?.localizacao || res.data?.ultima || null);
      setEstado(res.data?.estado || (res.data?.localizacao ? {
        estado: res.data.localizacao.estado,
        detalhe: res.data.localizacao.rotulo,
        atualizado_em: res.data.localizacao.atualizado_em,
      } : null));
      setHistoricoQtd(Array.isArray(res.data?.historico) ? res.data.historico.length : 0);
    } catch {
      setErro('Nao foi possivel carregar a ultima localizacao enviada.');
    } finally {
      setLoading(false);
    }
  }, [freteId]);

  useEffect(() => {
    queueMicrotask(() => { void carregar(); });
  }, [carregar]);

  return (
    <div className="mt-3 rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
      <div className="flex items-center gap-2">
        <MapPin size={14} className={ativa ? 'text-green-700' : 'text-gray-400'} aria-hidden="true" />
        <p className="font-bold text-gray-700">Ultima localizacao enviada</p>
        <button
          type="button"
          onClick={carregar}
          className="ml-auto rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700"
          aria-label="Atualizar localizacao"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      {erro ? (
        <p className="mt-2 text-red-600">{erro}</p>
      ) : ultima ? (
        <div className="mt-2 grid gap-1 sm:grid-cols-3">
          <p><span className="font-semibold">Enviada:</span> {fmtDataHora(ultima.captured_at)}</p>
          <p><span className="font-semibold">Recebida:</span> {fmtDataHora(ultima.received_at)}</p>
          <p><span className="font-semibold">Precisao:</span> {ultima.accuracy_m == null ? '-' : `${Math.round(ultima.accuracy_m)} m`}</p>
          {estado?.estado && (
            <p className="sm:col-span-3"><span className="font-semibold">Estado:</span> {estado.detalhe || rotuloEstado(estado.estado)}</p>
          )}
        </div>
      ) : (
        <p className="mt-2">{estado?.estado ? rotuloEstado(estado.estado) : (historicoQtd > 0 ? `${historicoQtd} pontos no historico da viagem.` : 'Sem localizacao enviada para esta viagem.')}</p>
      )}
    </div>
  );
};

const rotuloEstado = (estado: string | null) => ({
  atualizada: 'Localizacao atualizada',
  aguardando_atualizacao: 'Aguardando atualizacao',
  desatualizada: 'Localizacao desatualizada',
  aguardando_primeira: 'Aguardando primeira localizacao',
  interrompida: 'Localizacao interrompida',
  gps_desativado: 'GPS desativado',
  permissao_nao_concedida: 'Permissao nao concedida',
  sem_conexao: 'Sem conexao',
  rastreamento_encerrado: 'Rastreamento encerrado',
}[estado || ''] || 'Sem localizacao enviada para esta viagem.');
