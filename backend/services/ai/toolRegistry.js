'use strict';

// Tool Registry determinístico do AI Copilot V1.
//
// O modelo só pode chamar tools REGISTRADAS (allowlist). Cada tool declara a
// permissão/entitlement exigidos — os MESMOS de um read normal do produto — e o
// registry os checa com a autoridade do servidor. Tenant/scope vêm do contexto
// autenticado (nunca de argumento do modelo, §24). Sem SQL/HTTP/eval dinâmico.

const { LIMITS } = require('./config');

const _tools = new Map();

function registerTool(def) {
  if (!def || !def.name || typeof def.handler !== 'function') {
    throw new Error('Tool inválida: exige name e handler.');
  }
  _tools.set(def.name, {
    name: def.name,
    description: def.description || '',
    inputSchema: def.inputSchema || { type: 'object', properties: {} },
    requiredPermission: def.requiredPermission || null,
    requiredEntitlement: def.requiredEntitlement || null,
    timeoutMs: def.timeoutMs || LIMITS.TOOL_TIMEOUT_MS,
    handler: def.handler,
    sanitizer: def.sanitizer || null,
  });
}

function getTool(name) { return _tools.get(name) || null; }
function listTools() { return [..._tools.values()]; }
function clear() { _tools.clear(); }

// Especificação das tools para o provider (sem handler/sanitizer).
function toolSpecs() {
  return listTools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

// Autoridade: super-admin passa; senão exige a permissão efetiva e o entitlement.
function hasPermission(ctx, key) {
  if (!key) return true;
  if (ctx.isSuperAdmin) return true;
  return Boolean(ctx.effectivePermissions && ctx.effectivePermissions[key] === true);
}
function hasEntitlement(ctx, key) {
  if (!key) return true;
  if (ctx.isSuperAdmin) return true;
  return typeof ctx.hasEntitlement === 'function' ? Boolean(ctx.hasEntitlement(key)) : true;
}

// Sanitização defensiva (§63): remove chaves sensíveis e URLs assinadas em
// profundidade. Tools já devem projetar só campos seguros; isto é defesa extra.
const SENSITIVE_KEY = /(token|secret|api[_-]?key|authorization|password|senha|signed|service_role)/i;
function sanitizeDeep(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') {
    // Redige URLs assinadas de storage (?token=, X-Amz-Signature, etc.).
    if (/https?:\/\/\S+(token=|signature=|x-amz-|se=)/i.test(value)) return '[redacted-url]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue; }
      out[k] = sanitizeDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()); } }, ms);
    Promise.resolve(promise).then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(t); resolve({ __error: e }); } },
    );
  });
}

// Executa uma tool com toda a autoridade + envelope estável.
// Retorna sempre { ok, data|null, evidence[], warnings[], truncated, error? }.
async function executeTool(name, args, ctx) {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, error: 'unknown_tool', data: null, evidence: [], warnings: ['Ferramenta não reconhecida.'], truncated: false };
  }
  if (!hasPermission(ctx, tool.requiredPermission)) {
    return { ok: false, error: 'permission_denied', data: null, evidence: [], warnings: ['Sem permissão para esta consulta.'], truncated: false };
  }
  if (!hasEntitlement(ctx, tool.requiredEntitlement)) {
    return { ok: false, error: 'entitlement_denied', data: null, evidence: [], warnings: ['Recurso não incluído no plano.'], truncated: false };
  }

  const safeArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  const result = await withTimeout(
    tool.handler(ctx, safeArgs),
    tool.timeoutMs,
    () => ({ __timeout: true }),
  );

  if (result && result.__timeout) {
    return { ok: false, error: 'tool_timeout', data: null, evidence: [], warnings: ['A consulta demorou demais.'], truncated: false };
  }
  if (result && result.__error) {
    // NUNCA vaza stack/erro cru ao modelo/usuário.
    return { ok: false, error: 'tool_error', data: null, evidence: [], warnings: ['Não foi possível concluir a consulta.'], truncated: false };
  }

  const envelope = {
    ok: result?.ok !== false,
    data: sanitizeDeep(result?.data ?? null),
    evidence: Array.isArray(result?.evidence) ? result.evidence : [],
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    truncated: result?.truncated === true,
  };
  if (tool.sanitizer) return tool.sanitizer(envelope);
  return envelope;
}

module.exports = {
  registerTool, getTool, listTools, clear, toolSpecs,
  executeTool, sanitizeDeep, hasPermission, hasEntitlement,
};
