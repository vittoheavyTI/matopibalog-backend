const supabase = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { criarEmpresaCompleta } = require('../services/empresaService');
const { criarPropostaEContrato } = require('../services/contratacaoComercialService');
const notificacaoService = require('../services/notificacaoService');
const planoLimiteService = require('../services/planoLimiteService');
const { getTermosPendentes } = require('./termosController');
const { gerarSenhaTemporaria } = require('../utils/senhaTemporaria');

// Client ISOLADO só para autenticação (signInWithPassword no login). Mantido
// separado do client admin (config/supabase.js) de propósito: assim a sessão do
// usuário criada no login fica neste client e NUNCA contamina o client admin
// usado por DB/Storage — evitando que uploads (foto/comprovantes) sejam rebaixados
// de service_role para 'authenticated' e batam em RLS. Não usar para DB/Storage.
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Client ANÔNIMO (anon/public key) — usado só para disparar e-mails transacionais
// do Auth que NÃO exigem service_role, como o reenvio do e-mail de confirmação de
// cadastro (resend type:'signup'). Fica null quando SUPABASE_ANON_KEY não está
// configurada; nesse caso o envio é silenciosamente pulado (não-fatal).
const supabaseAnon = process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// URL de destino do link de confirmação após o clique. Precisa bater com a
// Redirect URL cadastrada no Supabase e com FRONTEND_URL no Railway.
function urlConfirmacao() {
  return `${process.env.FRONTEND_URL || 'https://matopibalog.com.br'}/confirmado`;
}

// Envia (ou reenvia) o e-mail de confirmação de cadastro. NÃO-FATAL: qualquer
// falha é apenas logada — o cadastro segue e o usuário pode pedir o reenvio
// depois. Usa o client anônimo (resend signup não precisa de service_role).
async function enviarConfirmacaoEmail(email) {
  if (!supabaseAnon || !email) return;
  try {
    const { error } = await supabaseAnon.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: urlConfirmacao() },
    });
    if (error) {
      console.error('[auth] Falha ao enviar confirmação de e-mail (não-fatal):', error.message);
    }
  } catch (e) {
    console.error('[auth] Exceção ao enviar confirmação de e-mail (não-fatal):', e.message || e);
  }
}

