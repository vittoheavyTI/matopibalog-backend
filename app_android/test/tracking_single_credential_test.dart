import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/location_tracking_service.dart';

/// BLOCKER-1 (single_native_tracking_credential): o app NÃO pode re-emitir uma nova
/// credencial a cada reconcile/resume/timer de foreground. Testa o predicado PURO do
/// guard de reuso e a assinatura de escopo (detecção de mudança legítima de viagens),
/// sem depender de plataforma (Geolocator/MethodChannel).
void main() {
  const nominalTtlMs = 24 * 60 * 60 * 1000; // 24h nominal
  final now = DateTime.now().millisecondsSinceEpoch;
  final validExpiry = now + nominalTtlMs;

  setUp(LocationTrackingService.resetTrackingStateForTesting);

  group('assinatura de escopo', () {
    List<Map<String, dynamic>> fretes(List<String> ativos, {List<String> outros = const []}) => [
          for (final id in ativos) {'id': id, 'status': 'ativo'},
          for (final id in outros) {'id': id, 'status': 'finalizado'},
        ];

    test('mesmo conjunto de viagens ativas → mesma assinatura (independe de ordem)', () {
      final a = LocationTrackingService.scopeSignatureForTesting(fretes(['f2', 'f1']));
      final b = LocationTrackingService.scopeSignatureForTesting(fretes(['f1', 'f2']));
      expect(a, b);
      expect(a, 'f1,f2');
    });

    test('finalizadas/canceladas não entram na assinatura', () {
      final sig = LocationTrackingService.scopeSignatureForTesting(
        fretes(['f1'], outros: ['f9']),
      );
      expect(sig, 'f1');
    });

    test('nova viagem muda a assinatura → escopo diferente', () {
      final antes = LocationTrackingService.scopeSignatureForTesting(fretes(['f1', 'f2']));
      final depois = LocationTrackingService.scopeSignatureForTesting(fretes(['f1', 'f2', 'f3']));
      expect(antes == depois, isFalse);
    });
  });

  group('guard de reuso da credencial', () {
    test('1º start (nativo inativo) → NÃO reusa (precisa emitir)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: false, credentialMode: false,
          currentSig: null, requestedSig: 'f1,f2',
          expiresAtMs: validExpiry, nowMs: now,
        ),
        isFalse,
      );
    });

    test('resume/reconcile com MESMO escopo e credencial válida → REUSA (não re-emite)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2',
          expiresAtMs: validExpiry, nowMs: now,
        ),
        isTrue,
      );
    });

    test('mudança legítima de escopo (nova viagem) → NÃO reusa (re-emite)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2,f3',
          expiresAtMs: validExpiry, nowMs: now,
        ),
        isFalse,
      );
    });

    test('credencial perto do vencimento nominal → NÃO reusa (re-emite/renova)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2',
          expiresAtMs: now + 30 * 1000, nowMs: now, // 30s p/ expirar (< margem)
        ),
        isFalse,
      );
    });

    test('modo legacy (flag OFF, sem credencial) → NÃO reusa (access token rotaciona)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: false,
          currentSig: null, requestedSig: 'f1,f2',
          expiresAtMs: 0, nowMs: now,
        ),
        isFalse,
      );
    });

    test('scopeSignature nula (chamada por contagem) → NÃO reusa (backend deduplica)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: null,
          expiresAtMs: validExpiry, nowMs: now,
        ),
        isFalse,
      );
    });

    test('após reset (logout/stop) → estado inativo, guard não reusa', () {
      LocationTrackingService.resetTrackingStateForTesting();
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: false, credentialMode: false,
          currentSig: null, requestedSig: 'f1,f2',
          expiresAtMs: 0, nowMs: now,
        ),
        isFalse,
      );
    });
  });
}
