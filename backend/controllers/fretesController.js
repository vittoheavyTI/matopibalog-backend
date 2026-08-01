const supabase = require('../config/supabase');
const notificacaoService = require('../services/notificacaoService');
const { calcularComissao } = require('../utils/comissao');
const { normalizarModalidade, calcularValorToneladaKm } = require('../utils/calculoFrete');
const { validarLimitesFrete } = require('../utils/limitesFrete');

const BUCKET_ODOMETRO = 'fretes-odometro';
const SIGNED_URL_TTL_SECONDS = 300;
const EXTENSAO_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const acessoPermitidoAoFrete = (req, frete) => {
  if (req.user.is_super_admin === true) return true;
  if (req.user.role === 'admin') return frete.empresa_id === req.empresa_id;
  return frete.motorista_id === req.user.uid;
};

const campoPathOdometro = (tipo) => tipo === 'inicial'
  ? 'foto_odometro_inicial_path'
  : tipo === 'final'
    ? 'foto_odometro_final_path'
    : null;

const criarSignedUrlOdometro = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET_ODOMETRO)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data?.signedUrl || data?.signedURL || null;
};

const uploadOdometro = async (req, res, tipo) => {
  const campoPath = campoPathOdometro(tipo);
  if (!campoPath) return res.status(400).json({ message: 'Tipo de foto de odômetro inválido.' });
  if (!req.file) return res.status(400).json({ message: 'Foto do odômetro não enviada.' });

  try {
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, status, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', req.params.id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });
    if (!acessoPermitidoAoFrete(req, frete)) return res.status(403).json({ message: 'Acesso negado.' });
    if (frete.status === 'finalizado' || frete.status === 'cancelado') {
      return res.status(409).json({ message: 'Não é possível alterar fotos de um frete finalizado ou cancelado.' });
    }

    const extensao = EXTENSAO_POR_MIME[req.file.mimetype];
    if (!extensao) return res.status(400).json({ message: 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.' });

    const pathPrivado = `${frete.empresa_id}/fretes/${frete.id}/odometro-${tipo}.${extensao}`;
    const pathAnterior = frete[campoPath] || null;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ODOMETRO)
      .upload(pathPrivado, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    if (uploadError) {
      console.error('[fretesController:uploadOdometro] Falha no upload privado', {
        frete_id: frete.id,
        empresa_id: frete.empresa_id,
        tipo,
        mimetype: req.file.mimetype,
        size: req.file.size,
        erro: uploadError.message || String(uploadError),
      });
      return res.status(502).json({ message: 'Erro ao salvar foto do odômetro.' });
    }

    const updatePayload = { [campoPath]: pathPrivado };
    if (tipo === 'inicial' && frete.status === 'pendente') updatePayload.status = 'ativo';
    const { data: atualizado, error: updateError } = await supabase
      .from('fretes')
      .update(updatePayload)
      .eq('id', frete.id)
      .select()
      .single();
    if (updateError) {
      await supabase.storage.from(BUCKET_ODOMETRO).remove([pathPrivado]).catch(() => {});
      throw updateError;
    }

    if (pathAnterior && pathAnterior !== pathPrivado) {
      supabase.storage.from(BUCKET_ODOMETRO).remove([pathAnterior]).catch(() => {});
    }

    return res.status(200).json({
      path: pathPrivado,
      status: atualizado.status,
    });
  } catch (error) {
    console.error('[fretesController:uploadOdometro] Erro inesperado:', error?.message || error);
    return res.status(500).json({ message: 'Erro ao enviar foto do odômetro.' });
  }
};

// Helper para validar status do motorista
const checkMotoristaStatus = async (uid) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('status')
    .eq('id', uid)
    .single();
  
  if (error || !data) return false;
  return data.status === 'ativo';
};

// Mensagem única da trava de pendências (reuso nas duas travas)
const MSG_PENDENCIAS = 'Não é possível finalizar: há lançamentos pendentes desta viagem. Aprove ou rejeite todos antes de finalizar.';

const mensagemFinalizacaoLimite = (limite) => (
  `Não foi possível finalizar a viagem. ${limite?.message || 'Revise os dados do frete antes de continuar.'}`
);

// Datas simples representam o último dia incluído pelo cliente. Converte esse
// dia no limite exclusivo seguinte; datetimes já expressam o limite desejado.
const normalizarDataFimExclusiva = (dataFim) => {
  if (typeof dataFim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) return dataFim;

  const [ano, mes, dia] = dataFim.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataValida = data.getUTCFullYear() === ano
    && data.getUTCMonth() === mes - 1
    && data.getUTCDate() === dia;

  if (!dataValida) return dataFim;

  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
};

// Retorna true se o FRETE tem algum lançamento pendente (despesa/abast/vale).
// Escopo por frete_id: bloqueia só a viagem atual, não outras viagens do motorista.
const freteTemPendencias = async (freteId) => {
  for (const tabela of ['despesas', 'abastecimentos', 'vales']) {
    const { count, error } = await supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('frete_id', freteId)
      .eq('status', 'pendente');
    if (error) throw error;
    if ((count || 0) > 0) return true;
  }
  return false;
};

// Retorna true se o motorista pertence a uma empresa do tipo 'autonomo'.
// Fonte confiável: motoristas.empresa_id → empresas.tipo. NUNCA detecta por nome.
// Retorna null quando o lookup falha (indeterminado), para o chamador aplicar fallback leniente.
const isMotoristaAutonomo = async (motoristaId) => {
  const { data: mot, error: motErr } = await supabase
    .from('motoristas')
    .select('empresa_id')
    .eq('id', motoristaId)
    .single();
  if (motErr || !mot) return null;
  const { data: emp, error: empErr } = await supabase
    .from('empresas')
    .select('tipo')
    .eq('id', mot.empresa_id)
    .single();
  if (empErr || !emp) return null;
  return emp.tipo === 'autonomo';
};

exports.getAll = async (req, res) => {
  const { data_inicio, data_fim, status, motorista_id } = req.query;
  const isAdmin = req.user.role === 'admin';

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin
      ? (req.query.empresa_id || null)
      : req.empresa_id;

    let idsPermitidos = null;

    if (!isAdmin) {
      idsPermitidos = [req.user.uid];
    } else if (empresaAlvo) {
      const { data: uids, error: uidsError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('empresa_id', empresaAlvo)
        .eq('tipo', 'motorista');

      if (uidsError) throw uidsError;
      idsPermitidos = uids.map(u => u.id);
    }

    let query = supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome))');

    if (idsPermitidos !== null) {
      query = query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    }

    if (isAdmin && motorista_id) {
      query = query.eq('motorista_id', motorista_id);
    }

    if (data_inicio) query = query.gte('data', data_inicio);
    if (data_fim) query = query.lt('data', normalizarDataFimExclusiva(data_fim));
    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao listar fretes:', error);
    res.status(500).json({ message: 'Erro ao listar fretes.' });
  }
};

