-- Migration 019: Modalidade de cálculo (valor fixo | tonelada/km) e paths de
-- foto de odômetro nos fretes.
-- Rodar no Supabase SQL Editor (sem rollback automático). NÃO aplicada por código.
--
-- Contexto: base para o piloto de frete por tonelada/km e para as fotos
-- obrigatórias de odômetro. Este PR (PR-1) usa apenas os campos de modalidade e
-- de tonelada/km; as colunas *_path de foto entram já aqui para que o PR-2
-- (bucket privado `fretes-odometro` + upload) seja somente código, sem novo ALTER.
--
-- Modelo:
--   * modalidade_calculo: 'valor_fixo' (padrão, todo frete atual) ou 'tonelada_km'.
--   * toneladas / valor_tonelada_km: usados só na modalidade tonelada_km.
--   * km_inicial / km_final JÁ EXISTEM (não recriados aqui). km_total é derivado
--     (km_final - km_inicial), não persistido, para não duplicar fonte de verdade.
--   * valor_frete JÁ EXISTE: continua digitado no valor_fixo; na modalidade
--     tonelada_km é CALCULADO na finalização = toneladas * (km_final - km_inicial)
--     * valor_tonelada_km.
--   * foto_odometro_inicial_path / foto_odometro_final_path: caminho no bucket
--     PRIVADO (PR-2). Guardamos o PATH, não URL pública; a exibição usa signed URL.
--
-- Compatibilidade (não quebra dados existentes):
--   * modalidade_calculo NOT NULL DEFAULT 'valor_fixo' → todo frete antigo vira
--     'valor_fixo' automaticamente e segue válido;
--   * demais colunas NULLABLE → nada a preencher em linhas antigas;
--   * CHECK só rejeita valores inválidos em escritas novas.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Não altera dados, não toca RLS.

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS modalidade_calculo TEXT NOT NULL DEFAULT 'valor_fixo';

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS toneladas NUMERIC(10,3);

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS valor_tonelada_km NUMERIC(12,4);

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS foto_odometro_inicial_path TEXT;

ALTER TABLE fretes
  ADD COLUMN IF NOT EXISTS foto_odometro_final_path TEXT;

-- Restrições de integridade (idempotentes via DO/exception): modalidade dentro do
-- domínio; toneladas e valor_tonelada_km positivos quando presentes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_modalidade_calculo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_modalidade_calculo_check
      CHECK (modalidade_calculo IN ('valor_fixo', 'tonelada_km'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_toneladas_positivo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_toneladas_positivo_check
      CHECK (toneladas IS NULL OR toneladas > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fretes_valor_tonelada_km_positivo_check'
  ) THEN
    ALTER TABLE fretes
      ADD CONSTRAINT fretes_valor_tonelada_km_positivo_check
      CHECK (valor_tonelada_km IS NULL OR valor_tonelada_km > 0);
  END IF;
END $$;
