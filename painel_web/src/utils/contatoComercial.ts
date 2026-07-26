// Helper PURO para montar links de contato comercial/suporte a partir da
// configuração pública já existente (contactEmail/contactPhone via
// /configuracoes/public). NÃO inventa número/e-mail: só usa o que for passado.
//
// Prioridade de canal (à prova de futuro): WhatsApp → e-mail → (nenhum). O
// telefone, quando houver, vira uma opção SECUNDÁRIA "Ligar" (tel:), nunca é
// assumido como WhatsApp. Hoje o endpoint público expõe contactEmail/contactPhone
// (whatsapp_suporte é SYSTEM_KEY, super-admin) — então `whatsapp` chega vazio e o
// fluxo cai para e-mail; quando uma fonte pública de WhatsApp existir, basta
// alimentá-la aqui.

export interface CanalContatoInput {
  whatsapp?: string | null;  // número com DDI/DDD; só dígitos são usados
  email?: string | null;
  telefone?: string | null;
}

export interface LinkComercial {
  // Canal principal resolvido (null = nenhum canal configurado).
  tipo: 'whatsapp' | 'email' | null;
  href: string | null;      // href do CTA principal (wa.me / mailto:)
  externo: boolean;         // abrir em nova aba (só WhatsApp)
  disponivel: boolean;      // há canal principal clicável?
  // Opção secundária "Ligar" (tel:), independente do canal principal.
  telHref: string | null;
}

// Só dígitos (remove máscara/espacos/parênteses). Vazio → ''.
function apenasDigitos(v?: string | null): string {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

function textoValido(v?: string | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Monta o link do CTA comercial. `assunto` é usado no mailto (subject).
export function montarLinkComercial(
  canal: CanalContatoInput,
  opts: { assunto?: string; mensagem?: string } = {}
): LinkComercial {
  const wpp = apenasDigitos(canal.whatsapp);
  const email = textoValido(canal.email);
  const telDigitos = apenasDigitos(canal.telefone);
  const telHref = telDigitos ? `tel:+${telDigitos}` : null;

  // 1. WhatsApp (preferencial), quando houver número.
  if (wpp) {
    const texto = opts.mensagem ? `?text=${encodeURIComponent(opts.mensagem)}` : '';
    return { tipo: 'whatsapp', href: `https://wa.me/${wpp}${texto}`, externo: true, disponivel: true, telHref };
  }

  // 2. E-mail, quando houver.
  if (email) {
    const params: string[] = [];
    if (opts.assunto) params.push(`subject=${encodeURIComponent(opts.assunto)}`);
    if (opts.mensagem) params.push(`body=${encodeURIComponent(opts.mensagem)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return { tipo: 'email', href: `mailto:${email}${qs}`, externo: false, disponivel: true, telHref };
  }

  // 3. Nenhum canal principal — telefone (se houver) ainda permite "Ligar".
  return { tipo: null, href: null, externo: false, disponivel: false, telHref };
}
