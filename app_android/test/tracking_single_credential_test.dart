import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/location_tracking_service.dart';

/// BLOCKER-1 (single_native_tracking_credential): o app NÃO pode re-emitir uma nova
/// credencial a cada reconcile/resume/timer de foreground. Testa o predicado PURO do
/// guard de reuso e a assinatura de escopo (detecção de mudança legítima de viagens),
/// sem depender de plataforma (Geolocator/MethodChannel).
void main() {
  const maxTtlMs = 7 * 24 * 60 * 60 * 1000; // teto absoluto (~7d)
  final now = DateTime.now().millisecondsSinceEpoch;
  final validExpiry = now + maxTtlMs;

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
          maxExpiresAtMs: validExpiry, nowMs: now,
        ),
        isFalse,
      );
    });

    test('resume/reconcile com MESMO escopo e credencial válida → REUSA (não re-emite)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2',
          maxExpiresAtMs: validExpiry, nowMs: now,
        ),
        isTrue,
      );
    });

    test('mudança legítima de escopo (nova viagem) → NÃO reusa (re-emite)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2,f3',
          maxExpiresAtMs: validExpiry, nowMs: now,
        ),
        isFalse,
      );
    });

    test('credencial perto do TETO absoluto → NÃO reusa (re-emite)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: 'f1,f2',
          maxExpiresAtMs: now + 30 * 1000, nowMs: now, // 30s p/ expirar (< margem)
        ),
        isFalse,
      );
    });

    test('modo legacy (flag OFF, sem credencial) → NÃO reusa (access token rotaciona)', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: false,
          currentSig: null, requestedSig: 'f1,f2',
          maxExpiresAtMs: 0, nowMs: now,
        ),
        isFalse,
      );
    });

    test('scopeSignature nula → NÃO reusa (o backend NÃO deduplica; emissão é centralizada '
        'na reconciliação por IDs — Fase 4)', () {
      // Correção da premissa falsa: cada POST cria uma credencial nova e revoga a anterior.
      // Um caminho sem escopo não pode reusar às cegas; a decisão de emissão é da reconciliação.
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: true, credentialMode: true,
          currentSig: 'f1,f2', requestedSig: null,
          maxExpiresAtMs: validExpiry, nowMs: now,
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
          maxExpiresAtMs: 0, nowMs: now,
        ),
        isFalse,
      );
    });

    test('nativo NÃO vivo (active=false) → NÃO reutiliza silenciosamente credencial', () {
      expect(
        LocationTrackingService.shouldReuseCredential(
          active: false,
          credentialMode: true,
          currentSig: 'f1,f2',
          requestedSig: 'f1,f2',
          maxExpiresAtMs: validExpiry,
          nowMs: now,
        ),
        isFalse,
      );
    });
  });

  group('estado nativo tri-state (parse + liveness)', () {
    test('parseNativeState: só nomes conhecidos; null/desconhecido → stopped (fail-safe)', () {
      expect(LocationTrackingService.parseNativeState('running'), NativeTrackingState.running);
      expect(LocationTrackingService.parseNativeState('starting'), NativeTrackingState.starting);
      expect(LocationTrackingService.parseNativeState('terminal'), NativeTrackingState.terminal);
      expect(LocationTrackingService.parseNativeState('stopped'), NativeTrackingState.stopped);
      expect(LocationTrackingService.parseNativeState(null), NativeTrackingState.stopped);
      expect(LocationTrackingService.parseNativeState('qualquer'), NativeTrackingState.stopped);
      expect(LocationTrackingService.parseNativeState(1), NativeTrackingState.stopped);
    });

    test('nativeStateIsAlive: starting e running são vivos; stopped e terminal não', () {
      expect(LocationTrackingService.nativeStateIsAlive(NativeTrackingState.starting), isTrue);
      expect(LocationTrackingService.nativeStateIsAlive(NativeTrackingState.running), isTrue);
      expect(LocationTrackingService.nativeStateIsAlive(NativeTrackingState.stopped), isFalse);
      expect(LocationTrackingService.nativeStateIsAlive(NativeTrackingState.terminal), isFalse);
    });

    test('nativeTrackingState é fail-safe fora do Android (host) → stopped', () async {
      expect(await LocationTrackingService.nativeTrackingState(), NativeTrackingState.stopped);
    });
  });

  group('classifyStartDecision (máquina de reconciliação — decisão de emissão)', () {
    String decide({
      required bool trackingActive,
      required bool nativeAlive,
      bool credentialMode = true,
      String? currentSig,
      String? requestedSig,
      int? maxExpiresAtMs,
    }) =>
        LocationTrackingService.classifyStartDecision(
          trackingActive: trackingActive,
          nativeAlive: nativeAlive,
          credentialMode: credentialMode,
          currentSig: currentSig,
          requestedSig: requestedSig,
          maxExpiresAtMs: maxExpiresAtMs ?? validExpiry,
          nowMs: now,
        );

    test('1ª emissão (nada ativo, nativo não vivo) → issue', () {
      expect(decide(trackingActive: false, nativeAlive: false, requestedSig: 'f1,f2'), 'issue');
    });

    test('STARTING + MESMO escopo → reuse (fecha a native_start_ack_race)', () {
      expect(
        decide(trackingActive: true, nativeAlive: true, currentSig: 'f1,f2', requestedSig: 'f1,f2'),
        'reuse',
      );
    });

    test('RUNNING + MESMO escopo → reuse (não reemite)', () {
      expect(
        decide(trackingActive: true, nativeAlive: true, currentSig: 'f1,f2', requestedSig: 'f1,f2'),
        'reuse',
      );
    });

    test('nativo TERMINAL/morto após ter estado marcado → recover (recuperação controlada)', () {
      expect(
        decide(trackingActive: true, nativeAlive: false, currentSig: 'f1,f2', requestedSig: 'f1,f2'),
        'recover',
      );
    });

    test('mudança real de conjunto de viagens (mesmo com nativo vivo) → issue (1 nova emissão)', () {
      expect(
        decide(trackingActive: true, nativeAlive: true, currentSig: 'f1,f2', requestedSig: 'f1,f2,f3'),
        'issue',
      );
    });

    test('escopo-null NÃO reusa → issue (não decide reescopo às cegas)', () {
      expect(
        decide(trackingActive: true, nativeAlive: true, currentSig: 'f1,f2', requestedSig: null),
        'issue',
      );
    });

    // ACEITAÇÃO do incidente físico: emit#1 → STARTING → reconcile → reconcile ⇒ 1 emissão.
    // Modela a máquina de reconciliação (o fluxo completo só roda no Android). Cada 'issue'/
    // 'recover' conta como uma emissão; 'reuse' não emite.
    test('emit#1 → STARTING → reconcile imediato → reconcile ⇒ issueTrackingCredential == 1', () {
      // Estado client espelhando o fluxo.
      var trackingActive = false;
      var credentialMode = false;
      String? currentSig;
      var maxExp = 0;
      const sig = 'f1,f2';
      var emissoes = 0;

      // Aplica a decisão para um reconcile com escopo `sig` e um estado nativo `nativeAlive`.
      void reconcile({required bool nativeAlive}) {
        final d = LocationTrackingService.classifyStartDecision(
          trackingActive: trackingActive,
          nativeAlive: nativeAlive,
          credentialMode: credentialMode,
          currentSig: currentSig,
          requestedSig: sig,
          maxExpiresAtMs: trackingActive ? maxExp : validExpiry,
          nowMs: now,
        );
        if (d == 'reuse') return; // não emite
        // issue/recover: emite e marca estado (como _startSessionInner no sucesso).
        emissoes++;
        trackingActive = true;
        credentialMode = true;
        currentSig = sig;
        maxExp = validExpiry;
      }

      reconcile(nativeAlive: false); // #1: nativo ainda parado → issue (emite #1) → STARTING
      reconcile(nativeAlive: true);  // #2: reconcile imediato durante STARTING → reuse
      reconcile(nativeAlive: true);  // #3: reconcile durante STARTING/RUNNING → reuse

      expect(emissoes, 1);
    });

    test('mesmo escopo → nenhuma emissão adicional; nova viagem → exatamente +1', () {
      var trackingActive = true;
      var credentialMode = true;
      String? currentSig = 'f1,f2';
      var maxExp = validExpiry;
      var emissoes = 0;

      void reconcile(String sig, {required bool nativeAlive}) {
        final d = LocationTrackingService.classifyStartDecision(
          trackingActive: trackingActive,
          nativeAlive: nativeAlive,
          credentialMode: credentialMode,
          currentSig: currentSig,
          requestedSig: sig,
          maxExpiresAtMs: maxExp,
          nowMs: now,
        );
        if (d == 'reuse') return;
        emissoes++;
        trackingActive = true;
        credentialMode = true;
        currentSig = sig;
        maxExp = validExpiry;
      }

      reconcile('f1,f2', nativeAlive: true); // mesmo escopo → reuse (0)
      reconcile('f1,f2', nativeAlive: true); // mesmo escopo → reuse (0)
      reconcile('f1,f2,f3', nativeAlive: true); // nova viagem → issue (+1)
      reconcile('f1,f2,f3', nativeAlive: true); // já reemitido → reuse (0)

      expect(emissoes, 1);
    });
  });
}
