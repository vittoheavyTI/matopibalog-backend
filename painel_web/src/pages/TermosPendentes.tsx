import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLoginConfig } from '../hooks/useLoginConfig';
import api from '../api';
import { Truck, Check, X, FileText, AlertTriangle } from 'lucide-react';

interface TermoPendente {
  id: string;
  tipo: string;
  versao: number;
  titulo: string;
  conteudo?: string;
  resumo?: string | null;
}

export const TermosPendentes: React.FC = () => {
  const { user, login, logout } = useAuth();
  const config = useLoginConfig();
  const navigate = useNavigate();

  const [pendentes, setPendentes] = useState<TermoPendente[]>([]);
  const [indice, setIndice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aceitando, setAceitando] = useState(false);
  const [erroApi, setErroApi] = useState('');
  const [aceito, setAceito] = useState(false);          // checkbox "Li e concordo"
  const [modalAberto, setModalAberto] = useState(false); // leitura em tela cheia

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    carregarPendentes();
  }, []);

  // Cada termo exige consentimento próprio: zera o checkbox e fecha o modal ao trocar.
  useEffect(() => {
    setAceito(false);
    setModalAberto(false);
  }, [indice]);

  async function carregarPendentes() {
    setLoading(true);
    setErroApi('');
    try {
      const { data } = await api.get('/termos/pendentes');
      const lista = Array.isArray(data?.pendentes) ? data.pendentes : [];
      if (lista.length === 0) {
        navigate('/', { replace: true });
        return;
      }
      setPendentes(lista);
      setIndice(0);
    } catch {
      setErroApi('Erro ao carregar termos pendentes.');
    } finally {
      setLoading(false);
    }
  }

  async function aceitarTermo() {
    if (aceitando || pendentes.length === 0) return;
    const termo = pendentes[indice];
    if (!termo) return;

    setAceitando(true);
    setErroApi('');
    try {
      await api.post(`/termos/${termo.id}/aceitar`, { origem: 'web' });

      if (indice + 1 < pendentes.length) {
        setIndice((i) => i + 1); // o efeito de [indice] zera o checkbox/modal
      } else {
        if (user) {
          login({ ...user, termos_pendentes: false, termos_pendentes_count: 0 });
        }
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        setErroApi('Este termo não se aplica ao seu perfil. Entre em contato com o suporte.');
      } else if (status === 422) {
        setErroApi('Termo não está disponível para aceite no momento.');
      } else {
        setErroApi(err?.response?.data?.message || 'Erro ao aceitar termo. Tente novamente.');
      }
    } finally {
      setAceitando(false);
    }
  }

  async function recusar() {
    await logout();
    navigate('/login', { replace: true });
  }

  const termoAtual = pendentes[indice];
  const total = pendentes.length;

  // Conteúdo: prioriza SEMPRE termo.conteudo. Sem conteúdo completo, o aceite fica
  // bloqueado para evitar consentimento sem leitura integral do termo.
  const conteudoCompleto = (termoAtual?.conteudo || '').trim();
  const temConteudo = conteudoCompleto.length > 0;
  const podeAceitar = temConteudo && aceito && !aceitando;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: config.loginBg ? `url(${config.loginBg}) center/cover no-repeat` : '#1a1a2e',
      padding: '16px',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '1rem',
        padding: '2rem',
        maxWidth: '640px',
        width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          {config.loginLogo ? (
            <img src={config.loginLogo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '64px', objectFit: 'contain' }} />
          ) : (
            <div style={{ background: '#3b82f6', padding: '12px', borderRadius: '50%' }}>
              <Truck size={32} color="#ffffff" />
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '14px', color: '#6b7280' }}>Carregando termos...</p>
          </div>
        ) : erroApi && !termoAtual ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ color: '#dc2626', fontSize: '14px', marginBottom: '16px' }}>{erroApi}</p>
            <button onClick={carregarPendentes} style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
              Tentar novamente
            </button>
          </div>
        ) : termoAtual ? (
          <>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ background: '#dbeafe', color: '#2563eb', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                  {termoAtual.tipo.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>v{termoAtual.versao}</span>
              </div>
              <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', margin: '8px 0 4px' }}>
                {termoAtual.titulo}
              </h1>
              <p style={{ fontSize: '13px', color: '#9ca3af' }}>
                Termo {indice + 1} de {total}
              </p>
            </div>

            {/* Área de leitura — grande e rolável; mostra o conteúdo integral */}
            {temConteudo ? (
              <>
                <div style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '18px',
                  marginBottom: '12px',
                  height: '42vh',
                  minHeight: '220px',
                  overflowY: 'auto',
                  fontSize: '14px',
                  lineHeight: '1.7',
                  color: '#374151',
                  whiteSpace: 'pre-wrap',
                }}>
                  {conteudoCompleto}
                </div>

                <button
                  onClick={() => setModalAberto(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', color: '#2563eb', border: 'none', padding: '4px 0', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '16px' }}
                >
                  <FileText size={16} /> Ver termo completo
                </button>

                {/* Consentimento explícito antes de habilitar o aceite */}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '18px', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={aceito}
                    onChange={(e) => setAceito(e.target.checked)}
                    style={{ width: '18px', height: '18px', marginTop: '1px', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '14px', color: '#374151' }}>
                    Li e concordo com este termo
                  </span>
                </label>
              </>
            ) : (
              <div style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '12px',
                padding: '18px',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}>
                <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '14px', color: '#92400e', lineHeight: '1.6' }}>
                  Este termo ainda não possui conteúdo completo cadastrado. Entre em contato com o suporte.
                </span>
              </div>
            )}

            {erroApi && (
              <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
                {erroApi}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={aceitarTermo}
                disabled={!podeAceitar}
                style={{ width: '100%', height: '48px', background: !podeAceitar ? '#9ca3af' : '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '700', fontSize: '15px', cursor: !podeAceitar ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {aceitando ? (
                  <>
                    <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Aceitando...
                  </>
                ) : (
                  <><Check size={18} /> Aceitar termo</>
                )}
              </button>

              <button
                onClick={recusar}
                disabled={aceitando}
                style={{ width: '100%', height: '44px', background: 'transparent', color: '#dc2626', border: '2px solid #fecaca', borderRadius: '10px', fontWeight: '600', fontSize: '14px', cursor: aceitando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <X size={18} /> Recusar e sair
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Modal de leitura completa — área ampla e rolável */}
      {modalAberto && termoAtual && temConteudo && (
        <div
          onClick={() => setModalAberto(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '860px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #f3f4f6', gap: '12px' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', margin: 0 }}>
                  {termoAtual.tipo.replace(/_/g, ' ')} · v{termoAtual.versao}
                </p>
                <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', margin: '2px 0 0' }}>
                  {termoAtual.titulo}
                </h2>
              </div>
              <button onClick={() => setModalAberto(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '999px', color: '#6b7280', flexShrink: 0 }}>
                <X size={22} />
              </button>
            </div>
            <div style={{ padding: '22px', overflowY: 'auto', fontSize: '15px', lineHeight: '1.8', color: '#374151', whiteSpace: 'pre-wrap' }}>
              {conteudoCompleto}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalAberto(false)} style={{ padding: '10px 22px', background: '#111827', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', fontSize: '14px', cursor: 'pointer' }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
