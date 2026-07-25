import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Truck, User, Building2, Mail, Lock, Phone, Eye, EyeOff } from 'lucide-react';
import api from '../api';
import { maskCNPJ, maskPhone } from '../utils/masks';

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
  codigo_promocional: string;
}

interface PromoPreview {
  valido: boolean;
  campanha: string;
  preco_original: number | null;
  preco_promocional: number | null;
  implantacao_original: number | null;
  implantacao_promocional: number | null;
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
  const [reenviando, setReenviando] = useState(false);
  const [reenvioMsg, setReenvioMsg] = useState('');
  const [catalogo, setCatalogo] = useState<PlanoOpcao[]>([]);
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);
  const [promoErro, setPromoErro] = useState('');
  const [validandoPromo, setValidandoPromo] = useState(false);
  const [form, setForm] = useState<FormData>({
    nome: '', email: '', senha: '', confirmarSenha: '',
    empresa: '', cnpj: '', telefone: '', plano_id: '', plano: 'basico', codigo_promocional: '',
  });
  // Sem auto-redirecionamento: o cadastro NÃO libera acesso imediato. O usuário
  // precisa confirmar o e-mail antes de entrar, então ele decide quando ir ao
  // login (ou reenviar a confirmação).

  // Carrega o catálogo público e aplica a seleção inicial vinda da URL
  // (?plano_id=<uuid> preferido; ?plano=<alias> legado como fallback).
  useEffect(() => {
    const qpId = searchParams.get('plano_id');
    const qpAlias = searchParams.get('plano');
    // Cadastro público é de empresa/transportadora: só planos de empresa ou
    // "ambos" (autônomo se cadastra pelo app). Filtro por categoria, nunca por nome.
    api.get('/planos/publicos?categoria=empresa')
      .then((res) => {
        // Planos "sob negociação" (Enterprise 41+) NÃO são self-service: não
        // entram na seleção do cadastro (evita card "R$ 0,00" e default errado).
        // Ordena por preço crescente — o backend já ordena, mas garantimos aqui.
        const bruto = (res.data?.planos || [])
          .filter((p: any) => p?.requer_negociacao !== true)
          .sort((a: any, b: any) => (Number(a?.preco_mensal) || 0) - (Number(b?.preco_mensal) || 0));
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

  async function validarPromo() {
    const codigo = (form.codigo_promocional || '').trim();
    setPromoErro(''); setPromoPreview(null);
    if (!codigo) { setPromoErro('Informe o código.'); return; }
    setValidandoPromo(true);
    try {
      const { data } = await api.post('/planos/validar-promocao', { codigo, plano_id: form.plano_id || undefined });
      setPromoPreview(data);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { message?: string } } })?.response;
      setPromoErro(resp?.data?.message ?? 'Código inválido.');
    } finally {
      setValidandoPromo(false);
    }
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
      if (form.codigo_promocional && form.codigo_promocional.trim()) payload.codigo_promocional = form.codigo_promocional.trim();
      await api.post('/auth/register-empresa', payload);
      setSuccess('Sua conta foi criada.');
      setStep(3);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao cadastrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Reenvia o e-mail de confirmação para o e-mail do cadastro. Resposta genérica
  // do backend (não revela se o e-mail existe); aqui só damos o feedback.
  const handleReenviar = async () => {
    if (!form.email) return;
    setReenviando(true);
    setReenvioMsg('');
    try {
      await api.post('/auth/reenviar-confirmacao', { email: form.email });
      setReenvioMsg('Se houver um cadastro pendente, reenviamos o link de confirmação.');
    } catch {
      setReenvioMsg('Não foi possível reenviar agora. Tente novamente em instantes.');
    } finally {
      setReenviando(false);
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
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm mb-4">
              <p className="font-semibold mb-1">✅ {success}</p>
              <p className="mb-2">
                Enviamos um link de confirmação para <strong>{form.email}</strong>.
                Confirme seu e-mail antes de entrar — verifique também a caixa de spam.
              </p>
              {reenvioMsg && <p className="text-blue-700 mb-2">{reenvioMsg}</p>}
              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Ir para o login
                </button>
                <button
                  type="button"
                  onClick={handleReenviar}
                  disabled={reenviando}
                  className="flex-1 py-2 border border-blue-300 text-blue-700 rounded-lg font-medium hover:bg-blue-100 disabled:opacity-50 transition-colors"
                >
                  {reenviando ? 'Reenviando...' : 'Reenviar e-mail'}
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Dados do Administrador</h2>
              <div className="space-y-4">
                <InputField icon={<User size={18} />} placeholder="Nome completo" value={form.nome} onChange={v => updateField('nome', v)} required />
                <InputField icon={<Mail size={18} />} placeholder="Email" type="email" value={form.email} onChange={v => updateField('email', v)} required />
                <InputField icon={<Phone size={18} />} placeholder="Telefone" value={form.telefone} onChange={v => updateField('telefone', maskPhone(v))} required />
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
                <InputField icon={<Building2 size={18} />} placeholder="CNPJ" value={form.cnpj} onChange={v => updateField('cnpj', maskCNPJ(v))} required />

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

                {/* Código promocional (opcional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Código promocional (opcional)</label>
                  <div className="flex gap-2">
                    <input
                      value={form.codigo_promocional}
                      onChange={(e) => { updateField('codigo_promocional', e.target.value.toUpperCase()); setPromoPreview(null); setPromoErro(''); }}
                      placeholder="EX: FEIRA2026"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-xl font-mono text-sm"
                    />
                    <button type="button" onClick={validarPromo} disabled={validandoPromo}
                      className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                      {validandoPromo ? '...' : 'Aplicar'}
                    </button>
                  </div>
                  {promoErro && <p className="mt-2 text-sm text-red-600">{promoErro}</p>}
                  {promoPreview && promoPreview.valido && (
                    <div className="mt-2 rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">
                      <div className="font-semibold">{promoPreview.campanha}</div>
                      {promoPreview.preco_promocional != null && (
                        <div>
                          Mensalidade: <span className="line-through opacity-60">{precoBRL(promoPreview.preco_original || 0)}</span>{' '}
                          <span className="font-bold">{precoBRL(promoPreview.preco_promocional)}</span>
                        </div>
                      )}
                      {promoPreview.implantacao_promocional != null && (promoPreview.implantacao_original || 0) > 0 && (
                        <div>
                          Implantação: <span className="line-through opacity-60">{precoBRL(promoPreview.implantacao_original || 0)}</span>{' '}
                          <span className="font-bold">{promoPreview.implantacao_promocional === 0 ? 'Grátis' : precoBRL(promoPreview.implantacao_promocional)}</span>
                        </div>
                      )}
                    </div>
                  )}
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
  // Só campos de senha ganham o botão de mostrar/ocultar. Alterna o type
  // password/text sem expor a senha por padrão e sem mexer no autocomplete.
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && reveal ? 'text' : type;
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
      <input
        type={inputType}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className={`w-full pl-10 ${isPassword ? 'pr-10' : 'pr-4'} py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setReveal(r => !r)}
          aria-label={reveal ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
}
