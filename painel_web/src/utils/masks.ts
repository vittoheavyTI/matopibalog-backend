// ============================================================
// Utilitário de Máscaras — Matopiba Log
// Aplicar como onChange: e => setField(maskPhone(e.target.value))
// ============================================================

/**
 * Máscara de telefone brasileiro
 * Celular (11 dígitos): (00) 0 0000-0000
 * Fixo   (10 dígitos): (00) 0000-0000
 */
export const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2)  return `(${digits}`;
  if (digits.length <= 6)  return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  // 11 dígitos: celular com 9
  return `(${digits.slice(0,2)}) ${digits.slice(2,3)} ${digits.slice(3,7)}-${digits.slice(7,11)}`;
};

/**
 * Máscara de CNPJ: 00.000.000/0000-00
 */
export const maskCNPJ = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length === 0) return '';
  if (digits.length <= 2)  return digits;
  if (digits.length <= 5)  return `${digits.slice(0,2)}.${digits.slice(2)}`;
  if (digits.length <= 8)  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`;
};

/**
 * Máscara de CPF: 000.000.000-00
 */
export const maskCPF = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 3)  return digits;
  if (digits.length <= 6)  return `${digits.slice(0,3)}.${digits.slice(3)}`;
  if (digits.length <= 9)  return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
  return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9,11)}`;
};

/**
 * Máscara de CEP: 00000-000
 */
export const maskCEP = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length === 0) return '';
  if (digits.length <= 5)  return digits;
  return `${digits.slice(0,5)}-${digits.slice(5,8)}`;
};
