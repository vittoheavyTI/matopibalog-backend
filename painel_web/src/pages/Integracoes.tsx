import React, { useState, useEffect } from 'react';
import { CreditCard, FileSignature, MapPin, Mail, Database, Plug, Plus, X, Check, AlertTriangle, Loader2 } from 'lucide-react';
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
    status: 'conectado',
    config: {},
    ultimaVerificacao: new Date().toISOString()
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
    status: 'conectado',
    config: {},
    ultimaVerificacao: new Date().toISOString()
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

export const Integracoes: React.FC = () => {
  const [integracoes, setIntegracoes] = useState<Integracao[]>(integracoesPadrao);
  const [showModal, setShowModal] = useState(false);
  const [servicoSelecionado, setServicoSelecionado] = useState<Integracao | null>(null);
  const [configEdit, setConfigEdit] = useState<Record<string, string>>({});
  const [testando, setTestando] = useState<string | null>(null);
  const [mensagemTeste, setMensagemTeste] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [showNovaIntegracao, setShowNovaIntegracao] = useState(false);
  const [novaIntegracao, setNovaIntegracao] = useState({
    nome: '',
    tipo: 'outro' as Integracao['tipo'],
    descricao: '',
    config: {} as Record<string, string>
  });
  const [camposDinamicos, setCamposDinamicos] = useState<{ chave: string; valor: string }[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('choferlog_integracoes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setIntegracoes(prev => prev.map(p => {
          const savedConfig = parsed[p.id];
          if (savedConfig) {
            return { ...p, config: { ...p.config, ...savedConfig.config }, status: savedConfig.status || p.status, ultimaVerificacao: savedConfig.ultimaVerificacao || p.ultimaVerificacao };
          }
          return p;
        }));
      } catch {}
    }
  }, []);

  const persistirIntegracoes = (novas: Integracao[]) => {
    const obj: Record<string, any> = {};
    novas.forEach(i => { obj[i.id] = { config: i.config, status: i.status, ultimaVerificacao: i.ultimaVerificacao }; });
    localStorage.setItem('choferlog_integracoes', JSON.stringify(obj));
    setIntegracoes(novas);
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
    localStorage.setItem(`choferlog_integracao_config_${servico.id}`, JSON.stringify(config));
    try {
      await api.post('/integracoes/testar/' + servico.id, config);
      const novas = integracoes.map(i => i.id === servico.id ? { ...i, status: 'conectado' as const, ultimaVerificacao: new Date().toISOString() } : i);
      persistirIntegracoes(novas);
      setMensagemTeste({ tipo: 'sucesso', texto: 'Conexão estabelecida com sucesso.' });
    } catch {
      const novas = integracoes.map(i => i.id === servico.id ? { ...i, status: 'erro' as const, ultimaVerificacao: new Date().toISOString() } : i);
      persistirIntegracoes(novas);
      setMensagemTeste({ tipo: 'erro', texto: 'Falha na conexão. Verifique as configurações.' });
    }
    setTestando(null);
  };

  const salvarConfig = async () => {
    if (!servicoSelecionado) return;
    setSalvando(true);
    const novas = integracoes.map(i => i.id === servicoSelecionado.id ? { ...i, config: { ...configEdit } } : i);
    persistirIntegracoes(novas);
    try {
      await api.post('/integracoes/salvar', { servico: servicoSelecionado.id, config: configEdit });
    } catch {}
    setShowModal(false);
    setMensagemTeste(null);
    setSalvando(false);
  };

  const adicionarNovaIntegracao = () => {
    const campos: Record<string, string> = {};
    camposDinamicos.forEach(c => { if (c.chave.trim()) campos[c.chave.trim()] = c.valor; });

    const nova: Integracao = {
      id: `custom_${Date.now()}`,
      nome: novaIntegracao.nome,
      tipo: novaIntegracao.tipo,
      descricao: novaIntegracao.descricao,
      icone: 'Plug',
      status: 'desconectado',
      config: campos,
      ultimaVerificacao: null
    };

    const novas = [...integracoes, nova];
    persistirIntegracoes(novas);
    setShowNovaIntegracao(false);
    setNovaIntegracao({ nome: '', tipo: 'outro', descricao: '', config: {} });
    setCamposDinamicos([]);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white">
          <Plug size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Integrações Externas</h1>
          <p className="text-sm text-gray-500">Gerencie as APIs e serviços conectados ao sistema</p>
        </div>
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
                  servico.status === 'conectado' ? 'bg-green-50 text-green-700' :
                  servico.status === 'erro' ? 'bg-red-50 text-red-700' :
                  'bg-gray-50 text-gray-600'
                }`}>
                  {servico.status === 'conectado' ? '● Conectado' : servico.status === 'erro' ? '● Erro' : '○ Não configurado'}
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

        <div
          onClick={() => setShowNovaIntegracao(true)}
          className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-6 hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[200px]"
        >
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600 mb-3">
            <Plus size={28} />
          </div>
          <p className="font-bold text-gray-700">Adicionar Nova Integração</p>
          <p className="text-xs text-gray-400 mt-1">Conecte novos serviços ao sistema</p>
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
                      placeholder={`Digite ${campo.label.toLowerCase()}`}
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
                  className="flex items-center px-5 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Check size={16} className="mr-1.5" />
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNovaIntegracao && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">Nova Integração</h3>
              <button onClick={() => setShowNovaIntegracao(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome do Serviço</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={novaIntegracao.nome}
                  onChange={e => setNovaIntegracao({ ...novaIntegracao, nome: e.target.value })}
                  placeholder="Ex: Mercado Pago"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo</label>
                <select
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-white"
                  value={novaIntegracao.tipo}
                  onChange={e => setNovaIntegracao({ ...novaIntegracao, tipo: e.target.value as Integracao['tipo'] })}
                >
                  <option value="pagamento">Pagamento</option>
                  <option value="assinatura">Assinatura Digital</option>
                  <option value="consulta">Consulta</option>
                  <option value="email">Email</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Descrição</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50"
                  value={novaIntegracao.descricao}
                  onChange={e => setNovaIntegracao({ ...novaIntegracao, descricao: e.target.value })}
                  placeholder="O que esta integração faz?"
                />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">Campos Personalizados</label>
                {camposDinamicos.map((campo, idx) => (
                  <div key={idx} className="flex items-center space-x-2 mb-2">
                    <input
                      type="text"
                      className="flex-1 border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm"
                      placeholder="Nome do campo"
                      value={campo.chave}
                      onChange={e => {
                        const novos = [...camposDinamicos];
                        novos[idx].chave = e.target.value;
                        setCamposDinamicos(novos);
                      }}
                    />
                    <input
                      type="text"
                      className="flex-1 border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm"
                      placeholder="Valor padrão"
                      value={campo.valor}
                      onChange={e => {
                        const novos = [...camposDinamicos];
                        novos[idx].valor = e.target.value;
                        setCamposDinamicos(novos);
                      }}
                    />
                    <button
                      onClick={() => setCamposDinamicos(camposDinamicos.filter((_, i) => i !== idx))}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setCamposDinamicos([...camposDinamicos, { chave: '', valor: '' }])}
                  className="flex items-center text-sm text-blue-600 hover:text-blue-700 font-medium mt-2"
                >
                  <Plus size={16} className="mr-1" /> Adicionar Campo
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => setShowNovaIntegracao(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
              <button
                onClick={adicionarNovaIntegracao}
                disabled={!novaIntegracao.nome.trim()}
                className="flex items-center px-5 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                <Plus size={16} className="mr-1.5" /> Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
