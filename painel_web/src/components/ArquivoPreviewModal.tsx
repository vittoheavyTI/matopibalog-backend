import React from 'react';
import { Download, ExternalLink, Share2, X } from 'lucide-react';

export type ArquivoPreview = {
  url: string;
  nome: string;
  mime?: string | null;
};

type Props = {
  arquivo: ArquivoPreview | null;
  onClose: () => void;
};

const ehImagem = (mime?: string | null) => !!mime && mime.startsWith('image/');
const ehPdf = (mime?: string | null) => mime === 'application/pdf';

export const ArquivoPreviewModal: React.FC<Props> = ({ arquivo, onClose }) => {
  if (!arquivo) return null;
  const podeCompartilhar = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const compartilhar = async () => {
    try {
      await navigator.share({ title: arquivo.nome, url: arquivo.url });
    } catch {
      // Cancelamento pelo usuario ou plataforma sem suporte completo.
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Visualizar arquivo">
      <div className="bg-white w-full max-w-5xl max-h-[92vh] rounded-lg shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <p className="font-semibold text-gray-800 truncate">{arquivo.nome}</p>
          <div className="flex items-center gap-1">
            {podeCompartilhar && (
              <button onClick={compartilhar} className="p-2 rounded hover:bg-gray-100 text-gray-600" title="Compartilhar" aria-label="Compartilhar">
                <Share2 size={18} />
              </button>
            )}
            <a href={arquivo.url} download className="p-2 rounded hover:bg-gray-100 text-gray-600" title="Salvar" aria-label="Salvar">
              <Download size={18} />
            </a>
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer" className="p-2 rounded hover:bg-gray-100 text-gray-600" title="Abrir fora" aria-label="Abrir fora">
              <ExternalLink size={18} />
            </a>
            <button onClick={onClose} className="p-2 rounded hover:bg-gray-100 text-gray-600" title="Fechar" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="bg-gray-100 min-h-[60vh] flex-1 overflow-auto">
          {ehImagem(arquivo.mime) ? (
            <div className="min-h-[60vh] flex items-center justify-center p-4">
              <img src={arquivo.url} alt={arquivo.nome} className="max-w-full max-h-[76vh] object-contain rounded bg-white" />
            </div>
          ) : ehPdf(arquivo.mime) ? (
            <iframe title={arquivo.nome} src={arquivo.url} className="w-full h-[76vh] bg-white" />
          ) : (
            <div className="min-h-[60vh] flex items-center justify-center p-6 text-center">
              <div>
                <p className="text-sm font-semibold text-gray-700">Pre-visualizacao indisponivel para este formato.</p>
                <p className="text-xs text-gray-500 mt-1">Use abrir fora ou salvar.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
