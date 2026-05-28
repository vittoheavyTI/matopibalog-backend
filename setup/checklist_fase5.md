# Checklist: Fase 5 (Web Admin vs Node API)

Esta checklist garante que a Fase 5 (Integração Total do Painel Web com a Nova API) foi concluída e está pronta para uso em produção.

## 1. Segurança e Autenticação
- [ ] Login como Administrador (via API) concluído com sucesso.
- [ ] Bloqueio de Login para Motoristas/Usuários Bloqueados confirmado.
- [ ] Token JWT sendo armazenado corretamente no `localStorage`.
- [ ] Rota Protegida (`ProtectedRoute`) bloqueando acesso de usuários não logados.
- [ ] Rota Protegida bloqueando acesso de usuários cujo `role` (tipo) não é admin.
- [ ] Sessão de Login é persistente ao recarregar a página (recarrega os dados via Token no contexto).
- [ ] Logout limpa o Token e redireciona para a página de Login.

## 2. Dashboard
- [ ] Resumo Geral de valores (Total Fretes, Comissões, Deduções, Saldo) carrega corretamente da API.
- [ ] Lista de Motoristas na página inicial reflete os dados do banco Supabase.
- [ ] Detalhamento do Motorista exibe lançamentos reais (fretes, despesas, abastecimentos).
- [ ] Adição de novo Frete no Dashboard é gravado com sucesso via API.
- [ ] Modificação do Status de um motorista (Bloqueado/Em Viagem) reflete na interface e na API.

## 3. Gestão de Motoristas
- [ ] Cadastro de novo Motorista cria registro no Supabase Auth e nas tabelas `usuarios` e `motoristas` via API (`POST /auth/register`).
- [ ] Edição da comissão do motorista (`PUT /admin/motoristas/:id/comissao`) salva e recalcula os fretes futuros corretamente.
- [ ] Bloqueio/Desbloqueio de Motorista via Dashboard ou Motoristas funciona e impede o login do mesmo no App Flutter.

## 4. Gestão de Usuários (Admins)
- [ ] Lista de Usuários Administrativos carrega corretamente (`GET /admin/usuarios`).
- [ ] Criação de novo Administrador (`POST /admin/usuarios`) funciona e permite login no painel.
- [ ] Atualização de permissões de Administrador (`PUT /admin/usuarios/:id`) funciona e atualiza as restrições na interface (se aplicável).

## 5. Relatórios
- [ ] A prévia de relatórios reflete os dados do banco (`fretes`, `despesas`, `abastecimentos`, `vales`).
- [ ] Filtro por mês e período personalizado atualiza os dados na tela.
- [ ] Geração do arquivo `.pdf` (via `jsPDF`) processa com sucesso e traz os dados das tabelas consultadas.

## 6. Configuração e Dependências
- [ ] O arquivo `package.json` do `painel_web` não possui nenhuma referência ao `firebase` ou `firebase-tools`.
- [ ] A aplicação realiza chamadas utilizando `axios` interceptando o token JWT.
- [ ] O `.env` / Variável de Ambiente `VITE_API_URL` está configurado apontando para a URL do Node.js.

## Observações Pós-Teste
> Preencher esta seção caso algum dos itens acima necessite de refatoração complementar.
