import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Truck, User, Building2, Mail, Lock, Phone, Eye, EyeOff, ArrowLeft, Tag, Check } from 'lucide-react';
import api from '../api';
import { maskCNPJ, maskPhone } from '../utils/masks';
import { useLoginConfig } from '../hooks/useLoginConfig';
import { PlanosVitrine } from '../components/PlanosVitrine';
import { normalizarRecursos, primeiroPlanoSelfService } from '../utils/planosCatalogo';
import type { PlanoPublico } from '../utils/planosCatalogo';
import { montarLinkComercial } from '../utils/contatoComercial';

const ASSUNTO_ENTERPRISE = 'Interesse no plano Enterprise - Matopiba Log';

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

type PlanoPublicoApi = Partial<PlanoPublico> & {
  id: string;
  nome: string;
};

// Fallback usado APENAS se /planos/publicos falhar — mantém o cadastro funcionando
// e a vitrine com o mesmo visual. ids são aliases legados (não-UUID).
const PLANOS_FALLBACK: PlanoPublico[] = [
  { id: 'empresa-start', nome: 'Empresa Start', descricao: 'Para equipes iniciando a operação digital', preco_mensal: 299.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 5, dias_trial: 14, valor_implantacao: 0, capacidade_inclusa: 5, preco_motorista_extra: 100, recursos: ['5 motoristas incluídos', 'Motorista extra R$ 100,00', 'Implantação grátis'] },
  { id: 'empresa-essencial', nome: 'Empresa Essencial', descricao: 'Para operações em crescimento', preco_mensal: 499.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 10, dias_trial: 14, valor_implantacao: 0, capacidade_inclusa: 10, preco_motorista_extra: 90, recursos: ['10 motoristas incluídos', 'Motorista extra R$ 90,00', 'Implantação grátis'] },
  { id: 'empresa-growth', nome: 'Empresa Growth', descricao: 'Para frotas maiores com rotina comercial ativa', preco_mensal: 799.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 20, dias_trial: 14, valor_implantacao: 0, capacidade_inclusa: 20, preco_motorista_extra: 80, recursos: ['20 motoristas incluídos', 'Motorista extra R$ 80,00', 'Implantação grátis'] },
  { id: 'empresa-scale', nome: 'Empresa Scale', descricao: 'Para operações de alta capacidade', preco_mensal: 1199.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 40, dias_trial: 14, valor_implantacao: 0, capacidade_inclusa: 40, preco_motorista_extra: 70, recursos: ['40 motoristas incluídos', 'Motorista extra R$ 70,00', 'Implantação grátis'] },
  { id: 'enterprise', nome: 'Enterprise / Sob negociação', descricao: 'Para frotas acima de 40 motoristas', preco_mensal: 0, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: null, dias_trial: 14, valor_implantacao: 0, capacidade_inclusa: 41, preco_motorista_extra: null, requer_negociacao: true, recursos: ['Motoristas sob medida', 'Condições comerciais sob negociação'] },
];

