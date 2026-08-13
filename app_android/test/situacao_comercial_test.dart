import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/models/situacao_comercial.dart';

/// Testes do model de Situação Comercial (macrofrente 3A-1, §31).
///
/// Garantia central (§16): o app NÃO re-deriva bloqueio — ele lê `podeOperar`
/// (pode_operar / acoes.operar_escrita) da autoridade backend. Isto substitui a
/// lógica incorreta do PR #405 (bloquear por contrato pendente durante trial).
void main() {
  group('SituacaoComercial.fromJson', () {
    test('trial ativo + contrato pendente → podeOperar TRUE (autoridade backend)', () {
      final s = SituacaoComercial.fromJson({
        'aplicavel': true,
        'situacao': 'trial_ativo',
        'trial_ativo': true,
        'dias_restantes': 5,
        'contrato_obrigatorio': true,
        'contrato_status': 'aguardando_assinatura_cliente',
        'pode_operar': true, // backend liberou escrita durante o trial
        'acoes': {'operar_escrita': true, 'consultar': true, 'assinar_contrato': false},
        'plano_nome': 'Empresa Start',
        'mensalidade': 299.9,
        'implantacao': 0,
        'implantacao_gratis': true,
      });
      expect(s.podeOperar, isTrue);
      expect(s.trialAtivo, isTrue);
      expect(s.diasRestantes, 5);
      expect(s.rotulo, 'Período de teste ativo');
    });

    test('aguardando assinatura (sem trial) → podeOperar FALSE e precisa assinar', () {
      final s = SituacaoComercial.fromJson({
        'aplicavel': true,
        'situacao': 'aguardando_assinatura',
        'pode_operar': false,
        'acoes': {'operar_escrita': false, 'consultar': true, 'assinar_contrato': true},
      });
      expect(s.podeOperar, isFalse);
      expect(s.precisaAssinarContrato, isTrue);
      expect(s.rotulo, 'Assinatura pendente');
    });

    test('deriva podeOperar de acoes quando pode_operar ausente', () {
      final s = SituacaoComercial.fromJson({
        'aplicavel': true,
        'situacao': 'trial_ativo',
        'acoes': {'operar_escrita': true},
      });
      expect(s.podeOperar, isTrue);
    });

    test('conta suspensa financeiramente → bloqueia, orienta regularizar', () {
      final s = SituacaoComercial.fromJson({
        'aplicavel': true,
        'situacao': 'suspensa_financeiramente',
        'pode_operar': false,
        'acoes': {'operar_escrita': false, 'regularizar': true},
      });
      expect(s.podeOperar, isFalse);
      expect(s.regularizar, isTrue);
      expect(s.rotulo, 'Conta suspensa');
    });

    test('valores numéricos aceitam num e string', () {
      final s = SituacaoComercial.fromJson({
        'aplicavel': true,
        'mensalidade': '149.9',
        'implantacao': 500,
        'dias_restantes': '3',
      });
      expect(s.mensalidade, 149.9);
      expect(s.implantacao, 500);
      expect(s.diasRestantes, 3);
    });
  });

  group('SituacaoComercial.desconhecida (fail-open)', () {
    test('não bloqueia por falha de rede (podeOperar TRUE, não aplicável)', () {
      final s = SituacaoComercial.desconhecida();
      expect(s.podeOperar, isTrue);
      expect(s.aplicavel, isFalse);
      expect(s.precisaAssinarContrato, isFalse);
    });
  });
}
