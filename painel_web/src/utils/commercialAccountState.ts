// AUTORIDADE SEMÂNTICA ÚNICA DO ESTADO COMERCIAL DA CONTA.
//
// S1-HIGH-02 — antes existiam DUAS lógicas independentes para o mesmo estado: o
// banner do `Layout` (copy hardcoded no JSX) e o banner de `MinhasFaturas`
// (`resolverBannerPlano`). O mesmo fato — contrato obrigatório pendente — era
// explicado de formas diferentes conforme a tela, e a correção do BUG-005 tinha
// consertado só uma das duas.
//
// Aqui existe UM resolvedor semântico. As superfícies escolhem o TAMANHO da copy
// (o banner global é curto, a tela financeira é mais explícita), mas ambas derivam
// do mesmo estado — então elas podem divergir em extensão, nunca em sentido.
//
// ─────────────────────────────────────────────────────────────────────────────
// VERDADE EXATA DO BACKEND (auditada em `verificarPlano.js` +
// `situacaoComercialDomainService.js` + `routes/contratacao.js`), porque a copy
// anterior exagerava:
//
//  1. LEITURA NUNCA É BLOQUEADA. `verificarPlano` libera GET/HEAD/OPTIONS sempre.
//     Nenhuma copy pode sugerir "acesso bloqueado" de forma absoluta.
//  2. Contrato obrigatório pendente bloqueia ESCRITAS em contas LEGADAS
//     (`commercial_flow_version !== 'v2'`). Em contas v2, quem decide é
//     `situacao.acoes.operar_escrita` — e uma conta v2 ATIVA com contrato pendente
//     continua podendo escrever.
//  3. `/contratacao/status` FORÇA `pendencia_obrigatoria: false` enquanto a conta
//     está em `trial_ativo`/`trial_expirando`. Ou seja: "trial ativo + pendência
//     obrigatória" NÃO chega ao frontend por esse endpoint. Durante o trial o
//     contrato aparece como PRÓXIMA AÇÃO (`assinatura_pendente`), não como bloqueio.
//
// Consequência honesta: o frontend NÃO recebe `pode_operar` e, portanto, não pode
// afirmar com precisão se as escritas estão bloqueadas neste momento. A copy então
// diz o que é verdade em todos os casos — "algumas ações podem ficar restritas" —
// em vez de escolher um extremo. A recomendação de expor `pode_operar` em
// `/contratacao/status` está registrada no board de estabilização.

export type SeveridadeComercial = 'ok' | 'informativo' | 'atencao' | 'critico';

export type EstadoComercial = {
  planoAtivo: boolean;
  trialAtivo: boolean;
  trialExpirado: boolean;
  /** Contrato OBRIGATÓRIO pendente de assinatura (bloqueante em contas legadas). */
  contratoPendente: boolean;
  /** Contrato iniciado aguardando assinatura, SEM ser bloqueante (trial). */
  assinaturaPendente: boolean;
  /** Conta suspensa/expirada/bloqueada — operação de escrita negada. */
  operacaoBloqueada: boolean;
  /** `false` só quando o backend comprovadamente nega a escrita. */
  operacaoLiberada: boolean;
  severidade: SeveridadeComercial;
  /** Chave estável do motivo — é ela que as duas superfícies compartilham. */
  motivo: MotivoComercial;
};

export type MotivoComercial =
  | 'plano_ativo'
  | 'plano_ativo_contrato_pendente'
  | 'trial_ativo'
  | 'trial_ativo_assinatura_pendente'
  | 'trial_expirado'
  | 'conta_suspensa'
  | 'plano_expirado'
  | 'plano_bloqueado'
  | 'contrato_pendente'
  | 'indefinido';

