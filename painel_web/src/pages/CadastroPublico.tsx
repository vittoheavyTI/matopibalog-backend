import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Truck, User, Building2, Mail, Lock, Phone, X } from 'lucide-react';
import api from '../api';

interface FormData {
  nome: string;
  email: string;
  senha: string;
  confirmarSenha: string;
  empresa: string;
  cnpj: string;
  telefone: string;
  plano_id: string;   // UUID do catálogo público (preferido)
  plano: string;      // alias legado (fallback: basico/profissional/empresarial)
}

interface PlanoOpcao {
  id: string;
  alias?: string;        // preenchido só no fallback (id não-UUID)
  nome: string;
  precoLabel: string;
}

// Fallback usado APENAS se /planos/publicos falhar — mantém o cadastro funcionando.
const PLANOS_FALLBACK: PlanoOpcao[] = [
  { id: 'basico', alias: 'basico', nome: 'Básico', precoLabel: 'R$ 49,90' },
  { id: 'profissional', alias: 'profissional', nome: 'Profissional', precoLabel: 'R$ 99,90' },
  { id: 'empresarial', alias: 'empresarial', nome: 'Empresarial', precoLabel: 'R$ 199,90' },
];

// Mapeia alias legado (?plano=) para um plano real do catálogo, por nome.
const ALIAS_NOME: Record<string, string[]> = {
  basico: ['básico', 'basico'],
  profissional: ['profissional'],
  empresarial: ['enterprise', 'empresarial'],
};

function precoBRL(v: number): string {
  return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}

