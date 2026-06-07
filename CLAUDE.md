# CLAUDE.md — Matopiba Log

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
> Ele define como trabalhar neste projeto. Siga estas regras sempre.

---

## 🚨 REGRAS DE OURO (nunca violar)

1. **SEMPRE mostre o diff completo antes de aplicar qualquer alteração.**
   Aguarde confirmação explícita do desenvolvedor antes de editar.

2. **NUNCA quebre o que já funciona.**
   Antes de mexer em um arquivo crítico, leia-o inteiro primeiro.
   Se a mudança afeta autenticação, API, ou deploy, avise antes.

3. **Passos pequenos, um de cada vez.**
   Não faça 5 alterações de uma vez. Faça uma, explique o que testar,
   aguarde o resultado, depois siga para a próxima.

4. **Após cada alteração, diga claramente:**
   - O que foi alterado
   - O que o desenvolvedor deve testar
   - Se pode haver efeito colateral em outra parte

5. **Commits atômicos, mensagem em português.**
   Um commit por correção lógica. Ex: "fix(auth): corrige logout imediato"

6. **Se não tiver certeza, pergunte. Não suponha.**
   Melhor uma pergunta a mais do que uma mudança errada.

---

## 📦 CONTEXTO DO PROJETO

**Matopiba Log** — SaaS de gestão de transportadoras.
Atende: transportadoras (frota grande), fazendas (frota própria),
e caminhoneiros autônomos (um veículo).

### Stack
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 (pasta `painel_web/`)
- **Backend:** Node.js + Express (pasta `backend/`) — requer Node.js 20+
- **App mobile:** Flutter/Dart (pasta `app_android/`)
- **Banco + Auth:** PostgreSQL via Supabase
- **E-mail:** Resend (SMTP do Supabase)

### Infraestrutura (produção)
- **Backend:** Railway — https://matopibalog-backend-production.up.railway.app
- **Frontend:** GitHub Pages — https://matopibalog.com.br (deploy via GitHub Actions)
- **Domínio:** matopibalog.com.br (DNS na Hostinger)
- **Repositório:** vittoheavyTI/matopibalog-backend (monorepo: backend + frontend + app)

### Pipeline de deploy
- Push para `main` → Railway redeploy backend (~2min) + GitHub Actions build frontend (~4min)
- Backend requer variável de ambiente: SUPABASE_URL, SUPABASE_SERVICE_KEY,
  JWT_SECRET, FRONTEND_URL, NODE_ENV
- Frontend usa VITE_API_URL (Secret no GitHub Actions + fallback no .env)

---

## 🏗️ ARQUITETURA DE AUTENTICAÇÃO (cuidado redobrado aqui)

- **Web:** JWT em httpOnly cookie (secure, sameSite:none)
- **App mobile (Flutter):** usa Bearer token no header (cookie httpOnly não funciona em app)
- `AuthContext.tsx` chama GET /auth/me na montagem para restaurar sessão
- `ProtectedRoute.tsx` DEVE aguardar loading terminar antes de redirecionar
- Interceptor de 401 em `api.ts` NÃO deve agir nas rotas /auth/me e /auth/login
  (senão causa logout imediato — bug já corrigido, não reintroduzir)

---

## 🔒 SEGURANÇA (já implementado — não remover)

- Rate limiting: 200 req/15min geral, 10 tentativas/15min no login
- Validação de inputs com Zod em todos os POST
- Senhas: bcrypt
- Isolamento multi-tenant: middleware injeta empresa_id
- CORS: apenas matopibalog.com.br

---

## ✅ JÁ CONCLUÍDO

- Migração Render → Railway
- JWT httpOnly cookie + rate limiting + Zod
- Fluxo principal web: login → motorista → frete → despesa → relatório PDF
- Auditoria das 17 páginas (todas funcionais ou corrigidas)
- E-mail de recuperação via Resend (funciona em Gmail)
- Bug de logout imediato (corrigido — ver seção autenticação acima)
- Node.js 20 forçado no Railway

---

## 📋 TAREFAS PENDENTES (em ordem de prioridade)

### Para a Farmshow (urgente)
1. **App Flutter — bloqueadores:**
   - URL da API → Railway (lib/config.dart)
   - Rebranding chofer_log → matopibalog
   - Auth: confirmar Bearer token funcionando
2. **Cadastro público** — visitante deve conseguir se cadastrar no trial
3. **Teste completo de todos os fluxos** como cliente novo

### Rebranding (branch separado: rebranding/choferlog-to-matopibalog)
- Substituir todas as referências "chofer"/"choferlog"/"ChoferLog"
  por "matopiba"/"matopibalog"/"Matopiba Log"
- Backend, frontend, app Flutter, package.json, README
- localStorage já migrado (prefixo matopibalog_)

### Pós-Farmshow (Fase 2)
- Testes automatizados: Jest + Supertest (autenticação, cálculo de frete, multi-tenant)
- Sentry para error tracking
- App Flutter: refresh token, foto em fretes, timeout HTTP