// Normaliza um código de convite para comparação tolerante: maiúsculas, sem
// espaços e sem traços/separadores. O backend é a defesa principal — aceita o
// código com ou sem traço, em qualquer caixa, com espaços acidentais.
// Ex.: 'mato-a1b2c3', ' MATO A1B2C3 ', 'MATOA1B2C3' → 'MATOA1B2C3'.
function normalizarCodigoConvite(valor) {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function apenasDigitos(valor) {
  return String(valor || '').replace(/\D+/g, '');
}

// Cria, de forma NÃO-FATAL, um administrador vinculado à empresa autônoma recém
// criada. Retorna um objeto de status para o app orientar o usuário:
//   { criado: true,  email, senha_temporaria }  → exibir a senha UMA vez
//   { criado: false, motivo }                   → conta criada, admin não; usar painel
// Nunca lança: qualquer falha vira { criado:false } para não derrubar o cadastro
// do autônomo (que já está concluído neste ponto). empresa_id vem SEMPRE do
// backend (empresa do autônomo), nunca do body.
async function criarAdministradorAutonomo({ empresa_id, administrador, emailAutonomo }) {
  const nomeAdmin = String(administrador?.nome || '').trim();
  const emailAdmin = String(administrador?.email || '').trim().toLowerCase();
  if (!nomeAdmin || !emailAdmin) {
    return { criado: false, motivo: 'Dados do administrador incompletos.' };
  }
  // O admin precisa ser uma pessoa diferente do autônomo (mesmo e-mail colidiria
  // no Auth e confundiria os acessos app x painel).
  if (emailAdmin === String(emailAutonomo || '').trim().toLowerCase()) {
    return { criado: false, motivo: 'O e-mail do administrador deve ser diferente do seu.' };
  }

  let adminUid = null;
  try {
    const senhaTemporaria = gerarSenhaTemporaria();
    const { data: adminAuth, error: adminAuthError } = await supabase.auth.admin.createUser({
      email: emailAdmin,
      password: senhaTemporaria,
      email_confirm: true,
    });
    if (adminAuthError || !adminAuth?.user) {
      const msg = (adminAuthError?.message || '').toLowerCase();
      if (adminAuthError?.status === 422 || msg.includes('already') || msg.includes('registered')) {
        return { criado: false, motivo: 'Este e-mail de administrador já está cadastrado. Adicione o administrador pelo painel.' };
      }
      return { criado: false, motivo: 'Não foi possível criar o administrador. Adicione pelo painel.' };
    }
    adminUid = adminAuth.user.id;

    const { error: adminUserError } = await supabase.from('usuarios').insert({
      id: adminUid,
      nome: nomeAdmin,
      email: emailAdmin,
      tipo: 'admin',
      status: 'ativo',
      empresa_id, // derivado do backend (empresa do autônomo), nunca do body
      // Nasce com senha provisória → login força troca no 1º acesso.
      senha_temporaria: true,
      permissoes: { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false },
    });
    if (adminUserError) {
      // Rollback do Auth para não deixar admin órfão (sem linha em usuarios).
      await supabase.auth.admin.deleteUser(adminUid).catch(() => {});
      return { criado: false, motivo: 'Não foi possível vincular o administrador. Adicione pelo painel.' };
    }

    return { criado: true, email: emailAdmin, senha_temporaria: senhaTemporaria };
  } catch (e) {
    console.error('[register] criarAdministradorAutonomo falhou (não-fatal):', e.message);
    if (adminUid) {
      await supabase.auth.admin.deleteUser(adminUid).catch(() => {});
    }
    return { criado: false, motivo: 'Não foi possível criar o administrador. Adicione pelo painel.' };
  }
}

exports.register = async (req, res) => {
  const { nome, email, senha, codigo_convite, plano_id, cpf, placa_veiculo, administrador } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha.' });
  }

  try {
    let empresa_id = null;
    const comConvite = Boolean(codigo_convite && codigo_convite.trim() !== '');
    const cpfMotoristaInformado = apenasDigitos(cpf);
    let cpfMotorista = cpfMotoristaInformado || null;

    if (comConvite) {
      // --- Fluxo com código de convite: vincular à empresa ---
      // Busca tolerante a traço/caixa/espaços. Os códigos salvos têm formato
      // 'MATO-XXXXXX' (sempre com traço); o usuário pode digitar com ou sem.
      // Como o volume é pequeno e o código é curto, comparamos a versão
      // normalizada em memória (apenas as colunas necessárias, sem select *).
      const alvo = normalizarCodigoConvite(codigo_convite);

      const { data: empresas, error: empresaError } = await supabase
        .from('empresas')
        .select('id, nome, codigo_convite, status, tipo, plano_id, trial_ends_at')
        .not('codigo_convite', 'is', null);

      if (empresaError) {
        console.error('[register] Falha ao buscar empresa por convite:', empresaError.message);
        return res.status(500).json({ message: 'Erro ao validar código. Tente novamente.' });
      }

      const empresa = (empresas || []).find(
        (e) => normalizarCodigoConvite(e.codigo_convite) === alvo
      );

      if (!alvo || !empresa) {
        return res.status(400).json({ message: 'Código de empresa inválido. Confira o código recebido e tente novamente.' });
      }

      if (empresa.status === 'expirado' || empresa.status === 'bloqueado') {
        return res.status(400).json({ message: 'Esta empresa está com o plano inativo. Contate o suporte.' });
      }

      empresa_id = empresa.id;

      // Frente #7: trava de limite de motoristas por plano, SÓ no auto-cadastro
      // por convite (empresa já existente). Avaliada antes de criar no Auth para
      // não deixar órfão. O ramo autônomo (else) cria a 1a vaga da própria empresa
      // e NUNCA passa por aqui. Fail-open: erro de infra da trava não bloqueia.
      try {
        const avaliacao = await planoLimiteService.avaliarLimiteMotoristas(supabase, empresa_id);
        if (!avaliacao.ok) {
          return res.status(409).json(planoLimiteService.montarErroLimiteMotoristas(avaliacao));
        }
      } catch (limiteErr) {
        console.error('[register] Falha ao avaliar limite de motoristas (fail-open):', limiteErr.message);
      }
    } else {
      // --- Fluxo autônomo: criar empresa própria ---
      const documentoBilling = apenasDigitos(
        req.body.documento_billing || req.body.documento || req.body.cnpj || cpf
      );

      if (documentoBilling.length !== 11 && documentoBilling.length !== 14) {
        return res.status(400).json({ message: 'Informe um CPF ou CNPJ valido para o documento de cobranca.' });
      }

      // CNPJ/MEI: o documento de cobranca NAO serve como CPF do motorista.
      // Exigimos o CPF do responsavel (11 digitos) ANTES de criar a empresa,
      // para nao cair na constraint NOT NULL de motoristas.cpf nem deixar
      // empresa orfa. Para CPF, o proprio documento ja e o CPF do motorista.
      if (documentoBilling.length === 14 && cpfMotoristaInformado.length !== 11) {
        return res.status(400).json({ message: 'Para CNPJ/MEI, informe o CPF do motorista responsavel.' });
      }
      cpfMotorista = documentoBilling.length === 11 ? documentoBilling : cpfMotoristaInformado;

      // Selecao do plano do autonomo:
      //  - com plano_id: valida o plano escolhido (precisa existir e estar ativo).
      //  - sem plano_id: fallback para o 1o plano ATIVO elegivel a autonomo
      //    (categoria 'autonomo' ou 'ambos'). NUNCA cai em plano de empresa;
      //    se nao houver plano elegivel, bloqueia o cadastro com 400 amigavel.
      let planoData = null;
      if (plano_id) {
        const { data, error: planoError } = await supabase
          .from('planos')
          .select('id, dias_trial, ativo')
          .eq('id', plano_id)
          .maybeSingle();
        if (planoError) {
          console.error('[register] Falha ao validar plano do autônomo:', planoError.message);
          return res.status(500).json({ message: 'Erro ao validar plano. Tente novamente.' });
        }
        // Preço, limite e trial nunca vêm do cliente — só validamos o id.
        if (!data || data.ativo !== true) {
          return res.status(400).json({ message: 'Plano selecionado inválido ou indisponível.' });
        }
        planoData = data;
      } else {
        const { data, error: planoError } = await supabase
          .from('planos')
          .select('id, dias_trial, ativo, categoria')
          .eq('ativo', true)
          .in('categoria', ['autonomo', 'ambos'])
          .order('preco_mensal', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (planoError) {
          console.error('[register] Falha ao buscar plano autônomo:', planoError.message);
          return res.status(500).json({ message: 'Erro ao validar plano. Tente novamente.' });
        }
        if (!data) {
          return res.status(400).json({ message: 'Nenhum plano para autônomo disponível no momento. Contate o suporte.' });
        }
        planoData = data;
      }

      // Criacao da conta autonoma com documento de billing para Asaas.
      const { empresa: novaEmpresa, error: empresaError, status: empresaStatus } = await criarEmpresaCompleta({
        nome: `${nome} (Autonomo)`,
        cnpj: documentoBilling,
        email_contato: email,
        plano_id: planoData?.id || null,
        tipo: 'autonomo',
      });
      if (empresaError || !novaEmpresa) {
        return res.status(empresaStatus || 500).json({ message: empresaError || 'Erro ao criar perfil autônomo. Tente novamente.' });
      }

      empresa_id = novaEmpresa.id;
    }

    // Criar usuário no Supabase Auth.
    // Auto-confirma SÓ quem entra por convite válido (a empresa é a autorização).
    // Cadastro self-service (autônomo) nasce NÃO confirmado: precisa confirmar o
    // e-mail antes do 1º login — o link é enviado logo após criar o perfil.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: comConvite
    });

    if (authError) {
      // E-mail já cadastrado no Auth → mensagem específica (não vazar texto cru em inglês).
      const authMsg = (authError.message || '').toLowerCase();
      if (authError.status === 422 || authMsg.includes('already') || authMsg.includes('registered')) {
        return res.status(409).json({ message: 'Este e-mail já está cadastrado. Faça login ou use "Esqueci minha senha".' });
      }
      return res.status(400).json({ message: 'Não foi possível criar a conta. Verifique o e-mail informado.' });
    }

    // Acesso imediato em ambos os fluxos:
    //  - Autônomo (sem convite): empresa própria em trial, nasce ativo/aprovado.
    //  - Motorista com convite VÁLIDO: autoaprovado — o convite é a autorização da
    //    empresa (já validada acima: existe e não está expirada/bloqueada).
    const statusUsuario = 'ativo';
    const statusCadastro = 'aprovado';

    // Criar perfil na tabela usuarios
    const { error: insertError } = await supabase.from('usuarios').insert({
      id: authData.user.id,
      nome,
      email,
      tipo: 'motorista',
      status: statusUsuario,
      empresa_id,
    });

    if (insertError) {
      console.error('[register] Falha ao inserir em usuarios, revertendo Auth:', insertError.message);
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
      return res.status(500).json({ message: 'Erro ao criar perfil. Tente novamente.' });
    }

    // Criar registro na tabela motoristas (cpf vazio → null para não colidir no UNIQUE)
    const { error: motoristaError } = await supabase.from('motoristas').insert({
      id: authData.user.id,
      empresa_id,
      cpf: cpfMotorista,
      placa_veiculo: placa_veiculo || '',
      status_cadastro: statusCadastro
    });

    if (motoristaError) {
      console.error('[register] Falha ao inserir em motoristas, revertendo:', motoristaError.message);
      try {
        await supabase.from('usuarios').delete().eq('id', authData.user.id);
        await supabase.auth.admin.deleteUser(authData.user.id);
      } catch (_) { /* rollback best-effort */ }
      // 23505 = unique_violation (Postgres) → CPF já cadastrado
      if (motoristaError.code === '23505' || (motoristaError.message || '').toLowerCase().includes('duplicate')) {
        return res.status(409).json({ message: 'Este CPF já está cadastrado. Verifique os dados ou contate o suporte.' });
      }
      // Frente #7: trigger legado de limite (corrida com o pré-check) → 409 amigável,
      // nunca 500 genérico.
      if (planoLimiteService.ehErroTriggerLimiteMotoristas(motoristaError)) {
        try {
          const avaliacao = await planoLimiteService.avaliarLimiteMotoristas(supabase, empresa_id);
          return res.status(409).json(planoLimiteService.montarErroLimiteMotoristas(avaliacao));
        } catch (_) {
          return res.status(409).json({ limiteMotoristasAtingido: true, message: 'Limite de motoristas do plano atingido. Contate a empresa para fazer upgrade do plano.' });
        }
      }
      return res.status(500).json({ message: 'Não foi possível concluir o cadastro. Tente novamente.' });
    }

    notificacaoService.criarParaUsuario(authData.user.id, {
      empresa_id,
      tipo: comConvite ? 'conta_vinculada' : 'conta_criada',
      titulo: comConvite ? 'Conta vinculada' : 'Conta criada',
      mensagem: comConvite
        ? 'Sua conta foi vinculada à empresa.'
        : 'Seu período de teste foi iniciado.',
      entidade_tipo: 'usuario',
      entidade_id: authData.user.id,
      dedupe_key: `cadastro:${authData.user.id}`,
    }).catch(() => {});

    // Motorista entrou por convite → os admins da empresa também são avisados no painel.
    if (comConvite) {
      notificacaoService.criarParaEmpresa(empresa_id, {
        tipo: 'conta_vinculada',
        titulo: 'Novo motorista vinculado',
        mensagem: `${nome} entrou na empresa.`,
        entidade_tipo: 'usuario',
        entidade_id: authData.user.id,
        dedupe_key: `conta_vinculada_admin:${authData.user.id}`,
      }, { somenteAdmins: true, excluir_usuario_id: authData.user.id }).catch(() => {});
    }

    // Fluxo "Autônomo com administrador": o autônomo já está criado acima. Se veio
    // um administrador no payload E não é fluxo vinculado, tenta criar o admin
    // (não-fatal). A senha temporária volta UMA vez para a tela de boas-vindas.
    const resposta = { message: 'Usuário criado com sucesso!' };

    // Cadastro self-service (sem convite) → dispara o e-mail de confirmação e
    // sinaliza ao cliente que o acesso depende de confirmar o e-mail.
    if (!comConvite) {
      await enviarConfirmacaoEmail(email);
      resposta.email_confirmacao_pendente = true;

      // Autônomo self-service gera contrato comercial OBRIGATÓRIO (mesmo fluxo do
      // cadastro de empresa): usa o modelo vigente do plano, Matopiba nasce
      // pré-assinada institucionalmente e o cliente assina depois. Não-fatal: uma
      // falha aqui NÃO desfaz o cadastro já concluído. NÃO se aplica ao motorista
      // vinculado por convite (esse entra numa empresa existente, sem novo contrato).
      if (empresa_id) {
        try {
          // plano_id vem da empresa recém-criada (scope-safe: não depende de
          // variáveis do bloco de criação). Sem plano → não gera contrato.
          const { data: empRow } = await supabase
            .from('empresas')
            .select('plano_id, nome')
            .eq('id', empresa_id)
            .maybeSingle();
          if (empRow?.plano_id) {
            const { data: planoAutonomo } = await supabase
              .from('planos')
              .select('id, nome, preco_mensal, dias_trial, limite_motoristas, capacidade_inclusa, preco_motorista_extra, valor_implantacao, requer_negociacao')
              .eq('id', empRow.plano_id)
              .maybeSingle();
            if (planoAutonomo) {
              const contratacao = await criarPropostaEContrato({
                supabase,
                empresa: { id: empresa_id, nome: empRow.nome || `${nome} (Autonomo)` },
                responsavel: { nome, email },
                plano: planoAutonomo,
                origem: 'cadastro_publico',
                criadoPor: authData.user.id,
              });
              if (contratacao && !contratacao.skipped) {
                resposta.contratacao = { contrato_id: contratacao.contrato_id };
              }
            }
          }
        } catch (contratoErr) {
          console.error('[register] contratacao autônomo (nao-fatal)', {
            motivo: contratoErr.motivo || contratoErr.code || 'erro',
          });
        }
      }
    }

    if (!comConvite && administrador && administrador.email) {
      resposta.administrador = await criarAdministradorAutonomo({
        empresa_id,
        administrador,
        emailAutonomo: email,
      });
    }

    res.status(201).json(resposta);
  } catch (error) {
    console.error('Erro no registro:', error.message);
    res.status(500).json({ message: 'Erro ao cadastrar. Verifique os dados e tente novamente.' });
  }
};

