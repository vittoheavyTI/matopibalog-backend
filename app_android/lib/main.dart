import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:workmanager/workmanager.dart';
import 'providers/auth_provider.dart';
import 'providers/finance_provider.dart';
import 'providers/theme_provider.dart';
import 'screens/login_screen.dart';
import 'screens/app_shell.dart';
import 'screens/trocar_senha_screen.dart';
import 'screens/termos_pendentes_screen.dart';
import 'services/offline_sync.dart';
import 'services/push_service.dart';
import 'services/location_tracking_service.dart';
import 'widgets/app_update_gate.dart';

/// Navigator global — permite ao PushService abrir a tela de Notificações ao
/// tocar num push, mesmo fora da árvore de widgets.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    await OfflineSync.syncPendingTasks();
    return Future.value(true);
  });
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Série 1: app apenas em retrato. Paisagem causava overflows (seletor de
  // frete, drawer, bottom sheets). Suporte a paisagem/tablet fica no backlog.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
  ]);

  try {
    await Workmanager().initialize(callbackDispatcher);
  } catch (_) {}

  final themeProvider = ThemeProvider();
  await themeProvider.init();
  await LocationTrackingService.restoreSnapshot();

  // Inicializa push (FCM). Tolerante: sem google-services.json apenas desabilita
  // o push e o app segue com as notificações internas.
  await PushService.init(rootNavigatorKey);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ThemeProvider>.value(value: themeProvider),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => FinanceProvider()),
      ],
      child: const MatopibaLogApp(),
    ),
  );
}

// Tipografia central com fontes maiores para legibilidade — pensado em
// motoristas com baixa visão de perto. Sem cor (o ColorScheme aplica onSurface),
// só tamanhos/pesos; entradas não citadas caem no default do Material 3.
const TextTheme _appTextTheme = TextTheme(
  titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
  titleMedium: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
  bodyLarge: TextStyle(fontSize: 17),
  bodyMedium: TextStyle(fontSize: 15),
  bodySmall: TextStyle(fontSize: 13),
  labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
);

// Botão primário maior e mais alto (toque/leitura mais fáceis). Compartilhado
// pelos temas claro e escuro — a cor vem do ColorScheme/tema.
final ElevatedButtonThemeData _elevatedButtonTheme = ElevatedButtonThemeData(
  style: ElevatedButton.styleFrom(
    backgroundColor: const Color(0xFF1B5E20),
    foregroundColor: Colors.white,
    minimumSize: const Size(0, 52),
    textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
  ),
);

class MatopibaLogApp extends StatelessWidget {
  const MatopibaLogApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Matopiba Log',
      navigatorKey: rootNavigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: const ColorScheme(
          brightness: Brightness.light,
          primary: Color(0xFF1B5E20),
          onPrimary: Colors.white,
          secondary: Color(0xFF827717),
          onSecondary: Colors.white,
          error: Color(0xFFB00020),
          onError: Colors.white,
          surface: Colors.white,
          onSurface: Colors.black,
        ),
        scaffoldBackgroundColor: const Color(0xFFF3F4F6),
        textTheme: _appTextTheme,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1B5E20),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        elevatedButtonTheme: _elevatedButtonTheme,
        // Links/botões de texto legíveis no claro: verde da marca (bom contraste
        // sobre fundo claro) e fonte maior.
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            foregroundColor: const Color(0xFF1B5E20),
            textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        cardTheme: CardThemeData(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          elevation: 4,
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: Color(0xFF1B5E20),
          contentTextStyle: TextStyle(color: Colors.white),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: const ColorScheme(
          brightness: Brightness.dark,
          primary: Color(0xFF1B5E20),
          onPrimary: Colors.white,
          secondary: Color(0xFF827717),
          onSecondary: Colors.white,
          error: Color(0xFFCF6679),
          onError: Colors.black,
          surface: Color(0xFF1E1E1E),
          onSurface: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFF121212),
        textTheme: _appTextTheme,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1B5E20),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        elevatedButtonTheme: _elevatedButtonTheme,
        // No escuro o verde da marca fica ilegível sobre o fundo quase-preto.
        // Links/botões de texto (ex.: "Ver histórico completo") ficam BRANCOS.
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            foregroundColor: Colors.white,
            textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        cardTheme: CardThemeData(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          elevation: 4,
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: Color(0xFF1B5E20),
          contentTextStyle: TextStyle(color: Colors.white),
        ),
      ),
      themeMode: context.watch<ThemeProvider>().themeMode,
      // Gate de versão (MOBILE-M1-008): envolve o home para que uma atualização
      // OBRIGATÓRIA bloqueie o app mesmo antes do login. Recommended/optional
      // apenas avisam. Fallback seguro: falha de rede não bloqueia.
      home: const AppUpdateGate(child: SplashScreen()),
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuthProvider>().tryAutoLogin();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        switch (auth.status) {
          case AuthStatus.authenticated:
            // Ordem do gate: senha temporária SEMPRE tem prioridade sobre termos.
            if (auth.senhaTemporaria) return const TrocarSenhaScreen();
            if (auth.termosPendentes) return const TermosPendentesScreen();
            return const AppShell();
          case AuthStatus.unauthenticated:
            return const LoginScreen();
          case AuthStatus.loading:
          case AuthStatus.initial:
            return const _SplashBody();
          case AuthStatus.error:
            return const LoginScreen();
        }
      },
    );
  }
}

class _SplashBody extends StatelessWidget {
  const _SplashBody();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset('assets/LOGOMARCA.png', height: 120, fit: BoxFit.contain),
            const SizedBox(height: 32),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
