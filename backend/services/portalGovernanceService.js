const { resolverEntitlement } = require('./entitlementDomainService');

const CODIGOS_PORTAL = Object.freeze({
  estrutura_operacional: 'estrutura_operacional',
  integracoes_erp: 'integracoes_erp',
  acesso_corporativo_sso: 'acesso_corporativo_sso',
  fleet: 'fleet',
  operation_campaign: 'operation_campaign',
});

const PERMISSOES_PORTAL = Object.freeze({
  perfil: 'perfil.editar',
  empresa: 'empresa.configuracoes.gerenciar',
  usuarios: 'usuarios.permissoes.gerenciar',
  estrutura_operacional: 'estrutura_operacional.gerenciar',
  integracoes_erp: 'integracoes_erp.gerenciar',
  acesso_corporativo_sso: 'acesso_corporativo_sso.gerenciar',
});

function permissaoUsuario(usuario, codigo) {
  if (!usuario) return false;
  if (usuario.is_super_admin === true) return true;
  const role = usuario.tipo || usuario.role;
  if (role !== 'admin') return codigo === PERMISSOES_PORTAL.perfil;

  const p = usuario.permissoes || {};
  if (p[codigo] === true) return true;
  if (p[codigo] === false) return false;

  if (codigo === PERMISSOES_PORTAL.perfil) return true;
  if (codigo === PERMISSOES_PORTAL.empresa) return p.configuracoes !== false;
  if (codigo === PERMISSOES_PORTAL.usuarios) return p.usuarios === true;
  if (codigo === PERMISSOES_PORTAL.estrutura_operacional) return p.configuracoes !== false;
  if (codigo === PERMISSOES_PORTAL.integracoes_erp) return p.configuracoes !== false;
  if (codigo === PERMISSOES_PORTAL.acesso_corporativo_sso) return p.configuracoes !== false;
  return false;
}

// Direito comercial de uma funcionalidade para a empresa, SEM I/O e independente
// do status técnico: override ativo da empresa > disponibilidade do plano >
// 'indisponivel'. Usado só para VISIBILIDADE/copy no portal (nunca autoriza uso).
function disponibilidadeComercial(planoFunc, empresaFunc, agora = new Date()) {
  const overrideVigente = empresaFunc && empresaFunc.status === 'ativa'
    && (!empresaFunc.vigencia_inicio || new Date(empresaFunc.vigencia_inicio) <= agora)
    && (!empresaFunc.vigencia_fim || new Date(empresaFunc.vigencia_fim) >= agora);
  if (overrideVigente) return 'incluida';
  if (planoFunc && planoFunc.disponibilidade) return planoFunc.disponibilidade;
  return 'indisponivel';
}

function respostaFallback({ usuario, motivo = 'catalogo_indisponivel' } = {}) {
  const permissoes = Object.fromEntries(
    Object.entries(PERMISSOES_PORTAL).map(([k, codigo]) => [k, permissaoUsuario(usuario, codigo)])
  );
  return {
    permissoes,
    entitlements: Object.fromEntries(Object.keys(CODIGOS_PORTAL).map((k) => [
      k,
      {
        codigo: CODIGOS_PORTAL[k],
        permitido: false,
        origem: null,
        disponibilidade: null,
        disponibilidade_comercial: 'indisponivel',
        motivo,
        proxima_acao: 'ver_planos',
      },
    ])),
    integracoes: {
      erp: { configurado: false, modo: 'assistido' },
      sso: { configurado: false, modo: 'assistido' },
    },
  };
}

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    /does not exist|could not find|schema cache/i.test(error.message || '')
  );
}

