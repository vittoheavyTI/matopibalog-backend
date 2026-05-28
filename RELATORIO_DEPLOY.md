# 🚀 Relatório de Deploy — MATOPIBA LOG

> Gerado em: Maio/2026

---

## URLs de Produção

| Serviço | URL | Status |
|---------|-----|--------|
| **Backend (Render)** | `https://matopibalog-api.onrender.com` | ⬜ Pendente |
| **Frontend (Netlify)** | `https://matopibalog.netlify.app` | ⬜ Pendente |
| **Banco (Supabase)** | `https://rjahjogidyndphdxevom.supabase.co` | ✅ Ativo |
| **Admin** | `admin@matopibalog.com.br` / `Admin@123!` | ✅ Criado |

---

## Checklist de Produção

| # | Item | Status | Como verificar |
|---|------|--------|----------------|
| 1 | Backend no Render | ⬜ | `GET https://matopibalog-api.onrender.com/health` → `{"status":"UP"}` |
| 2 | Frontend no Netlify | ⬜ | Acessar `https://matopibalog.netlify.app` |
| 3 | CORS configurado | ✅ | `server.js` já permite `FRONTEND_URL` |
| 4 | Variáveis de ambiente no Render | ⬜ | Configurar no painel do Render |
| 5 | `_redirects` configurado | ✅ | `dist/_redirects` com `/* /index.html 200` |
| 6 | Login funciona | ⬜ | Testar com admin@matopibalog.com.br |
| 7 | Cadastro público funciona | ⬜ | Acessar `/cadastro`, criar conta |
| 8 | API Key Asaas configurada | ⬜ | Sandbox pronta, trocar para produção depois |
| 9 | SQL migrado no Supabase | ✅ | Faturas, documentos, trigger, colunas |
| 10 | Domínio personalizado | ⬜ | `matopibalog.com.br` no Registro.br |

---

## Instruções de Deploy

### Passo 1: Criar repositórios no GitHub

```bash
# Backend
cd "C:\Users\Jordão Vittor\Documents\APP-CHOFERLOG\APP-CHOFER LOG"
git init
git add backend/
git commit -m "Backend Matopiba Log"
git remote add origin https://github.com/SEU_USUARIO/matopibalog-backend.git
git push -u origin main

# Frontend
cd painel_web
git init
git add .
git commit -m "Frontend Matopiba Log"
git remote add origin https://github.com/SEU_USUARIO/matopibalog-frontend.git
git push -u origin main
```

### Passo 2: Deploy do Backend no Render

1. Acesse https://render.com e crie conta (via GitHub)
2. Clique em **New+ → Web Service**
3. Conecte o repositório `matopibalog-backend`
4. Configure:
   - **Name:** `matopibalog-api`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Em **Environment**, adicione:

| Variável | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://rjahjogidyndphdxevom.supabase.co` |
| `SUPABASE_SERVICE_KEY` | (service_role key do Supabase) |
| `JWT_SECRET` | `dc28024f-3b47-460e-897f-98802ed4a5ee` |
| `FRONTEND_URL` | `https://matopibalog.netlify.app` |
| `NODE_ENV` | `production` |

### Passo 3: Deploy do Frontend no Netlify

**Opção A — Manual (mais simples):**
1. No terminal: `cd painel_web && npx vite build`
2. Acesse https://app.netlify.com
3. Arraste a pasta `painel_web/dist` para o navegador
4. O Netlify faz deploy automático e gera URL

**Opção B — Via CLI:**
```bash
npm install -g netlify-cli
cd painel_web
netlify deploy --prod --dir=dist
```

### Passo 4: Atualizar variáveis após deploy

Depois de obter as URLs:

1. Edite `painel_web/.env`:
```
VITE_API_URL=https://matopibalog-api.onrender.com
```

2. Rebuild + redeploy:
```bash
cd painel_web
npx vite build
# Arrastar dist/ para Netlify novamente
```

3. No Render, confirme que `FRONTEND_URL` aponta para `https://matopibalog.netlify.app`

---

## Trocar Asaas de Sandbox → Produção

Quando estiver pronto para cobrar de verdade:

1. Crie uma conta Asaas Produção em https://asaas.com
2. Gere uma API Key de produção
3. No painel do Render, adicione ao Environment:
   ```
   ASAAS_API_KEY=suachaveproducao
   ASAAS_ENVIRONMENT=production
   ```
4. Redeploy no Render
5. Ou configure via interface em `/painel-administrativo/configuracoes`

---

## Ativar RLS no Supabase (recomendado)

No SQL Editor do Supabase, execute:

```sql
-- Habilitar RLS nas tabelas
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE abastecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vales ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;

-- Políticas de isolamento (admin vê tudo, usuário vê só da empresa)
CREATE POLICY empresas_isolation ON empresas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
);

CREATE POLICY usuarios_isolation ON usuarios FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
);

CREATE POLICY motoristas_isolation ON motoristas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY fretes_isolation ON fretes FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY despesas_isolation ON despesas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY abastecimentos_isolation ON abastecimentos FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY vales_isolation ON vales FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY faturas_isolation ON faturas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
);

CREATE POLICY documentos_isolation ON documentos FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
);
```

---

## Próximos Passos

### Imediatos
1. ✅ ~~Criar conta no Render~~
2. ✅ ~~Criar repositório no GitHub~~
3. ⬜ Fazer deploy do backend no Render
4. ⬜ Fazer deploy do frontend no Netlify
5. ⬜ Testar login em produção
6. ⬜ Testar cadastro público

### Curto prazo
7. ⬜ Comprar domínio `matopibalog.com.br` no Registro.br
8. ⬜ Configurar DNS para Netlify
9. ⬜ Adicionar domínio no CORS do backend
10. ⬜ Configurar SSL (automático no Netlify/Render)

### Médio prazo
11. ⬜ Ativar Asaas Produção
12. ⬜ Ativar RLS no Supabase
13. ⬜ Configurar SMTP para recuperação de senha
14. ⬜ Configurar monitoramento (UptimeRobot)

---

## Arquivos importantes

| Arquivo | Finalidade |
|---------|------------|
| `backend/.env.example` | Template de variáveis para novo dev |
| `backend/sql/final_migration.sql` | DDL para criar tabelas faltantes |
| `painel_web/.env` | Variável `VITE_API_URL` (local ou produção) |
| `painel_web/dist/_redirects` | SPA routing para Netlify |

---

> **Status atual:** Precisando de deploy. Todos os arquivos estão prontos — builds, migrações SQL, CORS, variáveis de ambiente.
