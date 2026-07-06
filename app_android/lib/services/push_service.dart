import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../screens/notificacoes_screen.dart';
import 'api_service.dart';
import 'app_logger.dart';

/// Handler de mensagens recebidas com o app em segundo plano ou terminado.
/// Precisa ser top-level e anotado como entry-point (roda em isolate proprio).
/// Mensagens do tipo "notification" ja sao exibidas pelo sistema; mantido para
/// eventual tratamento de data-only messages no futuro.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Sem acao: o FCM ja exibe a notificacao. Nao logamos conteudo aqui.
}

/// Push (FCM) integrado as notificacoes internas.
///
/// Toda a classe e TOLERANTE a ausencia de Firebase: se o app nao tiver
/// google-services.json configurado, [init] apenas marca push como desabilitado
/// e o app segue funcionando com as notificacoes internas. Nenhum metodo lanca.
class PushService {
  PushService._();

  static final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  static final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();

  static bool _configurado = false;
  static GlobalKey<NavigatorState>? _navigatorKey;

  /// Callback opcional para a UI (AppShell) recarregar o contador do sino ao
  /// receber um push em primeiro plano.
  static void Function()? onPushRecebido;

  /// Canal Android. O id deve casar com o meta-data do AndroidManifest e com o
  /// channelId enviado pelo backend (pushService.js).
  static const AndroidNotificationChannel _canal = AndroidNotificationChannel(
    'matopibalog_notificacoes',
    'Notificações',
    description: 'Avisos de fretes, lançamentos e aprovações.',
    importance: Importance.high,
  );

  static bool get configurado => _configurado;

  /// Inicializa o Firebase e o pipeline de mensagens. Retorna false (sem lançar)
  /// quando o Firebase não está configurado neste build.
  static Future<bool> init(GlobalKey<NavigatorState> navigatorKey) async {
    _navigatorKey = navigatorKey;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      // Sem google-services.json → segue sem push (só notificações internas).
      AppLogger.warning('PushService', 'Firebase não configurado; push desabilitado ($e)');
      _configurado = false;
      return false;
    }

    _configurado = true;
    try {
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      const initAndroid = AndroidInitializationSettings('@mipmap/ic_launcher');
      await _local.initialize(
        const InitializationSettings(android: initAndroid),
        onDidReceiveNotificationResponse: (_) => _abrirNotificacoes(),
      );
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_canal);

      // Foreground: o FCM não exibe automaticamente — mostramos via plugin local.
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      // App em background aberto ao tocar na notificação.
      FirebaseMessaging.onMessageOpenedApp.listen((_) => _abrirNotificacoes());
      // App terminado aberto pela notificação.
      final inicial = await _messaging.getInitialMessage();
      if (inicial != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _abrirNotificacoes());
      }
    } catch (e) {
      AppLogger.error('PushService', 'Falha ao configurar messaging', e);
    }
    return true;
  }

  /// Pede permissão (Android 13+/iOS), obtém o token FCM e registra no backend.
  /// Chamado após o login. Best-effort: falha nunca quebra o login.
  static Future<void> registrarTokenAposLogin() async {
    if (!_configurado) return;
    try {
      await _messaging.requestPermission(alert: true, badge: true, sound: true);
      final token = await _messaging.getToken();
      if (token != null && token.isNotEmpty) {
        await ApiService.registrarPushToken(token);
      }
      // Renovação do token: re-registra automaticamente.
      _messaging.onTokenRefresh.listen((novo) {
        if (novo.isNotEmpty) ApiService.registrarPushToken(novo);
      });
    } catch (e) {
      AppLogger.error('PushService', 'Falha ao registrar token', e);
    }
  }

  /// Desativa o token atual no backend (logout). Best-effort.
  static Future<void> removerTokenNoLogout() async {
    if (!_configurado) return;
    try {
      final token = await _messaging.getToken();
      if (token != null && token.isNotEmpty) {
        await ApiService.removerPushToken(token);
      }
    } catch (e) {
      AppLogger.error('PushService', 'Falha ao remover token', e);
    }
  }

  /// Limpa as notificações da bandeja do sistema (e, na maioria dos launchers,
  /// o badge numérico associado ao ícone). Chamado ao marcar todas como lidas —
  /// não faz sentido o ícone continuar com número se não há nada não lido.
  /// Best-effort: nunca lança. Obs.: não existe API universal para o badge do
  /// launcher sem dependência extra; cancelAll cobre a bandeja e o caso comum.
  static Future<void> limparNotificacoesBandeja() async {
    try {
      await _local.cancelAll();
    } catch (e) {
      AppLogger.error('PushService', 'Falha ao limpar notificacoes da bandeja', e);
    }
  }

  static void _onForegroundMessage(RemoteMessage message) {
    final n = message.notification;
    if (n != null) {
      _local.show(
        n.hashCode,
        n.title,
        n.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _canal.id,
            _canal.name,
            channelDescription: _canal.description,
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
      );
    }
    // Atualiza o badge do sino imediatamente.
    onPushRecebido?.call();
  }

  static void _abrirNotificacoes() {
    final nav = _navigatorKey?.currentState;
    if (nav == null) return;
    nav.push(MaterialPageRoute(builder: (_) => const NotificacoesScreen()));
  }
}