// Mapeia alias legado (?plano=) para um plano real do catálogo, por nome.
const ALIAS_NOME: Record<string, string[]> = {
  basico: ['básico', 'basico'],
  profissional: ['profissional'],
  empresarial: ['enterprise', 'empresarial'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function precoBRL(v: number): string {
  return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}

const PASSOS = ['Plano', 'Administrador', 'Empresa'];

export const CadastroPublico: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Mesma logomarca configurável da página de upgrade (/planos), via endpoint
  // público /configuracoes/public — sem exigir login.
  const { loginLogo, loginLogoScale, loginLogoY, configLoading, contactEmail, contactPhone, whatsappSuporte } = useLoginConfig();
  // Canal comercial do CTA do Enterprise (mesma fonte/regra do /planos): WhatsApp
  // prioritário → e-mail → telefone; wa.me abre com mensagem de interesse.
  const canalComercial = montarLinkComercial(
    { whatsapp: whatsappSuporte, email: contactEmail, telefone: contactPhone },
    { assunto: ASSUNTO_ENTERPRISE, mensagem: 'Olá! Tenho interesse no plano Enterprise do Matopiba Log.' }
  );
  // Etapas: 1 = escolha do plano · 2 = dados do administrador · 3 = dados da
  // empresa (com resumo + promoção). `concluido` mostra a tela de sucesso.
  const [step, setStep] = useState(1);
  const [concluido, setConcluido] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reenviando, setReenviando] = useState(false);
  const [reenvioMsg, setReenvioMsg] = useState('');
  const [planos, setPlanos] = useState<PlanoPublico[]>([]);
  const [promoPreview, setPromoPreview] = useState<PromoPreview | null>(null);
  const [promoErro, setPromoErro] = useState('');
  const [validandoPromo, setValidandoPromo] = useState(false);
  const [form, setForm] = useState<FormData>({
    nome: '', email: '', senha: '', confirmarSenha: '',
    empresa: '', cnpj: '', telefone: '', plano_id: '', plano: '', codigo_promocional: '',
  });

  // Carrega o catálogo público completo (mesma vitrine da página de upgrade) e
  // aplica a seleção inicial vinda da URL (?plano_id=<uuid> preferido; ?plano=
  // <alias> legado como fallback). A seleção NUNCA cai sobre um plano sob
  // negociação (Enterprise): ele aparece na vitrine, mas não é self-service.
  useEffect(() => {
    const qpId = searchParams.get('plano_id');
    const qpAlias = searchParams.get('plano');
    api.get('/planos/publicos?categoria=empresa')
      .then((res) => {
        const lista: PlanoPublico[] = ((res.data?.planos || []) as PlanoPublicoApi[]).map((p) => ({
          ...p,
          descricao: p.descricao || '',
          preco_mensal: Number(p.preco_mensal) || 0,
          modelo_cobranca: p.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
          preco_por_motorista: p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
          limite_motoristas: p.limite_motoristas != null ? Number(p.limite_motoristas) : null,
          dias_trial: p.dias_trial != null ? Number(p.dias_trial) : null,
          valor_implantacao: p.valor_implantacao != null ? Number(p.valor_implantacao) : null,
          recursos: normalizarRecursos(p.recursos),
        }));
        const catalogo = lista.length ? lista : PLANOS_FALLBACK;
        setPlanos(catalogo);
        aplicarSelecaoInicial(catalogo, qpId, qpAlias);
      })
      .catch(() => {
        setPlanos(PLANOS_FALLBACK);
        aplicarSelecaoInicial(PLANOS_FALLBACK, null, qpAlias);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a seleção inicial contra o catálogo, sempre num plano self-service.
  function aplicarSelecaoInicial(catalogo: PlanoPublico[], qpId: string | null, qpAlias: string | null) {
    const selfService = catalogo.filter((p) => !p.requer_negociacao);
    // 1. ?plano_id explícito, desde que seja self-service.
    if (qpId) {
      const alvo = selfService.find((p) => p.id === qpId);
      if (alvo) { selecionarPlano(alvo); return; }
    }
    // 2. ?plano alias → casa por nome (Enterprise/empresarial cai no default).
    if (qpAlias) {
      const chaves = ALIAS_NOME[qpAlias] || [qpAlias.toLowerCase()];
      const alvo = selfService.find((p) => chaves.some((k) => String(p.nome || '').toLowerCase().includes(k)));
      if (alvo) { selecionarPlano(alvo); return; }
    }
    // 3. Default: primeiro self-service por preço.
    const def = primeiroPlanoSelfService(catalogo);
    if (def) selecionarPlano(def);
  }

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Seleciona um plano self-service (apenas seleciona/destaca — NÃO avança de
  // etapa; o avanço é só pelo botão "Continuar"). UUID real → plano_id; alias de
  // fallback → plano.
  function selecionarPlano(p: PlanoPublico) {
    if (p.requer_negociacao) return; // guarda: negociação nunca é self-service
    if (UUID_RE.test(p.id)) setForm((f) => ({ ...f, plano_id: p.id, plano: '' }));
    else setForm((f) => ({ ...f, plano: p.id, plano_id: '' }));
  }

  // id atualmente selecionado (UUID ou alias), para destacar o card na vitrine.
  const selecionadoId = form.plano_id || form.plano || null;
  const planoSelecionado = planos.find((p) => p.id === selecionadoId) || null;

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

  function removerPromo() {
    setPromoPreview(null);
    setPromoErro('');
    updateField('codigo_promocional', '');
  }

  // Validação dos dados do administrador (etapa 2 → 3). Mantém as regras do
  // submit final e apenas antecipa o feedback ao avançar.
  function validarAdministrador(): boolean {
    if (form.senha !== form.confirmarSenha) { setError('Senhas não conferem.'); return false; }
    if (form.senha.length < 6) { setError('Senha deve ter no mínimo 6 caracteres.'); return false; }
    setError('');
    return true;
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
      setConcluido(true);
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { message?: string } } })?.response;
      setError(resp?.data?.message || 'Erro ao cadastrar. Tente novamente.');
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

  // Preço/mensalidade a exibir no resumo, considerando promoção aplicada.
  const precoMensalidade = planoSelecionado ? planoSelecionado.preco_mensal : 0;
  const valorImplantacao = planoSelecionado ? Number(planoSelecionado.valor_implantacao || 0) : 0;
  const implantacaoResumo = Math.max(0, promoPreview?.implantacao_promocional ?? valorImplantacao);
  const temPromo = !!(promoPreview && promoPreview.valido && promoPreview.preco_promocional != null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-10 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Cabeçalho + indicador de etapas. Logomarca configurável (mesma fonte
            do /planos e do Login): usa a logo quando houver; senão, cai para o
            ícone + texto. Placeholder de altura fixa enquanto a config carrega,
            para não "pular" o layout. */}
        <div className="text-center mb-8">
          {configLoading ? (
            <div className="h-16 mb-2" />
          ) : loginLogo ? (
            <div className="flex items-center justify-center mb-2">
              <img
                src={loginLogo}
                alt="Matopiba Log"
                style={{
                  transform: `scale(${loginLogoScale / 100}) translateY(${loginLogoY}px)`,
                  transformOrigin: 'center',
                }}
                className="max-h-16 max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 mb-2">
              <Truck className="text-blue-600" size={28} />
              <h1 className="text-2xl font-bold text-gray-900">Matopiba Log</h1>
            </div>
          )}
          <p className="text-gray-500">Crie sua conta em poucos passos</p>
        </div>

        {!concluido && (
          <div className="flex items-center justify-center gap-3 mb-10">
            {PASSOS.map((rotulo, i) => {
              const n = i + 1;
              const ativo = step === n;
              const feito = step > n;
              return (
                <React.Fragment key={rotulo}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                      feito ? 'bg-green-600 text-white' : ativo ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {feito ? <Check size={14} /> : n}
                    </div>
                    <span className={`text-sm hidden sm:inline ${ativo ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>{rotulo}</span>
                  </div>
                  {n < PASSOS.length && <div className="w-8 h-px bg-gray-300" />}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">{error}</div>
        )}

        {/* Tela de sucesso */}
        {concluido && (
          <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg p-8">
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm">
              <p className="font-semibold mb-1">✅ {success || 'Sua conta foi criada.'}</p>
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
          </div>
        )}

        {/* Etapa 1 — Escolha do plano (vitrine compartilhada com a página de upgrade) */}
        {!concluido && step === 1 && (
          <div>
            {planos.length === 0 ? (
              <div className="text-center text-gray-500 py-16">Carregando planos...</div>
            ) : (
              // Clicar no card APENAS seleciona e destaca o plano. O avanço de
              // etapa é só pelo botão "Continuar com [Plano] →" abaixo.
              <PlanosVitrine
                planos={planos}
                planoSelecionadoId={selecionadoId}
                onEscolher={(p) => selecionarPlano(p)}
                ctaLabel="Selecionar plano"
                ctaSelecionadoLabel="✓ Selecionado"
                negociacaoHref={canalComercial.href}
                negociacaoExterno={canalComercial.externo}
                negociacaoTelHref={canalComercial.telHref}
              />
            )}
            <div className="max-w-5xl mx-auto mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-gray-600">
                Já tem conta?{' '}
                <Link to="/login" className="text-blue-600 hover:underline font-semibold">Fazer login</Link>
              </p>
              {planoSelecionado && (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full sm:w-auto py-3 px-8 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                >
                  Continuar com {planoSelecionado.nome} →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Etapa 2 — Dados do administrador */}
        {!concluido && step === 2 && (
          <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg p-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Dados do Administrador</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (validarAdministrador()) setStep(3); }}>
              <div className="space-y-4">
                <InputField icon={<User size={18} />} placeholder="Nome completo" value={form.nome} onChange={(v) => updateField('nome', v)} required />
                <InputField icon={<Mail size={18} />} placeholder="Email" type="email" value={form.email} onChange={(v) => updateField('email', v)} required />
                <InputField icon={<Phone size={18} />} placeholder="Telefone" value={form.telefone} onChange={(v) => updateField('telefone', maskPhone(v))} required />
                <InputField icon={<Lock size={18} />} placeholder="Senha" type="password" value={form.senha} onChange={(v) => updateField('senha', v)} required />
                <InputField icon={<Lock size={18} />} placeholder="Confirmar senha" type="password" value={form.confirmarSenha} onChange={(v) => updateField('confirmarSenha', v)} required />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setStep(1)} className="flex items-center justify-center gap-1 flex-1 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors">
                  <ArrowLeft size={16} /> Voltar
                </button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors">
                  Continuar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Etapa 3 — Dados da empresa + resumo do plano (com promoção) */}
        {!concluido && step === 3 && (
          <form onSubmit={handleSubmit} className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-6 items-start">
            {/* Dados da empresa */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Dados da Empresa</h2>
              <div className="space-y-4">
                <InputField icon={<Building2 size={18} />} placeholder="Nome da empresa" value={form.empresa} onChange={(v) => updateField('empresa', v)} required />
                <InputField icon={<Building2 size={18} />} placeholder="CNPJ" value={form.cnpj} onChange={(v) => updateField('cnpj', maskCNPJ(v))} required />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setStep(2)} className="flex items-center justify-center gap-1 flex-1 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors">
                  <ArrowLeft size={16} /> Voltar
                </button>
                <button type="submit" disabled={loading} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {loading ? 'Cadastrando...' : 'Finalizar cadastro'}
                </button>
              </div>
            </div>

            {/* Resumo do plano + código promocional */}
            <aside className="bg-white rounded-2xl shadow-lg p-6 lg:sticky lg:top-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-900">Resumo</h3>
                <button type="button" onClick={() => setStep(1)} className="text-xs text-blue-600 hover:underline">Trocar plano</button>
              </div>

              {planoSelecionado ? (
                <div className="mb-4">
                  <div className="text-sm text-gray-500">Plano escolhido</div>
                  <div className="text-lg font-bold text-gray-900">{planoSelecionado.nome}</div>
                  <div className="mt-1">
                    {temPromo ? (
                      <div>
                        <span className="line-through text-gray-400 mr-2">{precoBRL(promoPreview!.preco_original ?? precoMensalidade)}</span>
                        <span className="text-2xl font-bold text-green-700">{precoBRL(promoPreview!.preco_promocional!)}</span>
                        <span className="text-gray-500">/mês</span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-2xl font-bold text-gray-900">{precoBRL(precoMensalidade)}</span>
                        <span className="text-gray-500">/mês</span>
                      </div>
                    )}
                  </div>
                  {planoSelecionado.dias_trial ? (
                    <div className="mt-1 text-sm text-green-600 font-medium">{planoSelecionado.dias_trial} dias de teste grátis</div>
                  ) : null}
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {implantacaoResumo <= 0 ? 'Implantação grátis' : `Implantação: ${precoBRL(implantacaoResumo)}`}
                  </div>
                  <div className="mt-2 text-sm text-gray-600">
                    Total inicial: <span className="font-semibold text-gray-900">{precoBRL(implantacaoResumo)}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    Recorrência: <span className="font-semibold text-gray-900">mensal</span>
                  </div>
                  {!planoSelecionado.requer_negociacao && (
                    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      <span className="font-semibold">Contrato obrigatório.</span> Para liberar o uso do sistema, será
                      necessário assinar eletronicamente o contrato, com código enviado por e-mail.
                    </div>
                  )}
                  <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    <span className="font-semibold">Seu período de teste é gratuito.</span> Nenhuma cobrança é feita
                    durante o trial e a contratação <span className="font-semibold">não é automática</span>. O teste
                    começa quando você assina o contrato e, ao final, você decide se deseja continuar.
                  </div>
                </div>
              ) : (
                <div className="mb-4 text-sm text-gray-500">Nenhum plano selecionado.</div>
              )}

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Código promocional (opcional)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Tag size={16} /></div>
                    <input
                      value={form.codigo_promocional}
                      onChange={(e) => { updateField('codigo_promocional', e.target.value.toUpperCase()); setPromoPreview(null); setPromoErro(''); }}
                      placeholder="EX: FEIRA2026"
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  {temPromo ? (
                    <button type="button" onClick={removerPromo} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200">
                      Remover
                    </button>
                  ) : (
                    <button type="button" onClick={validarPromo} disabled={validandoPromo} className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                      {validandoPromo ? '...' : 'Aplicar'}
                    </button>
                  )}
                </div>
                {promoErro && <p className="mt-2 text-sm text-red-600">{promoErro}</p>}
                {temPromo && (
                  <div className="mt-3 rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">
                    <div className="font-semibold">{promoPreview!.campanha}</div>
                    {promoPreview!.preco_promocional != null && (
                      <div>
                        Mensalidade: <span className="line-through opacity-60">{precoBRL(promoPreview!.preco_original || 0)}</span>{' '}
                        <span className="font-bold">{precoBRL(promoPreview!.preco_promocional)}</span>
                      </div>
                    )}
                    {promoPreview!.implantacao_promocional != null && (promoPreview!.implantacao_original || 0) > 0 && (
                      <div>
                        Implantação: <span className="line-through opacity-60">{precoBRL(promoPreview!.implantacao_original || 0)}</span>{' '}
                        <span className="font-bold">{promoPreview!.implantacao_promocional === 0 ? 'Grátis' : precoBRL(promoPreview!.implantacao_promocional)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </form>
        )}
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
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={`w-full pl-10 ${isPassword ? 'pr-10' : 'pr-4'} py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
}
