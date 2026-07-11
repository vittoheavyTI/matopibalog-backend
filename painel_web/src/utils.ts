export const formatCurrency = (value: number) => {
  const num = Number(value);
  if (isNaN(num)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(num);
};

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export const extractCivilDate = (value?: string | null): string | null => {
  if (!value) return null;
  const match = String(value).match(CIVIL_DATE_PATTERN);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);

  return valid ? `${year}-${month}-${day}` : null;
};

export const formatCivilDate = (value?: string | null): string => {
  const civilDate = extractCivilDate(value);
  if (!civilDate) return '—';
  const [year, month, day] = civilDate.split('-');
  return `${day}/${month}/${year}`;
};

export const compareCivilDates = (a?: string | null, b?: string | null): number => {
  const dateA = extractCivilDate(a);
  const dateB = extractCivilDate(b);
  if (!dateA && !dateB) return 0;
  if (!dateA) return 1;
  if (!dateB) return -1;
  return dateA.localeCompare(dateB);
};

export const civilDateToDayNumber = (value?: string | null): number | null => {
  const civilDate = extractCivilDate(value);
  if (!civilDate) return null;
  const [year, month, day] = civilDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
};

export const todayInBahia = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

export const formatTechnicalDate = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia',
  }).format(date);
};

export interface RecurringContractAccount {
  status?: string | null;
  billing_status?: string | null;
  asaas_subscription_id?: string | null;
  planos?: { preco_mensal?: number | string | null } | null;
}

// Fonte temporária: o valor contratado ainda não é versionado fora do plano vigente.
export const getContractMonthlyPrice = (account: RecurringContractAccount): number => {
  const price = Number(account.planos?.preco_mensal ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
};

export const hasActiveRecurringContract = (account: RecurringContractAccount): boolean => (
  account.status === 'ativo'
  && account.billing_status === 'ativo'
  && Boolean(String(account.asaas_subscription_id || '').trim())
  && getContractMonthlyPrice(account) > 0
);

export const getActiveRecurringContracts = <T extends RecurringContractAccount>(accounts: T[]): T[] => (
  accounts.filter(hasActiveRecurringContract)
);

export const calculateContractedMrr = (accounts: RecurringContractAccount[]): number => (
  getActiveRecurringContracts(accounts).reduce((total, account) => total + getContractMonthlyPrice(account), 0)
);
