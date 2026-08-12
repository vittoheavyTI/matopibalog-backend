import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/location_tracking_service.dart';
import '../services/push_service.dart';

enum AuthStatus { initial, loading, authenticated, unauthenticated, error }

/// Decide se uma falha do GET /auth/me durante o auto-login é TRANSITÓRIA e,
/// portanto, NÃO deve encerrar a sessão (o token JWT dura 7 dias e as telas
/// refazem o fetch quando o backend voltar). Espelha o tratamento do web
/// (AuthContext, PR #376): 429 (rate limit), 5xx (servidor) e 0 (exceção de
/// rede/timeout) são transitórios; 401/403 (token inválido/expirado) e demais
/// 4xx são definitivos e DEVEM deslogar. Função pura para ser testável.
bool ehFalhaTransitoriaAutoLogin(int status) =>
    status == 0 || status == 429 || status >= 500;

class AuthProvider extends ChangeNotifier {
  @visibleForTesting
  static bool skipExternalSideEffectsForTesting = false;

  // Token JWT vive no secure storage (Keystore/EncryptedSharedPreferences),
  // não mais em SharedPreferences (texto claro). Só é persistido quando o
  // usuário marca "Manter conectado neste aparelho".
  static const _tokenKey = 'token';
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  // Chaves não sensíveis (nome/role/uid/tipo) seguem em SharedPreferences,
  // apenas para restaurar a UI no auto-login. A senha NUNCA é salva.
  static const _prefKeysSessao = [
    'user_nome',
    'user_role',
    'user_uid',
    'user_empresa_tipo',
  ];

  AuthStatus _status = AuthStatus.initial;
  String _token = '';
  String _nome = '';
  String _role = '';
  String _uid = '';
  String _error = '';
  String _fotoUrl = '';
  String _empresaTipo = '';
  bool _senhaTemporaria = false;
  bool _termosPendentes = false;
  int _termosPendentesCount = 0;
  LogoutRemotoResult? _ultimoLogoutRemoto;
  // Login barrado por e-mail não confirmado (backend responde 403 { naoConfirmado }).
  // A tela usa isto para oferecer o reenvio do link — não é senha errada.
  bool _naoConfirmado = false;

  AuthStatus get status => _status;
  String get token => _token;
  String get nome => _nome;
  String get role => _role;
  String get uid => _uid;
  String get error => _error;
  String get fotoUrl => _fotoUrl;
  String get empresaTipo => _empresaTipo;
  bool get isAutonomo => _empresaTipo == 'autonomo';
  bool get senhaTemporaria => _senhaTemporaria;
  bool get termosPendentes => _termosPendentes;
  int get termosPendentesCount => _termosPendentesCount;
  bool get naoConfirmado => _naoConfirmado;
  bool get isLoggedIn => _status == AuthStatus.authenticated;
  bool get isMotorista => _role == 'motorista';
  LogoutRemotoResult? get ultimoLogoutRemoto => _ultimoLogoutRemoto;

  Future<void> tryAutoLogin() async {
    AppLogger.action('try_auto_login');
    _status = AuthStatus.loading;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();

    // Migração única: versões antigas guardavam o token em SharedPreferences
    // (texto claro). Move para o secure storage e apaga o resíduo antigo.
    final legacyToken = prefs.getString('token');
    if (legacyToken != null && legacyToken.isNotEmpty) {
      final existente = await _secureStorage.read(key: _tokenKey);
      if (existente == null) {
        await _secureStorage.write(key: _tokenKey, value: legacyToken);
      }
      await prefs.remove('token');
    }

    final token = await _secureStorage.read(key: _tokenKey);
    if (token == null || token.isEmpty) {
      AppLogger.action('try_auto_login', params: {'result': 'no_token'});
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }

    _token = token;
    ApiService.setSessionToken(token);
    ApiService.setSessionPersistence(SessionPersistence.persistent);
    _nome = prefs.getString('user_nome') ?? '';
    _role = prefs.getString('user_role') ?? '';
    _uid = prefs.getString('user_uid') ?? '';
    _empresaTipo = prefs.getString('user_empresa_tipo') ?? '';

    final resultado = await ApiService.getMeDetalhado();
    final profile = resultado.profile;
    if (profile != null) {
      _nome = profile['nome'] ?? _nome;
      _fotoUrl = profile['foto_url'] ?? '';
      // Restaura empresaTipo do perfil (fonte mais confiável que SharedPreferences)
      _empresaTipo =
          (profile['empresas'] as Map?)?['tipo'] as String? ?? _empresaTipo;
      // Restaura senha_temporaria do perfil: sem isso, ao reabrir o app com token
      // salvo o flag seria false e o motorista pularia a tela de troca de senha.
      _senhaTemporaria = profile['senha_temporaria'] == true;
      // Termos LGPD pendentes (gate após a troca de senha temporária).
      _termosPendentes = profile['termos_pendentes'] == true;
      _termosPendentesCount =
          (profile['termos_pendentes_count'] as num?)?.toInt() ?? 0;
      _status = AuthStatus.authenticated;
      // Registra o token de push para este aparelho (best-effort, não bloqueia).
      if (!skipExternalSideEffectsForTesting) {
        PushService.registrarTokenAposLogin();
      }
      AppLogger.action(
        'try_auto_login',
        params: {'result': 'success', 'user': _nome},
      );
    } else if (ehFalhaTransitoriaAutoLogin(resultado.status)) {
      // Falha TRANSITÓRIA (429 rate limit / 5xx / rede): NÃO desloga nem apaga o
      // token. Mantém a sessão restaurada das prefs (nome/role/uid já lidos) e
      // segue autenticado; as telas refazem o fetch quando o backend voltar.
      _status = AuthStatus.authenticated;
      AppLogger.action(
        'try_auto_login',
        params: {'result': 'transient_kept', 'status': resultado.status},
      );
    } else {
      // Definitiva (401/403 = token inválido/expirado, ou 4xx): encerra a sessão.
      await _limparSessao(prefs);
      _token = '';
      _status = AuthStatus.unauthenticated;
      AppLogger.action(
        'try_auto_login',
        params: {'result': 'api_failed', 'status': resultado.status},
      );
    }
    notifyListeners();
  }