exports.login = async (req, res) => {
  const { email, senha } = req.body;

  try {
    // 1. Autenticar no Supabase Auth (client isolado — não contamina o admin)
    const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
      email,
      password: senha
    });

    if (authError) {
      // Supabase sinaliza e-mail não confirmado por code 'email_not_confirmed'
      // (ou mensagem "Email not confirmed"). Isso NÃO é senha errada: devolvemos
      // 403 { naoConfirmado } para o cliente orientar a confirmação e oferecer o
      // reenvio — sem confundir com credenciais inválidas (401).
      const codigo = authError.code || '';
      const msg = (authError.message || '').toLowerCase();
      if (codigo === 'email_not_confirmed' || msg.includes('not confirmed')) {
        return res.status(403).json({
          naoConfirmado: true,
          message: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada ou reenvie a confirmação.',
        });
      }
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    const uid = authData.user.id;

    // 2. Buscar perfil detalhado com tipo da empresa.
    // FK explícita (usuarios.empresa_id → empresas.id): a migration 024 criou
    // empresas.suspended_by → usuarios.id, tornando o embed genérico empresas()
    // ambíguo (PGRST201). Sem o hint, o login inteiro quebra.
    const { data: userData, error: userError } = await supabase
      .from('usuarios')
      .select('*, empresas!usuarios_empresa_id_fkey(nome, tipo)')
      .eq('id', uid)
      .single();

    // Erro real de banco/PostgREST (≠ PGRST116 "zero linhas do .single()"):
    // NÃO mascarar como perfil ausente — é falha interna ao carregar o perfil.
    if (userError && userError.code !== 'PGRST116') {
      console.error(`[login] Erro ao carregar perfil para uid ${uid}:`, userError.code || userError.message);
      return res.status(500).json({ message: 'Erro ao carregar perfil. Tente novamente em instantes.' });
    }

    if (!userData) {
      console.error(`[login] Perfil ausente na tabela usuarios para uid ${uid}`);
      return res.status(409).json({
        message: 'Perfil incompleto. Entre em contato com o suporte.'
      });
    }

    if (userData.status === 'bloqueado') {
      return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
    }

    // 3. Gerar JWT para o backend
    const token = jwt.sign(
      { uid: userData.id, email: userData.email, role: userData.tipo, is_super_admin: userData.is_super_admin ?? false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Token expira em 7 dias
    );

    // 4. Salvar o token em um cookie seguro (MUDANÇA FEITA AQUI!)
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // Obriga o uso de HTTPS (necessário para o sameSite 'none')
      sameSite: 'none', // Permite o cookie viajar do seu Netlify/Hostinger para o Render
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // 5. Retorna os dados do usuário (token incluso para o app Flutter)
    res.status(200).json({
      token,
      user: {
        uid: userData.id,
        nome: userData.nome,
        email: userData.email,
        role: userData.tipo,
        status: userData.status,
        foto_url: userData.foto_url,
        is_super_admin: userData.is_super_admin ?? false,
        senha_temporaria: userData.senha_temporaria ?? false,
        empresa_id: userData.empresa_id,
        empresa_tipo: userData.empresas?.tipo ?? null,
        empresa_nome: userData.empresas?.nome ?? null,
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ message: 'Erro ao realizar login.' });
  }
};

// NOVA FUNÇÃO: Logout para apagar o cookie (MUDANÇA FEITA AQUI!)
exports.logout = async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true, // Obriga o uso de HTTPS
    sameSite: 'none' // Permite apagar o cookie cross-domain
  });
  return res.status(200).json({ message: 'Logout realizado com sucesso' });
};

