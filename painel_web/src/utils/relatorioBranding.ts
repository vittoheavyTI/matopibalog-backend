// painel_web/src/utils/relatorioBranding.ts
// Cabeçalho PADRÃO dos relatórios em PDF (jsPDF). Fonte única para o bloco de
// branding — logo da empresa (per-tenant) + identificação — reaproveitado por
// todos os geradores (Relatorios, ResumoMotorista). Assim o cabeçalho fica
// consistente e a robustez (logo ausente/inválida/lenta, formato, aspecto) vive
// num lugar só.
//
// A logo é resolvida do cache local `matopibalog_logo`, que o Sidebar/Configuracoes
// hidratam do backend (/configuracoes.sidebarLogo) — sempre da PRÓPRIA empresa
// logada (multi-tenant). Sem logo → fallback textual profissional.
//
// Este helper desenha SÓ o branding (topo). Cada relatório mantém o seu título e
// os parâmetros filtrados (período/alvo) logo abaixo — nada de layout de tabela.

import type { jsPDF } from 'jspdf';

const LOGO_MAX_W = 35;
const LOGO_MAX_H = 20;

export type FormatoImagem = 'PNG' | 'JPEG' | 'WEBP';

// Formato da imagem a partir do data URL (default PNG). Passar o formato certo ao
// jsPDF evita falha silenciosa quando a logo é JPEG/WEBP.
export function detectarFormatoImagem(dataUrl: string | null | undefined): FormatoImagem {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl || '');
  if (!m) return 'PNG';
  const t = m[1].toLowerCase();
  if (t === 'jpg' || t === 'jpeg') return 'JPEG';
  if (t === 'webp') return 'WEBP';
  return 'PNG';
}

// Dimensões preservando o aspecto real dentro de maxW x maxH (puro). Sem esticar.
export function calcularDimsLogo(nw: number, nh: number, maxW = LOGO_MAX_W, maxH = LOGO_MAX_H): { w: number; h: number } {
  const W = nw > 0 ? nw : maxW;
  const H = nh > 0 ? nh : maxH;
  const ratio = Math.min(maxW / W, maxH / H);
  return { w: W * ratio, h: H * ratio };
}

export type LogoDims = { w: number; h: number; ok: boolean };

// Decodifica a imagem para obter as dimensões reais. ok=false se falhar/inválida
// (nesse caso NÃO se deve desenhar — evita imagem quebrada no PDF).
export function carregarDimsLogo(dataUrl: string, maxW = LOGO_MAX_W, maxH = LOGO_MAX_H): Promise<LogoDims> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve({ ...calcularDimsLogo(img.naturalWidth, img.naturalHeight, maxW, maxH), ok: true });
      img.onerror = () => resolve({ w: maxW, h: maxH, ok: false });
      img.src = dataUrl;
    } catch {
      resolve({ w: maxW, h: maxH, ok: false });
    }
  });
}

export type EmpresaCabecalho =
  | { temEmpresa: true; nome: string; linhaEndereco: string; linhaContato: string }
  | { temEmpresa: false };

// Resolve nome/endereço/contato da empresa a partir do JSON cacheado (puro).
export function resolverEmpresaCabecalho(savedCompanyJson: string | null): EmpresaCabecalho {
  let c: any = null;
  try { c = savedCompanyJson ? JSON.parse(savedCompanyJson) : null; } catch { c = null; }
  if (c && c.nome) {
    return {
      temEmpresa: true,
      nome: String(c.nome).toUpperCase(),
      linhaEndereco: `${c.endereco || ''}, ${c.cidade || ''}-${c.estado || ''}`,
      linhaContato: `CNPJ: ${c.cnpj || ''} | Tel: ${c.telefone || ''}`,
    };
  }
  return { temEmpresa: false };
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

// 'dd/MM/yyyy HH:mm' (puro) para o carimbo "Gerado em".
export function formatarGeradoEm(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Desenha o cabeçalho de branding padrão no topo do PDF:
 *   - logo da empresa (per-tenant, robusta: só desenha se decodificar);
 *   - nome + endereço + contato da empresa, OU fallback "MATOPIBA LOG";
 *   - carimbo "Gerado em dd/MM/yyyy HH:mm" (topo direito, discreto);
 *   - identificação discreta "Matopiba Log" quando há logo/empresa própria.
 * Best-effort: NUNCA lança — um problema no cabeçalho jamais quebra o relatório.
 * NÃO desenha o título do relatório (cada tela mantém o seu logo abaixo).
 */
export async function desenharBrandingRelatorio(doc: jsPDF, opts: { geradoEm?: Date } = {}): Promise<void> {
  try {
    const savedLogo = localStorage.getItem('matopibalog_logo');
    const empresa = resolverEmpresaCabecalho(localStorage.getItem('matopibalog_company'));

    // Logo (só desenha se decodificar de verdade → sem imagem quebrada).
    if (savedLogo) {
      const dims = await carregarDimsLogo(savedLogo, LOGO_MAX_W, LOGO_MAX_H);
      if (dims.ok) {
        try {
          doc.addImage(savedLogo, detectarFormatoImagem(savedLogo), 12, 8 + (LOGO_MAX_H - dims.h) / 2, dims.w, dims.h);
        } catch { /* addImage falhou → segue sem logo */ }
      }
    }

    // Empresa (ou fallback).
    doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(0, 0, 0);
    if (empresa.temEmpresa) {
      doc.text(empresa.nome, 48, 14);
      doc.setFontSize(8).setFont('helvetica', 'normal');
      doc.text(empresa.linhaEndereco, 48, 22);
      doc.text(empresa.linhaContato, 48, 28);
    } else {
      doc.text('MATOPIBA LOG - GESTÃO DE FROTAS', 48, 20);
    }

    // Carimbo de geração (discreto, topo direito).
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(107, 114, 128);
    doc.text(`Gerado em ${formatarGeradoEm(opts.geradoEm || new Date())}`, 196, 12, { align: 'right' });

    // Identificação discreta do sistema (só quando a empresa tem branding próprio,
    // para não repetir com o fallback textual já rotulado "MATOPIBA LOG").
    if (empresa.temEmpresa) {
      doc.setFontSize(7);
      doc.text('Matopiba Log', 196, 18, { align: 'right' });
    }

    doc.setTextColor(0, 0, 0);
  } catch {
    // Cabeçalho é best-effort: qualquer falha aqui não pode impedir a geração.
  }
}