  /// Remove a sessão persistida (token seguro + chaves não sensíveis + resíduo
  /// legado), sem usar prefs.clear() para não apagar preferências de outros
  /// módulos, como o tema (theme_mode).
  Future<void> _limparSessao(SharedPreferences prefs) async {
    await ApiService.clearPersistedSession();
    await prefs.remove('token'); // legado em texto claro
    for (final k in _prefKeysSessao) {
      await prefs.remove(k);
    }
  }

  Future<bool> login(
    String email,
    String senha, {
    bool manterConectado = true,
  }) async {
    AppLogger.action('login_attempt', params: {'email': email});
    _status = AuthStatus.loading;
    _error = '';
    _naoConfirmado = false;
    notifyListeners();

    final res = await ApiService.login(email, senha);
    if (res == null || res['_error'] == true) {
      _status = AuthStatus.error;
      final httpStatus = res?['_status'] as int? ?? 0;
      if (httpStatus == 0) {
        // Exceção de rede (sem conexão, timeout, SSL) — _body não é JSON
        _error =
            'Não foi possível conectar ao servidor. Verifique sua conexão.';
      } else {
        // Resposta HTTP do backend — extrair mensagem do JSON
        try {
          final body = jsonDecode(res?['_body'] as String? ?? '{}');
          _error =
              body['message'] ?? body['error'] ?? 'E-mail ou senha incorretos.';
          // 403 { naoConfirmado } = e-mail ainda não confirmado (não é senha
          // errada): a tela oferece o reenvio do link de confirmação.
          if (httpStatus == 403 && body['naoConfirmado'] == true) {
            _naoConfirmado = true;
          }
        } catch (_) {
          _error = 'Erro inesperado ao processar resposta do servidor.';
        }
      }
      AppLogger.action(
        'login_error',
        params: {'email': email, 'status': httpStatus, 'error': _error},
      );
      notifyListeners();
      return false;
    }

    // role lido de forma tolerante (String?): cobre null/undefined sem lançar no cast,
    // permitindo rejeitá-los pela allowlist abaixo.
    final userRole = res['user']['role']?.toString();
    final userStatus = res['user']['status'] as String;

    if (userStatus == 'pendente') {
      _status = AuthStatus.error;
      _error = 'Sua conta está aguardando aprovação.';
      AppLogger.action(
        'login_error',
        params: {'email': email, 'error': 'pendente'},
      );
      notifyListeners();
      return false;
    }

    // App é exclusivo de motorista (regra de produto). Allowlist explícita: somente
    // role == 'motorista' entra. Admin, operador, auxiliar, roles futuros e null/undefined
    // são rejeitados aqui — o painel é o canal de admin/auxiliar. NÃO usa empresas.tipo nem
    // nome para decidir acesso: empresa.tipo serve só ao modelo financeiro (autônomo x vinculado).
    if (userRole != 'motorista') {
      _status = AuthStatus.error;
      _error = 'Este acesso é permitido apenas para motoristas no aplicativo.';
      AppLogger.action(
        'login_error',
        params: {
          'email': email,
          'error': 'role_nao_motorista',
          'role': userRole ?? 'null',
        },
      );
      notifyListeners();
      return false;
    }

    // SEC-1 hardening (FAIL-CLOSED): o app só aceita a sessão se o backend RESOLVEU
    // client_type=android E entregou refresh_token não vazio. Um contrato "web"
    // (sem refresh / resolved_client_type=web) foi a causa do achado forense (sessão
    // web em UA mobile). Aqui NÃO persistimos nada — devolvemos erro claro e paramos.
    // Requer backend que ecoa resolved_client_type (SEC-1 hardening) — o APK novo e o
    // backend novo DEVEM ser implantados juntos.
    if (!ApiService.isHealthyMobileLoginResponse(
      res,
      expectedClientType: ApiService.expectedClientType,
    )) {
      _status = AuthStatus.error;
      _error =
          'Não foi possível iniciar uma sessão segura no aplicativo. Tente novamente; '
          'se persistir, reinstale o app na versão mais recente.';
      final refreshPresente = res['refresh_token'] is String &&
          (res['refresh_token'] as String).trim().isNotEmpty;
      AppLogger.action('login_error', params: {
        'email': email,
        'error': 'contrato_login_nao_mobile',
        'resolved_client_type':
            res['resolved_client_type']?.toString() ?? 'ausente',
        'has_refresh': refreshPresente.toString(),
      });
      notifyListeners();
      return false;
    }

    final prefs = await SharedPreferences.getInstance();
    _token = res['token'];
    final refreshToken = res['refresh_token'] as String?;
    _nome = res['user']['nome'];
    _role = userRole!; // garantido 'motorista' pela allowlist acima
    _uid = res['user']['uid'];
    _fotoUrl = res['user']['foto_url'] ?? '';
    _empresaTipo = res['user']['empresa_tipo'] as String? ?? '';
    _senhaTemporaria = res['user']['senha_temporaria'] == true;

    await ApiService.setSessionTokens(
      accessToken: _token,
      refreshToken: refreshToken,
      persistence: manterConectado
          ? SessionPersistence.persistent
          : SessionPersistence.memoryOnly,
    );

    if (manterConectado) {
      await prefs.setString('user_role', _role);
      await prefs.setString('user_nome', _nome);
      await prefs.setString('user_uid', _uid);
      await prefs.setString('user_empresa_tipo', _empresaTipo);
    } else {
      await prefs.remove('token'); // legado em texto claro
      for (final k in _prefKeysSessao) {
        await prefs.remove(k);
      }
    }

    // O /auth/login NÃO retorna termos_pendentes (só /auth/me calcula). Busca o
    // perfil para acionar o gate de termos sem depender de reabrir o app. Feito
    // ANTES de marcar autenticado para evitar piscar o AppShell antes do gate.
    final profile = await ApiService.getMe();
    if (profile != null) {
      _senhaTemporaria = profile['senha_temporaria'] == true;
      _termosPendentes = profile['termos_pendentes'] == true;
      _termosPendentesCount =
          (profile['termos_pendentes_count'] as num?)?.toInt() ?? 0;
    }

    _status = AuthStatus.authenticated;
    // Registra o token de push para este aparelho (best-effort, não bloqueia o login).
    if (!skipExternalSideEffectsForTesting) {
      PushService.registrarTokenAposLogin();
    }
    AppLogger.action('login_success', params: {'email': email, 'user': _nome});
    notifyListeners();
    return true;
  }

