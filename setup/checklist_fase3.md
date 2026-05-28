# Checklist de Validação: Fase 3 (API de Movimentações)

Execute estes testes manuais (usando Postman ou Insomnia) para validar a implementação da Fase 3.

## Fretes
- [ ] `POST /fretes`: O objeto retornado contém `comissao_calculada`?
- [ ] `POST /fretes`: Retorna `403` se o motorista estiver 'pendente' ou 'bloqueado'?
- [ ] `GET /fretes`: Motorista vê apenas seus próprios fretes? Admin vê todos?

## Despesas, Abastecimentos e Vales
- [ ] `POST /despesas`: Retorna `400` se o campo `foto` estiver vazio?
- [ ] `POST /despesas`: O link em `foto_url` abre corretamente a imagem no Supabase Storage? (Verifique se o bucket `comprovantes` está configurado).
- [ ] `POST /abastecimentos`: Os campos `arla_litros` e `arla_valor` são gravados corretamente?

## Dashboard (Admin Only)
- [ ] `GET /dashboard/summary?mes=MM&ano=AAAA`: Os totais de `deducoes` somam corretamente despesas/abastecimentos onde `quem_pagou = 'proprietario'`?
- [ ] `GET /dashboard/summary`: O `saldo_a_pagar` é igual a `total_comissoes - total_deducoes`?

## Relatórios (Admin Only)
- [ ] `GET /relatorios/ficha-viagem`: Retorna todos os fretes, despesas e abastecimentos vinculados aos IDs passados?
- [ ] `GET /relatorios/ficha-viagem`: Os totais do resumo batem com a soma dos itens?

---
**Importante:** Certifique-se de que o bucket `comprovantes` no Supabase Storage tenha permissões de leitura pública ou políticas RLS de leitura para usuários autenticados para que as `foto_url` funcionem.
