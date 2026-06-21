import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Users, MessageCircle, Trash2, AlertTriangle, Camera, MapPin, Loader2 } from 'lucide-react';
import api from '../api';
import { maskPhone, maskCPF, maskCEP } from '../utils/masks';
import axios from 'axios';

export const Motoristas: React.FC = () => {
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal Novo Motorista
  const [showNewModal, setShowNewModal] = useState(false);
  const [newMot, setNewMot] = useState({ 
    nomeCompleto: '', cpf: '', email: '', senha: '', placaVeiculo: '', 
    telefone: '', cep: '', endereco: '', bairro: '', cidade: '', fotoUrl: '',
    percentualComissao: 12 
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingCep, setIsFetchingCep] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal Editar Motorista
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMot, setEditingMot] = useState<any | null>(null);
  // Exclusão
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadMotoristas = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/motoristas');
      setMotoristas((response.data || []).map((m: any) => ({
        uid: m.id,
        nomeCompleto: m.usuarios.nome,
        email: m.usuarios.email,
        cpf: m.cpf || '',
        telefone: m.usuarios.telefone || m.telefone || '',
        cep: m.usuarios.cep || '',
        endereco: m.usuarios.endereco || '',
        bairro: m.usuarios.bairro || '',
        cidade: m.usuarios.cidade || '',
        fotoUrl: m.usuarios.foto_url || '',
        placaVeiculo: m.placa_veiculo,
        percentualComissao: m.percentual_comissao,
        statusCadastro: m.status_cadastro,
        podeFinalizarViagem: m.pode_finalizar_viagem ?? false,
        empresaTipo: m.empresa_tipo
      })));
    } catch (error: any) {
      console.error('Erro detalhado ao carregar motoristas:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMotoristas();
  }, []);

  const handleAddMotorista = async () => {
    try {
      setIsSubmitting(true);
      await api.post('/admin/motoristas', {
        nome: newMot.nomeCompleto,
        cpf: newMot.cpf,
        email: newMot.email,
        senha: newMot.senha,
        placa_veiculo: newMot.placaVeiculo,
        telefone: newMot.telefone,
        cep: newMot.cep,
        endereco: newMot.endereco,
        bairro: newMot.bairro,
        cidade: newMot.cidade,
        foto_url: newMot.fotoUrl,
        percentual_comissao: newMot.percentualComissao
      });
      await loadMotoristas();
      setShowNewModal(false);
      setNewMot({ nomeCompleto: '', cpf: '', email: '', senha: '', placaVeiculo: '', telefone: '', cep: '', endereco: '', bairro: '', cidade: '', fotoUrl: '', percentualComissao: 12 });
      alert('Motorista cadastrado e já ativo. Ele troca a senha no primeiro acesso.');
    } catch (error: any) {
      console.error('Erro detalhado ao cadastrar motorista:', error);
      console.error('Payload do motorista enviado:', newMot);
      alert('Erro ao cadastrar motorista: ' + (error.response?.data?.message || error.message || 'Erro desconhecido'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateMotorista = async () => {
    if (!editingMot) return;
    try {
      setIsSubmitting(true);
      await api.put('/admin/usuarios/' + editingMot.uid, {
        nome: editingMot.nomeCompleto,
        telefone: editingMot.telefone,
        cep: editingMot.cep,
        endereco: editingMot.endereco,
        bairro: editingMot.bairro,
        cidade: editingMot.cidade,
        foto_url: editingMot.fotoUrl
      });

      await api.put('/admin/motoristas/' + editingMot.uid + '/comissao', {
        percentual_comissao: editingMot.percentualComissao,
        placa_veiculo: editingMot.placaVeiculo,
        cpf: editingMot.cpf,
        pode_finalizar_viagem: editingMot.podeFinalizarViagem ?? false
      });

      const motoristaOriginal = motoristas.find(m => m.uid === editingMot.uid);
      if (motoristaOriginal && motoristaOriginal.statusCadastro !== editingMot.statusCadastro) {
        if (editingMot.statusCadastro === 'aprovado') {
          await api.patch('/admin/motoristas/' + editingMot.uid + '/approve', {
            percentual_comissao: editingMot.percentualComissao
          });
        } else if (editingMot.statusCadastro === 'bloqueado' || editingMot.statusCadastro === 'pendente') {
           const status = editingMot.statusCadastro === 'bloqueado' ? 'bloqueado' : 'ativo';
           await api.patch('/admin/motoristas/' + editingMot.uid + '/block', { status });
        }
      }

      await loadMotoristas();
      setShowEditModal(false);
      setEditingMot(null);
    } catch (error: any) {
      console.error('Erro detalhado ao atualizar motorista:', error);
      console.error('Payload de edição do motorista:', editingMot);
      alert('Erro ao atualizar motorista: ' + (error.response?.data?.message || error.message || 'Erro desconhecido'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (mot: any) => {
    setEditingMot({ ...mot });
    setShowEditModal(true);
  };

  const handleDeleteMotorista = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await api.delete('/admin/motoristas/' + deleteTarget.uid);
      setDeleteTarget(null);
      await loadMotoristas();
    } catch (error: any) {
      console.error('Erro detalhado ao excluir motorista:', error);
      console.error('Alvo de exclusão do motorista:', deleteTarget);
      alert(error.response?.data?.message || error.message || 'Erro ao excluir motorista.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        if (editingMot) {
          setEditingMot({ ...editingMot, fotoUrl: base64String });
        } else {
          setNewMot({ ...newMot, fotoUrl: base64String });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const buscarCep = async (cepStr: string) => {
    const cleanCep = cepStr.replace(/\D/g, '');
    if (cleanCep.length !== 8) return;
    
    try {
      setIsFetchingCep(true);
      const response = await axios.get(`https://viacep.com.br/ws/${cleanCep}/json/`);
      if (response.data && !response.data.erro) {
        if (editingMot) {
          setEditingMot({
            ...editingMot,
            endereco: response.data.logradouro,
            bairro: response.data.bairro,
            cidade: `${response.data.localidade} - ${response.data.uf}`
          });
        } else {
          setNewMot({
            ...newMot,
            endereco: response.data.logradouro,
            bairro: response.data.bairro,
            cidade: `${response.data.localidade} - ${response.data.uf}`
          });
        }
      }
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
    } finally {
      setIsFetchingCep(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-blue-600 p-2 rounded-lg text-white">
          <Users size={24} />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">Cadastro de Motoristas</h1>
      </div>
      
      {/* SEÇÃO: MOTORISTAS CADASTRADOS */}
      <section className="space-y-6 pt-4">
        <div className="flex justify-between items-center px-2">
          <h2 className="text-xl font-bold text-gray-700 flex items-center">
            <Users size={20} className="mr-2 text-blue-600" /> Motoristas Cadastrados
          </h2>
          <button 
            onClick={() => setShowNewModal(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95"
          >
            <Plus size={20} className="mr-2" /> Adicionar Motorista
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <p className="p-8 text-center text-gray-500">Carregando motoristas...</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 text-gray-500 text-xs uppercase tracking-wider font-semibold">
                    <th className="p-5 border-b">Nome</th>
                    <th className="p-5 border-b">Placa</th>
                    <th className="p-5 border-b">Telefone</th>
                    <th className="p-5 border-b">Status Cadastro</th>
                    <th className="p-5 border-b text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {motoristas.map(mot => {
                    const formatWhatsappLink = (phone: string) => {
                      const cleanPhone = (phone || '').replace(/\D/g, '');
                      return `https://wa.me/55${cleanPhone}`;
                    };
                    return (
                      <tr key={mot.uid} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-5">
                          <div className="flex items-center">
                            <div className="bg-gray-100 text-gray-600 w-8 h-8 rounded-full flex items-center justify-center mr-3 font-bold text-xs overflow-hidden border border-gray-200">
                              {mot.fotoUrl ? <img src={mot.fotoUrl} alt="" className="w-full h-full object-cover" /> : (mot.nomeCompleto || '?')?.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-semibold text-gray-700">{mot.nomeCompleto}</span>
                          </div>
                        </td>
                        <td className="p-5 text-gray-600">{mot.placaVeiculo}</td>
                        <td className="p-5 text-gray-500 font-mono text-sm">{mot.telefone || 'Não informado'}</td>
                        <td className="p-5">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${
                            mot.statusCadastro === 'aprovado' ? 'bg-green-100 text-green-700' :
                            mot.statusCadastro === 'pendente' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {(mot.statusCadastro || '').toUpperCase()}
                          </span>
                        </td>
                        <td className="p-5 text-center flex items-center justify-center space-x-2">
                          <a 
                            href={formatWhatsappLink(mot.telefone)} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all shadow-sm border border-green-100 flex items-center justify-center"
                            title="Conversar no WhatsApp"
                          >
                            <MessageCircle size={20} />
                          </a>
                          <button 
                            onClick={() => openEditModal(mot)}
                            className="px-4 py-2 bg-white text-gray-600 border border-gray-200 rounded-lg font-bold text-sm hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-all"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(mot)}
                            className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-600 hover:text-white transition-all border border-red-100"
                            title="Excluir motorista"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {motoristas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-gray-500">Nenhum motorista encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* Modais de Add/Edit */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-lg text-gray-800">Cadastrar Novo Motorista</h3>
              <button onClick={() => setShowNewModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
              
              <div className="flex flex-col items-center space-y-2 pb-2">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-2xl bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 group hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-all overflow-hidden relative"
                >
                  {newMot.fotoUrl ? (
                    <>
                      <img src={newMot.fotoUrl} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={24} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Camera size={32} />
                      <span className="text-[10px] font-bold uppercase mt-1">Foto</span>
                    </>
                  )}
                </div>
                {newMot.fotoUrl && (
                  <button onClick={() => setNewMot({...newMot, fotoUrl: ''})} className="text-[10px] font-bold text-red-500 uppercase hover:underline">
                    Remover Foto
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome Completo</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.nomeCompleto} onChange={e => setNewMot({...newMot, nomeCompleto: e.target.value})} placeholder="Ex: João da Silva" />
                </div>
                <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">CPF</label>
                   <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.cpf} onChange={e => setNewMot({...newMot, cpf: maskCPF(e.target.value)})} placeholder="000.000.000-00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Email de Login</label>
                  <input type="email" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.email} onChange={e => setNewMot({...newMot, email: e.target.value})} placeholder="email@exemplo.com" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Senha Inicial</label>
                  <input type="password" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.senha} onChange={e => setNewMot({...newMot, senha: e.target.value})} placeholder="123456" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Placa Veículo</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.placaVeiculo} onChange={e => setNewMot({...newMot, placaVeiculo: e.target.value})} placeholder="AAA-0000" />
                </div>
                <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Telefone (Celular)</label>
                   <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={newMot.telefone} onChange={e => setNewMot({...newMot, telefone: maskPhone(e.target.value)})} placeholder="(00) 0 0000-0000" />
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-4 mt-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center">
                  <MapPin size={14} className="mr-1.5 text-gray-400" /> Localização
                </h4>
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1 flex justify-between">
                    CEP
                    {isFetchingCep && <Loader2 size={12} className="animate-spin text-blue-500" />}
                  </label>
                  <input 
                    className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                    placeholder="00000-000"
                    maxLength={9}
                    value={newMot.cep}
                    onChange={e => setNewMot({...newMot, cep: maskCEP(e.target.value)})}
                    onBlur={e => buscarCep(e.target.value)}
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Endereço / Logradouro</label>
                  <input 
                    className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                    placeholder="Rua, número..."
                    value={newMot.endereco}
                    onChange={e => setNewMot({...newMot, endereco: e.target.value})}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Bairro</label>
                    <input 
                      className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                      placeholder="Bairro"
                      value={newMot.bairro}
                      onChange={e => setNewMot({...newMot, bairro: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Cidade / UF</label>
                    <input 
                      className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                      placeholder="Cidade - UF"
                      value={newMot.cidade}
                      onChange={e => setNewMot({...newMot, cidade: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 bg-gray-50/80 border-t flex justify-end space-x-3">
              <button onClick={() => setShowNewModal(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl font-bold text-sm">Cancelar</button>
              <button onClick={handleAddMotorista} disabled={isSubmitting} className="px-6 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-xl font-bold text-sm shadow-md disabled:opacity-50">
                {isSubmitting ? 'Cadastrando...' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingMot && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50/50">
              <h3 className="font-bold text-lg text-gray-800">Editar Cadastro: {editingMot.nomeCompleto}</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">

              <div className="flex flex-col items-center space-y-2 pb-2">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-2xl bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 group hover:border-blue-400 hover:text-blue-500 cursor-pointer transition-all overflow-hidden relative"
                >
                  {editingMot.fotoUrl ? (
                    <>
                      <img src={editingMot.fotoUrl} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={24} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Camera size={32} />
                      <span className="text-[10px] font-bold uppercase mt-1">Foto</span>
                    </>
                  )}
                </div>
                {editingMot.fotoUrl && (
                  <button onClick={() => setEditingMot({...editingMot, fotoUrl: ''})} className="text-[10px] font-bold text-red-500 uppercase hover:underline">
                    Remover Foto
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome Completo</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" value={editingMot.nomeCompleto} onChange={e => setEditingMot({...editingMot, nomeCompleto: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">CPF</label>
                  <input type="text" disabled className="w-full border-gray-200 rounded-xl p-2.5 outline-none border bg-gray-100" value={editingMot.cpf} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {editingMot?.empresaTipo === 'autonomo' ? (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Comissão (%)</label>
                    <input type="number" readOnly className="w-full border-gray-200 rounded-xl p-2.5 outline-none border bg-gray-100 text-gray-500" value={0} />
                    <p className="text-[10px] text-gray-400 mt-1 ml-1">
                      Motorista autônomo não usa comissão percentual. O resultado é calculado por faturamento menos gastos.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Comissão (%)</label>
                    <input type="number" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500" value={editingMot.percentualComissao} onChange={e => setEditingMot({...editingMot, percentualComissao: Number(e.target.value)})} />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Status Cadastro</label>
                  <select className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" value={editingMot.statusCadastro} onChange={e => setEditingMot({...editingMot, statusCadastro: e.target.value as any})}>
                    <option value="aprovado">Aprovado</option>
                    <option value="pendente">Pendente</option>
                    <option value="bloqueado">Bloqueado</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Placa Veículo</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" value={editingMot.placaVeiculo} onChange={e => setEditingMot({...editingMot, placaVeiculo: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Telefone (Celular)</label>
                  <input type="text" className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" value={editingMot.telefone} onChange={e => setEditingMot({...editingMot, telefone: maskPhone(e.target.value)})} />
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-4 mt-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center">
                  <MapPin size={14} className="mr-1.5 text-gray-400" /> Localização
                </h4>
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1 flex justify-between">
                    CEP
                    {isFetchingCep && <Loader2 size={12} className="animate-spin text-blue-500" />}
                  </label>
                  <input 
                    className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                    placeholder="00000-000"
                    maxLength={9}
                    value={editingMot.cep}
                    onChange={e => setEditingMot({...editingMot, cep: maskCEP(e.target.value)})}
                    onBlur={e => buscarCep(e.target.value)}
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Endereço / Logradouro</label>
                  <input 
                    className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                    placeholder="Rua, número..."
                    value={editingMot.endereco}
                    onChange={e => setEditingMot({...editingMot, endereco: e.target.value})}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Bairro</label>
                    <input 
                      className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                      placeholder="Bairro"
                      value={editingMot.bairro}
                      onChange={e => setEditingMot({...editingMot, bairro: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Cidade / UF</label>
                    <input 
                      className="w-full border-gray-200 rounded-xl p-2.5 outline-none border focus:border-blue-500 bg-white" 
                      placeholder="Cidade - UF"
                      value={editingMot.cidade}
                      onChange={e => setEditingMot({...editingMot, cidade: e.target.value})}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mt-2">
                <div>
                  <p className="text-sm font-semibold text-blue-800">Motorista pode finalizar frete pelo app</p>
                  <p className="text-xs text-blue-600 mt-0.5">Permite que o motorista conclua fretes diretamente no app</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingMot({...editingMot, podeFinalizarViagem: !editingMot.podeFinalizarViagem})}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingMot.podeFinalizarViagem ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${editingMot.podeFinalizarViagem ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">* Administradores agora podem editar todas as informações, exceto o CPF.</p>
            </div>
            <div className="p-5 bg-gray-50/80 border-t flex justify-end space-x-3">
              <button onClick={() => setShowEditModal(false)} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl font-bold text-sm">Cancelar</button>
              <button onClick={handleUpdateMotorista} disabled={isSubmitting} className="px-6 py-2.5 bg-green-600 text-white hover:bg-green-700 rounded-xl font-bold text-sm shadow-md disabled:opacity-50">
                {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão de Motorista */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle size={32} className="text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">Excluir Motorista</h3>
              <p className="text-gray-500">
                Tem certeza que deseja excluir <strong className="text-gray-800">{deleteTarget.nomeCompleto}</strong>?
              </p>
              <div className="text-xs text-red-500 bg-red-50 p-3 rounded-xl w-full text-left space-y-1">
                <p>⚠️ <strong>Esta ação é irreversível.</strong></p>
                <p>• O motorista e sua conta de login serão removidos</p>
                <p>• Se houver viagens ativas, a exclusão será bloqueada automaticamente</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteMotorista}
                disabled={isDeleting}
                className="px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700 transition-all active:scale-95 flex items-center disabled:opacity-50"
              >
                <Trash2 size={18} className="mr-2" />
                {isDeleting ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
