export const OPERATIONAL_GROUP_CONTEXT_KEY = 'matopibalog_operational_group_context';
export const OPERATIONAL_UNIT_CONTEXT_KEY = 'matopibalog_operational_unit_context';

export function lerGrupoOperacional(): string {
  return localStorage.getItem(OPERATIONAL_GROUP_CONTEXT_KEY) || '';
}

export function lerUnidadeOperacional(): string {
  return localStorage.getItem(OPERATIONAL_UNIT_CONTEXT_KEY) || '';
}

export function gravarGrupoOperacional(grupoId: string) {
  if (grupoId) localStorage.setItem(OPERATIONAL_GROUP_CONTEXT_KEY, grupoId);
  else localStorage.removeItem(OPERATIONAL_GROUP_CONTEXT_KEY);
}

export function gravarUnidadeOperacional(unidadeId: string) {
  if (unidadeId) localStorage.setItem(OPERATIONAL_UNIT_CONTEXT_KEY, unidadeId);
  else localStorage.removeItem(OPERATIONAL_UNIT_CONTEXT_KEY);
}

export function limparContextoOperacional() {
  localStorage.removeItem(OPERATIONAL_GROUP_CONTEXT_KEY);
  localStorage.removeItem(OPERATIONAL_UNIT_CONTEXT_KEY);
}

export function montarHeadersContextoOperacional(): Record<string, string> {
  const headers: Record<string, string> = {};
  const grupoId = lerGrupoOperacional();
  const unidadeId = lerUnidadeOperacional();
  if (grupoId) headers['X-Operational-Group-Id'] = grupoId;
  if (unidadeId) headers['X-Operational-Unit-Id'] = unidadeId;
  return headers;
}
