import React, { useState, useEffect } from 'react';
import { CreditCard, FileSignature, MapPin, Mail, Database, Plug, X, Check, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../api';

interface Integracao {
  id: string;
  nome: string;
  tipo: 'pagamento' | 'assinatura' | 'consulta' | 'email' | 'banco' | 'outro';
  descricao: string;
  icone: string;
  status: 'conectado' | 'desconectado' | 'erro';
  config: Record<string, string>;
  ultimaVerificacao: string | null;
  // Integração nativa do sistema (ViaCEP/Supabase): não requer credenciais nem teste manual.
  // Evita exibir status falso "conectado agora".
  nativo?: boolean;
  // Metadados vindos do backend mascarado (GET /integracoes):
  configurado?: boolean;        // há credencial/config salva no backend
  camposCadastrados?: string[]; // chaves sensíveis que já possuem credencial cadastrada
}

const iconeMap: Record<string, React.ElementType> = {
  CreditCard, FileSignature, MapPin, Mail, Database
};

const tipoLabels: Record<string, string> = {
  pagamento: 'Pagamento',
  assinatura: 'Assinatura Digital',
  consulta: 'Consulta',
  email: 'Email',
  banco: 'Banco/Storage',
  outro: 'Outro'
};

const integracoesPadrao: Integracao[] = [
  {
    id: 'asaas',
    nome: 'Asaas',
    tipo: 'pagamento',
    descricao: 'Gateway de pagamentos (PIX, Boleto, Cartão de Crédito)',
    icone: 'CreditCard',
    status: 'desconectado',
    config: { apiKey: '', environment: 'sandbox' },
    ultimaVerificacao: null
  },
  {
    id: 'clicksign',
    nome: 'Clicksign',
    tipo: 'assinatura',
    descricao: 'Assinatura digital de contratos com validade jurídica',
    icone: 'FileSignature',
    status: 'desconectado',
    config: { token: '', environment: 'sandbox' },
    ultimaVerificacao: null
  },
  {
    id: 'viacep',
    nome: 'ViaCEP',
    tipo: 'consulta',
    descricao: 'Consulta automática de endereço por CEP',
    icone: 'MapPin',
    status: 'desconectado',
    config: {},
    ultimaVerificacao: null,
    nativo: true
  },
  {
    id: 'smtp',
    nome: 'SMTP',
    tipo: 'email',
    descricao: 'Envio de emails transacionais (validação, recuperação de senha)',
    icone: 'Mail',
    status: 'desconectado',
    config: { host: '', port: '587', user: '', pass: '' },
    ultimaVerificacao: null
  },
  {
    id: 'supabase',
    nome: 'Supabase',
    tipo: 'banco',
    descricao: 'Banco de dados, autenticação e storage (conexão principal do sistema)',
    icone: 'Database',
    status: 'desconectado',
    config: {},
    ultimaVerificacao: null,
    nativo: true
  }
];

interface CampoConfig {
  chave: string;
  label: string;
  tipo: 'text' | 'password' | 'select';
  options?: { value: string; label: string }[];
}

const camposPorServico: Record<string, CampoConfig[]> = {
  asaas: [
    { chave: 'apiKey', label: 'API Key', tipo: 'password' },
    { chave: 'environment', label: 'Ambiente', tipo: 'select', options: [{ value: 'sandbox', label: 'Sandbox (Testes)' }, { value: 'production', label: 'Produção' }] }
  ],
  clicksign: [
    { chave: 'token', label: 'Token de Acesso', tipo: 'password' },
    { chave: 'environment', label: 'Ambiente', tipo: 'select', options: [{ value: 'sandbox', label: 'Sandbox (Testes)' }, { value: 'production', label: 'Produção' }] }
  ],
  viacep: [],
  smtp: [
    { chave: 'host', label: 'Host SMTP', tipo: 'text' },
    { chave: 'port', label: 'Porta', tipo: 'text' },
    { chave: 'user', label: 'Usuário', tipo: 'text' },
    { chave: 'pass', label: 'Senha', tipo: 'password' }
  ],
  supabase: []
};

const LS_KEY = 'matopibalog_integracoes';

// Remove campos sensíveis (senha/token/apiKey — os de tipo 'password') antes de
// QUALQUER persistência local. Segredos NUNCA vão para o localStorage: a persistência
// segura de credenciais será feita no backend em fase futura (arquitetura de provedores).
const sanitizarConfig = (servicoId: string, config: Record<string, string>): Record<string, string> => {
  const sensiveis = new Set(
    (camposPorServico[servicoId] || []).filter(c => c.tipo === 'password').map(c => c.chave)
  );
  const limpo: Record<string, string> = {};
  Object.entries(config || {}).forEach(([chave, valor]) => {
    if (!sensiveis.has(chave)) limpo[chave] = valor;
  });
  return limpo;
};

export const Integracoes: React.FC = () => {
  const [integracoes, setIntegracoes] = useState<Integracao[]>(integracoesPadrao);
  const [showModal, setShowModal] = useState(false);
  const [servicoSelecionado, setServicoSelecionado] = useState<Integracao | null>(null);
  const [configEdit, setConfigEdit] = useState<Record<string, string>>({});
  const [testando, setTestando] = useState<string | null>(null);
  const [mensagemTeste, setMensagemTeste] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  // Toast global para feedback fora do modal
  const [toast, setToast] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Estado para o card "Adicionar Nova Integração" foi removido nesta fase de higiene.


  useEffect(() => {
    // Tenta ler da chave nova; se não existir, migra da chave legada (rebranding)
    const saved = localStorage.getItem(LS_KEY) || localStorage.getItem('choferlog_integracoes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Carrega apenas metadados não sensíveis (config já sanitizada); nunca restaura segredos.
        const merged = integracoesPadrao.map(p => {
          const savedConfig = parsed[p.id];
          if (savedConfig) {
            return {
              ...p,
              config: { ...p.config, ...sanitizarConfig(p.id, savedConfig.config || {}) },
              status: savedConfig.status || p.status,
              ultimaVerificacao: savedConfig.ultimaVerificacao || p.ultimaVerificacao,
            };
          }
          return p;
        });
        setIntegracoes(merged);
        // Re-grava já sanitizado na chave nova e remove a legada (limpa segredos antigos do storage).
        const obj: Record<string, any> = {};
        merged.forEach(i => { obj[i.id] = { config: sanitizarConfig(i.id, i.config), status: i.status, ultimaVerificacao: i.ultimaVerificacao }; });
        localStorage.setItem(LS_KEY, JSON.stringify(obj));
        localStorage.removeItem('choferlog_integracoes');
      } catch {}
    }
  }, []);

  // Fonte de verdade das integrações configuradas: backend mascarado (GET /integracoes).
  // Nunca traz segredo em claro; só metadados (configurado + configPublica + camposMascarados).
  // Prevalece sobre o fallback local; 401/403/erro de rede mantêm a tela sem quebrar.
  const carregarIntegracoesBackend = async () => {
    try {
      const resp = await api.get('/integracoes');
      const lista = Array.isArray(resp.data) ? resp.data : [];
      const porServico: Record<string, any> = {};
      lista.forEach((it: any) => { if (it?.servico) porServico[it.servico] = it; });
      setIntegracoes(prev => prev.map(p => {
        const back = porServico[p.id];
        if (!back || p.nativo) return p;
        return {
          ...p,
          // Só metadados não sensíveis (ex.: environment) entram no config visível/editável.
          config: { ...p.config, ...(back.configPublica || {}) },
          configurado: !!back.configurado,
          // Apenas as CHAVES mascaradas — nunca os valores (que vêm como "****").
          camposCadastrados: Object.keys(back.camposMascarados || {}),
        };
      }));
    } catch {
      // Mantém o fallback local; não expõe erro/segredo.
    }
  };

  useEffect(() => { carregarIntegracoesBackend(); }, []);

  const persistirIntegracoes = (novas: Integracao[]) => {
    const obj: Record<string, any> = {};
    // Só metadados não sensíveis vão para o localStorage (config sanitizada, sem segredos).
    novas.forEach(i => { obj[i.id] = { config: sanitizarConfig(i.id, i.config), status: i.status, ultimaVerificacao: i.ultimaVerificacao }; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
    setIntegracoes(novas);
  };

  const mostrarToast = (tipo: 'sucesso' | 'erro', texto: string) => {
    setToast({ tipo, texto });
    setTimeout(() => setToast(null), 4000);
  };

  const abrirModal = (servico: Integracao) => {
    setServicoSelecionado(servico);
    setConfigEdit({ ...servico.config });
    setMensagemTeste(null);
    setShowModal(true);
  };

  const testarConexao = async (servico: Integracao, configOverride?: Record<string, string>) => {
    setTestando(servico.id);
    setMensagemTeste(null);
    const config = configOverride || servico.config;
    // Credenciais usadas só em memória para o teste; NUNCA persistidas no navegador.
    try {
      const resp = await api.post('/integracoes/testar/' + servico.id, config);
      const msgSucesso = resp.data?.message || 'Conexão estabelecida com sucesso.';
      const novas = integracoes.map(i => i.id === servico.id ? { ...i, status: 'conectado' as const, ultimaVerificacao: new Date().toISOString() } : i);
      persistirIntegracoes(novas);
      setMensagemTeste({ tipo: 'sucesso', texto: msgSucesso });
      // Toast visível mesmo fora do modal
      mostrarToast('sucesso', `${servico.nome}: ${msgSucesso}`);
    } catch (err: any) {
      const msgErro = err?.response?.data?.message || 'Falha na conexão. Verifique as configurações.';
      const statusCode = err?.response?.status;
      const novas = integracoes.map(i => i.id === servico.id ? { ...i, status: 'erro' as const, ultimaVerificacao: new Date().toISOString() } : i);
      persistirIntegracoes(novas);
      // 403 = permissão insuficiente (endpoint exige super-admin)
      const msgFinal = statusCode === 403
        ? 'Apenas super-admin pode testar esta integração.'
        : msgErro;
      setMensagemTeste({ tipo: 'erro', texto: msgFinal });
      mostrarToast('erro', `${servico.nome}: ${msgFinal}`);
    }
    setTestando(null);
  };

  const salvarConfig = async () => {
    if (!servicoSelecionado) return;
    // O backend substitui o objeto de config inteiro ao salvar e as credenciais nunca são
    // exibidas de volta (vêm mascaradas do GET). Por isso exigimos reinseri-las para não
    // apagá-las — e NUNCA reenviamos o valor mascarado como se fosse a credencial real.
    const sensiveis = (camposPorServico[servicoSelecionado.id] || []).filter(c => c.tipo === 'password');
    const faltando = sensiveis.filter(c => !(configEdit[c.chave] || '').trim());
    if (faltando.length) {
      setMensagemTeste({ tipo: 'erro', texto: `Por segurança, as credenciais não são exibidas. Reinsira para salvar: ${faltando.map(c => c.label).join(', ')}.` });
      return;
    }
    setSalvando(true);
    try {
      await api.post('/integracoes/salvar', { servico: servicoSelecionado.id, config: configEdit });
      // Estado local só com metadados não sensíveis (o segredo é descartado após o POST).
      const novas = integracoes.map(i => i.id === servicoSelecionado.id
        ? { ...i, config: { ...i.config, ...sanitizarConfig(servicoSelecionado.id, configEdit) }, configurado: true }
        : i);
      persistirIntegracoes(novas);
      mostrarToast('sucesso', `${servicoSelecionado.nome}: configuração salva.`);
      setMensagemTeste(null);
      setShowModal(false);
      // Reflete o estado mascarado do backend (fonte de verdade).
      carregarIntegracoesBackend();
    } catch (err: any) {
      // Erro não é silencioso: mostra toast, mantém o modal aberto e não dá falso sucesso.
      const statusCode = err?.response?.status;
      const msgErro = statusCode === 403
        ? 'Apenas super-admin pode salvar esta integração.'
        : (err?.response?.data?.message || 'Falha ao salvar. Tente novamente.');
      setMensagemTeste({ tipo: 'erro', texto: msgErro });
      mostrarToast('erro', `${servicoSelecionado.nome}: ${msgErro}`);
    }
    setSalvando(false);
  };

  // Fase de higiene: o fluxo "Adicionar Nova Integração" foi removido (não há backend para
  // suportá-lo). O card correspondente virou um placeholder "Em breve", não clicável.

  return (
    <div className="space-y-6 pb-20">
      {/* Toast global — visível mesmo fora do modal */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold transition-all animate-fade-in ${
          toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.texto}</span>
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold text-gray-800">Integrações Externas</h2>
        <p className="text-gray-600 text-sm">Gerencie as APIs e serviços conectados ao sistema</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {integracoes.map(servico => {
          const Icon = iconeMap[servico.icone] || Plug;
          const isNaoConfiguravel = servico.id === 'viacep' || servico.id === 'supabase';
          return (
            <div key={servico.id} className="bg-white rounded-2xl border border-gray-100 p-6 hover:border-blue-200 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                    <Icon size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800">{servico.nome}</h3>
                    <p className="text-xs text-gray-500">{tipoLabels[servico.tipo]}</p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  servico.nativo ? 'bg-gray-50 text-gray-600' :
                  servico.status === 'conectado' ? 'bg-green-50 text-green-700' :
                  servico.status === 'erro' ? 'bg-red-50 text-red-700' :
                  servico.configurado ? 'bg-blue-50 text-blue-700' :
                  'bg-gray-50 text-gray-600'
                }`}>
                  {servico.nativo ? 'Nativo do sistema' : servico.status === 'conectado' ? '● Conectado' : servico.status === 'erro' ? '● Erro' : servico.configurado ? '● Configurado' : '○ Não configurado'}
                </span>
              </div>

              <p className="text-sm text-gray-500 mb-4">{servico.descricao}</p>

              <p className="text-xs text-gray-400 mb-4">
                Última verificação: {servico.ultimaVerificacao ? new Date(servico.ultimaVerificacao).toLocaleString('pt-BR') : 'Nunca'}
              </p>

              <div className="flex space-x-2">
                <button
                  onClick={() => abrirModal(servico)}
                  disabled={isNaoConfiguravel}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${isNaoConfiguravel ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  ⚙️ Configurar
                </button>
                <button
                  onClick={() => testarConexao(servico)}
                  disabled={testando === servico.id}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center ${testando === servico.id ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                >
                  {testando === servico.id ? (
                    <Loader2 size={16} className="animate-spin mr-1" />
                  ) : (
                    <span className="mr-1">🔌</span>
                  )}
                  Testar Conexão
                </button>
              </div>
            </div>
          );
        })}

        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-6 hover:border-blue-400 hover:bg-blue-50/30 transition-all flex flex-col items-center justify-center min-h-[200px] opacity-50 cursor-not-allowed">
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 mb-3">
              <Plug size={28} />
            </div>
            <p className="font-bold text-gray-700">Em breve</p>
            <p className="text-xs text-gray-400 mt-1">Próxima fase: integração configurável</p>
          </div>
      </div>

      {showModal && servicoSelecionado && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">Configurar {servicoSelecionado.nome}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
            </div>

            <div className="p-6 space-y-5">
              <div className="flex items-start space-x-2 p-3 rounded-xl bg-amber-50 text-amber-700 text-xs">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>As credenciais não serão mantidas no navegador. A persistência segura será tratada nas próximas fases.</span>
              </div>
              {(camposPorServico[servicoSelecionado.id] || []).map(campo => (
                <div key={campo.chave}>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{campo.label}</label>
                  {campo.tipo === 'select' ? (
                    <select
                      className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                      value={configEdit[campo.chave] || ''}
                      onChange={e => setConfigEdit({ ...configEdit, [campo.chave]: e.target.value })}
                    >
                      {(campo.options || []).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={campo.tipo}
                      className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                      value={configEdit[campo.chave] || ''}
                      onChange={e => setConfigEdit({ ...configEdit, [campo.chave]: e.target.value })}
                      placeholder={campo.tipo === 'password' && (servicoSelecionado.camposCadastrados || []).includes(campo.chave)
                        ? 'Credencial cadastrada — preencha para substituir'
                        : `Digite ${campo.label.toLowerCase()}`}
                    />
                  )}
                </div>
              ))}

              {mensagemTeste && (
                <div className={`flex items-center space-x-2 p-3 rounded-xl text-sm font-medium ${
                  mensagemTeste.tipo === 'sucesso' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {mensagemTeste.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
                  <span>{mensagemTeste.texto}</span>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-between items-center">
              <button
                onClick={() => testarConexao(servicoSelecionado, configEdit)}
                disabled={testando === servicoSelecionado.id}
                className="flex items-center px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-medium text-sm hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {testando === servicoSelecionado.id ? (
                  <Loader2 size={16} className="animate-spin mr-1.5" />
                ) : (
                  <span className="mr-1.5">🔌</span>
                )}
                Testar Conexão
              </button>
              <div className="flex space-x-2">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
                <button
                  onClick={salvarConfig}
                  disabled={salvando}
                  className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800 transition-colors disabled:opacity-50"
                >
                  <Check size={16} className="mr-1.5" />
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
