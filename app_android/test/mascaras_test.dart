import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/utils/mascaras.dart';

void main() {
  group('apenasDigitos', () {
    test('remove separadores', () {
      expect(apenasDigitos('123.456.789-01'), '12345678901');
      expect(apenasDigitos('(11) 99999-8888'), '11999998888');
      expect(apenasDigitos(''), '');
    });
  });

  group('formatarCpf', () {
    test('CPF completo', () {
      expect(formatarCpf('12345678901'), '123.456.789-01');
    });
    test('parcial', () {
      expect(formatarCpf('123'), '123');
      expect(formatarCpf('1234'), '123.4');
      expect(formatarCpf('123456789'), '123.456.789');
    });
    test('limita a 11 dígitos', () {
      expect(formatarCpf('123456789012345'), '123.456.789-01');
    });
  });

  group('formatarCnpj', () {
    test('CNPJ completo', () {
      expect(formatarCnpj('12345678000199'), '12.345.678/0001-99');
    });
    test('limita a 14 dígitos', () {
      expect(formatarCnpj('123456780001990000'), '12.345.678/0001-99');
    });
  });

  group('formatarDocumento', () {
    test('até 11 dígitos usa CPF', () {
      expect(formatarDocumento('12345678901'), '123.456.789-01');
    });
    test('acima de 11 usa CNPJ', () {
      expect(formatarDocumento('12345678000199'), '12.345.678/0001-99');
    });
  });

  group('formatarTelefone', () {
    test('celular (11 dígitos)', () {
      expect(formatarTelefone('11999998888'), '(11) 99999-8888');
    });
    test('fixo (10 dígitos)', () {
      expect(formatarTelefone('1133334444'), '(11) 3333-4444');
    });
    test('parcial', () {
      expect(formatarTelefone('11'), '(11');
      expect(formatarTelefone('119'), '(11) 9');
    });
    test('vazio', () {
      expect(formatarTelefone(''), '');
    });
  });

  group('formatarPlaca', () {
    test('padrão antigo recebe hífen', () {
      expect(formatarPlaca('abc1234'), 'ABC-1234');
    });
    test('padrão Mercosul sem hífen', () {
      expect(formatarPlaca('abc1d23'), 'ABC1D23');
    });
    test('limita a 7 caracteres e maiúsculas', () {
      expect(formatarPlaca('abc1234xyz'), 'ABC-1234');
    });
    test('ambíguo (até 4 chars) não insere hífen', () {
      expect(formatarPlaca('abc1'), 'ABC1');
    });
  });

  group('normalizarPlaca', () {
    test('antiga: remove hífen e mantém uppercase', () {
      expect(normalizarPlaca('abc-1234'), 'ABC1234');
      expect(normalizarPlaca('ABC-1234'), 'ABC1234');
    });
    test('Mercosul: uppercase sem alteração de conteúdo', () {
      expect(normalizarPlaca('abc1d23'), 'ABC1D23');
    });
    test('remove espaços e demais separadores', () {
      expect(normalizarPlaca(' abc 1234 '), 'ABC1234');
    });
  });
}