exports.updateMe = async (req, res) => {
  const CAMPOS_PERMITIDOS = ['telefone', 'celular', 'cep', 'endereco', 'bairro', 'cidade'];
  const update = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (req.body[campo] !== undefined) update[campo] = req.body[campo];
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
  }
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .update(update)
      .eq('id', req.user.uid)
      .select('*, motoristas(*), empresas!usuarios_empresa_id_fkey(nome, tipo)')
      .single();
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar perfil.' });
  }
};

exports.uploadFotoPerfil = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Foto não enviada.' });
  try {
    const path = require('path');
    // Filename único por upload: evita que Flutter use cache do URL anterior
    // (quando o nome era sempre "profile.jpg", a URL nunca mudava e o avatar
    // ficava congelado no cache do NetworkImage entre sessões)
    const ext = path.extname(file.originalname) || '.jpg';
    const fileName = `avatars/${req.user.uid}/profile_${Date.now()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('comprovantes')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      console.error('[uploadFotoPerfil] Erro Supabase Storage:', uploadError.message);
      return res.status(500).json({ message: 'Erro ao salvar foto no storage.' });
    }

    const { data: urlData } = supabase.storage.from('comprovantes').getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: dbError } = await supabase
      .from('usuarios')
      .update({ foto_url: publicUrl })
      .eq('id', req.user.uid);

    if (dbError) {
      console.error('[uploadFotoPerfil] Erro ao atualizar foto_url no banco:', dbError.message);
      return res.status(500).json({ message: 'Foto salva no storage mas erro ao atualizar perfil.' });
    }

    res.status(200).json({ foto_url: publicUrl });
  } catch (error) {
    console.error('[uploadFotoPerfil] Erro inesperado:', error.message || error);
    res.status(500).json({ message: 'Erro ao enviar foto de perfil.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*, motoristas(*), empresas!usuarios_empresa_id_fkey(nome, tipo)')
      .eq('id', req.user.uid)
      .single();

    if (error) throw error;

    // LGPD (aditivo): sinaliza termos pendentes. Falha na consulta de termos
    // NÃO pode derrubar /auth/me (login / restauração de sessão) → fallback false/0.
    let termos_pendentes = false;
    let termos_pendentes_count = 0;
    try {
      const { count } = await getTermosPendentes(
        data.id,
        data.tipo,
        data.is_super_admin === true
      );
      termos_pendentes_count = count;
      termos_pendentes = count > 0;
    } catch (termosErr) {
      console.error('[getMe] Falha ao calcular termos pendentes:', termosErr.message || termosErr);
    }

    res.status(200).json({ ...data, termos_pendentes, termos_pendentes_count });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados do usuário.' });
  }
};

exports.trocarSenha = async (req, res) => {
  const { nova_senha } = req.body;

  if (!nova_senha || typeof nova_senha !== 'string' || nova_senha.length < 6) {
    return res.status(400).json({ message: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  try {
    const { error: authError } = await supabase.auth.admin.updateUserById(req.user.uid, {
      password: nova_senha
    });

    if (authError) {
      console.error('[trocarSenha] Erro no Supabase Auth:', authError.message);
      return res.status(500).json({ message: 'Erro ao atualizar senha. Tente novamente.' });
    }

    const { error: dbError } = await supabase
      .from('usuarios')
      .update({ senha_temporaria: false })
      .eq('id', req.user.uid);

    if (dbError) {
      console.error('[trocarSenha] Erro ao atualizar usuarios:', dbError.message);
    }

    res.status(200).json({ message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    console.error('[trocarSenha] Erro inesperado:', error.message || error);
    res.status(500).json({ message: 'Erro inesperado ao atualizar senha.' });
  }
};

exports.esqueceuSenha = async (req, res) => {
  const { email } = req.body;

  try {
    const redirectTo = `${process.env.FRONTEND_URL || 'https://matopibalog.com.br'}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error('[esqueceuSenha] Supabase error:', error.status, error.message);
      return res.status(500).json({
        message: 'Erro ao enviar link de recuperação.',
        codigo: error.status,
        detalhe: error.message,
      });
    }

    res.json({ message: 'Link de recuperação enviado.' });
  } catch (err) {
    console.error('[esqueceuSenha] Exceção:', err.message || err);
    res.status(500).json({
      message: 'Erro ao enviar link de recuperação.',
      detalhe: err.message || 'Erro desconhecido',
    });
  }
};