---

## 🐛 BUGS CONHECIDOS

- **E-mail não chega no Hotmail/Outlook:** problema de reputação de domínio novo,
  não de código. Gmail funciona. Solução: configurar DMARC mais estrito +
  aguardar maturação do domínio + registrar no Microsoft SNDS.
- **App Flutter sem refresh token:** quando JWT expira, app trava. Pós-Farmshow.

---

## ⚙️ COMANDOS ÚTEIS

```bash
# Backend
cd backend && npm install && node server.js

# Frontend
cd painel_web && npm install && npm run dev

# Build de produção do frontend
cd painel_web && npm run build

# Verificar referências antigas (rebranding)
grep -ri "chofer" . --include="*.ts" --include="*.tsx" --include="*.js"

# App Flutter
cd app_android && flutter pub get && flutter run
```

---

## 💡 NOTAS DE ESTILO

- Código e comentários: português
- Mensagens de erro ao usuário: português
- Não adicionar dependências novas sem avisar
- Preferir editar arquivo existente a criar arquivo novo
- Hardware do dev é limitado: builds podem demorar, evite rodar processos longos sem avisar

---

## Estado atual (atualizado em 2026-06-07)

### Auditoria de segurança — fechados
- [x] Isolamento de leitura: fretes, despesas, vales, abastecimentos, dashboard, relatórios, motoristas, usuarios
- [x] Ownership: approve, block, delete, comissão, em-viagem
- [x] empresa_id nos 4 creates (fretes, despesas, vales, abastecimentos) — derivado do motorista
- [x] quem_recebeu automático por tipo empresa (autonomo→motorista, transportadora→proprietario)
- [x] Cadastro motorista pelo admin (POST /admin/motoristas)
- [x] #13/#14 Usuarios isolamento + ownership
- [x] #15 Impersonação ?empresa_id= → só super-admin (tenant.js)
- [x] #17 RCE impressoras → stubs inócuos (zero exec/child_process no backend)
- [x] #4 Segredos integração → whitelist nos GETs (/configuracoes e /public)
- [x] Integrações → isSuperAdmin (rotas + menu Sidebar)
- [x] #31 Webhook Asaas → validação header asaas-access-token (NÃO é HMAC; é token fixo)
- [x] #18-20 Pagamentos ownership + isSuperAdmin + bug ordem rota /cobrancas/all
- [x] #16/#32 PUT /configuracoes → isSuperAdmin + company por empresa (config_empresa JSONB)
- [x] Rename "Gerenciamento de Viagens" → "Gerenciamento de Fretes" + item "Fretes" no menu
- [x] despesas.tipo default 'geral' (NOT NULL)

