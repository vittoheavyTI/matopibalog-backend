# Implantação do Painel Web na Netlify (Fase 5)

Este documento descreve os passos para hospedar a versão final do Painel Web (React + Vite) na Netlify.

## Pré-requisitos
1. Ter uma conta na [Netlify](https://app.netlify.com).
2. Ter o código do Painel Web (`painel_web`) commitado em um repositório Git (GitHub, GitLab ou Bitbucket) ou estar pronto para usar a CLI da Netlify / arrastar a pasta.

## Passo 1: Preparar o Projeto

1. Certifique-se de que o arquivo `package.json` possui o script de build correto:
   ```json
   "scripts": {
     "dev": "vite",
     "build": "vite build",
     "preview": "vite preview"
   }
   ```
2. O arquivo de configuração do Vite (`vite.config.ts`) já está configurado por padrão.
3. Certifique-se de que a biblioteca `react-router-dom` possua rotas protegidas (como já implementado na Fase 5) baseadas em JWT via `localStorage`.

## Passo 2: Criar o arquivo de redirecionamento para SPAs (React)

Aplicativos de página única (SPAs) como o React precisam redirecionar todas as rotas não encontradas para o `index.html`, pois o roteamento é feito no lado do cliente.

Crie um arquivo chamado `_redirects` dentro da pasta `painel_web/public/` (se ainda não existir):
```
/*    /index.html   200
```

## Passo 3: Configurar Variáveis de Ambiente

O painel depende da API REST para se autenticar e obter os dados. 
Na raiz da pasta `painel_web`, você deve ter um `.env` em ambiente de desenvolvimento, mas em produção você definirá a variável no painel da Netlify.

Nome da Variável: `VITE_API_URL`
Valor (Exemplo Render): `https://choferlog-api.onrender.com`

## Passo 4: Fazer o Deploy via Painel da Netlify

1. Acesse [Netlify](https://app.netlify.com).
2. Clique em **Add new site** > **Import an existing project**.
3. Conecte sua conta do GitHub/GitLab e selecione o repositório do "CHOFER LOG".
4. Configure as opções de Build:
   - **Base directory**: `painel_web` (se o projeto inteiro estiver num mono-repo).
   - **Build command**: `npm run build`
   - **Publish directory**: `painel_web/dist`
5. Clique em **Show advanced** > **New variable**.
   - Adicione `VITE_API_URL` com o valor da URL do backend Node.js.
6. Clique em **Deploy site**.

## Passo 5: Teste

1. Após o deploy, a Netlify irá fornecer um link como `https://sua-url-gerada.netlify.app`.
2. Acesse a URL.
3. Teste o login com um usuário `administrador` configurado no backend.
4. Tente acessar diretamente as rotas, recarregando a página, para garantir que o redirecionamento (`_redirects`) está funcionando corretamente.

## Solução de Problemas Comuns

- **Página não encontrada (404) ao recarregar rotas:** Certifique-se de que o arquivo `public/_redirects` existe e foi adicionado na build (pasta `dist`).
- **Problemas de CORS:** O backend (Node.js/Express) deve estar configurado para permitir a URL fornecida pela Netlify na configuração do `cors()`.
- **Erro 401 nas requisições:** Verifique se o login foi efetuado e o token JWT está sendo enviado corretamente no cabeçalho `Authorization: Bearer <token>`.
