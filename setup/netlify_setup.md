# Configuração do Netlify (Painel Web React)

Siga estes passos para hospedar seu painel administrativo:

1. Acesse [https://netlify.com](https://netlify.com) e conecte seu GitHub.
2. Clique em **"Add new site"** > **"Import an existing project"**.
3. Selecione o repositório do projeto `CHOFER LOG`.
4. Configurações de Build:
   - **Base directory:** `painel_web`
   - **Build command:** `npm run build`
   - **Publish directory:** `dist` (ou `build` dependendo do seu Vite config).

5. Clique em **"Site configuration"** > **"Environment variables"**:
   - Adicione `VITE_API_URL`: (A URL da API que você criou no Render).

6. Clique em **"Deploy site"**.
7. O Netlify fornecerá uma URL (ex: `https://chofer-log.netlify.app`).

## Nota sobre Rotas (SPA)
Se ao atualizar a página você receber um erro 404, crie um arquivo chamado `_redirects` dentro da pasta `public` do seu projeto React com o conteúdo:
```text
/*    /index.html   200
```
Isso fará com que o Netlify redirecione todas as rotas para o seu App React.