export const CadastroPublico: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [catalogo, setCatalogo] = useState<PlanoOpcao[]>([]);
  const [form, setForm] = useState<FormData>({
    nome: '', email: '', senha: '', confirmarSenha: '',
    empresa: '', cnpj: '', telefone: '', plano_id: '', plano: 'basico',
  });
  // Após cadastro concluído (step 3 com success), some sozinho em 4s.
  // Usuário pode clicar no X para fechar antes.
  useEffect(() => {
    if (!success || step !== 3) return;
    const timer = setTimeout(() => navigate('/login'), 4000);
    return () => clearTimeout(timer);
  }, [success, step, navigate]);

  // Carrega o catálogo público e aplica a seleção inicial vinda da URL
  // (?plano_id=<uuid> preferido; ?plano=<alias> legado como fallback).
  useEffect(() => {
    const qpId = searchParams.get('plano_id');
    const qpAlias = searchParams.get('plano');
    api.get('/planos/publicos')
      .then((res) => {
        const bruto = res.data?.planos || [];
        const lista: PlanoOpcao[] = bruto.map((p: any) => ({
          id: p.id, nome: p.nome, precoLabel: precoBRL(p.preco_mensal),
        }));
        if (!lista.length) { setCatalogo(PLANOS_FALLBACK); return; }
        setCatalogo(lista);
        if (qpId && lista.some((p) => p.id === qpId)) {
          setForm((f) => ({ ...f, plano_id: qpId, plano: '' }));
        } else if (qpAlias) {
          const chaves = ALIAS_NOME[qpAlias] || [qpAlias.toLowerCase()];
          const match = bruto.find((p: any) =>
            chaves.some((k) => String(p.nome || '').toLowerCase().includes(k)));
          if (match) setForm((f) => ({ ...f, plano_id: match.id, plano: '' }));
          else setForm((f) => ({ ...f, plano: qpAlias }));
        } else {
          setForm((f) => ({ ...f, plano_id: lista[0].id, plano: '' }));
        }
      })
      .catch(() => {
        // Sem catálogo: mantém fallback por alias (comportamento antigo).
        setCatalogo(PLANOS_FALLBACK);
        if (qpAlias && ['basico', 'profissional', 'empresarial'].includes(qpAlias)) {
          setForm((f) => ({ ...f, plano: qpAlias, plano_id: '' }));
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  function selecionarPlano(p: PlanoOpcao) {
    if (p.alias) setForm((f) => ({ ...f, plano: p.alias as string, plano_id: '' }));
    else setForm((f) => ({ ...f, plano_id: p.id, plano: '' }));
  }

  function planoSelecionado(p: PlanoOpcao): boolean {
    return p.alias ? form.plano === p.alias : form.plano_id === p.id;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (form.senha !== form.confirmarSenha) {
      setError('Senhas não conferem.');
      return;
    }
    if (form.senha.length < 6) {
      setError('Senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, string> = {
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        empresa: form.empresa,
        cnpj: form.cnpj,
        telefone: form.telefone,
      };
      // Preferir plano_id (catálogo); cair para alias legado quando não houver.
      if (form.plano_id) payload.plano_id = form.plano_id;
      else if (form.plano) payload.plano = form.plano;
      await api.post('/auth/register-empresa', payload);
      setSuccess('Cadastro realizado com sucesso! Sua conta já está ativa com o período de avaliação — é só fazer login para começar.');
      setStep(3);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao cadastrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Truck className="text-blue-600" size={28} />
            <h1 className="text-2xl font-bold text-gray-900">Matopiba Log</h1>
          </div>
          <p className="text-gray-500">Crie sua conta gratuitamente</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          {/* Steps indicator */}
          <div className="flex justify-center gap-2 mb-8">
            {[1, 2].map((s) => (
              <div key={s} className={`w-3 h-3 rounded-full ${step >= s ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">{error}</div>
          )}

          {success && (
            <div className="relative bg-green-50 text-green-700 p-4 pr-10 rounded-lg text-sm mb-4">
              <button
                onClick={() => navigate('/login')}
                aria-label="Ir para o login agora"
                className="absolute top-2 right-2 p-1 rounded hover:bg-green-100 text-green-700"
              >
                <X size={16} />
              </button>
              <p className="font-semibold mb-1">✅ {success}</p>
              <p className="text-green-600">Você será redirecionado para o login.</p>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Dados do Administrador</h2>
              <div className="space-y-4">
                <InputField icon={<User size={18} />} placeholder="Nome completo" value={form.nome} onChange={v => updateField('nome', v)} required />
                <InputField icon={<Mail size={18} />} placeholder="Email" type="email" value={form.email} onChange={v => updateField('email', v)} required />
                <InputField icon={<Phone size={18} />} placeholder="Telefone" value={form.telefone} onChange={v => updateField('telefone', v)} required />
                <InputField icon={<Lock size={18} />} placeholder="Senha" type="password" value={form.senha} onChange={v => updateField('senha', v)} required />
                <InputField icon={<Lock size={18} />} placeholder="Confirmar senha" type="password" value={form.confirmarSenha} onChange={v => updateField('confirmarSenha', v)} required />
              </div>
              <button type="submit" className="w-full mt-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
                Continuar
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Dados da Empresa</h2>
              <div className="space-y-4">
                <InputField icon={<Building2 size={18} />} placeholder="Nome da empresa" value={form.empresa} onChange={v => updateField('empresa', v)} required />
                <InputField icon={<Building2 size={18} />} placeholder="CNPJ" value={form.cnpj} onChange={v => updateField('cnpj', v)} required />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Plano</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(catalogo.length ? catalogo : PLANOS_FALLBACK).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selecionarPlano(p)}
                        className={`p-3 rounded-xl border-2 text-center transition-all ${
                          planoSelecionado(p) ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-gray-900">{p.nome}</div>
                        <div className="text-xs text-gray-500">{p.precoLabel}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setStep(1)} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors">
                  Voltar
                </button>
                <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {loading ? 'Cadastrando...' : 'Finalizar'}
                </button>
              </div>
            </form>
          )}

          <div className="text-center mt-6">
            <Link to="/login" className="text-sm text-gray-500 hover:text-blue-600">Já tem conta? Fazer login</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

function InputField({ icon, placeholder, type = 'text', value, onChange, required }: {
  icon: React.ReactNode; placeholder: string; type?: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
      />
    </div>
  );
}