### App Flutter — estado atual
- [x] Build funcionando (flutter build apk --debug passa — requer Modo Desenvolvedor Windows + flutter extraído)
- [x] Redesign UI: Material 3, tema light/dark, cores da marca (#1B5E20 verde, #827717 oliva)
- [x] ThemeProvider com SharedPreferences + toggle sol/lua
- [x] Login: Card, logomarca LOGOMARCA.png, olhinho senha, Esqueceu senha, toggle tema
- [x] Cadastro: mesma linguagem visual, olhinho nos 2 campos de senha
- [x] Splash: LOGOMARCA.png em vez de ícone de caminhão
- [x] Logos configuradas: Logo.png (launcher) e LOGOMARCA.png (telas) em assets/
- [x] flutter_launcher_icons configurado (Logo.png, fundo branco)
- [x] Debug de conexão: debugPrint do status+body no login; erro real do backend exibido ao usuário
- [x] Assets: case-sensitive confirmado (Logo.png, LOGOMARCA.png)
- [x] Bug botão ENTRAR invisível: foregroundColor: Colors.white adicionado ao ElevatedButtonTheme (light e dark)
- [x] Dark mode: estrutura correta (ThemeProvider acima do MaterialApp, themeMode: context.watch)
- [x] Ícone launcher: flutter_launcher_icons ^0.14.3 configurado (dart run flutter_launcher_icons para gerar)
- [x] Splash: Image.asset('assets/LOGOMARCA.png') confirmado
- [ ] Teste de login real com motorista cadastrado
- [ ] Relatório mensal (sessão separada)
- [ ] Notificações push (precisa Firebase, sessão separada)
- [ ] Modo Desenvolvedor Windows: habilitar para rodar flutter localmente (start ms-settings:developers)
- [ ] flutter extraído: C:\Users\Jordão Vittor\Downloads\flutter_windows_3.44.0-stable.zip → extrair antes de buildar

### Pendentes
- [ ] #7 Refatorar configuracoes id=1 (company separado ✓; falta limpar blob/printers)
- [ ] #30/#34 Validação Zod (configuracoes, painel-admin, pagamentos, integracoes)
- [ ] #33 Status suspenso em verificarPlano + PAYMENT_OVERDUE no webhook
- [ ] #35 SMTP reputação domínio (Hotmail/Outlook)
- [ ] #36/#37 Flutter (refresh token, máscaras CPF/telefone/placa, rebranding chofer→matopiba)
- [ ] Bateria teste Alfa/Bravo (isolamento completo end-to-end com dados limpos)
- [ ] Tela "Minhas Faturas" (transportadora vê próprias faturas — GET /pagamentos/cobrancas/:empresa_id pronto)
- [ ] Limpar empresas duplicadas (3 Alfas, 2 autônomos órfãos — cuidado com FKs)
- [ ] Autocomplete cidades (API IBGE — gratuita, municípios brasileiros)
- [ ] Máscaras web (moeda, placa) em forms
- [ ] Etapa D: super-admin criar empresa com admin + reset obrigatório de senha (coluna senha_temporaria já existe)
- [ ] Login 3 botões (empresa/autônomo/código)

### Padrões estabelecidos (não re-derivar, seguir como estão)
- **Isolamento leitura**: IDs motoristas da empresa via usuarios.empresa_id → .in(ids.length ? ids : [''])
- **Ownership ações**: buscar alvo .eq('empresa_id', req.empresa_id) antes de agir; super-admin pula
- **empresa_id em creates**: derivar do MOTORISTA do lançamento (motData.empresa_id), nunca do body
- **Auth níveis**: verifyToken → isAdmin (admin comum) → isSuperAdmin (super-admin) — em middlewares/auth.js
- **Tenant**: verificarEmpresa (middlewares/tenant.js) injeta req.empresa_id; ?empresa_id= na query SÓ para super-admin
- **Webhook Asaas**: token fixo no header asaas-access-token (não HMAC). Env: ASAAS_WEBHOOK_TOKEN
- **Config global**: whitelist nos GETs (APPEARANCE_KEYS / ADMIN_EXTRA_KEYS); integracao_* só super-admin
- **Company**: vive em empresas.config_empresa (JSONB, por empresa). GET/PUT /configuracoes/empresa. O blob global id=1 ainda tem company órfão — limpeza no #7

### Schema — fatos confirmados (não supor, não confiar nos SQLs versionados)
- empresa_id NOT NULL em: motoristas, fretes, despesas, vales, abastecimentos
- faturas usa `created_at` (não `criado_em`)
- empresas tem `config_empresa JSONB` (migration 009)
- fretes tem `quem_recebeu` NOT NULL (default automático por tipo empresa)
- despesas tem `tipo` NOT NULL (default 'geral')
- SQLs versionados (001_create_tables, full_setup) DESATUALIZADOS vs produção — sempre conferir o banco real

### Decisões de produto (já tomadas — não rediscutir)
- Integrações = plataforma → só super-admin
- Billing/pagamentos = plataforma → super-admin cria cobranças; admin comum vê só próprias faturas
- Impressão = função de cliente → desativada no servidor (stubs sem exec)
- Company = por empresa (config_empresa na tabela empresas, não no blob global)
- quem_recebeu = automático por tipo (autonomo/TAC → 'motorista'; transportadora/CLT → 'proprietario')
- CIOT obrigatório a partir de 24/05/2026 → avaliar como feature futura / diferencial
- Aparência do login = plataforma → só super-admin edita

### Contas de teste
- vittoheavymetal@gmail.com → super-admin → Matopiba Log Admin (21e4160b)
- jordaovittor@gmail.com → admin comum → Empresa Alfa (e5afecd6)
- infratechmarket@gmail.com → admin comum → Transportadora Bravo (c5d513be)

### Mapa de arquivos principal
| Tarefa | Arquivo |
|--------|---------|
| Isolamento fretes/despesas/vales/abast | backend/controllers/{fretes,despesas,vales,abastecimentos}Controller.js |
| Dashboard / Relatórios | backend/controllers/{dashboard,relatorios}Controller.js |
| Motoristas + usuários (admin) | backend/controllers/adminController.js + backend/routes/admin.js |
| Integrações | backend/routes/integracoes.js |
| Config global + empresa | backend/controllers/configController.js + backend/routes/config.js |
| Pagamentos / billing | backend/routes/pagamentos.js |
| Middlewares de segurança | backend/middlewares/{auth,tenant}.js |
| Cadastro motorista/empresa | backend/controllers/authController.js + backend/services/empresaService.js |
| Impressoras (stubs) | backend/routes/impressoras.js |
| Sidebar (menu) | painel_web/src/components/Sidebar.tsx |
| Configurações (frontend) | painel_web/src/pages/Configuracoes.tsx |
| Viagens/Fretes (frontend) | painel_web/src/pages/GerenciamentoViagens.tsx |
| Auth context (frontend) | painel_web/src/contexts/AuthContext.tsx |
| Login config (frontend) | painel_web/src/hooks/useLoginConfig.ts |
