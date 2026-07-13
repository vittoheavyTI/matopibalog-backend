import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Check, Truck } from 'lucide-react';
import api from '../api';

interface PlanoPublico {
  id: string;
  nome: string;
  descricao: string;
  preco_mensal: number;
  limite_motoristas: number | null;
  dias_trial: number | null;
  recursos: string[];
}

// Fallback local mínimo — usado APENAS se a API pública falhar, para a página de
// planos não ficar em branco. O backend (/planos/publicos) é a fonte principal.
// Os ids aqui são aliases legados (não-UUID) e navegam via ?plano=<alias>.
const PLANOS_FALLBACK: PlanoPublico[] = [
  { id: 'basico', nome: 'Plano Básico', descricao: 'Para pequenas frotas', preco_mensal: 49.9, limite_motoristas: 3, dias_trial: 7, recursos: ['Gestão de fretes', 'Relatórios básicos', 'Suporte via email'] },
  { id: 'profissional', nome: 'Plano Profissional', descricao: 'Para frotas em crescimento', preco_mensal: 99.9, limite_motoristas: 10, dias_trial: 7, recursos: ['Gestão de fretes + despesas', 'Relatórios avançados', 'Suporte prioritário', 'App motorista'] },
  { id: 'empresarial', nome: 'Plano Enterprise', descricao: 'Para operações completas', preco_mensal: 199.9, limite_motoristas: null, dias_trial: 7, recursos: ['Motoristas ilimitados', 'Todas as funcionalidades', 'Suporte 24h'] },
];

// Defesa extra: o backend já normaliza `recursos` para array de strings.
function normalizarRecursos(recursos: any): string[] {
  if (Array.isArray(recursos)) return recursos.map((r) => String(r).trim()).filter(Boolean);
  if (typeof recursos === 'string' && recursos.trim()) {
    const s = recursos.trim();
    if (s.startsWith('[')) {
      try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((r) => String(r).trim()).filter(Boolean); } catch (_) { /* split abaixo */ }
    }
    return s.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  }
  return [];
}

function limiteLabel(limite: number | null): string {
  if (limite == null) return 'Motoristas ilimitados';
  return `Até ${limite} motorista${limite === 1 ? '' : 's'}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PlanosPublicos: React.FC = () => {
  const navigate = useNavigate();
  const [planos, setPlanos] = useState<PlanoPublico[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    // Catálogo público leva ao cadastro de empresa (/cadastro): só planos de
    // empresa ou "ambos". Autônomo usa o app. Filtro por categoria, nunca por nome.
    api.get('/planos/publicos?categoria=empresa')
      .then((res) => {
        if (!vivo) return;
        const lista: PlanoPublico[] = (res.data?.planos || []).map((p: any) => ({
          ...p,
          preco_mensal: Number(p.preco_mensal) || 0,
          recursos: normalizarRecursos(p.recursos),
        }));
        setPlanos(lista.length ? lista : PLANOS_FALLBACK);
      })
      .catch(() => {
        if (!vivo) return;
        setErro('Não foi possível carregar os planos agora. Exibindo valores de referência.');
        setPlanos(PLANOS_FALLBACK);
      })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  // Destaque visual: o plano do meio quando há 3+ planos.
  const idxDestaque = planos.length >= 3 ? 1 : -1;

  function irParaCadastro(plano: PlanoPublico) {
    // UUID real → plano_id; alias de fallback → ?plano= (compat legado).
    const q = UUID_RE.test(plano.id)
      ? 'plano_id=' + encodeURIComponent(plano.id)
      : 'plano=' + encodeURIComponent(plano.id);
    navigate('/cadastro?' + q);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Truck className="text-blue-600" size={32} />
            <h1 className="text-3xl font-bold text-gray-900">Matopiba Log</h1>
          </div>
          <p className="text-xl text-gray-600">Planos para todos os tamanhos de frota</p>
        </div>

        {erro && (
          <div className="max-w-2xl mx-auto mb-8 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 text-center">{erro}</div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-16">Carregando planos...</div>
        ) : (
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {planos.map((plano, idx) => {
              const destaque = idx === idxDestaque;
              return (
                <div key={plano.id} className={`relative bg-white rounded-2xl shadow-lg p-8 flex flex-col transition-transform hover:scale-105 ${destaque ? 'ring-2 ring-blue-500 shadow-xl' : ''}`}>
                  {destaque && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-semibold">Mais Popular</div>
                  )}
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plano.nome}</h3>
                  <p className="text-gray-500 mb-6">{plano.descricao}</p>
                  <div className="mb-1">
                    <span className="text-4xl font-bold text-gray-900">R$ {plano.preco_mensal.toFixed(2)}</span>
                    <span className="text-gray-500">/mês</span>
                  </div>
                  {plano.dias_trial ? (
                    <p className="text-sm text-green-600 font-medium mb-6">{plano.dias_trial} dias de teste grátis</p>
                  ) : <div className="mb-6" />}
                  <ul className="space-y-3 mb-8 flex-1">
                    <li className="flex items-center gap-2 text-gray-800 font-semibold">
                      <Check size={18} className="text-green-500 shrink-0" />
                      <span>{limiteLabel(plano.limite_motoristas)}</span>
                    </li>
                    {plano.recursos.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-gray-700">
                        <Check size={18} className="text-green-500 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    className={`w-full py-3 rounded-xl text-white font-semibold transition-colors ${destaque ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-800 hover:bg-gray-900'}`}
                    onClick={() => irParaCadastro(plano)}
                  >
                    Começar Agora
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-center mt-12">
          <p className="text-gray-500">
            Já tem cadastro?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">Fazer Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};