exports.create = async (req, res) => {
  const { origem, destino, km_inicial, km_final, valor_frete, quem_recebeu, toneladas, valor_tonelada_km, odometro_obrigatorio } = req.body;
  // Modalidade: ausente/desconhecida → 'valor_fixo' (comportamento histórico e
  // compatível com app/APK antigos que não enviam o campo).
  const modalidade = normalizarModalidade(req.body.modalidade_calculo) || 'valor_fixo';
  const motorista_id = req.user.role === 'admin'
    ? (req.body.motorista_id || req.user.uid)
    : req.user.uid;

  try {
    // 1. Validar status
    const isAtivo = await checkMotoristaStatus(motorista_id);
    if (!isAtivo) return res.status(403).json({ message: 'Motorista não aprovado ou bloqueado.' });

    // 2. Buscar dados do motorista (placa e comissão) em uma única consulta
    const { data: motData, error: motError } = await supabase
      .from('motoristas')
      .select('placa_veiculo, percentual_comissao, empresa_id')
      .eq('id', motorista_id)
      .single();

    if (motError || !motData) throw motError || new Error('Dados do motorista não encontrados');

    // 2b. Definir quem_recebeu por tipo de empresa (TAC vs CLT):
    //  - autonomo (TAC) → SEMPRE 'motorista' (recebe direto, é dono do veículo); o body NÃO
    //    sobrescreve — defense-in-depth contra requisição forjada (espelha a trava do frontend).
    //  - transportadora (CLT) / vinculado → respeita o body; default 'proprietario' se ausente.
    // Lookup do tipo sempre executado; se falhar, fallback leniente + log (mantém comportamento atual).
    let quemRecebeuFinal = quem_recebeu;
    const { data: empData, error: empError } = await supabase
      .from('empresas')
      .select('tipo')
      .eq('id', motData.empresa_id)
      .single();
    if (empError || !empData) {
      console.warn('[fretesController:create] lookup tipo empresa falhou; fallback leniente:', empError?.message);
    }
    if (empData?.tipo === 'autonomo') {
      quemRecebeuFinal = 'motorista';
    } else if (!quemRecebeuFinal) {
      quemRecebeuFinal = 'proprietario';
    }

    // Valor do frete por modalidade:
    //  - valor_fixo: usa o valor_frete digitado.
    //  - tonelada_km: DERIVADO = toneladas * (km_final - km_inicial) * valor_tonelada_km.
    //    Na criação o km_final normalmente ainda não existe → o valor real ainda não
    //    é calculável. Como a coluna fretes.valor_frete é NOT NULL (sem CHECK > 0,
    //    confirmado no schema de produção), gravamos 0 PROVISÓRIO nesse caso — nunca
    //    null (o null quebrava o INSERT com 23502). O valor definitivo é calculado na
    //    finalização (ou no update, quando o km_final for informado). Se ambos os KMs
    //    já vierem no create, calcula desde já. valor_frete do body é ignorado aqui.
    let valorFreteFinal = valor_frete !== undefined ? Number(valor_frete) : null;
    if (modalidade === 'tonelada_km') {
      const calc = calcularValorToneladaKm({
        toneladas,
        valorToneladaKm: valor_tonelada_km,
        kmInicial: km_inicial,
        kmFinal: km_final,
      });
      valorFreteFinal = calc !== null ? calc : 0;
    }

    // Trava de sanidade operacional: barra valores absurdos (ex.: R$150/t·km no lugar
    // de R$0,15) ANTES de gravar. Valida os campos de tonelada/km, a ordem dos KMs e o
    // valor final (derivado ou fixo). Reprova → 422, sem insert.
    const limite = validarLimitesFrete({
      modalidade,
      valorFrete: valorFreteFinal,
      toneladas,
      valorToneladaKm: valor_tonelada_km,
      kmInicial: km_inicial,
      kmFinal: km_final,
    });
    if (!limite.ok) return res.status(422).json({ message: limite.message });

    // Comissão só para VINCULADO (empresa.tipo conhecido e ≠ 'autonomo'). Autônomo e
    // tipo desconhecido → 0 (nunca assume 12%). Campo comissao_calculada mantido no
    // contrato da resposta, apenas zerado quando não há comissão fixa (inclui
    // tonelada_km ainda sem valor calculado).
    const comissao = calcularComissao(valorFreteFinal, motData.percentual_comissao, empData?.tipo);

    // 3. Inserir frete. Campos de tonelada/km só são gravados na modalidade
    // tonelada_km; no valor_fixo ficam null para não sujar o registro.
    const { data, error } = await supabase
      .from('fretes')
      .insert({
        motorista_id,
        empresa_id: motData.empresa_id,
        origem,
        destino,
        km_inicial,
        valor_frete: valorFreteFinal,
        modalidade_calculo: modalidade,
        toneladas: modalidade === 'tonelada_km' && toneladas !== undefined ? Number(toneladas) : null,
        valor_tonelada_km: modalidade === 'tonelada_km' && valor_tonelada_km !== undefined ? Number(valor_tonelada_km) : null,
        quem_recebeu: quemRecebeuFinal,
        placa: motData.placa_veiculo,
        // Novo fluxo de odômetro: o frete só fica ativo depois que a foto
        // inicial é enviada. Registros antigos já ativos/finalizados não mudam.
        status: odometro_obrigatorio === true ? 'pendente' : 'ativo'
      })
      .select()
      .single();

    if (error) {
      console.error('[fretesController:create] Erro ao inserir frete:', error);
      throw error;
    }

    // Notificação de frete criado (best-effort): avisa o motorista dono e os admins
    // da empresa (exceto o autor). Não bloqueia a criação; em falha, apenas loga para
    // dar observabilidade (antes o erro era engolido em silêncio).
    notificacaoService.notificarFreteCriado(data, { actorId: req.user?.uid })
      .catch((e) => console.warn('[fretesController:create] notificarFreteCriado falhou:', e?.message || e));
    res.status(201).json({ ...data, comissao_calculada: comissao });
  } catch (error) {
    console.error(error);
    // Violação de restrição do banco (NOT NULL / CHECK) → 400 com mensagem em
    // português, em vez do genérico "Erro ao criar frete." que escondia a causa.
    // Não expõe detalhe interno do Postgres ao cliente.
    if (error?.code === '23502' || error?.code === '23514') {
      return res.status(400).json({
        message: 'Não foi possível salvar o frete. Verifique os campos: no tonelada/km informe toneladas, valor por tonelada/km e KM inicial; no valor fixo informe o valor do frete.'
      });
    }
    res.status(500).json({ message: 'Erro ao criar frete.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome))')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Isolamento por tenant: super-admin acessa tudo; admin só a própria
    // empresa; motorista só os próprios fretes.
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      if (req.user.role === 'admin') {
        if (data.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (data.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar frete.' });
  }
};

exports.uploadOdometroInicial = (req, res) => uploadOdometro(req, res, 'inicial');
exports.uploadOdometroFinal = (req, res) => uploadOdometro(req, res, 'final');

exports.getOdometroSignedUrl = async (req, res) => {
  const campoPath = campoPathOdometro(req.params.tipo);
  if (!campoPath) return res.status(400).json({ message: 'Tipo de foto de odômetro inválido.' });

  try {
    const { data: frete, error } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', req.params.id)
      .single();
    if (error || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });
    if (!acessoPermitidoAoFrete(req, frete)) return res.status(403).json({ message: 'Acesso negado.' });

    const pathPrivado = frete[campoPath];
    if (!pathPrivado) return res.status(404).json({ message: 'Foto do odômetro não enviada.' });
    const signedUrl = await criarSignedUrlOdometro(pathPrivado);
    return res.status(200).json({ signed_url: signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    console.error('[fretesController:getOdometroSignedUrl] Erro:', error?.message || error);
    return res.status(500).json({ message: 'Erro ao gerar acesso temporário à foto.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    const { data: checkData, error: checkError } = await supabase
      .from('fretes')
      .select('motorista_id, empresa_id, status, modalidade_calculo, toneladas, valor_tonelada_km, km_inicial, km_final, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', id)
      .single();

    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Ownership por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    if (!isSuperAdmin) {
      if (isAdmin) {
        if (checkData.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (checkData.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    // Extrair APENAS campos permitidos (previne mass assignment)
    // data com alias (dataFrete) para não colidir com o const { data } do Supabase abaixo
    const { origem, destino, km_inicial, km_final, valor_frete, status, quem_recebeu, data: dataFrete, modalidade_calculo, toneladas, valor_tonelada_km } = req.body;
    const allowedUpdate = {};
    if (origem !== undefined) allowedUpdate.origem = origem;
    if (destino !== undefined) allowedUpdate.destino = destino;
    if (km_inicial !== undefined) allowedUpdate.km_inicial = Number(km_inicial);
    if (km_final !== undefined) allowedUpdate.km_final = Number(km_final);
    if (valor_frete !== undefined) allowedUpdate.valor_frete = parseFloat(valor_frete);
    if (status !== undefined) allowedUpdate.status = status;
    if (quem_recebeu !== undefined) allowedUpdate.quem_recebeu = quem_recebeu;
    if (dataFrete !== undefined) allowedUpdate.data = dataFrete;
    if (modalidade_calculo !== undefined) allowedUpdate.modalidade_calculo = modalidade_calculo;
    if (toneladas !== undefined) allowedUpdate.toneladas = Number(toneladas);
    if (valor_tonelada_km !== undefined) allowedUpdate.valor_tonelada_km = Number(valor_tonelada_km);

    if (Object.keys(allowedUpdate).length === 0) {
      return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
    }

    // Cálculo por modalidade (merge do que veio no body sobre o já gravado):
    //  - tonelada_km: valor_frete é SEMPRE derivado; ignora valor manual. Se ainda
    //    não dá para calcular (ex.: falta km_final), não deixa passar valor
    //    inconsistente — remove valor_frete do update, preservando o valor atual.
    //  - voltar para valor_fixo: limpa os campos de tonelada para não deixar resíduo.
    const modalidadeEfetiva = allowedUpdate.modalidade_calculo ?? checkData.modalidade_calculo ?? 'valor_fixo';
    if (modalidadeEfetiva === 'tonelada_km') {
      const calc = calcularValorToneladaKm({
        toneladas: allowedUpdate.toneladas ?? checkData.toneladas,
        valorToneladaKm: allowedUpdate.valor_tonelada_km ?? checkData.valor_tonelada_km,
        kmInicial: allowedUpdate.km_inicial ?? checkData.km_inicial,
        kmFinal: allowedUpdate.km_final ?? checkData.km_final,
      });
      if (calc !== null) {
        allowedUpdate.valor_frete = calc;
      } else {
        delete allowedUpdate.valor_frete;
      }
    } else if (allowedUpdate.modalidade_calculo === 'valor_fixo') {
      allowedUpdate.toneladas = null;
      allowedUpdate.valor_tonelada_km = null;
    }

    // Defense-in-depth: autônomo SEMPRE recebe via 'motorista'. Força o valor independentemente
    // do body (espelha a trava do frontend). Vinculado preserva o valor enviado. Lookup pelo tipo
    // real da empresa (motoristas → empresas.tipo), nunca por nome; falha → fallback leniente + log.
    if (allowedUpdate.quem_recebeu !== undefined) {
      const autonomo = await isMotoristaAutonomo(checkData.motorista_id);
      if (autonomo === true) {
        allowedUpdate.quem_recebeu = 'motorista';
      } else if (autonomo === null) {
        console.warn('[fretesController:update] lookup tipo empresa falhou; mantendo quem_recebeu do body (fallback leniente).');
      }
    }

    // Trava de finalização: bloqueia se o motorista tiver lançamentos pendentes (vale p/ todos)
    if (allowedUpdate.status === 'finalizado' && await freteTemPendencias(id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }
    if (allowedUpdate.status === 'ativo' && checkData.status === 'pendente' && !checkData.foto_odometro_inicial_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
    }
    // Novo fluxo de odômetro: espelha exports.finalizar TAMBÉM neste PATCH, para que
    // uma finalização via update (status → 'finalizado') não contorne a trava de foto
    // (defense-in-depth: a regra vale no backend, não só no painel). Fonte de verdade =
    // foto_odometro_inicial_path. Fretes legados (sem foto inicial) seguem finalizáveis.
    if (allowedUpdate.status === 'finalizado') {
      if (checkData.status === 'pendente' && !checkData.foto_odometro_inicial_path) {
        return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
      }
      if (checkData.foto_odometro_inicial_path && !checkData.foto_odometro_final_path) {
        return res.status(422).json({ message: 'Envie a foto do odômetro final para concluir o frete.' });
      }
    }

    // Trava de sanidade operacional (espelha o create): valida os valores EFETIVOS
    // após o merge (o que veio no body sobre o já gravado) antes de persistir.
    // Reprova → 422, sem update.
    const limite = validarLimitesFrete({
      modalidade: modalidadeEfetiva,
      valorFrete: 'valor_frete' in allowedUpdate ? allowedUpdate.valor_frete : undefined,
      toneladas: allowedUpdate.toneladas ?? checkData.toneladas,
      valorToneladaKm: allowedUpdate.valor_tonelada_km ?? checkData.valor_tonelada_km,
      kmInicial: allowedUpdate.km_inicial ?? checkData.km_inicial,
      kmFinal: allowedUpdate.km_final ?? checkData.km_final,
    });
    if (!limite.ok) return res.status(422).json({ message: limite.message });

    const { data, error } = await supabase
      .from('fretes')
      .update(allowedUpdate)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao atualizar frete:', error);
    res.status(500).json({ message: 'Erro ao atualizar frete.' });
  }
};

exports.finalizar = async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.is_super_admin === true;
  const isAdmin = req.user.role === 'admin';

  try {
    // Busca o frete e verifica ownership
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, status, km_inicial, km_final, modalidade_calculo, toneladas, valor_tonelada_km, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    // super-admin: sempre pode
    if (!isSuperAdmin) {
      // admin empresa: verifica se o frete é da empresa
      if (isAdmin) {
        if (frete.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else {
        // motorista: verifica ownership + permissão
        if (frete.motorista_id !== req.user.uid) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }

        // Busca permissão e tipo de empresa
        const { data: motData } = await supabase
          .from('motoristas')
          .select('pode_finalizar_viagem, empresas(tipo)')
          .eq('id', req.user.uid)
          .single();

        const isAutonomo = motData?.empresas?.tipo === 'autonomo';
        const podeFinalizar = motData?.pode_finalizar_viagem === true;

        if (!isAutonomo && !podeFinalizar) {
          return res.status(403).json({
            message: 'Sua empresa não autorizou a finalização de viagens pelo app. Contate o administrador.'
          });
        }
      }
    }

    if (frete.status === 'finalizado') {
      return res.status(400).json({ message: 'Esta viagem já está finalizada.' });
    }
    if (frete.status === 'pendente' && !frete.foto_odometro_inicial_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
    }

    // Trava de finalização: bloqueia se a viagem tiver lançamentos pendentes (vale p/ todos, inclusive super-admin)
    if (await freteTemPendencias(frete.id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }

    // Compatibilidade: a obrigação vale para o novo fluxo, identificado pela
    // foto inicial. Fretes antigos sem path continuam finalizáveis.
    if (frete.foto_odometro_inicial_path && !frete.foto_odometro_final_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro final para concluir o frete.' });
    }

    // Série 1.5 (KM na finalização): o app NOVO envia km_inicial/km_final no corpo;
    // quando vierem, validamos (positivos, km_final > km_inicial) e persistimos junto da
    // finalização. App/cliente ANTIGO não manda KM → finaliza como antes (compatibilidade;
    // a trava obrigatória rígida fica para um PR posterior, após o APK novo validado).
    const updatePayload = { status: 'finalizado' };
    const { km_inicial: kmIniBody, km_final: kmFinBody } = req.body || {};
    const temKmIni = kmIniBody !== undefined && kmIniBody !== null && kmIniBody !== '';
    const temKmFin = kmFinBody !== undefined && kmFinBody !== null && kmFinBody !== '';

    if (frete.foto_odometro_inicial_path && !temKmFin
      && (frete.km_final === null || frete.km_final === undefined || frete.km_final === '')) {
      return res.status(422).json({ message: 'Informe o KM final para finalizar o frete.' });
    }

    if (temKmFin) {
      const kmFinal = Number(kmFinBody);
      if (!Number.isFinite(kmFinal) || kmFinal <= 0) {
        return res.status(422).json({ message: 'KM final inválido.' });
      }
      // KM inicial efetivo: o enviado agora (se houver) ou o já gravado no frete.
      let kmInicialEfetivo = frete.km_inicial;
      if (temKmIni) {
        const kmIni = Number(kmIniBody);
        if (!Number.isFinite(kmIni) || kmIni <= 0) {
          return res.status(422).json({ message: 'KM inicial inválido.' });
        }
        kmInicialEfetivo = kmIni;
        updatePayload.km_inicial = kmIni;
      }
      if (kmInicialEfetivo === null || kmInicialEfetivo === undefined) {
        return res.status(422).json({ message: 'Informe o KM inicial para finalizar.' });
      }
      if (kmFinal <= Number(kmInicialEfetivo)) {
        return res.status(422).json({ message: 'KM final deve ser maior que o KM inicial.' });
      }
      updatePayload.km_final = kmFinal;
    } else if (temKmIni) {
      // KM inicial enviado isolado (sem km_final): valida e salva, mas não finaliza com média.
      const kmIni = Number(kmIniBody);
      if (!Number.isFinite(kmIni) || kmIni <= 0) {
        return res.status(422).json({ message: 'KM inicial inválido.' });
      }
      updatePayload.km_inicial = kmIni;
    }

    // Frete por tonelada/km: NÃO pode ser finalizado sem KM final — senão ficaria
    // "finalizado" com valor 0 provisório e distância ausente (bug corrigido aqui).
    // O km_final efetivo é o enviado nesta finalização (updatePayload.km_final) ou o
    // já gravado no frete. Regras (retorna 422 e NÃO altera status quando falham):
    //  - km_final obrigatório;
    //  - km_inicial obrigatório (sem ele não há distância);
    //  - km_final > km_inicial (calcularValorToneladaKm devolve null caso contrário).
    // Só quando tudo é válido calculamos o valor definitivo e prosseguimos com a
    // finalização = toneladas * (km_final - km_inicial) * valor_tonelada_km.
    if (frete.modalidade_calculo === 'tonelada_km') {
      const kmFinalEfetivo = updatePayload.km_final ?? frete.km_final;
      const kmInicialEfetivo = updatePayload.km_inicial ?? frete.km_inicial;
      if (kmFinalEfetivo === null || kmFinalEfetivo === undefined || kmFinalEfetivo === '') {
        return res.status(422).json({ message: 'Informe o KM final para finalizar um frete por tonelada/km.' });
      }
      if (kmInicialEfetivo === null || kmInicialEfetivo === undefined || kmInicialEfetivo === '') {
        return res.status(422).json({ message: 'Informe o KM inicial para finalizar um frete por tonelada/km.' });
      }
      const calc = calcularValorToneladaKm({
        toneladas: frete.toneladas,
        valorToneladaKm: frete.valor_tonelada_km,
        kmInicial: kmInicialEfetivo,
        kmFinal: kmFinalEfetivo,
      });
      if (calc === null) {
        return res.status(422).json({ message: 'O KM final deve ser maior que o KM inicial.' });
      }
      // Trava de sanidade operacional: o valor derivado na finalização também respeita
      // os tetos (toneladas, valor por tonelada/km e valor final). Reprova → 422, sem
      // finalizar (impede que um frete legado com insumos absurdos vire valor final).
      const limite = validarLimitesFrete({
        modalidade: 'tonelada_km',
        valorFrete: calc,
        toneladas: frete.toneladas,
        valorToneladaKm: frete.valor_tonelada_km,
        kmInicial: kmInicialEfetivo,
        kmFinal: kmFinalEfetivo,
      });
      if (!limite.ok) return res.status(422).json({ message: mensagemFinalizacaoLimite(limite) });
      updatePayload.valor_frete = calc;
    }

    const { data, error } = await supabase
      .from('fretes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    notificacaoService.notificarViagemFinalizada(data, { actorId: req.user?.uid }).catch(() => {});
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao finalizar frete:', error);
    res.status(500).json({ message: 'Erro ao finalizar viagem.' });
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    // Cancelar = marcar status 'cancelado' (nunca delete físico). Antes, verifica ownership
    // por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    if (!isSuperAdmin) {
      if (isAdmin) {
        if (frete.empresa_id !== req.empresa_id) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (frete.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    const { error } = await supabase
      .from('fretes')
      .update({ status: 'cancelado' })
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Frete cancelado com sucesso.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar frete.' });
  }
};
