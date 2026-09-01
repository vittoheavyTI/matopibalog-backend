// Matriz de comunicação do ESTADO COMERCIAL da conta (Faturas / Regularização).
//
// Por que isto é uma função pura e não JSX embutido na página: a copy comercial é
// uma MATRIZ de combinações alcançáveis (trial × plano × contrato × fatura), e uma
// matriz que só existe dentro do render não dá para exercitar — foi assim que
// "Plano ativo / Seu plano está ativo." acabou sendo dito ao lado de um pedido de
// assinatura de contrato, contradizendo a própria tela.
//
// REGRA CENTRAL (BUG-005): PLANO ATIVO e USO OPERACIONAL LIBERADO são duas coisas
// distintas. A assinatura comercial pode estar em dia enquanto a operação continua
// restrita por um contrato obrigatório ainda não assinado — e o backend de fato
// bloqueia as escritas nesse caso. Quando as duas divergem, a copy diz as DUAS.
// Nunca afirmar só a metade agradável.

export type TomBanner = 'ok' | 'atencao' | 'critico' | 'neutro';

export type BannerPlano = {
  titulo: string;
  texto: string;
  tom: TomBanner;
  /** A operação está liberada neste estado? Espelha o gate real do backend. */
  operacaoLiberada: boolean;
};

export type EntradaBannerPlano = {
  /** `planoStatus.status` cru do backend. */
  status?: string | null;
  trialExpirado?: boolean | null;
  /** Data do fim do trial já formatada para exibição, ou null. */
  trialData?: string | null;
  /** Há contrato OBRIGATÓRIO pendente de assinatura. */
  pendenciaObrigatoria?: boolean | null;
  /** Existe fatura pendente com link de pagamento (muda a saída da suspensão). */
  temFaturaComLink?: boolean | null;
};

const CLASSES_POR_TOM: Record<TomBanner, string> = {
  ok: 'bg-green-50 border-green-200 text-green-800',
  atencao: 'bg-amber-50 border-amber-200 text-amber-800',
  critico: 'bg-red-50 border-red-200 text-red-800',
  neutro: 'bg-gray-50 border-gray-200 text-gray-700',
};

export function classesDoTom(tom: TomBanner): string {
  return CLASSES_POR_TOM[tom];
}

export function resolverBannerPlano(entrada: EntradaBannerPlano): BannerPlano {
  const { status, trialData, temFaturaComLink } = entrada;
  const trialExpirado = entrada.trialExpirado === true;
  const pendencia = entrada.pendenciaObrigatoria === true;

  if (status === 'ativo') {
    if (pendencia) {
      return {
        titulo: 'Plano ativo — assinatura do contrato pendente',
        texto: 'Seu plano está ativo, mas o uso operacional continua restrito até a assinatura do contrato.',
        tom: 'atencao',
        operacaoLiberada: false,
      };
    }
    return {
      titulo: 'Plano ativo',
      texto: 'Seu plano está ativo.',
      tom: 'ok',
      operacaoLiberada: true,
    };
  }

  if (status === 'trial') {
    if (trialExpirado) {
      return {
        titulo: 'Período de teste expirado',
        texto: trialData ? `Seu teste expirou em ${trialData}.` : 'Seu período de teste expirou.',
        tom: 'critico',
        operacaoLiberada: false,
      };
    }
    if (pendencia) {
      return {
        titulo: 'Período de teste — assinatura do contrato pendente',
        texto: trialData
          ? `Seu teste segue ativo até ${trialData}. Assine o contrato para liberar o uso operacional sem interrupção.`
          : 'Seu teste segue ativo. Assine o contrato para liberar o uso operacional sem interrupção.',
        tom: 'atencao',
        operacaoLiberada: false,
      };
    }
    return {
      titulo: 'Período de teste',
      texto: trialData
        ? `Seu período de teste permanece ativo até ${trialData}.`
        : 'Sua empresa está no período de teste.',
      tom: 'neutro',
      operacaoLiberada: true,
    };
  }

  if (status === 'suspenso') {
    return {
      titulo: 'Conta suspensa',
      texto: temFaturaComLink
        ? 'Sua conta está suspensa. Pague a fatura pendente para recuperar o acesso.'
        : 'Sua conta está suspensa. Entre em contato com o suporte para regularizar.',
      tom: 'critico',
      operacaoLiberada: false,
    };
  }

  if (status === 'expirado' || status === 'bloqueado') {
    return {
      titulo: status === 'expirado' ? 'Plano expirado' : 'Plano bloqueado',
      texto: 'Seu acesso operacional está bloqueado. Entre em contato com o suporte.',
      tom: 'critico',
      operacaoLiberada: false,
    };
  }

  // Estado desconhecido: honesto e sem inventar liberação.
  return {
    titulo: 'Status do plano',
    texto: status ? `Status atual: ${status}.` : 'Status não informado.',
    tom: 'neutro',
    operacaoLiberada: false,
  };
}
