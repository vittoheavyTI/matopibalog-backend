-- 037_archive_test_companies.sql
-- Mega-frente de higiene operacional — arquivamento das CONTAS DE TESTE.
--
-- ⚠️ NÃO APLICAR AUTOMATICAMENTE. Todo o DML está COMENTADO. Rodar bloco a bloco,
-- com autorização explícita, DEPOIS de a migration 036 (colunas de arquivamento)
-- estar aplicada e DEPOIS de conferir a lista de IDs no banco real (a lista de
-- nomes abaixo é ponto de partida; o alvo do UPDATE são IDs EXPLÍCITOS que você
-- confirma no Bloco A).
--
-- GARANTIAS DESTE SCRIPT:
--   * NENHUM DELETE — só UPDATE de arquivada_em/motivo/por (reversível);
--   * NENHUMA fatura/assinatura tocada;
--   * KEEPERS excluídos por construção (guarda por nome E por id);
--   * candidatos COM fatura paga ou assinatura Asaas NÃO entram no Bloco B
--     (vão para o Bloco C, hard stop separado);
--   * snapshot/auditoria antes de qualquer UPDATE (Bloco A);
--   * rollback trivial (Bloco E).
--
-- Depende de: 036_add_empresas_arquivamento.sql (colunas arquivada_em/motivo/por).

-- ─────────────────────────────────────────────────────────────────────────────
-- REFERÊNCIA — classificação (revalidar SEMPRE por dados antes de arquivar):
--
-- KEEPERS (NUNCA arquivar):
--   Empresa Alfa, José Motora Autônomo, MATOPIBA ASSINATURA SANDBOX 01,
--   INFRA TRANSP TESTE, E2E EMPRESA TESTE BASICO, Transportadora Bravo,
--   Matopiba Log Admin (plataforma/super-admin).
--
-- CANDIDATOS A ARQUIVAR (teste/lixo):
--   Autônomo Test com Admin, Ricardo Autônomo, Teste Autônomo 5,
--   Teste Autônomo com Adm, Codex Transportadora, Codex Notif Auto (x2),
--   teste, Teste Autônomo, Motorista A1, Not Teste Pixxx, Planeta X,
--   Empresa Charlie, 000000000:):), João Motora, Pedro Motora Bravo.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ BLOCO A — AUDITORIA / SNAPSHOT + PREVIEW (rodar e CONFERIR primeiro) ═════
-- A.1 Tabela de auditoria (idempotente).
/*
CREATE TABLE IF NOT EXISTS empresas_arquivamento_auditoria (
  id            bigserial PRIMARY KEY,
  empresa_id    uuid        NOT NULL,
  snapshot      jsonb       NOT NULL,   -- estado completo da empresa antes de arquivar
  motivo        text,
  arquivado_em  timestamptz NOT NULL DEFAULT now()
);
*/

-- A.2 PREVIEW dos candidatos REAIS no banco: casa os nomes candidatos, marca
--     quem tem fatura paga e/ou assinatura Asaas (esses NÃO entram no Bloco B).
--     Rode e COPIE os `id` seguros (sem paga e sem assinatura) para o Bloco B.
/*
SELECT e.id, e.nome, e.tipo, e.status,
       (e.asaas_subscription_id IS NOT NULL)                         AS tem_assinatura,
       EXISTS (SELECT 1 FROM faturas f WHERE f.empresa_id = e.id AND f.status = 'pago') AS tem_fatura_paga,
       e.arquivada_em
FROM empresas e
WHERE e.nome IN (
        'Autônomo Test com Admin','Ricardo Autônomo','Teste Autônomo 5',
        'Teste Autônomo com Adm','Codex Transportadora','Codex Notif Auto',
        'teste','Teste Autônomo','Motorista A1','Not Teste Pixxx','Planeta X',
        'Empresa Charlie','000000000:):)','João Motora','Pedro Motora Bravo'
      )
  -- guarda dura: NUNCA um keeper, mesmo que um nome colida
  AND e.nome NOT IN (
        'Empresa Alfa','José Motora Autônomo','MATOPIBA ASSINATURA SANDBOX 01',
        'INFRA TRANSP TESTE','E2E EMPRESA TESTE BASICO','Transportadora Bravo',
        'Matopiba Log Admin'
      )
ORDER BY tem_fatura_paga DESC, tem_assinatura DESC, e.nome;
*/


