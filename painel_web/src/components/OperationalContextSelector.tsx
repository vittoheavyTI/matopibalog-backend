import React, { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import {
  gravarGrupoOperacional,
  gravarUnidadeOperacional,
  lerGrupoOperacional,
  lerUnidadeOperacional,
  limparContextoOperacional,
} from '../utils/operationalContextStorage';

type Unidade = {
  id: string;
  nome: string;
  empresa_id?: string | null;
  grupo_id?: string | null;
  codigo?: string | null;
  is_default?: boolean;
};

type Grupo = {
  id: string;
  nome: string;
  status?: string | null;
};

export const OperationalContextSelector: React.FC = () => {
  const { user } = useAuth();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>(() => lerGrupoOperacional());
  const [selectedUnit, setSelectedUnit] = useState<string>(() => lerUnidadeOperacional());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canUse = user?.is_super_admin || user?.role === 'admin';

  useEffect(() => {
    if (!canUse) return;
    let alive = true;
    const load = (retriedAfterStale = false) => {
      setLoading(true);
      api.get('/operacional/contexto')
      .then(({ data }) => {
        if (!alive) return;
        if (!retriedAfterStale) setError('');
        const lista = Array.isArray(data?.unidades) ? data.unidades : [];
        const gruposDisponiveis = Array.isArray(data?.grupos) ? data.grupos : [];
        setUnidades(lista);
        setGrupos(gruposDisponiveis);
        const savedGroup = lerGrupoOperacional();
        const savedUnit = lerUnidadeOperacional();
        if (savedGroup && !gruposDisponiveis.some((g: Grupo) => g.id === savedGroup)) {
          limparContextoOperacional();
          setSelectedGroup('');
          setSelectedUnit('');
          setError('Contexto corporativo removido');
          return;
        }
        if (savedUnit && !lista.some((u: Unidade) => u.id === savedUnit)) {
          gravarUnidadeOperacional('');
          setSelectedUnit('');
          setError('Contexto removido');
        }
      })
      .catch(() => {
        if (alive) {
          const hadGroup = Boolean(lerGrupoOperacional());
          if (hadGroup && !retriedAfterStale) {
            limparContextoOperacional();
            setSelectedGroup('');
            setSelectedUnit('');
            setError('Contexto corporativo removido');
            return;
          }
          setUnidades([]);
          setGrupos([]);
          setError(hadGroup ? 'Contexto corporativo removido' : 'Contexto indisponivel');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    };
    load(false);
    return () => { alive = false; };
  }, [canUse, selectedGroup]);

  const label = useMemo(() => {
    if (loading) return 'Carregando';
    if (error) return error;
    if (selectedGroup) return grupos.find((g) => g.id === selectedGroup)?.nome || 'Grupo';
    if (!unidades.length) return 'Empresa';
    if (!selectedUnit) return 'Todas';
    return unidades.find((u) => u.id === selectedUnit)?.nome || 'Unidade';
  }, [error, grupos, loading, selectedGroup, selectedUnit, unidades]);

  if (!canUse) return null;

  const handleGroupChange = (value: string) => {
    setSelectedGroup(value);
    setSelectedUnit('');
    gravarGrupoOperacional(value);
    gravarUnidadeOperacional('');
    window.dispatchEvent(new CustomEvent('operational-context:changed', { detail: { grupo_id: value || null, unidade_operacional_id: null } }));
  };

  const handleUnitChange = (value: string) => {
    setSelectedUnit(value);
    gravarUnidadeOperacional(value);
    window.dispatchEvent(new CustomEvent('operational-context:changed', {
      detail: { grupo_id: selectedGroup || null, unidade_operacional_id: value || null },
    }));
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 min-w-0 max-w-[58vw] sm:max-w-none sm:min-w-[220px] sm:px-3">
      <Building2 size={16} className="text-green-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold uppercase leading-none ${error ? 'text-amber-600' : 'text-gray-400'}`}>Operacao</p>
        {grupos.length > 0 ? (
          <select
            value={selectedGroup}
            onChange={(event) => handleGroupChange(event.target.value)}
            className="mt-1 w-full bg-transparent text-xs font-semibold text-gray-800 outline-none sm:text-sm"
            aria-label="Contexto corporativo"
          >
            <option value="">Empresa</option>
            {grupos.map((grupo) => (
              <option key={grupo.id} value={grupo.id}>{grupo.nome}</option>
            ))}
          </select>
        ) : unidades.length > 1 ? (
          <select
            value={selectedUnit}
            onChange={(event) => handleUnitChange(event.target.value)}
            className="mt-1 w-full bg-transparent text-xs font-semibold text-gray-800 outline-none sm:text-sm"
            aria-label="Contexto operacional"
          >
            <option value="">Todas autorizadas</option>
            {unidades.map((unidade) => (
              <option key={unidade.id} value={unidade.id}>
                {unidade.nome}{unidade.codigo ? ` (${unidade.codigo})` : ''}{unidade.is_default ? ' - padrao' : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className={`mt-1 truncate text-xs font-semibold sm:text-sm ${error ? 'text-amber-700' : 'text-gray-800'}`} title={label}>{label}</p>
        )}
        {grupos.length > 0 && unidades.length > 1 && (
          <select
            value={selectedUnit}
            onChange={(event) => handleUnitChange(event.target.value)}
            className="mt-1 w-full bg-transparent text-xs font-semibold text-gray-700 outline-none"
            aria-label="Unidade operacional"
          >
            <option value="">Todas autorizadas</option>
            {unidades.map((unidade) => (
              <option key={unidade.id} value={unidade.id}>
                {unidade.nome}{unidade.codigo ? ` (${unidade.codigo})` : ''}{unidade.is_default ? ' - padrao' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};
