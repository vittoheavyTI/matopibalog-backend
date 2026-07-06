# Billing e regularização — piloto controlado

Este fluxo organiza o acesso ao billing existente sem criar cobrança automática.
As rotas de criação Asaas e o webhook não são acionados nem alterados por este PR.

| Perfil | Ativo | Suspenso, bloqueado ou expirado | Regularização |
| --- | --- | --- | --- |
| Super-admin | Visão global de planos, assinaturas e faturas | Mantém controle global | Painel Admin |
| Empresa/admin | Operação normal e Faturas/Regularização | Histórico read-only; escritas bloqueadas | Painel web |
| Motorista vinculado | App normal | Histórico read-only e aviso para procurar o administrador | Administrador da empresa |
| Autônomo puro | App normal | Histórico read-only e contato de suporte | App, via suporte configurado |
| Autônomo com admin | App normal; admin usa painel | Histórico read-only e orientação ao administrador | Administrador no painel web |

## Limites deste PR

- Não cria cliente ou cobrança no Asaas.
- Não altera credenciais, envs, webhook ou configuração de integração.
- Não cria tabela, coluna, migration, grant ou policy RLS.
- Não adiciona pagamento embutido ao aplicativo.
- Uma cobrança já emitida continua abrindo somente pela URL segura armazenada na fatura.

## Próximo PR recomendado

Antes de habilitar emissão automática, revisar o ciclo completo Asaas em sandbox:
normalização de status, persistência atômica, idempotência da criação, conciliação e
tratamento de falha entre a API externa e a tabela `faturas`.