-- ═══ BLOCO B — ARQUIVAR os candidatos SEGUROS (sem paga, sem assinatura) ═════
-- Preencha a lista de IDs EXPLÍCITOS com o resultado do Bloco A.2 onde
-- tem_fatura_paga=false E tem_assinatura=false. NÃO arquive por nome solto.
--
-- >>> PREENCHER: substitua os UUIDs abaixo pelos IDs conferidos no Bloco A. <<<
/*
-- B.1 snapshot ANTES de alterar
INSERT INTO empresas_arquivamento_auditoria (empresa_id, snapshot, motivo)
SELECT e.id, to_jsonb(e.*), 'higiene: conta de teste'
FROM empresas e
WHERE e.id IN (
  '00000000-0000-0000-0000-000000000000'  -- <substituir> exemplo; remover
  -- , '<uuid-2>', '<uuid-3>', ...
)
AND e.arquivada_em IS NULL;

-- B.2 arquivar (só os mesmos IDs; guardas redundantes de segurança)
UPDATE empresas e
SET arquivada_em = now(),
    arquivada_motivo = 'higiene: conta de teste',
    arquivada_por = NULL   -- ou o uuid do super-admin que autorizou
WHERE e.id IN (
  '00000000-0000-0000-0000-000000000000'  -- <substituir> a MESMA lista do B.1
)
AND e.arquivada_em IS NULL
AND e.nome NOT IN (
      'Empresa Alfa','José Motora Autônomo','MATOPIBA ASSINATURA SANDBOX 01',
      'INFRA TRANSP TESTE','E2E EMPRESA TESTE BASICO','Transportadora Bravo',
      'Matopiba Log Admin')
AND e.asaas_subscription_id IS NULL
AND NOT EXISTS (SELECT 1 FROM faturas f WHERE f.empresa_id = e.id AND f.status = 'pago');
*/


-- ═══ BLOCO C — HARD STOP: candidatos com assinatura Asaas ou fatura paga ═════
-- Se o Bloco A.2 mostrar candidato com tem_assinatura=true ou tem_fatura_paga=true,
-- ele NÃO é arquivado aqui. Decida caso a caso:
--   * assinatura sandbox → ver docs/RUNBOOK_HIGIENE_ASAAS_SANDBOX.md (cancelar só
--     com autorização explícita; arquivar a empresa NÃO cancela a assinatura);
--   * fatura paga → é histórico financeiro; arquivar a empresa preserva a fatura,
--     mas confirme que não é um cliente real antes.
-- Nenhum comando automático aqui de propósito.


-- ═══ BLOCO D — VALIDAÇÃO (rodar depois do Bloco B) ══════════════════════════
/*
-- D.1 quantas arquivadas agora
SELECT count(*) AS arquivadas FROM empresas WHERE arquivada_em IS NOT NULL;

-- D.2 conferir que NENHUM keeper foi arquivado (esperado: 0 linhas)
SELECT id, nome FROM empresas
WHERE arquivada_em IS NOT NULL
  AND nome IN ('Empresa Alfa','José Motora Autônomo','MATOPIBA ASSINATURA SANDBOX 01',
               'INFRA TRANSP TESTE','E2E EMPRESA TESTE BASICO','Transportadora Bravo',
               'Matopiba Log Admin');

-- D.3 gate financeiro inalterado (comparar com o baseline pré-arquivamento)
SELECT
  count(*)                                        AS total,
  count(*) FILTER (WHERE status = 'pago')         AS pagas,
  coalesce(sum(valor) FILTER (WHERE status='pago'),0) AS total_pago,
  count(*) FILTER (WHERE status IN ('pendente','vencido')) AS abertas,
  count(*) FILTER (WHERE status = 'cancelado')    AS canceladas
FROM faturas;

-- D.4 nenhuma arquivada com fatura paga sem intenção (sinal — revisar se > 0)
SELECT e.id, e.nome FROM empresas e
WHERE e.arquivada_em IS NOT NULL
  AND EXISTS (SELECT 1 FROM faturas f WHERE f.empresa_id = e.id AND f.status = 'pago');
*/


-- ═══ BLOCO E — ROLLBACK (desarquivar tudo que este script arquivou) ═════════
/*
UPDATE empresas
SET arquivada_em = NULL, arquivada_motivo = NULL, arquivada_por = NULL
WHERE id IN (SELECT empresa_id FROM empresas_arquivamento_auditoria);
-- (opcional) DROP TABLE IF EXISTS empresas_arquivamento_auditoria;
*/
