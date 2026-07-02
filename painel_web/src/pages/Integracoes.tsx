import React, { useState, useEffect } from 'react';
import { CreditCard, FileSignature, MapPin, Mail, Database, Plug, X, Check, AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
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
  // Integração personalizada (Fase 3D): cadastro administrativo, SEM automação e SEM teste.
  custom?: boolean;
  campos?: CampoConfig[];       // definição de campos própria (só para custom)
  criadoEm?: string | null;
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

// Visibilidade de cards (espelha o backend Fase 3A): SÓ estas podem ser ocultadas/reexibidas.
const INTEGRACOES_REMOVIVEIS = new Set(['clicksign', 'smtp']);
// Nativas/críticas: ficam SEMPRE visíveis na UI, mesmo que por algum bug venham em "ocultas".
const INTEGRACOES_PROTEGIDAS = new Set(['asaas', 'viacep', 'supabase']);

// Slugs reservados (espelha o backend Fase 3C): serviços padrão + nomes internos de rota.
// Usado só para feedback amigável no modal — o backend é a autoridade final.
const SLUGS_RESERVADOS = new Set([
  'asaas', 'clicksign', 'viacep', 'smtp', 'supabase',
  'estado', 'catalogo', 'customizadas', 'salvar', 'testar', 'ocultar', 'exibir',
]);

// Categorias aceitas pelo backend para uma integração personalizada.
const CATEGORIAS_CUSTOM: { value: Integracao['tipo']; label: string }[] = [
  { value: 'pagamento', label: 'Pagamento' },
  { value: 'assinatura', label: 'Assinatura Digital' },
  { value: 'consulta', label: 'Consulta' },
  { value: 'email', label: 'Email' },
  { value: 'banco', label: 'Banco/Storage' },
  { value: 'outro', label: 'Outro' },
];

// Limite espelhado do backend (MAX_CAMPOS) — evita enviar payload que será rejeitado.
const MAX_CAMPOS_CUSTOM = 10;

// Gera um slug a partir do nome: minúsculas, só [a-z0-9_-]; separadores/acentos viram hífen.
const gerarSlug = (texto: string): string =>
  (texto || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

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
  // Serviços atualmente ocultos da tela (fonte de verdade: GET /integracoes/estado).
  const [integracoesOcultas, setIntegracoesOcultas] = useState<string[]>([]);
  // Integrações personalizadas (fonte de verdade: GET /integracoes/catalogo).
  const [integracoesCustomizadas, setIntegracoesCustomizadas] = useState<Integracao[]>([]);
  // Metadados mascarados por serviço (GET /integracoes) — usado p/ refletir "configurado"
  // e chaves já cadastradas nos cards personalizados (padrão já mescla direto no estado).
  const [mascaradoPorServico, setMascaradoPorServico] = useState<Record<string, { configurado: boolean; camposCadastrados: string[]; configPublica: Record<string, string> }>>({});
  // Modal "Adicionar integração personalizada".
  const [modalAdicionarAberto, setModalAdicionarAberto] = useState(false);
  const [formAdicionar, setFormAdicionar] = useState<{ nome: string; servico: string; servicoEditado: boolean; categoria: Integracao['tipo']; descricao: string }>({ nome: '', servico: '', servicoEditado: false, categoria: 'outro', descricao: '' });
  const [camposCustomForm, setCamposCustomForm] = useState<{ chave: string; label: string; tipo: 'text' | 'password' }[]>([]);
  const [salvandoAdicionar, setSalvandoAdicionar] = useState(false);
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);


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
      // Guarda o metadado mascarado por serviço (sem segredo) para os cards personalizados.
      const meta: Record<string, { configurado: boolean; camposCadastrados: string[]; configPublica: Record<string, string> }> = {};
      lista.forEach((it: any) => {
        if (!it?.servico) return;
        meta[it.servico] = {
          configurado: !!it.configurado,
          camposCadastrados: Object.keys(it.camposMascarados || {}),
          configPublica: (it.configPublica && typeof it.configPublica === 'object') ? it.configPublica : {},
        };
      });
      setMascaradoPorServico(meta);
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

  // Estado de visibilidade dos cards (GET /integracoes/estado). Sem segredos: só a lista
  // de serviços ocultos. 401/403/erro de rede mantêm a tela sem quebrar (nada oculto).
  const carregarEstadoIntegracoes = async () => {
    try {
      const resp = await api.get('/integracoes/estado');
      const bruto = Array.isArray(resp.data?.ocultas) ? resp.data.ocultas : [];
      // Normaliza para strings minúsculas e NUNCA oculta integrações protegidas na UI,
      // mesmo que o backend por algum bug devolva uma delas.
      const ocultas = bruto
        .filter((s: any) => typeof s === 'string')
        .map((s: string) => s.toLowerCase())
        .filter((s: string) => !INTEGRACOES_PROTEGIDAS.has(s));
      setIntegracoesOcultas(ocultas);
    } catch {
      // Mantém o fallback (nada oculto); não expõe erro/segredo.
    }
  };

  useEffect(() => { carregarEstadoIntegracoes(); }, []);

  // Converte uma entrada do catálogo do backend em um card de integração personalizada.
  // Só metadados/definição de campos; nunca valores de credenciais.
  const catalogoParaIntegracao = (item: any): Integracao | null => {
    if (!item || typeof item.servico !== 'string') return null;
    const tipo = CATEGORIAS_CUSTOM.some(c => c.value === item.categoria) ? item.categoria : 'outro';
    const campos: CampoConfig[] = Array.isArray(item.campos) ? item.campos
      .filter((c: any) => c && typeof c === 'object' && typeof c.chave === 'string')
      .map((c: any) => ({
        chave: String(c.chave),
        label: String(c.label || c.chave),
        tipo: (c.tipo === 'password' || c.tipo === 'select') ? c.tipo : 'text',
        ...(c.tipo === 'select' && Array.isArray(c.options) ? { options: c.options } : {}),
      })) : [];
    return {
      id: item.servico,
      nome: String(item.nome || item.servico),
      tipo,
      descricao: String(item.descricao || ''),
      icone: 'Plug',
      status: 'desconectado',
      config: {},
      ultimaVerificacao: null,
      custom: true,
      campos,
      criadoEm: item.criado_em || null,
    };
  };

  // Fonte de verdade das personalizadas: GET /integracoes/catalogo. Sem segredos.
  // 401/403/erro de rede mantêm a tela sem quebrar (lista vazia).
  const carregarCatalogoIntegracoes = async () => {
    try {
      const resp = await api.get('/integracoes/catalogo');
      const lista = Array.isArray(resp.data?.customizadas) ? resp.data.customizadas : [];
      const cards = lista.map(catalogoParaIntegracao).filter(Boolean) as Integracao[];
      setIntegracoesCustomizadas(cards);
    } catch {
      // Mantém o fallback (nenhuma personalizada); não expõe erro/segredo.
    }
  };

  useEffect(() => { carregarCatalogoIntegracoes(); }, []);

  // Campos de configuração de um serviço: dinâmicos p/ custom, fixos p/ padrão.
  const obterCamposServico = (servico: Integracao): CampoConfig[] =>
    servico.custom ? (servico.campos || []) : (camposPorServico[servico.id] || []);

  // Cria uma integração personalizada (POST /integracoes/customizadas).
  // NÃO salva credenciais aqui — só o cadastro/catálogo. Credencial só em "Configurar".
  const criarCustomizada = async () => {
    setErroAdicionar(null);
    const nome = formAdicionar.nome.trim();
    const servico = gerarSlug(formAdicionar.servico || formAdicionar.nome);
    if (!nome) { setErroAdicionar('Informe o nome da integração.'); return; }
    if (!servico) { setErroAdicionar('Informe um identificador (slug) válido.'); return; }
    if (SLUGS_RESERVADOS.has(servico)) { setErroAdicionar('Este identificador é reservado. Escolha outro.'); return; }
    if (integracoesCustomizadas.some(c => c.id === servico)) { setErroAdicionar('Já existe uma integração com este identificador.'); return; }

    // Valida/normaliza campos (só metadados; sem valores/segredos).
    const campos: CampoConfig[] = [];
    const chavesVistas = new Set<string>();
    for (const campo of camposCustomForm) {
      const chave = gerarSlug(campo.chave);
      const label = (campo.label || '').trim();
      if (!chave) { setErroAdicionar('Cada campo precisa de uma chave válida (ex.: base_url).'); return; }
      if (!label) { setErroAdicionar('Cada campo precisa de um rótulo.'); return; }
      if (chavesVistas.has(chave)) { setErroAdicionar('Há campos com a mesma chave.'); return; }
      chavesVistas.add(chave);
      campos.push({ chave, label, tipo: campo.tipo });
    }
    if (campos.length > MAX_CAMPOS_CUSTOM) { setErroAdicionar(`No máximo ${MAX_CAMPOS_CUSTOM} campos por integração.`); return; }

    setSalvandoAdicionar(true);
    try {
      await api.post('/integracoes/customizadas', {
        servico,
        nome,
        categoria: formAdicionar.categoria,
        descricao: formAdicionar.descricao.trim(),
        campos,
      });
      mostrarToast('sucesso', `${nome}: integração personalizada criada.`);
      setModalAdicionarAberto(false);
      setFormAdicionar({ nome: '', servico: '', servicoEditado: false, categoria: 'outro', descricao: '' });
      setCamposCustomForm([]);
      carregarCatalogoIntegracoes();
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const msg = statusCode === 403
        ? 'Apenas super-admin pode criar integrações.'
        : (err?.response?.data?.message || 'Falha ao criar integração. Tente novamente.');
      setErroAdicionar(msg);
    }
    setSalvandoAdicionar(false);
  };

  // Exclui uma integração personalizada de verdade (DELETE /integracoes/customizadas/:servico).
  const excluirCustomizada = async (servico: Integracao) => {
    if (!servico.custom) return;
    const ok = window.confirm(
      'Deseja excluir esta integração personalizada? O catálogo e a configuração salva serão removidos. Esta ação não afeta integrações nativas ou de pagamento.'
    );
    if (!ok) return;
    setExcluindo(servico.id);
    try {
      await api.delete(`/integracoes/customizadas/${servico.id}`);
      mostrarToast('sucesso', `${servico.nome}: integração personalizada excluída.`);
      // Recarrega catálogo e metadados mascarados (a credencial associada foi removida).
      carregarCatalogoIntegracoes();
      carregarIntegracoesBackend();
    } catch (err: any) {
      // Não remove visualmente se a API falhar.
      const statusCode = err?.response?.status;
      const msg = statusCode === 403
        ? 'Apenas super-admin pode excluir esta integração.'
        : (err?.response?.data?.message || 'Falha ao excluir. Tente novamente.');
      mostrarToast('erro', `${servico.nome}: ${msg}`);
    }
    setExcluindo(null);
  };

  // Oculta um card opcional (clicksign/smtp). NÃO apaga a configuração/credencial salva.
  const ocultarIntegracao = async (servico: Integracao) => {
    if (!INTEGRACOES_REMOVIVEIS.has(servico.id)) return;
    const ok = window.confirm(
      'Deseja remover esta integração da tela? A configuração salva será mantida e você poderá adicioná-la novamente depois.'
    );
    if (!ok) return;
    try {
      await api.patch(`/integracoes/${servico.id}/ocultar`);
      mostrarToast('sucesso', `${servico.nome}: removida da tela.`);
      setIntegracoesOcultas(prev => (prev.includes(servico.id) ? prev : [...prev, servico.id]));
      // Reflete a fonte de verdade (backend).
      carregarEstadoIntegracoes();
    } catch (err: any) {
      // Não altera o estado visual se a API falhar.
      const statusCode = err?.response?.status;
      const msg = statusCode === 403
        ? 'Apenas super-admin pode remover esta integração.'
        : (err?.response?.data?.message || 'Falha ao remover da tela. Tente novamente.');
      mostrarToast('erro', `${servico.nome}: ${msg}`);
    }
  };

  // Reexibe um card previamente ocultado (clicksign/smtp).
  const reexibirIntegracao = async (servico: Integracao) => {
    if (!INTEGRACOES_REMOVIVEIS.has(servico.id)) return;
    try {
      await api.patch(`/integracoes/${servico.id}/exibir`);
      mostrarToast('sucesso', `${servico.nome}: adicionada de volta à tela.`);
      setIntegracoesOcultas(prev => prev.filter(s => s !== servico.id));
      carregarEstadoIntegracoes();
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const msg = statusCode === 403
        ? 'Apenas super-admin pode reexibir esta integração.'
        : (err?.response?.data?.message || 'Falha ao reexibir. Tente novamente.');
      mostrarToast('erro', `${servico.nome}: ${msg}`);
    }
  };

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
    const sensiveis = obterCamposServico(servicoSelecionado).filter(c => c.tipo === 'password');
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

  // Cards visíveis: exclui os ocultos, mas NUNCA esconde integrações protegidas.
  const integracoesVisiveis = integracoes.filter(
    s => INTEGRACOES_PROTEGIDAS.has(s.id) || !integracoesOcultas.includes(s.id)
  );
  // Ocultas que podem voltar à tela (apenas as removíveis, defensivo).
  const integracoesParaReexibir = integracoes.filter(
    s => INTEGRACOES_REMOVIVEIS.has(s.id) && integracoesOcultas.includes(s.id)
  );
  // Cards personalizados enriquecidos com o metadado mascarado do backend (sem segredo):
  // reflete "configurado" e chaves já cadastradas, sem nunca trazer o valor da credencial.
  const integracoesCustomizadasView = integracoesCustomizadas.map(c => {
    const meta = mascaradoPorServico[c.id];
    if (!meta) return c;
    return {
      ...c,
      config: { ...c.config, ...meta.configPublica },
      configurado: meta.configurado,
      camposCadastrados: meta.camposCadastrados,
    };
  });

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
        {integracoesVisiveis.map(servico => {
          const Icon = iconeMap[servico.icone] || Plug;
          const isNaoConfiguravel = servico.id === 'viacep' || servico.id === 'supabase';
          const podeRemover = INTEGRACOES_REMOVIVEIS.has(servico.id);
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

              {podeRemover && (
                <button
                  onClick={() => ocultarIntegracao(servico)}
                  className="mt-3 w-full text-xs font-medium text-gray-400 hover:text-red-600 transition-colors"
                >
                  Remover da tela
                </button>
              )}
            </div>
          );
        })}

        {/* Cards de integrações personalizadas (cadastro administrativo, SEM automação). */}
        {integracoesCustomizadasView.map(servico => {
          const Icon = iconeMap[servico.icone] || Plug;
          return (
            <div key={`custom-${servico.id}`} className="bg-white rounded-2xl border border-purple-100 p-6 hover:border-purple-200 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                    <Icon size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800">{servico.nome}</h3>
                    <p className="text-xs text-gray-500">{tipoLabels[servico.tipo]}</p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700">Personalizada</span>
              </div>

              {servico.descricao && <p className="text-sm text-gray-500 mb-3">{servico.descricao}</p>}

              <div className="flex items-start space-x-2 p-2.5 mb-4 rounded-lg bg-amber-50 text-amber-700 text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>Sem automação — sem teste de conexão até existir um adaptador.</span>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => abrirModal(servico)}
                  className="flex-1 px-4 py-2 rounded-lg font-medium text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  ⚙️ Configurar
                </button>
                <button
                  onClick={() => excluirCustomizada(servico)}
                  disabled={excluindo === servico.id}
                  className="flex-1 px-4 py-2 rounded-lg font-medium text-sm bg-red-50 text-red-700 hover:bg-red-100 transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {excluindo === servico.id ? (
                    <Loader2 size={16} className="animate-spin mr-1" />
                  ) : (
                    <Trash2 size={15} className="mr-1" />
                  )}
                  Excluir
                </button>
              </div>

              <p className="mt-3 text-center text-xs text-gray-400">
                {servico.configurado ? '● Configurado' : 'Teste indisponível — integração sem adaptador.'}
              </p>
            </div>
          );
        })}

        {/* Reexibir integrações opcionais conhecidas (clicksign/smtp) que foram removidas. */}
        {integracoesParaReexibir.map(servico => {
          const Icon = iconeMap[servico.icone] || Plug;
          return (
            <div
              key={`reexibir-${servico.id}`}
              className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-6 hover:border-blue-400 hover:bg-blue-50/30 transition-all flex flex-col items-center justify-center min-h-[200px]"
            >
              <div className="p-3 rounded-xl bg-blue-50 text-blue-600 mb-3">
                <Icon size={28} />
              </div>
              <p className="font-bold text-gray-700">{servico.nome}</p>
              <p className="text-xs text-gray-400 mt-1 mb-4 text-center">Removida da tela — configuração preservada</p>
              <button
                onClick={() => reexibirIntegracao(servico)}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
              >
                Reexibir {servico.nome}
              </button>
            </div>
          );
        })}

        {/* Adicionar integração personalizada — abre o modal de cadastro administrativo. */}
        <button
          onClick={() => { setErroAdicionar(null); setModalAdicionarAberto(true); }}
          className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-6 hover:border-green-400 hover:bg-green-50/30 transition-all flex flex-col items-center justify-center min-h-[200px] text-center"
        >
          <div className="p-3 rounded-xl bg-green-50 text-green-600 mb-3">
            <Plus size={28} />
          </div>
          <p className="font-bold text-gray-700">Adicionar integração</p>
          <p className="text-xs text-gray-400 mt-1">Cadastro de integração personalizada</p>
        </button>
      </div>

      {showModal && servicoSelecionado && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">Configurar {servicoSelecionado.nome}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
            </div>

            <div className="p-6 space-y-5">
              {servicoSelecionado.custom ? (
                <div className="flex items-start space-x-2 p-3 rounded-xl bg-amber-50 text-amber-700 text-xs">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>Esta integração personalizada apenas armazena dados administrativos. Ela não executa ações automáticas nem possui teste de conexão até que um adaptador seja implementado.</span>
                </div>
              ) : (
                <div className="flex items-start space-x-2 p-3 rounded-xl bg-amber-50 text-amber-700 text-xs">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>As credenciais não serão mantidas no navegador. A persistência segura será tratada nas próximas fases.</span>
                </div>
              )}
              {obterCamposServico(servicoSelecionado).length === 0 && (
                <p className="text-sm text-gray-400 text-center">Esta integração não possui campos de configuração.</p>
              )}
              {obterCamposServico(servicoSelecionado).map(campo => (
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
              {servicoSelecionado.custom ? (
                <span className="text-xs text-gray-400 max-w-[55%]">Teste indisponível — integração sem adaptador.</span>
              ) : (
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
              )}
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

      {modalAdicionarAberto && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-bold text-gray-800">Adicionar integração</h3>
              <button onClick={() => setModalAdicionarAberto(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="flex items-start space-x-2 p-3 rounded-xl bg-amber-50 text-amber-700 text-xs">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>Esta integração personalizada apenas armazena dados administrativos. Ela não executa ações automáticas nem possui teste de conexão até que um adaptador seja implementado.</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome da integração</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-500 bg-gray-50/50"
                  value={formAdicionar.nome}
                  onChange={e => setFormAdicionar({ ...formAdicionar, nome: e.target.value })}
                  placeholder="Ex.: Minha API"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Identificador (slug)</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-500 bg-gray-50/50"
                  value={formAdicionar.servicoEditado ? formAdicionar.servico : gerarSlug(formAdicionar.nome)}
                  onChange={e => setFormAdicionar({ ...formAdicionar, servico: gerarSlug(e.target.value), servicoEditado: true })}
                  placeholder="minha-api"
                />
                <p className="text-xs text-gray-400 mt-1 ml-1">Identificador usado internamente. Ex.: minha-api</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Categoria</label>
                <select
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-500 bg-gray-50/50"
                  value={formAdicionar.categoria}
                  onChange={e => setFormAdicionar({ ...formAdicionar, categoria: e.target.value as Integracao['tipo'] })}
                >
                  {CATEGORIAS_CUSTOM.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Descrição (opcional)</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-green-500 bg-gray-50/50"
                  value={formAdicionar.descricao}
                  onChange={e => setFormAdicionar({ ...formAdicionar, descricao: e.target.value })}
                  placeholder="Para que serve esta integração"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-400 uppercase ml-1">Campos de configuração</label>
                  <button
                    type="button"
                    onClick={() => { if (camposCustomForm.length < MAX_CAMPOS_CUSTOM) setCamposCustomForm([...camposCustomForm, { chave: '', label: '', tipo: 'text' }]); }}
                    disabled={camposCustomForm.length >= MAX_CAMPOS_CUSTOM}
                    className="flex items-center text-xs font-medium text-green-700 hover:text-green-800 disabled:text-gray-300"
                  >
                    <Plus size={14} className="mr-1" /> Adicionar campo
                  </button>
                </div>
                {camposCustomForm.length === 0 && (
                  <p className="text-xs text-gray-400 ml-1">Nenhum campo. Ex.: URL Base (text), Token (password).</p>
                )}
                <div className="space-y-2">
                  {camposCustomForm.map((campo, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <input
                        type="text"
                        className="flex-1 border-2 border-gray-50 rounded-lg p-2 text-sm outline-none focus:border-green-500 bg-gray-50/50"
                        value={campo.chave}
                        onChange={e => setCamposCustomForm(camposCustomForm.map((c, i) => i === idx ? { ...c, chave: e.target.value } : c))}
                        placeholder="chave (ex.: base_url)"
                      />
                      <input
                        type="text"
                        className="flex-1 border-2 border-gray-50 rounded-lg p-2 text-sm outline-none focus:border-green-500 bg-gray-50/50"
                        value={campo.label}
                        onChange={e => setCamposCustomForm(camposCustomForm.map((c, i) => i === idx ? { ...c, label: e.target.value } : c))}
                        placeholder="rótulo (ex.: URL Base)"
                      />
                      <select
                        className="border-2 border-gray-50 rounded-lg p-2 text-sm outline-none focus:border-green-500 bg-gray-50/50"
                        value={campo.tipo}
                        onChange={e => setCamposCustomForm(camposCustomForm.map((c, i) => i === idx ? { ...c, tipo: e.target.value as 'text' | 'password' } : c))}
                      >
                        <option value="text">Texto</option>
                        <option value="password">Senha</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setCamposCustomForm(camposCustomForm.filter((_, i) => i !== idx))}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {erroAdicionar && (
                <div className="flex items-center space-x-2 p-3 rounded-xl text-sm font-medium bg-red-50 text-red-700">
                  <AlertTriangle size={18} />
                  <span>{erroAdicionar}</span>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
              <button onClick={() => setModalAdicionarAberto(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm font-medium">Cancelar</button>
              <button
                onClick={criarCustomizada}
                disabled={salvandoAdicionar}
                className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800 transition-colors disabled:opacity-50"
              >
                {salvandoAdicionar ? <Loader2 size={16} className="animate-spin mr-1.5" /> : <Plus size={16} className="mr-1.5" />}
                {salvandoAdicionar ? 'Criando...' : 'Criar integração'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