// Reenvio do e-mail de confirmação de cadastro (self-service). Resposta SEMPRE
// genérica: não revela se o e-mail existe nem se há cadastro pendente (evita
// enumeração de contas). O envio em si é não-fatal.
exports.reenviarConfirmacao = async (req, res) => {
  const { email } = req.body;
  await enviarConfirmacaoEmail(email);
  return res.status(200).json({
    message: 'Se houver um cadastro pendente para este e-mail, enviamos um novo link de confirmação.',
  });
};

exports.registerEmpresa = async (req, res) => {
  const { nome, email, senha, empresa, cnpj, telefone, plano, plano_id } = req.body;

  if (!nome || !email || !senha || !empresa) {
    return res.status(400).json({ message: 'Campos obrigatórios: nome, email, senha, empresa.' });
  }

  try {
    // Se veio plano_id do catálogo público, exigir que exista e esteja ativo.
    // O alias legado (`plano`) continua aceito como fallback quando não há plano_id.
    if (plano_id) {
      const { data: planoSel, error: planoErr } = await supabase
        .from('planos')
        .select('id, ativo')
        .eq('id', plano_id)
        .maybeSingle();
      if (planoErr) {
        console.error('[registerEmpresa] Erro ao validar plano_id:', planoErr.message);
        return res.status(500).json({ message: 'Erro ao validar plano.' });
      }
      if (!planoSel || planoSel.ativo !== true) {
        return res.status(400).json({ message: 'Plano selecionado inválido ou indisponível.' });
      }
    }

    // 1. Criar empresa via helper (gera código, trial automático). plano_id tem
    // precedência sobre o alias legado dentro do criarEmpresaCompleta.
    const { empresa: empresaData, error: empresaError } = await criarEmpresaCompleta({
      nome: empresa,
      cnpj,
      email_contato: email,
      telefone,
      plano_id,
      planoAlias: plano,
      tipo: 'transportadora',
    });

    if (empresaError || !empresaData) {
      return res.status(500).json({ message: empresaError || 'Erro ao criar empresa.' });
    }

    // 2. Criar usuário admin no Supabase Auth.
    // Cadastro self-service da empresa → nasce NÃO confirmado; a confirmação do
    // e-mail é exigida antes do 1º login. O link vai logo após criar o usuário.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: false
    });

    if (authError) {
      await supabase.from('empresas').delete().eq('id', empresaData.id);
      return res.status(400).json({ message: authError.message });
    }

    // 3. Criar admin na tabela usuarios
    const { error: userError } = await supabase
      .from('usuarios')
      .insert({
        id: authData.user.id,
        nome,
        email,
        tipo: 'admin',
        status: 'ativo',
        empresa_id: empresaData.id,
        telefone: telefone || null
      });

    if (userError) {
      console.error('[registerEmpresa] Erro ao inserir usuario admin:', userError);
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => { });
      await supabase.from('empresas').delete().eq('id', empresaData.id);
      return res.status(500).json({ message: 'Erro ao salvar dados do usuário.' });
    }

    // Código promocional (mega-frente comercial): registra um RESGATE pendente
    // (fatura_id NULL) com o snapshot do preço promocional. É consumido quando a
    // 1ª fatura for gerada. Best-effort e DEFENSIVO: código inválido/expirado ou
    // tabela ausente NÃO bloqueia o cadastro (que já foi concluído acima).
    let promocao_aplicada = null;
    const codigoPromo = req.body && req.body.codigo_promocional;
    if (codigoPromo) {
      try {
        const { normalizarCodigo, avaliarResgate, aplicarPromocao, montarResgate } = require('../services/promocaoDomainService');
        const codigo = normalizarCodigo(codigoPromo);
        const { data: cod } = await supabase.from('promocao_codigos').select('*, promocoes(*)').ilike('codigo', codigo).maybeSingle();
        if (cod && cod.promocoes) {
          const promocao = cod.promocoes;
          const { data: planoRow } = await supabase.from('planos').select('id, preco_mensal, valor_implantacao').eq('id', empresaData.plano_id).maybeSingle();
          const aval = avaliarResgate({ promocao, codigoRegistro: cod, empresa: { id: empresaData.id }, planoEscolhidoId: empresaData.plano_id || null, resgatesDaEmpresa: [], agora: new Date(), manual: false });
          if (aval.ok && planoRow) {
            const efeito = aplicarPromocao({ promocao, precoMensalidade: Number(planoRow.preco_mensal), valorImplantacao: planoRow.valor_implantacao != null ? Number(planoRow.valor_implantacao) : null });
            if (efeito.ok) {
              const resgate = montarResgate({ promocao, codigoRegistro: cod, empresa: { id: empresaData.id }, aplicadoPor: null, manual: false, efeito, motivo: 'cadastro', precoOriginal: Number(planoRow.preco_mensal) });
              await supabase.from('promocao_resgates').insert(resgate); // fatura_id NULL = pendente
              // Contadores de uso (best-effort).
              await supabase.from('promocoes').update({ usos_total: (Number(promocao.usos_total) || 0) + 1 }).eq('id', promocao.id);
              if (cod.limite_usos != null) await supabase.from('promocao_codigos').update({ usos: (Number(cod.usos) || 0) + 1 }).eq('id', cod.id);
              promocao_aplicada = { tipo: promocao.tipo, campanha: promocao.nome, preco_promocional: efeito.mensalidade_final, implantacao_promocional: efeito.implantacao_final };
            }
          }
        }
      } catch (promoErr) {
        console.error('[registerEmpresa] promo (não-fatal):', promoErr.message);
      }
    }

    // Dispara o e-mail de confirmação (não-fatal) e sinaliza pendência ao cliente.
    let contratacao = null;
    if (empresaData.plano_id) {
      try {
        const { data: planoContrato } = await supabase
          .from('planos')
          .select('id, nome, preco_mensal, dias_trial, limite_motoristas, capacidade_inclusa, preco_motorista_extra, valor_implantacao, requer_negociacao')
          .eq('id', empresaData.plano_id)
          .maybeSingle();
        if (planoContrato) {
          contratacao = await criarPropostaEContrato({
            supabase,
            empresa: empresaData,
            responsavel: { nome, email },
            plano: planoContrato,
            origem: 'cadastro_publico',
            criadoPor: authData.user.id,
          });
        }
      } catch (contratoErr) {
        console.error('[registerEmpresa] contratacao (nao-fatal)', {
          motivo: contratoErr.motivo || contratoErr.code || 'erro',
        });
      }
    }

    await enviarConfirmacaoEmail(email);

    res.status(201).json({
      message: 'Cadastro realizado com sucesso!',
      empresa_id: empresaData.id,
      email_confirmacao_pendente: true,
      promocao_aplicada,
      contratacao: contratacao && !contratacao.skipped ? {
        proposta_id: contratacao.proposta_id,
        contrato_id: contratacao.contrato_id,
        implantacao: contratacao.snapshot?.implantacao_gratis ? 'gratis' : 'positiva',
        fatura_implantacao: contratacao.snapshot?.implantacao_gratis ? 'nao_criada' : 'pendente_autorizacao',
      } : null,
    });
  } catch (err) {
    console.error('Erro no register-empresa:', err);
    res.status(500).json({ message: 'Erro ao realizar cadastro.' });
  }
};
