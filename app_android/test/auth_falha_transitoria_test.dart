import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/providers/auth_provider.dart';

/// Trava anti-regressão do falso logout em 429 (objetivo ePOD v2 #11).
///
/// No cold-start, o auto-login busca GET /auth/me. Uma falha TRANSITÓRIA
/// (429 rate limit, 5xx, ou exceção de rede/timeout=0) NÃO pode encerrar a
/// sessão — o token JWT dura 7 dias e as telas refazem o fetch depois. Só
/// 401/403 (token inválido/expirado) e demais 4xx devem deslogar. Espelha o
/// tratamento do web (AuthContext, PR #376). O helper é puro e testável.
void main() {
  group('ehFalhaTransitoriaAutoLogin — preserva sessão', () {
    test('429 (rate limit) é transitório → NÃO desloga', () {
      expect(ehFalhaTransitoriaAutoLogin(429), isTrue);
    });

    test('0 (exceção de rede/timeout) é transitório → NÃO desloga', () {
      expect(ehFalhaTransitoriaAutoLogin(0), isTrue);
    });

    test('5xx (servidor) é transitório → NÃO desloga', () {
      for (final s in const [500, 502, 503, 504]) {
        expect(ehFalhaTransitoriaAutoLogin(s), isTrue, reason: 'status $s');
      }
    });
  });

  group('ehFalhaTransitoriaAutoLogin — encerra sessão (definitivo)', () {
    test('401 (token inválido/expirado) → desloga', () {
      expect(ehFalhaTransitoriaAutoLogin(401), isFalse);
    });

    test('403 (proibido) → desloga', () {
      expect(ehFalhaTransitoriaAutoLogin(403), isFalse);
    });

    test('demais 4xx (400/404/409) → desloga', () {
      for (final s in const [400, 404, 409]) {
        expect(ehFalhaTransitoriaAutoLogin(s), isFalse, reason: 'status $s');
      }
    });
  });
}