export type EntradaEstadoComercial = {
  /** `planoStatus.status` do backend. Ausente quando a superfície não tem acesso financeiro. */
  status?: string | null;
  trialExpirado?: boolean | null;
  /** `/contratacao/status` → `pendencia_obrigatoria`. */
  contratoPendente?: boolean | null;
  /** `/contratacao/status` → `trial_ativo`. */
  trialAtivo?: boolean | null;
  /** `/contratacao/status` → `assinatura_pendente` (não bloqueante). */
  assinaturaPendente?: boolean | null;
};

const BLOQUEADOS = new Set(['suspenso', 'expirado', 'bloqueado']);

export function resolverEstadoComercial(entrada: EntradaEstadoComercial = {}): EstadoComercial {
  const status = entrada.status ?? null;
  const contratoPendente = entrada.contratoPendente === true;
  const assinaturaPendente = entrada.assinaturaPendente === true;
  const trialExpirado = entrada.trialExpirado === true;
  const trialAtivo = entrada.trialAtivo === true || (status === 'trial' && !trialExpirado);
  const planoAtivo = status === 'ativo';
  const operacaoBloqueada = BLOQUEADOS.has(status || '') || (status === 'trial' && trialExpirado);

  const base = {
    planoAtivo,
    trialAtivo: trialAtivo && !trialExpirado,
    trialExpirado,
    contratoPendente,
    assinaturaPendente: assinaturaPendente && !contratoPendente,
    operacaoBloqueada,
  };

  // O pior estado manda: bloqueio efetivo vence pendência de contrato.
  if (status === 'suspenso') {
    return { ...base, operacaoLiberada: false, severidade: 'critico', motivo: 'conta_suspensa' };
  }
  if (status === 'expirado') {
    return { ...base, operacaoLiberada: false, severidade: 'critico', motivo: 'plano_expirado' };
  }
  if (status === 'bloqueado') {
    return { ...base, operacaoLiberada: false, severidade: 'critico', motivo: 'plano_bloqueado' };
  }
  if (trialExpirado) {
    return { ...base, operacaoLiberada: false, severidade: 'critico', motivo: 'trial_expirado' };
  }

  if (contratoPendente) {
    // Não afirmamos bloqueio: em conta v2 ativa a escrita segue liberada, em conta
    // legada não. Sem `pode_operar` vindo do backend, `operacaoLiberada` fica
    // INDETERMINADA e é reportada como `false` apenas onde o backend comprova.
    return {
      ...base,
      operacaoLiberada: true,
      severidade: 'atencao',
      motivo: planoAtivo ? 'plano_ativo_contrato_pendente' : 'contrato_pendente',
    };
  }

  if (base.trialAtivo) {
    return {
      ...base,
      operacaoLiberada: true,
      severidade: assinaturaPendente ? 'informativo' : 'informativo',
      motivo: assinaturaPendente ? 'trial_ativo_assinatura_pendente' : 'trial_ativo',
    };
  }

  if (planoAtivo) {
    return { ...base, operacaoLiberada: true, severidade: 'ok', motivo: 'plano_ativo' };
  }

  return { ...base, operacaoLiberada: false, severidade: 'informativo', motivo: 'indefinido' };
}

// ─── COPY DERIVADA ───────────────────────────────────────────────────────────
// Duas superfícies, um estado. `global` é o banner do shell (curto, uma frase);
// `financeiro` é a tela de Faturas/Regularização (pode explicar mais).

export type Superficie = 'global' | 'financeiro';

export type CopyComercial = {
  titulo: string;
  texto: string;
  severidade: SeveridadeComercial;
};

export type ContextoCopy = {
  /** Data do fim do trial já formatada, quando houver. */
  trialData?: string | null;
  diasRestantes?: number | null;
  /** Há fatura pendente com link de pagamento (muda a saída da suspensão). */
  temFaturaComLink?: boolean | null;
};

function textoTrial(ctx: ContextoCopy): string {
  const ate = ctx.trialData ? ` até ${ctx.trialData}` : '';
  const dias = typeof ctx.diasRestantes === 'number'
    ? `, com ${ctx.diasRestantes} dia${ctx.diasRestantes === 1 ? '' : 's'} restante${ctx.diasRestantes === 1 ? '' : 's'}`
    : '';
  return `Seu teste gratuito está ativo${ate}${dias}.`;
}

