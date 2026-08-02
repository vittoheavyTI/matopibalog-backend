declare module 'date-fns' {
  export function format(date: Date | number | string, formatStr: string, options?: unknown): string;
  export function startOfMonth(date: Date | number | string): Date;
  export function endOfMonth(date: Date | number | string): Date;
  export function startOfYear(date: Date | number | string): Date;
  export function endOfYear(date: Date | number | string): Date;
}

declare module 'date-fns/locale' {
  export const ptBR: unknown;
}
