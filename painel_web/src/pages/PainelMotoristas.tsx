import React, { useState, useEffect } from 'react';
import { Shield, Search, CheckCircle, XCircle, FileWarning, KeyRound } from 'lucide-react';
import api from '../api';

export const PainelMotoristas: React.FC = () => {
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('todas');
  const [vinculoFiltro, setVinculoFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [freteFiltro, setFreteFiltro] = useState('todos');

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    const [response, emFreteResponse] = await Promise.all([
      api.get('/painel-admin/motoristas'),
      api.get('/admin/motoristas/em-viagem'),
    ]);
    const idsEmFrete = new Set((emFreteResponse.data || []).map((m: any) => m.id));
    setMotoristas((response.data || []).map((m: any) => {
      const empresa = Array.isArray(m.empresas) ? m.empresas[0] : m.empresas;
      return {
        ...m,
        status: m.status_cadastro || m.status,
        empresaNome: empresa?.nome || '-',
        empresaTipo: empresa?.tipo || null,
        temFreteAtivo: idsEmFrete.has(m.id),
      };
    }));
  }

  async function aprovar(id: string) {
    try { await api.patch('/painel-admin/motoristas/' + id + '/aprovar'); carregar(); } catch {}
  }

  async function reprovar(id: string) {
    try { await api.patch('/painel-admin/motoristas/' + id + '/reprovar'); carregar(); } catch {}
  }

  async function resetSenha(id: string, nome: string) {
    const nova = prompt(`Nova senha para ${nome} (mín. 6 caracteres):`);
    if (!nova || nova.length < 6) return;
    try {
      await api.post(`/admin/usuarios/${id}/reset-senha`, { nova_senha: nova });
      alert('Senha resetada com sucesso!');
    } catch {
      alert('Erro ao resetar senha.');
    }
  }

  const empresas = Array.from(new Set(motoristas.map(m => m.empresaNome).filter(nome => nome && nome !== '-'))).sort();
  const filtered = motoristas.filter(m => {
    const porBusca = (m.usuarios?.nome || m.nome || '').toLowerCase().includes(searchTerm.toLowerCase())
      || (m.usuarios?.email || m.email || '').toLowerCase().includes(searchTerm.toLowerCase());
    const porEmpresa = empresaFiltro === 'todas' || m.empresaNome === empresaFiltro;
    const porVinculo = vinculoFiltro === 'todos'
      || (vinculoFiltro === 'autonomos' ? m.empresaTipo === 'autonomo' : m.empresaTipo !== 'autonomo');
    const porStatus = statusFiltro === 'todos' || m.status === statusFiltro;
    const porFrete = freteFiltro === 'todos'
      || (freteFiltro === 'com' ? m.temFreteAtivo : !m.temFreteAtivo);
    return porBusca && porEmpresa && porVinculo && porStatus && porFrete;
  });
  const pendentes = filtered.filter(m => m.status === 'pendente');
  const aprovados = filtered.filter(m => m.status === 'aprovado');

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Motoristas / Autônomos</h1>
          <p className="text-sm text-gray-500">Visão global por empresa, vínculo, status e frete ativo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md"><p className="text-2xl font-black text-gray-800">{motoristas.length}</p><p className="text-sm text-gray-500">Total</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md"><p className="text-2xl font-black text-green-600">{aprovados.length}</p><p className="text-sm text-gray-500">Aprovados</p></div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 hover:shadow-md"><p className="text-2xl font-black text-amber-500">{pendentes.length}</p><p className="text-sm text-gray-500">Pendentes</p></div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="flex items-center border border-gray-200 rounded-lg px-3">
          <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
          <input type="text" placeholder="Nome ou e-mail" className="w-full py-2 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="todas">Todas as empresas</option>
          {empresas.map(nome => <option key={nome} value={nome}>{nome}</option>)}
        </select>
        <select value={vinculoFiltro} onChange={e => setVinculoFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="todos">Todos os vínculos</option>
          <option value="autonomos">Autônomos</option>
          <option value="vinculados">Vinculados</option>
        </select>
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="todos">Todos os status</option>
          <option value="aprovado">Aprovados</option>
          <option value="pendente">Pendentes</option>
          <option value="reprovado">Reprovados</option>
          <option value="bloqueado">Bloqueados</option>
        </select>
        <select value={freteFiltro} onChange={e => setFreteFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="todos">Com ou sem frete</option>
          <option value="com">Com frete ativo</option>
          <option value="sem">Sem frete ativo</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead><tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider"><th className="px-4 py-2.5 border-b">Motorista</th><th className="px-4 py-2.5 border-b">E-mail</th><th className="px-4 py-2.5 border-b">Empresa/conta</th><th className="px-4 py-2.5 border-b">Status</th><th className="px-4 py-2.5 border-b text-center">Ações</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5"><p className="font-bold text-gray-800">{m.usuarios?.nome || m.nome}</p><p className="text-xs text-gray-400">{m.cpf}</p></td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{m.usuarios?.email || m.email}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">
                  <p>{m.empresaNome}</p>
                  <span className="text-[10px] font-bold uppercase text-gray-400">{m.empresaTipo === 'autonomo' ? 'Motorista autônomo' : 'Motorista vinculado'} · {m.temFreteAtivo ? 'Com frete ativo' : 'Sem frete ativo'}</span>
                </td>
                <td className="px-4 py-2.5">
                  {m.status === 'aprovado' ? <span className="flex items-center text-green-600 text-sm font-bold"><CheckCircle size={14} className="mr-1" />Aprovado</span> :
                   m.status === 'pendente' ? <span className="flex items-center text-amber-600 text-sm font-bold"><FileWarning size={14} className="mr-1" />Pendente</span> :
                   m.status === 'bloqueado' ? <span className="flex items-center text-gray-600 text-sm font-bold"><XCircle size={14} className="mr-1" />Bloqueado</span> :
                   <span className="flex items-center text-red-600 text-sm font-bold"><XCircle size={14} className="mr-1" />Reprovado</span>}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    {m.status === 'pendente' && <>
                      <button onClick={() => aprovar(m.id)} className="px-3 py-1.5 text-xs font-bold bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center"><CheckCircle size={14} className="mr-1" />Aprovar</button>
                      <button onClick={() => reprovar(m.id)} className="px-3 py-1.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center"><XCircle size={14} className="mr-1" />Reprovar</button>
                    </>}
                    <button onClick={() => resetSenha(m.id, m.usuarios?.nome || m.nome)} title="Resetar senha" aria-label="Resetar senha do motorista" className="px-3 py-1.5 text-xs font-bold bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center"><KeyRound size={14} className="mr-1" />Resetar senha</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum motorista encontrado para os filtros selecionados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
