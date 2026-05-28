import 'package:flutter/material.dart';
import 'package:workmanager/workmanager.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'services/offline_sync.dart';

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    // Tenta sincronizar dados pendentes quando houver internet
    await OfflineSync.syncPendingTasks();
    return Future.value(true);
  });
}

void main() async {
  try {
    WidgetsFlutterBinding.ensureInitialized();
    
    // Inicializa Workmanager (pode falhar na Web ou se não configurado)
    await Workmanager().initialize(callbackDispatcher, isInDebugMode: true);

    final prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('token');

    runApp(ChoferLogApp(isLoggedIn: token != null));
  } catch (e, stackTrace) {
    runApp(MaterialApp(
      home: Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Text('Erro fatal na inicialização:\n$e\n\n$stackTrace', 
              style: const TextStyle(color: Colors.red)),
          ),
        ),
      ),
    ));
  }
}

class ChoferLogApp extends StatelessWidget {
  final bool isLoggedIn;
  
  const ChoferLogApp({super.key, required this.isLoggedIn});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Chofer Log',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primarySwatch: Colors.blue,
        useMaterial3: true,
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.blue,
            foregroundColor: Colors.white,
          ),
        ),
      ),
      home: isLoggedIn ? const HomeScreen() : const LoginScreen(),
    );
  }
}
