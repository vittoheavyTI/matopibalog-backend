# Checklist de Validação: Fase 4 (App Flutter)

Execute estes testes no emulador ou dispositivo físico para garantir que o App foi migrado corretamente para a nova API REST.

## 1. Configuração Inicial
- [ ] Executou `flutter pub get` e não há erros de dependência?
- [ ] O arquivo `lib/config.dart` aponta para a URL correta da sua API?

## 2. Autenticação
- [ ] **Login:** Ao entrar com e-mail/senha, o App redireciona para a Home?
- [ ] **Status Pendente:** Se um motorista não aprovado tentar logar, aparece a mensagem "Aguardando aprovação"?
- [ ] **Persistência:** Se você fechar o app e abrir de novo, ele continua logado na Home?
- [ ] **Logout:** O botão de sair limpa os dados e volta para a tela de Login?

## 3. Tela Home e Indicadores
- [ ] Os valores de "Total Fretes", "Comissão" e "Saldo" carregam após o login?
- [ ] O `RefreshIndicator` (puxar para baixo) atualiza os valores?

## 4. Lançamentos
- [ ] **Frete:** Registrar um novo frete reflete no total da Home?
- [ ] **Despesa:** Tentar salvar sem tirar foto bloqueia o botão?
- [ ] **Foto:** Tirar foto e salvar funciona? A imagem aparece no console do Supabase Storage?
- [ ] **Fluxo Completo:** Abastecimentos e Vales também registram corretamente?

## 5. Offline e Sincronização
- [ ] **Modo Avião:** Tente salvar uma despesa sem internet. O App deve dizer que salvou localmente.
- [ ] **Sincronização:** Ao ligar a internet, a tarefa do WorkManager sincroniza os dados? (Pode levar alguns minutos ou você pode forçar o sync chamando `OfflineSync.syncPendingTasks()` em um botão de teste).

## 6. Histórico
- [ ] A tela de histórico permite filtrar entre as 4 categorias e mostra os valores corretos?

---
**Dica:** Verifique os logs do seu Backend Node.js enquanto usa o App para ver as requisições chegando em tempo real.
