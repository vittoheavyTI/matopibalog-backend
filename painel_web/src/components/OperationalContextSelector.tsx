import React, { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

type Unidade = {
  id: string;
  nome: string;
  codigo?: string | null;
  is_default?: boolean;
};

const STORAGE_KEY = 'matopibalog_operational_unit_context';

export const OperationalContextSelector: React.FC = () => {
  const { user } = useAuth();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [selected, setSelected] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || '');
  const [loading, setLoading] = useState(false);

  const canUse = user?.is_super_admin || user?.role === 'admin';

  useEffect(() => {
    if (!canUse) return;
    let alive = true;
    api.get('/operacional/contexto')
      .then(({ data }) => {
        if (!alive) return;
        const lista = Array.isArray(data?.unidades) ? data.unidades : [];
        setUnidades(lista);
        const saved = localStorage.getItem(STORAGE_KEY) || '';
        if (saved && !lista.some((u: Unidade) => u.id === saved)) {
          localStorage.removeItem(STORAGE_KEY);
          setSelected('');
        }
      })
      .catch(() => {
        if (alive) setUnidades([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [canUse]);

  const label = useMemo(() => {
    if (loading) return 'Carregando';
    if (!unidades.length) return 'Empresa';
    if (!selected) return 'Todas';
    return unidades.find((u) => u.id === selected)?.nome || 'Unidade';
  }, [loading, selected, unidades]);

  if (!canUse) return null;

  const handleChange = (value: string) => {
    setSelected(value);
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('operational-context:changed', { detail: { unidade_operacional_id: value || null } }));
  };

  return (
    <div className="hidden lg:flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 min-w-[220px]">
      <Building2 size={16} className="text-green-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase text-gray-400 leading-none">Operacao</p>
        {unidades.length > 1 ? (
          <select
            value={selected}
            onChange={(event) => handleChange(event.target.value)}
            className="mt-1 w-full bg-transparent text-sm font-semibold text-gray-800 outline-none"
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
          <p className="mt-1 truncate text-sm font-semibold text-gray-800" title={label}>{label}</p>
        )}
      </div>
    </div>
  );
};
