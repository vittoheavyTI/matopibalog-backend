// Pré-validação PURA do cadastro mínimo que o Asaas exige para criar customer:
// nome + CPF/CNPJ (11 ou 14 dígitos) + e-mail válido. Fonte única de verdade —
// garantirCustomer (asaasSubscriptionService) aplica exatamente esta regra.
//
// POR QUE EXISTE: a coreografia reserva-primeiro cria a fatura local ANTES de
// falar com o Asaas. Se o cadastro está incompleto, garantirCustomer recusa
// DEPOIS da reserva → fatura local órfã (sem asaas_id, impagável). Chamar esta
// validação ANTES da reserva impede a órfã: sem cadastro mínimo, nenhum insert.
// Só se aplica quando a empresa ainda NÃO tem asaas_customer_id — com customer
// existente não há nada a validar.

function soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

function emailValido(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const MOTIVO_CADASTRO_INCOMPLETO = 'cadastro_incompleto';

// Retorna { ok, motivo, camposFaltantes }. Nunca lança; nunca loga PII.
function validarCadastroAsaasEmpresa(empresa) {
  const e = empresa || {};
  const camposFaltantes = [];

  const nome = typeof e.nome === 'string' ? e.nome.trim() : '';
  if (!nome) camposFaltantes.push('nome');

  const doc = soDigitos(e.cnpj);
  if (doc.length !== 11 && doc.length !== 14) camposFaltantes.push('cpf_cnpj');

  if (!emailValido(e.email_contato)) camposFaltantes.push('email_contato');

  if (camposFaltantes.length > 0) {
    return { ok: false, motivo: MOTIVO_CADASTRO_INCOMPLETO, camposFaltantes };
  }
  return { ok: true, motivo: null, camposFaltantes: [] };
}

// A empresa está pronta para COBRANÇA? Com customer já criado, sim; sem
// customer, só se o cadastro mínimo permitir criá-lo.
function podeCriarCobranca(empresa) {
  if (empresa && empresa.asaas_customer_id) return { ok: true, motivo: null, camposFaltantes: [] };
  return validarCadastroAsaasEmpresa(empresa);
}

module.exports = {
  soDigitos,
  emailValido,
  validarCadastroAsaasEmpresa,
  podeCriarCobranca,
  MOTIVO_CADASTRO_INCOMPLETO,
};