  void atualizarFotoUrl(String url) {
    // Remove cache-buster anterior se presente, depois adiciona novo timestamp.
    // Isso força o NetworkImage a recarregar a imagem mesmo quando o filename
    // no Supabase Storage não muda entre uploads.
    final base = url.contains('?') ? url.split('?').first : url;
    _fotoUrl = '$base?t=${DateTime.now().millisecondsSinceEpoch}';
    notifyListeners();
  }

  void limparSenhaTemporaria() {
    _senhaTemporaria = false;
    notifyListeners();
  }

  /// Chamado pela TermosPendentesScreen quando todos os termos obrigatórios
  /// foram aceitos. O Consumer<AuthProvider> em main.dart troca para o AppShell.
  void marcarTermosAceitos() {
    _termosPendentes = false;
    _termosPendentesCount = 0;
    notifyListeners();
  }

  Future<void> logout() async {
    AppLogger.action('logout', params: {'user': _nome});
    if (!skipExternalSideEffectsForTesting) {
      await LocationTrackingService.stop();
      // Desativa o token de push deste aparelho antes de limpar a sessao.
      // Best-effort: se falhar (offline), o backend desativa no primeiro envio
      // que retornar token invalido.
      await PushService.removerTokenNoLogout();
    }
    _ultimoLogoutRemoto = await ApiService.logoutRemoto();
    final prefs = await SharedPreferences.getInstance();
    await _limparSessao(prefs);
    _token = '';
    _nome = '';
    _role = '';
    _uid = '';
    _empresaTipo = '';
    _senhaTemporaria = false;
    _termosPendentes = false;
    _termosPendentesCount = 0;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
