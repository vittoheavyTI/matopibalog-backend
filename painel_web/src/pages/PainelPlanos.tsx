import React, { useEffect, useState } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, Check, Eye, Plus, Shield, Trash2, X } from 'lucide-react';
import api from '../api';
import { formatCurrency } from '../utils';

type ModeloCobranca = 'fixo' | 'por_motorista';

type FormPlano = {
  nome: string;
  modelo_cobranca: ModeloCobranca;
  preco_mensal: string;
  preco_por_motorista: string;
  descricao: string;
  limite_motoristas: string;
  dias_trial: string;
  ativo: boolean;
  categoria: string;
  recursos: string;
  capacidade_inclusa: string;
  preco_motorista_extra: string;
  valor_implantacao: string;
  requer_negociacao: boolean;
};

const FORM_VAZIO: FormPlano = {
  nome: '',
  modelo_cobranca: 'fixo',
  preco_mensal: '',
  preco_por_motorista: '',
  descricao: '',
  limite_motoristas: '5',
  dias_trial: '7',
  ativo: true,
  categoria: 'ambos',
  recursos: '',
  capacidade_inclusa: '',
  preco_motorista_extra: '',
  valor_implantacao: '0',
  requer_negociacao: false,
};

const MODELOS_COBRANCA: { chave: ModeloCobranca; titulo: string; ajuda: string }[] = [
  { chave: 'fixo', titulo: 'Valor fixo', ajuda: 'Um valor mensal para o plano inteiro.' },
  { chave: 'por_motorista', titulo: 'Por motorista', ajuda: 'Valor unitário × capacidade contratada (não conta motoristas ativos).' },
];

// Espelho da política do backend (planoPrecoService). Existe para o super-admin
// VER o valor e o erro antes de salvar — nunca para decidir o que será cobrado.
// O backend é a autoridade: se divergirem, o 422 dele manda.
const SENTINELA_ILIMITADO = 999;
const LIMITE_MOTORISTAS_MAX = 200;
const VALOR_FINAL_MAX = 500000;

// Público-alvo do plano. Dirige o que aparece no app do autônomo.
const CATEGORIAS_PLANO: { chave: string; titulo: string }[] = [
  { chave: 'empresa', titulo: 'Empresa' },
  { chave: 'autonomo', titulo: 'Autônomo' },
  { chave: 'ambos', titulo: 'Ambos' },
];

const LABELS_RECURSOS: Record<string, string> = {
  api: 'Api',
  gestao: 'Gestão',
  integracao: 'Integração',
  multiusuario: 'Multiusuário',
  personalizacao: 'Personalização',
  relatorios: 'Relatórios',
  suporte: 'Suporte',
  usuarios: 'Usuários',
};

const VALORES_RECURSOS: Record<string, string> = {
  prioritario: 'prioritário',
};

function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function labelRecurso(chave: string): string {
  const palavras = chave.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return palavras.map((palavra, indice) => {
    const normalizada = removerAcentos(palavra);
    const conhecida = LABELS_RECURSOS[normalizada];
    if (conhecida) return conhecida;
    return indice === 0 ? palavra.charAt(0).toUpperCase() + palavra.slice(1) : palavra.toLocaleLowerCase('pt-BR');
  }).join(' ');
}

function valorRecurso(valor: string): string {
  const limpo = valor.trim();
  return VALORES_RECURSOS[removerAcentos(limpo)] || limpo;
}

