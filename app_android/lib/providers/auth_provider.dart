import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';

enum AuthStatus { initial, loading, authenticated, unauthenticated, error }

class AuthProvider extends ChangeNotifier {
  AuthStatus _status = AuthStatus.initial;
  String _token = '';
  String _nome = '';
  String _role = '';
  String _uid = '';
  String _error = '';

  AuthStatus get status => _status;
  String get token => _token;
  String get nome => _nome;
  String get role => _role;
  String get uid => _uid;
  String get error => _error;
  bool get isLoggedIn => _status == AuthStatus.authenticated;
  bool get isMotorista => _role == 'motorista';

  Future<void> tryAutoLogin() async {
    _status = AuthStatus.loading;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    if (token == null) {
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }

    _token = token;
    _nome = prefs.getString('user_nome') ?? '';
    _role = prefs.getString('user_role') ?? '';
    _uid = prefs.getString('user_uid') ?? '';

    final profile = await ApiService.getMe();
    if (profile != null) {
      _nome = profile['nome'] ?? _nome;
      _status = AuthStatus.authenticated;
    } else {
      await prefs.clear();
      _token = '';
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<bool> login(String email, String senha) async {
    _status = AuthStatus.loading;
    _error = '';
    notifyListeners();

    final res = await ApiService.login(email, senha);
    if (res == null || res['_error'] == true) {
      _status = AuthStatus.error;
      // Tenta extrair mensagem do backend, senão usa mensagem genérica
      try {
        if (res != null && res['_body'] != null) {
          final body = jsonDecode(res['_body'] as String);
          _error = body['message'] ?? body['error'] ?? 'E-mail ou senha incorretos.';
        } else {
          _error = 'Não foi possível conectar ao servidor.';
        }
      } catch (_) {
        _error = 'E-mail ou senha incorretos.';
      }
      notifyListeners();
      return false;
    }

    final userRole = res['user']['role'] as String;
    final userStatus = res['user']['status'] as String;

    if (userStatus == 'pendente') {
      _status = AuthStatus.error;
      _error = 'Sua conta está aguardando aprovação.';
      notifyListeners();
      return false;
    }

    if (userRole == 'admin') {
      _status = AuthStatus.error;
      _error = 'Acesso ao App restrito para motoristas.';
      notifyListeners();
      return false;
    }

    final prefs = await SharedPreferences.getInstance();
    _token = res['token'];
    _nome = res['user']['nome'];
    _role = userRole;
    _uid = res['user']['uid'];

    await prefs.setString('token', _token);
    await prefs.setString('user_role', _role);
    await prefs.setString('user_nome', _nome);
    await prefs.setString('user_uid', _uid);

    _status = AuthStatus.authenticated;
    notifyListeners();
    return true;
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    _token = '';
    _nome = '';
    _role = '';
    _uid = '';
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}