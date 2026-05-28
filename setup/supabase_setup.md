# Configuração do Supabase (Chofer Log)

Siga estes passos para configurar sua infraestrutura de banco de dados e autenticação:

## 1. Criar Projeto
1. Acesse [https://supabase.com](https://supabase.com) e faça login.
2. Clique em **"New Project"**.
3. Nome: `chofer-log`
4. Password do Banco: (Crie uma senha forte e anote-a).
5. Região: Escolha a mais próxima (ex: `Sao Paulo / Brazil`).
6. Clique em **"Create new project"**.

## 2. Coletar Credenciais
Após o projeto ser criado (pode levar 1-2 minutos):
1. Vá em **Project Settings** (ícone de engrenagem) > **API**.
2. Copie a **Project URL**.
3. Copie a **service_role** key (essa chave é secreta e tem poderes de admin).
4. Em **JWT Settings**, localize o **JWT Secret**.

## 3. Gerar um JWT Secret Forte (Opcional)
Se desejar trocar o segredo padrão por um mais forte, execute este comando no seu terminal:
```bash
openssl rand -base64 32
```
Cole o resultado no campo **JWT Secret** nas configurações do Supabase.

## 4. Próximos Passos
Agora que você tem os valores, preencha o arquivo `.env` na pasta `backend` seguindo o modelo `.env.example`.
