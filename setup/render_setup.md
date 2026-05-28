# Configuração do Render (API Node.js)

Siga estes passos para hospedar sua API:

1. Acesse [https://render.com](https://render.com) e conecte sua conta do GitHub.
2. Clique em **"New +"** > **"Web Service"**.
3. Selecione o repositório do projeto `CHOFER LOG`.
4. Configurações:
   - **Name:** `chofer-log-api`
   - **Environment:** `Node`
   - **Region:** Escolha a mesma do Supabase se possível.
   - **Branch:** `main` (ou sua branch de desenvolvimento).
   - **Root Directory:** `backend` (ou deixe vazio se o repo for apenas o backend).
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`

5. Vá em **Advanced** > **Environment Variables** e adicione:
   - `SUPABASE_URL`: (Sua URL do Supabase)
   - `SUPABASE_SERVICE_KEY`: (Sua Service Role Key)
   - `JWT_SECRET`: (Seu segredo gerado)
   - `NODE_ENV`: `production`

6. Clique em **"Create Web Service"**.
7. O Render gerará uma URL (ex: `https://chofer-log-api.onrender.com`). Anote-a para usar no Painel Web e no App.