function formatarRecursoTexto(item: string): string {
  const limpo = item.trim().replace(/[{}\[\]"]/g, '').replace(/^'+|'+$/g, '').trim();
  if (!limpo || ['true', 'false', 'null'].includes(limpo.toLocaleLowerCase('pt-BR'))) return '';
  const separador = limpo.indexOf(':');
  if (separador < 0) return labelRecurso(limpo);

  const chave = limpo.slice(0, separador).trim().replace(/^'+|'+$/g, '');
  const valor = limpo.slice(separador + 1).trim().replace(/^'+|'+$/g, '');
  if (!chave || !valor || valor === 'false' || valor === 'null') return '';
  if (valor === 'true') return labelRecurso(chave);
  return `${labelRecurso(chave)}: ${valorRecurso(valor)}`;
}

function normalizarRecursosParaLista(recursos: unknown): string[] {
  let itens: string[] = [];

  if (typeof recursos === 'string') {
    const texto = recursos.trim();
    if (!texto) return [];

    if ((texto.startsWith('{') && texto.endsWith('}')) || (texto.startsWith('[') && texto.endsWith(']'))) {
      try {
        return normalizarRecursosParaLista(JSON.parse(texto));
      } catch {
        // JSON legado inválido segue como texto comum, sem interromper a tela.
      }
    }

    itens = texto.split(/[,\n]/).map(formatarRecursoTexto);
  } else if (Array.isArray(recursos)) {
    itens = recursos.flatMap((item) => normalizarRecursosParaLista(item));
  } else if (recursos && typeof recursos === 'object') {
    itens = Object.entries(recursos).flatMap(([chave, valor]) => {
      if (valor === false || valor === null || valor === undefined || valor === '') return [];
      const label = labelRecurso(chave);
      if (valor === true) return label ? [label] : [];
      if (Array.isArray(valor)) {
        const detalhes = normalizarRecursosParaLista(valor).join(', ');
        return detalhes ? [`${label}: ${detalhes}`] : [];
      }
      if (typeof valor === 'object') return normalizarRecursosParaLista(valor);
      return label ? [`${label}: ${valorRecurso(String(valor))}`] : [valorRecurso(String(valor))];
    });
  }

  const vistos = new Set<string>();
  return itens.filter((item) => {
    const limpo = item.trim();
    const chave = limpo.toLocaleLowerCase('pt-BR');
    if (!limpo || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function recursosParaTexto(recursos: unknown): string {
  return normalizarRecursosParaLista(recursos).join('\n');
}

function textoParaRecursos(texto: string): string[] {
  return normalizarRecursosParaLista(texto);
}

// Texto monetário → centavos inteiros. null = não é dinheiro válido (vazio, lixo
// ou mais de 2 casas decimais — que o backend recusa em vez de arredondar).
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  const centavos = n * 100;
  const inteiro = Math.round(centavos);
  if (Math.abs(centavos - inteiro) > 1e-6) return null;
  return inteiro;
}

type Previa =
  | { ok: true; centavos: number; unitarioCentavos: number; quantidade: number }
  | { ok: false; erro: string };

// Prévia do valor final de um plano por motorista. Conta em centavos inteiros,
// igual à do backend — em float, 149,90 × 3 dá 449.70000000000005.
function calcularPrevia(form: FormPlano): Previa {
  const unitarioCentavos = paraCentavos(form.preco_por_motorista);
  if (unitarioCentavos === null) {
    return { ok: false, erro: 'Informe o valor por motorista (no máximo 2 casas decimais).' };
  }
  if (unitarioCentavos <= 0) {
    return { ok: false, erro: 'O valor por motorista deve ser maior que zero.' };
  }

  const quantidade = Number(form.limite_motoristas);
  if (!Number.isInteger(quantidade)) {
    return { ok: false, erro: 'A quantidade de motoristas contratados deve ser um número inteiro.' };
  }
  if (quantidade < 1) {
    return { ok: false, erro: 'A quantidade de motoristas contratados deve ser de pelo menos 1.' };
  }
  if (quantidade === SENTINELA_ILIMITADO) {
    return {
      ok: false,
      erro: '999 é reservado como sentinela de ilimitado; planos por motorista exigem quantidade finita.',
    };
  }
  if (quantidade > LIMITE_MOTORISTAS_MAX) {
    return { ok: false, erro: `Planos por motorista aceitam no máximo ${LIMITE_MOTORISTAS_MAX} motoristas.` };
  }

  const centavos = unitarioCentavos * quantidade;
  if (centavos > VALOR_FINAL_MAX * 100) {
    return { ok: false, erro: `O valor final ultrapassa o teto de ${formatCurrency(VALOR_FINAL_MAX)}.` };
  }
  return { ok: true, centavos, unitarioCentavos, quantidade };
}

export const PainelPlanos: React.FC = () => {
  const [planos, setPlanos] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<FormPlano>(FORM_VAZIO);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);
  // Seção "Arquivados" recolhida por padrão (não polui a visão principal).
  const [arquivadosAbertos, setArquivadosAbertos] = useState(false);
  // Plano sob confirmação forte de exclusão (modal exige digitar o nome).
  const [confirmarExcluir, setConfirmarExcluir] = useState<any>(null);
  const [excluirTexto, setExcluirTexto] = useState('');
  // Reprecificação de plano em uso: preenchido a partir do 409 do backend, que
  // já traz o diff pronto. Guarda o payload para reenviar com a flag.
  const [confirmarReprec, setConfirmarReprec] = useState<{
    preco_atual: number;
    preco_novo: number;
    empresas_afetadas: number;
    planoId: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const [aceiteAsaas, setAceiteAsaas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [modelosPorPlano, setModelosPorPlano] = useState<Record<string, { versao?: number; sem: boolean }>>({});

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function carregar() {
    try {
      const response = await api.get('/painel-admin/planos');
      setPlanos(response.data || []);
    } catch {
      setToast({ message: 'Erro ao carregar planos', tipo: 'erro' });
    }
    // Modelo de contrato vigente por plano (só leitura; fail-open: some se indisponível).
    try {
      const { data } = await api.get('/admin/contrato-modelos/overview');
      const mapa: Record<string, { versao?: number; sem: boolean }> = {};
      for (const l of (data?.planos || [])) {
        mapa[l.plano_id] = { versao: l.vigente?.versao, sem: l.sem_modelo_vigente === true };
      }
      setModelosPorPlano(mapa);
    } catch { /* indicador de modelo é best-effort */ }
  }

  function abrirNovoPlano() {
    setEditing(null);
    setForm({ ...FORM_VAZIO });
    setShowModal(true);
  }

  function abrirEdicao(plano: any) {
    setEditing(plano);
    setForm({
      nome: plano.nome || '',
      // Qualquer coisa que não seja 'por_motorista' é fixo — inclusive plano
      // antigo cujo modelo_cobranca nem existia.
      modelo_cobranca: plano.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
      preco_mensal: String(plano.preco_mensal ?? ''),
      preco_por_motorista: plano.preco_por_motorista != null ? String(plano.preco_por_motorista) : '',
      descricao: plano.descricao || '',
      limite_motoristas: String(plano.limite_motoristas ?? 5),
      dias_trial: String(plano.dias_trial ?? 7),
      ativo: plano.ativo !== false,
      categoria: plano.categoria || 'ambos',
      recursos: recursosParaTexto(plano.recursos),
      capacidade_inclusa: plano.capacidade_inclusa != null ? String(plano.capacidade_inclusa) : '',
      preco_motorista_extra: plano.preco_motorista_extra != null ? String(plano.preco_motorista_extra) : '',
      valor_implantacao: plano.valor_implantacao != null ? String(plano.valor_implantacao) : '0',
      requer_negociacao: plano.requer_negociacao === true,
    });
    setShowModal(true);
  }

  async function handleSalvar() {
    const limite = Number(form.limite_motoristas);
    const diasTrial = Number(form.dias_trial);

    if (!form.nome.trim()) { setToast({ message: 'Nome é obrigatório', tipo: 'erro' }); return; }
    if (!Number.isInteger(limite) || limite < 0) { setToast({ message: 'Limite de motoristas deve ser um inteiro igual ou maior que zero', tipo: 'erro' }); return; }
    if (!Number.isInteger(diasTrial) || diasTrial < 0) { setToast({ message: 'Dias de trial deve ser um inteiro igual ou maior que zero', tipo: 'erro' }); return; }

    // Campos comerciais (passthrough validado no backend). Vazio = não envia.
    const capacidade = form.capacidade_inclusa.trim();
    const extra = form.preco_motorista_extra.trim();
    const implantacao = form.valor_implantacao.trim();
    if (implantacao !== '' && (!Number.isFinite(Number(implantacao)) || Number(implantacao) < 0)) {
      setToast({ message: 'Valor de implantação deve ser igual ou maior que zero', tipo: 'erro' }); return;
    }
    if (extra !== '' && (!Number.isFinite(Number(extra)) || Number(extra) < 0)) {
      setToast({ message: 'Valor por motorista extra deve ser igual ou maior que zero', tipo: 'erro' }); return;
    }

    const base = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim(),
      limite_motoristas: limite,
      dias_trial: diasTrial,
      ativo: form.ativo,
      categoria: form.categoria,
      recursos: textoParaRecursos(form.recursos),
      modelo_cobranca: form.modelo_cobranca,
      requer_negociacao: form.requer_negociacao,
      valor_implantacao: implantacao === '' ? 0 : Number(implantacao),
      ...(capacidade !== '' ? { capacidade_inclusa: Number(capacidade) } : {}),
      ...(extra !== '' ? { preco_motorista_extra: Number(extra) } : {}),
    };

    let payload: Record<string, unknown>;
    if (form.modelo_cobranca === 'por_motorista') {
      const previa = calcularPrevia(form);
      if (!previa.ok) { setToast({ message: previa.erro, tipo: 'erro' }); return; }
      // preco_mensal NÃO entra no payload: quem deriva o valor final é o backend.
      // Mandar o total daqui seria dar ao frontend a autoridade sobre a cobrança.
      payload = { ...base, preco_por_motorista: Number(form.preco_por_motorista) };
    } else {
      const preco = Number(form.preco_mensal);
      if (!Number.isFinite(preco) || preco < 0) { setToast({ message: 'Preço deve ser igual ou maior que zero', tipo: 'erro' }); return; }
      payload = { ...base, preco_mensal: preco };
    }

    await enviarPlano(payload);
  }

  // Envia o plano e traduz a resposta do backend. Dois caminhos importam:
  //   409 reprecificacaoRequerConfirmacao → o backend NÃO aplicou nada e mandou o
  //     diff; abrimos a confirmação e o mesmo payload volta com a flag;
  //   422 → traz a mensagem específica (sentinela 999, teto, casas decimais).
  //     Sem repassá-la, o usuário veria só "Erro ao criar" sem saber o que corrigir.
  async function enviarPlano(payload: Record<string, unknown>) {
    setSalvando(true);
    try {
      if (editing) {
        await api.put('/painel-admin/planos/' + editing.id, payload);
        setToast({ message: 'Plano atualizado!', tipo: 'sucesso' });
      } else {
        await api.post('/painel-admin/planos', payload);
        setToast({ message: 'Plano criado!', tipo: 'sucesso' });
      }
      setShowModal(false);
      setEditing(null);
      carregar();
    } catch (err: any) {
      const dados = err?.response?.data;
      if (err?.response?.status === 409 && dados?.reprecificacaoRequerConfirmacao && editing) {
        setConfirmarReprec({
          preco_atual: Number(dados.preco_atual),
          preco_novo: Number(dados.preco_novo),
          empresas_afetadas: Number(dados.empresas_afetadas) || 0,
          planoId: editing.id,
          payload,
        });
        setAceiteAsaas(false);
        return; // mantém o formulário aberto por trás da confirmação
      }
      setToast({ message: dados?.message || (editing ? 'Erro ao atualizar' : 'Erro ao criar'), tipo: 'erro' });
    } finally {
      setSalvando(false);
    }
  }

  // Reenvia o MESMO payload com a flag. O backend revalida tudo de novo — a flag
  // só destrava a confirmação, não pula validação.
  async function aplicarReprecificacao() {
    if (!confirmarReprec || !aceiteAsaas) return;
    const { planoId, payload } = confirmarReprec;
    setSalvando(true);
    try {
      await api.put('/painel-admin/planos/' + planoId, { ...payload, confirmar_reprecificacao: true });
      setToast({ message: 'Plano atualizado!', tipo: 'sucesso' });
      setConfirmarReprec(null);
      setAceiteAsaas(false);
      setShowModal(false);
      setEditing(null);
      carregar();
    } catch (err: any) {
      setToast({ message: err?.response?.data?.message || 'Erro ao atualizar', tipo: 'erro' });
    } finally {
      setSalvando(false);
    }
  }

  // Ativar/Inativar: dimensão APP/cadastro (ativo=true/false). Separada de
  // arquivar. Nunca remove do banco (empresas/faturas podem referenciar).
  async function alternarAtivo(plano: any) {
    const reativar = plano.ativo === false;
    try {
      await api.put('/painel-admin/planos/' + plano.id, { ativo: reativar });
      setToast({ message: reativar ? 'Plano reativado!' : 'Plano inativado!', tipo: 'sucesso' });
      carregar();
    } catch {
      setToast({ message: 'Erro ao alterar status do plano', tipo: 'erro' });
    }
  }

  // Arquivar/Desarquivar: dimensão VISIBILIDADE NO PAINEL, separada de ativo.
  // Arquivar seta ativo=false no backend; desarquivar NÃO reativa (ativo segue false).
  async function alternarArquivo(plano: any, arquivarFlag: boolean) {
    try {
      await api.put('/painel-admin/planos/' + plano.id, { arquivar: arquivarFlag });
      setToast({ message: arquivarFlag ? 'Plano arquivado!' : 'Plano desarquivado!', tipo: 'sucesso' });
      carregar();
    } catch {
      setToast({ message: 'Erro ao arquivar o plano', tipo: 'erro' });
    }
  }

  // Exclusão física — só chega aqui via modal de confirmação forte, e o botão só
  // aparece quando excluivel===true. 409 do backend vira toast de erro (nunca quebra).
  async function excluir(plano: any) {
    try {
      await api.delete('/painel-admin/planos/' + plano.id);
      setToast({ message: 'Plano excluído!', tipo: 'sucesso' });
      setConfirmarExcluir(null);
      setExcluirTexto('');
      carregar();
    } catch (err: any) {
      setToast({ message: err.response?.data?.message || 'Não foi possível excluir o plano.', tipo: 'erro' });
    }
  }

  function renderCard(plano: any) {
    const recursos = normalizarRecursosParaLista(plano.recursos);
    const inativo = plano.ativo === false;
    const arquivado = Boolean(plano.arquivado_em);
    const excluivel = plano.excluivel === true;
    return (
      <div key={plano.id} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-md transition-all">
        <div className="flex justify-between items-start gap-3 mb-3">
          <h3 className="text-lg font-bold text-gray-800">{plano.nome}</h3>
          <span className="text-xl font-black text-blue-600 whitespace-nowrap">R$ {Number(plano.preco_mensal || 0).toFixed(2)}</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">{plano.descricao || 'Sem descrição'}</p>
        <div className="flex flex-wrap gap-2 mb-4 text-xs font-semibold">
          <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 capitalize">{plano.categoria || 'ambos'}</span>
          {/* Composição do preço: só aparece em plano por motorista. O valor de
              cima continua sendo o FINAL cobrado, em qualquer modelo. */}
          {plano.modelo_cobranca === 'por_motorista' && plano.preco_por_motorista != null && (
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700">
              {Number(plano.limite_motoristas ?? 0)} × {formatCurrency(Number(plano.preco_por_motorista))}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Até {Number(plano.limite_motoristas ?? 0)} motoristas</span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700">Trial: {Number(plano.dias_trial ?? 0)} dias</span>
          <span className={`px-2.5 py-1 rounded-lg ${!inativo ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{!inativo ? 'Ativo' : 'Inativo'}</span>
          {arquivado && <span className="px-2.5 py-1 rounded-lg bg-gray-200 text-gray-600">Arquivado</span>}
          {(() => {
            const m = modelosPorPlano[plano.id];
            if (!m) return null;
            return m.sem
              ? <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-semibold" title="Sem modelo de contrato publicado — contratação usa o texto técnico padrão"><AlertTriangle size={12} className="inline mr-1" />Sem modelo</span>
              : <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700" title="Modelo de contrato vigente">Contrato v{m.versao}</span>;
          })()}
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-7">
          {recursos.length > 0 ? recursos.map((recurso) => (
            <span key={recurso} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{recurso}</span>
          )) : <span className="text-xs text-gray-400">Nenhum recurso informado</span>}
        </div>
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
          <button onClick={() => abrirEdicao(plano)} title={`Editar plano ${plano.nome}`} aria-label={`Editar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl"><Eye size={14} className="inline mr-1" />Editar</button>
          {!arquivado ? (
            <>
              <button onClick={() => alternarAtivo(plano)} title={inativo ? `Reativar plano ${plano.nome}` : `Inativar plano ${plano.nome}`} aria-label={inativo ? `Reativar plano ${plano.nome}` : `Inativar plano ${plano.nome}`} className={`flex-1 min-w-24 py-2 text-xs font-bold rounded-xl ${inativo ? 'text-green-700 bg-green-50 hover:bg-green-100' : 'text-amber-700 bg-amber-50 hover:bg-amber-100'}`}>{inativo ? 'Reativar' : 'Inativar'}</button>
              <button onClick={() => alternarArquivo(plano, true)} title={`Arquivar plano ${plano.nome}`} aria-label={`Arquivar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl"><Archive size={14} className="inline mr-1" />Arquivar</button>
            </>
          ) : (
            <button onClick={() => alternarArquivo(plano, false)} title={`Desarquivar plano ${plano.nome}`} aria-label={`Desarquivar plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl"><ArchiveRestore size={14} className="inline mr-1" />Desarquivar</button>
          )}
          {excluivel && (
            <button onClick={() => { setConfirmarExcluir(plano); setExcluirTexto(''); }} title={`Excluir plano ${plano.nome}`} aria-label={`Excluir plano ${plano.nome}`} className="flex-1 min-w-24 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl"><Trash2 size={14} className="inline mr-1" />Excluir</button>
          )}
        </div>
      </div>
    );
  }

  // Prévia só existe no modelo por motorista — no fixo, o próprio campo já é o
  // valor final e não há o que compor.
  const previa = form.modelo_cobranca === 'por_motorista' ? calcularPrevia(form) : null;
  const podeSalvar = !salvando && (previa === null || previa.ok);

  // Visão principal = não arquivados. Arquivados vão para seção recolhida.
  const naoArquivados = planos.filter((p) => !p.arquivado_em);
  const arquivados = planos.filter((p) => p.arquivado_em);
  const ativos = naoArquivados.filter((p) => p.ativo !== false);
  const inativos = naoArquivados.filter((p) => p.ativo === false);

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`} role="status">
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} title="Fechar" aria-label="Fechar notificação" className="ml-1 p-0.5 rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-gray-800 p-1.5 rounded-lg text-white"><Shield size={18} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 leading-tight">Planos</h1>
            <p className="text-sm text-gray-500">Gerenciar planos de assinatura</p>
          </div>
        </div>
        <button onClick={abrirNovoPlano} title="Criar novo plano" aria-label="Criar novo plano" className="flex items-center shrink-0 px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Novo Plano</button>
      </div>

      {planos.length === 0 && <div className="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">Nenhum plano cadastrado</div>}

      {CATEGORIAS_PLANO.map(({ chave, titulo }) => {
        const doGrupo = ativos.filter((p) => (p.categoria || 'ambos') === chave);
        if (doGrupo.length === 0) return null;
        return (
          <div key={chave} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{titulo}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {doGrupo.map(renderCard)}
            </div>
          </div>
        );
      })}

      {inativos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Inativos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inativos.map(renderCard)}
          </div>
        </div>
      )}

      {arquivados.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setArquivadosAbertos((v) => !v)}
            aria-expanded={arquivadosAbertos}
            className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-400 hover:text-gray-600"
          >
            <Archive size={14} />
            Arquivados ({arquivados.length})
            <span className="text-[10px]">{arquivadosAbertos ? '▲' : '▼'}</span>
          </button>
          {arquivadosAbertos && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {arquivados.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center bg-gray-50 sticky top-0 z-10">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Plano' : 'Novo Plano'}</h3>
              <button onClick={() => setShowModal(false)} title="Fechar formulário" aria-label="Fechar formulário" className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="plano-nome" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome</label>
                <input id="plano-nome" type="text" required className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Premium" />
              </div>
              <div>
                <label htmlFor="plano-descricao" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Descrição</label>
                <input id="plano-descricao" type="text" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descrição do plano" />
              </div>
              {/* Modelo de cobrança: define QUAL campo de valor é editável abaixo.
                  Nunca existem dois campos disputando "qual é o valor cobrado". */}
              <div>
                <span className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Modelo de cobrança</span>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modelo de cobrança do plano">
                  {MODELOS_COBRANCA.map((op) => {
                    const escolhido = form.modelo_cobranca === op.chave;
                    return (
                      <button
                        key={op.chave}
                        type="button"
                        aria-pressed={escolhido}
                        onClick={() => setForm({ ...form, modelo_cobranca: op.chave })}
                        className={`text-left rounded-xl border-2 p-3 transition-colors ${escolhido ? 'border-blue-500 bg-blue-50/50' : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'}`}
                      >
                        <span className={`block text-sm font-bold ${escolhido ? 'text-blue-700' : 'text-gray-700'}`}>{op.titulo}</span>
                        <span className="block text-xs text-gray-400 mt-0.5">{op.ajuda}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {form.modelo_cobranca === 'fixo' ? (
                  <div>
                    <label htmlFor="plano-preco" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Preço mensal</label>
                    <input id="plano-preco" type="number" min="0" step="0.01" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.preco_mensal} onChange={(e) => setForm({ ...form, preco_mensal: e.target.value })} placeholder="99,90" />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="plano-unitario" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Valor por motorista</label>
                    <input id="plano-unitario" type="number" min="0" step="0.01" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.preco_por_motorista} onChange={(e) => setForm({ ...form, preco_por_motorista: e.target.value })} placeholder="100,00" />
                  </div>
                )}
                <div>
                  <label htmlFor="plano-limite" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">
                    {form.modelo_cobranca === 'por_motorista' ? 'Motoristas contratados' : 'Motoristas'}
                  </label>
                  <input id="plano-limite" type="number" min="0" step="1" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.limite_motoristas} onChange={(e) => setForm({ ...form, limite_motoristas: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="plano-trial" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Dias de trial</label>
                  <input id="plano-trial" type="number" min="0" step="1" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.dias_trial} onChange={(e) => setForm({ ...form, dias_trial: e.target.value })} />
                </div>
              </div>

              {/* Campos comerciais (fora da fórmula de preço). Congelados no contrato na emissão. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="plano-capacidade" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Capacidade inclusa</label>
                  <input id="plano-capacidade" type="number" min="0" step="1" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.capacidade_inclusa} onChange={(e) => setForm({ ...form, capacidade_inclusa: e.target.value })} placeholder="Ex: 5" />
                  <p className="text-xs text-gray-400 mt-1 ml-1">Motoristas inclusos (≠ limite self-service).</p>
                </div>
                <div>
                  <label htmlFor="plano-extra" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Motorista extra (R$)</label>
                  <input id="plano-extra" type="number" min="0" step="0.01" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.preco_motorista_extra} onChange={(e) => setForm({ ...form, preco_motorista_extra: e.target.value })} placeholder="Ex: 100,00" />
                  <p className="text-xs text-gray-400 mt-1 ml-1">Vazio = não aplicável.</p>
                </div>
                <div>
                  <label htmlFor="plano-implantacao" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Implantação / valor inicial (R$)</label>
                  <input id="plano-implantacao" type="number" min="0" step="0.01" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.valor_implantacao} onChange={(e) => setForm({ ...form, valor_implantacao: e.target.value })} placeholder="0,00" />
                  <p className="text-xs text-gray-400 mt-1 ml-1">0 = "Implantação grátis no lançamento".</p>
                </div>
              </div>

              <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-3 cursor-pointer">
                <span>
                  <span className="block text-sm font-semibold text-gray-700">Sob negociação (não self-service)</span>
                  <span className="block text-xs text-gray-400">Marque para planos Enterprise/41+; não aparecem como self-service no cadastro.</span>
                </span>
                <input type="checkbox" className="w-5 h-5" checked={form.requer_negociacao} onChange={(e) => setForm({ ...form, requer_negociacao: e.target.checked })} />
              </label>

              {/* Prévia do valor final — SOMENTE LEITURA, nunca input. É o que
                  impede o erro que originou esta frente: o valor que será cobrado
                  aparece antes de salvar. Quem calcula de verdade é o backend. */}
              {previa && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`rounded-xl border-2 p-3 ${previa.ok ? 'border-blue-100 bg-blue-50/50' : 'border-red-100 bg-red-50/50'}`}
                >
                  <span className="block text-xs font-bold uppercase text-gray-500 mb-0.5">Valor final mensal</span>
                  {previa.ok ? (
                    <>
                      <span className="block text-sm text-gray-600">
                        {previa.quantidade} motorista(s) × {formatCurrency(previa.unitarioCentavos / 100)} ={' '}
                        <strong className="text-lg text-blue-700">{formatCurrency(previa.centavos / 100)}</strong>
                        <span className="text-gray-500">/mês</span>
                      </span>
                      <span className="block text-xs text-gray-400 mt-1">
                        Conferência. O valor cobrado é calculado pelo backend ao salvar.
                      </span>
                    </>
                  ) : (
                    <span className="block text-sm text-red-600">{previa.erro}</span>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="plano-recursos" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Recursos</label>
                <textarea id="plano-recursos" rows={4} className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 resize-y" value={form.recursos} onChange={(e) => setForm({ ...form, recursos: e.target.value })} placeholder={'Um recurso por linha\nou separados por vírgula'} />
                <p className="text-xs text-gray-400 mt-1.5 ml-1">Use vírgulas ou uma linha para cada recurso. Não é necessário escrever JSON.</p>
              </div>
              <div>
                <label htmlFor="plano-categoria" className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Categoria (público-alvo)</label>
                <select id="plano-categoria" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                  <option value="empresa">Empresa</option>
                  <option value="autonomo">Autônomo</option>
                  <option value="ambos">Ambos</option>
                </select>
                <p className="text-xs text-gray-400 mt-1.5 ml-1">No app do autônomo só aparecem planos "Autônomo" ou "Ambos".</p>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-3 cursor-pointer">
                <span>
                  <span className="block text-sm font-semibold text-gray-700">Plano ativo</span>
                  <span className="block text-xs text-gray-400">Planos inativos ficam identificados no painel.</span>
                </span>
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-5 w-5 accent-green-700" aria-label="Definir plano como ativo" />
              </label>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 sticky bottom-0">
              <button onClick={() => setShowModal(false)} title="Cancelar edição" aria-label="Cancelar edição" className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSalvar} disabled={!podeSalvar} title="Salvar plano" aria-label="Salvar plano" className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed"><Check size={16} className="mr-1.5" /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Reprecificação de plano em uso. Só abre a partir do 409 do backend — a
          trava real está lá, não aqui: este modal é o aviso, não o guarda. Fica
          acima do formulário (z-70), que continua aberto por trás. */}
      {confirmarReprec && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center gap-2">
              <AlertTriangle className="text-amber-600" size={22} />
              <h3 className="text-lg font-bold text-gray-800">Alterar preço de plano em uso</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-center gap-4 rounded-xl bg-gray-50 p-3">
                <div className="text-center">
                  <span className="block text-[10px] font-bold uppercase text-gray-400">Preço atual</span>
                  <span className="block text-base font-bold text-gray-500 line-through">{formatCurrency(confirmarReprec.preco_atual)}</span>
                </div>
                <span className="text-gray-300 text-xl">→</span>
                <div className="text-center">
                  <span className="block text-[10px] font-bold uppercase text-gray-400">Novo preço</span>
                  <span className="block text-lg font-black text-blue-700">{formatCurrency(confirmarReprec.preco_novo)}</span>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Este plano está em uso por <strong>{confirmarReprec.empresas_afetadas} empresa(s)</strong>.
              </p>
              <p className="text-sm text-gray-600">
                As faturas <strong>já emitidas</strong> (pagas ou abertas) <strong>não mudam</strong> — o valor foi
                congelado em cada fatura. O novo preço vale a partir da <strong>próxima</strong> fatura.
              </p>
              <label className="flex items-start gap-3 rounded-xl border-2 border-amber-100 bg-amber-50/50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceiteAsaas}
                  onChange={(e) => setAceiteAsaas(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
                />
                <span className="text-sm text-gray-700">
                  Entendo que alterar o preço deste plano <strong>NÃO atualiza automaticamente assinaturas Asaas já
                  criadas</strong>; elas continuarão cobrando o valor antigo até uma frente futura de sincronização.
                </span>
              </label>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button
                onClick={() => { setConfirmarReprec(null); setAceiteAsaas(false); }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={aplicarReprecificacao}
                disabled={!aceiteAsaas || salvando}
                className="flex items-center px-5 py-2 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check size={16} className="mr-1.5" /> Confirmar alteração
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarExcluir && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center gap-2">
              <AlertTriangle className="text-red-600" size={22} />
              <h3 className="text-lg font-bold text-gray-800">Excluir plano</h3>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600">
                Esta ação é <strong>irreversível</strong>. O plano <strong>{confirmarExcluir.nome}</strong> será
                removido permanentemente. Só é possível porque ele nunca foi usado.
              </p>
              <p className="text-sm text-gray-500">Para confirmar, digite o nome do plano:</p>
              <input
                autoFocus
                type="text"
                value={excluirTexto}
                onChange={(e) => setExcluirTexto(e.target.value)}
                placeholder={confirmarExcluir.nome}
                className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-red-500 bg-gray-50/50"
                aria-label="Digite o nome do plano para confirmar a exclusão"
              />
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => { setConfirmarExcluir(null); setExcluirTexto(''); }} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button
                onClick={() => excluir(confirmarExcluir)}
                disabled={excluirTexto.trim() !== confirmarExcluir.nome}
                className="flex items-center px-5 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} className="mr-1.5" /> Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
