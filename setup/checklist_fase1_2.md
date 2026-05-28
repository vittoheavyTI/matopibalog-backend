# Checklist de Validação: Fases 1 e 2

Execute este checklist após configurar seu ambiente e subir o servidor localmente.

## Estrutura de Arquivos
- [ ] Pasta `backend/` criada com `package.json`, `server.js` e subpastas?
- [ ] Arquivos `.env.example` e `config/supabase.js` presentes?
- [ ] Pasta `database/migrations/` contém os scripts SQL (001 e 002)?
- [ ] Guias de deploy criados na pasta `setup/`?

## Banco de Dados (Supabase)
- [ ] Script `001_create_tables.sql` executado sem erros no SQL Editor?
- [ ] Script `002_create_rls.sql` executado e políticas aplicadas?
- [ ] Bucket `comprovantes` criado manualmente no Storage?

## Servidor Backend
- [ ] `npm install` executado na pasta `backend`?
- [ ] Servidor inicia com `node server.js` ou `npm run dev`?
- [ ] Rota `GET /health` retorna `{"status": "UP"}`?

## Autenticação e Regras
- [ ] `POST /auth/register` cria usuário no Auth e nas tabelas `usuarios` e `motoristas`?
- [ ] `POST /auth/login` retorna um Token JWT válido?
- [ ] Rota de Admin (`GET /admin/motoristas`) retorna `403 Forbidden` se tentada com token de motorista?
- [ ] `PATCH /admin/motoristas/:id/approve` (usando token de admin) altera o status para 'ativo'?

---
**Status Final:** Se todos os itens acima forem marcados, as Fases 1 e 2 estão concluídas com sucesso.
