-- Migration 012: Adiciona campos de resolução de pendência em lançamentos
-- Rodar no Supabase SQL Editor (sem rollback automático).
--
-- Quando admin/empresa resolve uma pendência (aprova ou rejeita com nota),
-- registra obs_resolucao, resolvido_por e resolvido_em.

ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS obs_resolucao TEXT,
  ADD COLUMN IF NOT EXISTS resolvido_por UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMP WITH TIME ZONE;

ALTER TABLE abastecimentos
  ADD COLUMN IF NOT EXISTS obs_resolucao TEXT,
  ADD COLUMN IF NOT EXISTS resolvido_por UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMP WITH TIME ZONE;

ALTER TABLE vales
  ADD COLUMN IF NOT EXISTS obs_resolucao TEXT,
  ADD COLUMN IF NOT EXISTS resolvido_por UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMP WITH TIME ZONE;
