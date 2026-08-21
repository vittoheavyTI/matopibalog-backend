// driverFinancialRedaction.js — Redação de campos financeiros do frete para o
// motorista, conforme a VISIBILITY POLICY (P2, Section 33). É SEGURANÇA DE DADOS:
// os campos são OMITIDOS da resposta do backend (não basta esconder no app).
//
// Campos financeiros do frete: valor_frete (bruto), valor_tonelada_km, toneladas.
// Comissão = valor_frete * (percentual_comissao/100) — derivada.
//
// Modos:
//   commission_only        → só a comissão do motorista + percentual; sem bruto.
//   commission_plus_base   → comissão + valor-base (valor_frete) usado no cálculo.
//   full_freight_financial → todos os campos autorizados (sem redação).

'use strict';

const { DRIVER_FINANCIAL_VISIBILITY } = require('./permissionRegistry');

const GROSS_FIELDS = ['valor_frete', 'valor_tonelada_km', 'toneladas'];

/**
 * @param {object} frete            objeto do frete (será clonado, não mutado)
 * @param {string} mode             commission_only|commission_plus_base|full_freight_financial
 * @param {number|null} percentualComissao  % de comissão do motorista (motoristas.percentual_comissao)
 * @returns {object} frete redigido para o motorista
 */
function redactFreteForDriver(frete, mode, percentualComissao = null) {
  if (!frete || typeof frete !== 'object') return frete;
  const out = { ...frete };

  const valorFrete = toNumber(frete.valor_frete);
  const pct = toNumber(percentualComissao);
  const comissao = (valorFrete != null && pct != null) ? round2(valorFrete * (pct / 100)) : null;

  // sempre expõe a comissão derivada (o que o motorista precisa do próprio acerto)
  out.comissao_percentual = pct;
  out.comissao_valor = comissao;

  if (mode === DRIVER_FINANCIAL_VISIBILITY.FULL_FREIGHT_FINANCIAL) {
    return out; // sem redação
  }

  if (mode === DRIVER_FINANCIAL_VISIBILITY.COMMISSION_PLUS_BASE) {
    // mantém valor_frete (base do cálculo); remove os demais brutos de precificação
    for (const f of GROSS_FIELDS) {
      if (f !== 'valor_frete') delete out[f];
    }
    return out;
  }

  // COMMISSION_ONLY (default): remove todos os brutos.
  for (const f of GROSS_FIELDS) delete out[f];
  return out;
}

/** Redige uma lista de fretes (mesmo modo/percentual). */
function redactFretesForDriver(fretes, mode, percentualComissao = null) {
  if (!Array.isArray(fretes)) return fretes;
  return fretes.map((f) => redactFreteForDriver(f, mode, percentualComissao));
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = { redactFreteForDriver, redactFretesForDriver, GROSS_FIELDS };
