# Criptografia em repouso das credenciais de Integrações

As credenciais sensíveis das integrações (por exemplo `apiKey`, `token`, `secret`,
`password`, `senha`) passam a ser gravadas **criptografadas** em
`configuracoes.dados.integracao_<servico>`. Campos não sensíveis (endpoints, IDs
públicos, flags) continuam em texto puro.

A criptografia usa **AES-256-GCM** (autenticado) implementado com o módulo `crypto`
nativo do Node.js, em `backend/utils/integrationsCrypto.js`. O payload armazenado tem o
formato:

```
enc:v1:<ivBase64>:<authTagBase64>:<cipherTextBase64>
```

## Variável de ambiente `INTEGRATIONS_SECRET_KEY`

O helper lê a chave de `process.env.INTEGRATIONS_SECRET_KEY`. Ela deve ser uma string
**base64 que decodifique para exatamente 32 bytes** (chave de 256 bits).

Gere uma chave nova com:

```bash
openssl rand -base64 32
```

### Onde configurar

- **Produção** e **staging**: defina `INTEGRATIONS_SECRET_KEY` no provedor de deploy
  (variáveis de ambiente do serviço de backend). Use **chaves diferentes** por ambiente.
- **Desenvolvimento**: defina no seu `.env` local (não versionado).

> Sem `INTEGRATIONS_SECRET_KEY` configurada, o salvamento de uma integração com campos
> sensíveis falha com erro genérico (HTTP 500) — o sistema **nunca** grava o segredo em
> texto puro por engano.

## Compatibilidade com valores legados

Valores já existentes gravados em texto puro (sem o prefixo `enc:v1:`) continuam sendo
**lidos normalmente**: a leitura apenas os mascara, e a descriptografia devolve o próprio
valor quando ele não está no formato criptografado.

- A **migração** desses valores legados para o formato criptografado é uma etapa futura,
  tratada por um script/PR separado.
- **Este PR não executa nenhuma migration** e não altera o banco de dados.

## Escopo

Este PR cobre **apenas** a criptografia em repouso das credenciais de integrações
(rota `POST /integracoes/salvar` e leitura mascarada em `GET /integracoes`).

Não altera o provedor de pagamentos (Asaas), a API pública, nem o frontend.