async function carregarPortalGovernanca(supabase, { empresaId, usuarioId, user } = {}) {
  let usuario = {
    id: usuarioId || user?.uid || null,
    tipo: user?.role || user?.tipo || null,
    is_super_admin: user?.is_super_admin === true,
    empresa_id: empresaId || user?.empresa_id || null,
    permissoes: user?.permissoes || null,
  };

  try {
    if (usuario.id) {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, tipo, is_super_admin, empresa_id, permissoes')
        .eq('id', usuario.id)
        .maybeSingle();
      if (!error && data) usuario = { ...usuario, ...data };
    }

    const resolvedEmpresaId = empresaId || usuario.empresa_id || null;
    const permissoes = Object.fromEntries(
      Object.entries(PERMISSOES_PORTAL).map(([k, codigo]) => [k, permissaoUsuario(usuario, codigo)])
    );

    if (usuario.is_super_admin === true) {
      return {
        permissoes,
        entitlements: Object.fromEntries(Object.keys(CODIGOS_PORTAL).map((k) => [
          k,
          { codigo: CODIGOS_PORTAL[k], permitido: true, origem: 'super_admin', disponibilidade: 'incluida', disponibilidade_comercial: 'incluida', motivo: null, proxima_acao: null },
        ])),
        integracoes: {
          erp: { configurado: false, modo: 'super_admin' },
          sso: { configurado: false, modo: 'super_admin' },
        },
      };
    }

    if (!resolvedEmpresaId) return respostaFallback({ usuario, motivo: 'empresa_indisponivel' });

    const { data: empresa, error: empresaError } = await supabase
      .from('empresas')
      .select('id, plano_id, config_empresa')
      .eq('id', resolvedEmpresaId)
      .maybeSingle();
    if (empresaError || !empresa) return respostaFallback({ usuario, motivo: 'empresa_indisponivel' });

    const codigos = Object.values(CODIGOS_PORTAL);
    const { data: funcionalidades, error: fError } = await supabase
      .from('funcionalidades')
      .select('*')
      .in('codigo', codigos);
    if (fError) {
      if (tabelaAusente(fError)) return respostaFallback({ usuario });
      throw fError;
    }

    const porCodigo = new Map((funcionalidades || []).map((f) => [f.codigo, f]));
    const ids = (funcionalidades || []).map((f) => f.id).filter(Boolean);

    let planoFuncs = [];
    if (empresa.plano_id && ids.length) {
      const { data, error } = await supabase
        .from('plano_funcionalidades')
        .select('*')
        .eq('plano_id', empresa.plano_id)
        .in('funcionalidade_id', ids);
      if (error) {
        if (!tabelaAusente(error)) throw error;
      } else {
        planoFuncs = data || [];
      }
    }

    let empresaFuncs = [];
    if (ids.length) {
      const { data, error } = await supabase
        .from('empresa_funcionalidades')
        .select('*')
        .eq('empresa_id', resolvedEmpresaId)
        .in('funcionalidade_id', ids);
      if (error) {
        if (!tabelaAusente(error)) throw error;
      } else {
        empresaFuncs = data || [];
      }
    }

    const pfPorFunc = new Map(planoFuncs.map((pf) => [pf.funcionalidade_id, pf]));
    const efPorFunc = new Map(empresaFuncs.map((ef) => [ef.funcionalidade_id, ef]));
    const entitlements = {};

    for (const [chave, codigo] of Object.entries(CODIGOS_PORTAL)) {
      const funcionalidade = porCodigo.get(codigo) || null;
      const papelPermitido = chave === 'fleet' || chave === 'operation_campaign'
        ? true
        : permissaoUsuario(usuario, PERMISSOES_PORTAL[chave]);
      const planoFunc = funcionalidade ? pfPorFunc.get(funcionalidade.id) : null;
      const empresaFunc = funcionalidade ? efPorFunc.get(funcionalidade.id) : null;
      entitlements[chave] = resolverEntitlement({
        codigo,
        funcionalidade,
        planoFunc,
        empresaFunc,
        papelPermitido,
      });
      // DIREITO COMERCIAL do plano (independente do STATUS TÉCNICO). Para ERP/SSO
      // o resolver nega o USO real (nao_implementada), mas a UI ainda precisa saber
      // se o recurso está previsto no plano (opcional_paga/incluida) ou não
      // (indisponivel) para decidir se mostra a aba e com qual copy. Nunca implica
      // conexão real — apenas visibilidade/mensagem comercial honesta.
      entitlements[chave].disponibilidade_comercial = disponibilidadeComercial(planoFunc, empresaFunc);
    }

    const configEmpresa = empresa.config_empresa && typeof empresa.config_empresa === 'object'
      ? empresa.config_empresa
      : {};

    return {
      permissoes,
      entitlements,
      integracoes: {
        erp: {
          configurado: Boolean(configEmpresa.erp?.configurado),
          modo: configEmpresa.erp?.modo || 'assistido',
        },
        sso: {
          configurado: Boolean(configEmpresa.sso?.configurado),
          modo: configEmpresa.sso?.modo || 'assistido',
        },
      },
    };
  } catch (error) {
    if (tabelaAusente(error)) return respostaFallback({ usuario });
    throw error;
  }
}

module.exports = {
  CODIGOS_PORTAL,
  PERMISSOES_PORTAL,
  permissaoUsuario,
  carregarPortalGovernanca,
};