export function copyComercial(
  estado: EstadoComercial,
  superficie: Superficie,
  ctx: ContextoCopy = {},
): CopyComercial {
  const { severidade } = estado;

  switch (estado.motivo) {
    case 'plano_ativo':
      return {
        titulo: 'Plano ativo',
        texto: 'Seu plano está ativo.',
        severidade,
      };

    case 'plano_ativo_contrato_pendente':
    case 'contrato_pendente':
      // §11 — a copy precisa revelar o EFEITO OPERACIONAL, sem exagerar. Dizer
      // apenas "formalizar continuidade comercial" escondia que ações podem parar
      // de funcionar; dizer "uso bloqueado" mentiria, porque leitura nunca é
      // bloqueada e conta v2 ativa continua escrevendo.
      return {
        titulo: estado.planoAtivo
          ? 'Plano ativo — assinatura do contrato pendente'
          : 'Assinatura do contrato pendente',
        texto: superficie === 'global'
          ? 'Assine o contrato para não ter ações restritas. A consulta continua liberada.'
          : estado.planoAtivo
            ? 'Seu plano está ativo, mas algumas ações podem ficar restritas até a assinatura do contrato. A consulta dos seus dados continua liberada.'
            : 'Algumas ações podem ficar restritas até a assinatura do contrato. A consulta dos seus dados continua liberada.',
        severidade,
      };

    case 'trial_ativo_assinatura_pendente':
      return {
        titulo: 'Contratação iniciada',
        texto: superficie === 'global'
          ? 'Sua contratação está iniciada. Finalize a assinatura quando quiser; seu teste segue ativo.'
          : 'Sua contratação está iniciada. Finalize a assinatura quando quiser — seu teste segue ativo normalmente.',
        severidade,
      };

    case 'trial_ativo':
      return {
        titulo: 'Período de teste',
        texto: superficie === 'global'
          ? textoTrial(ctx)
          : ctx.trialData
            ? `Seu período de teste permanece ativo até ${ctx.trialData}.`
            : 'Sua empresa está no período de teste.',
        severidade,
      };

    case 'trial_expirado':
      return {
        titulo: 'Período de teste expirado',
        texto: ctx.trialData
          ? `Seu teste expirou em ${ctx.trialData}. Contrate um plano para voltar a registrar operações.`
          : 'Seu período de teste terminou. Contrate um plano para voltar a registrar operações.',
        severidade,
      };

    case 'conta_suspensa':
      return {
        titulo: 'Conta suspensa',
        texto: ctx.temFaturaComLink
          ? 'Sua conta está suspensa. Pague a fatura pendente para recuperar o acesso.'
          : 'Sua conta está suspensa. Entre em contato com o suporte para regularizar.',
        severidade,
      };

    case 'plano_expirado':
      return {
        titulo: 'Plano expirado',
        texto: 'O registro de novas operações está bloqueado. Entre em contato com o suporte.',
        severidade,
      };

    case 'plano_bloqueado':
      return {
        titulo: 'Plano bloqueado',
        texto: 'O registro de novas operações está bloqueado. Entre em contato com o suporte.',
        severidade,
      };

    default:
      return {
        titulo: 'Status do plano',
        texto: 'Não foi possível determinar o status do seu plano agora.',
        severidade,
      };
  }
}

const CLASSES_POR_SEVERIDADE: Record<SeveridadeComercial, string> = {
  ok: 'bg-green-50 border-green-200 text-green-800',
  informativo: 'bg-blue-50 border-blue-200 text-blue-800',
  atencao: 'bg-amber-50 border-amber-200 text-amber-800',
  critico: 'bg-red-50 border-red-200 text-red-800',
};

export function classesDaSeveridade(s: SeveridadeComercial): string {
  return CLASSES_POR_SEVERIDADE[s];
}
