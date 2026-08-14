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
  const [error, setError] = useState('');

  const canUse = user?.is_super_admin || user?.role === 'admin';

  useEffect(() => {
    if (!canUse) return;
    let alive = true;
    api.get('/operacional/contexto')
      .then(({ data }) => {
        if (!alive) return;
        setError('');
        const lista = Array.isArray(data?.unidades) ? data.unidades : [];
        setUnidades(lista);
        const saved = localStorage.getItem(STORAGE_KEY) || '';
        if (saved && !lista.some((u: Unidade) => u.id === saved)) {
          localStorage.removeItem(STORAGE_KEY);
          setSelected('');
          setError('Contexto removido');
        }
      })
      .catch(() => {
        if (alive) {
          setUnidades([]);
          setError('Contexto indisponivel');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [canUse]);

  const label = useMemo(() => {
    if (loading) return 'Carregando';
    if (error) return error;
    if (!unidades.length) return 'Empresa';
    if (!selected) return 'Todas';
    return unidades.find((u) => u.id === selected)?.nome || 'Unidade';
  }, [error, loading, selected, unidades]);

  if (!canUse) return null;

  const handleChange = (value: string) => {
    setSelected(value);
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('operational-context:changed', { detail: { unidade_operacional_id: value || null } }));
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 min-w-0 max-w-[58vw] sm:max-w-none sm:min-w-[220px] sm:px-3">
      <Building2 size={16} className="text-green-700 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-semibold uppercase leading-none ${error ? 'text-amber-600' : 'text-gray-400'}`}>Operacao</p>
        {unidades.length > 1 ? (
          <select
            value={selected}
            onChange={(event) => handleChange(event.target.value)}
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
      </div>
    </div>
  );
};
