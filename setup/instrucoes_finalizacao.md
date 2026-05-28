# Instruções para Finalização do CHOFER LOG

## Passo 1: Executar o script SQL no Supabase
1. Acesse o Dashboard do Supabase (https://supabase.com/dashboard)
2. Selecione seu projeto "chofer-log"
3. Vá em SQL Editor (ícone de terminal no menu lateral)
4. Clique em "New query"
5. Abra o arquivo database/migrations/full_setup.sql
6. Copie TODO o conteúdo e cole no SQL Editor
7. Clique em "Run" (Ctrl+Enter)
8. Verifique se não há mensagens de erro vermelhas

## Passo 2: Verificar as tabelas
1. No menu lateral, vá em "Table Editor"
2. Confirme que as 6 tabelas estão listadas:
   - usuarios
   - motoristas
   - fretes
   - despesas
   - abastecimentos
   - vales
3. Clique em cada tabela e verifique as colunas
4. Na aba "Policies", confirme que as políticas RLS estão ativas

## Passo 3: Criar o primeiro administrador
1. Abra o terminal na pasta backend
2. Execute: node setup_admin.js
3. Deve aparecer: "✅ Administrador criado com sucesso!"
4. Anote as credenciais: admin@choferlog.com.br / Admin@123!

## Passo 4: Testar o login
1. Certifique-se de que o backend está rodando (node server.js)
2. Acesse o painel web (http://localhost:5174)
3. Faça login com admin@choferlog.com.br / Admin@123!
4. Você deve ser redirecionado ao Dashboard

## Passo 5: Testar funcionalidades principais
- Cadastrar um motorista pelo app
- Aprovar o motorista no painel
- Criar um frete
- Ver o dashboard refletir os dados
- Gerar um relatório PDF
