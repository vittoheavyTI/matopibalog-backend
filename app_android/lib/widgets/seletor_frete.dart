import 'package:flutter/material.dart';

/// Exibe um seletor modal (bottom sheet) quando há múltiplos fretes ativos.
/// Retorna o `id` do frete escolhido, ou `null` se o usuário cancelar.
///
/// Uso típico (em callback assíncrono):
/// ```dart
/// final freteId = await SeletorFrete.mostrar(context, ativos);
/// if (freteId != null) { /* navegar com freteId */ }
/// ```
class SeletorFrete {
  static Future<String?> mostrar(
    BuildContext context,
    List<Map<String, dynamic>> ativos,
  ) {
    return showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Selecione o Frete',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              'Há mais de um frete ativo. Escolha em qual deseja lançar.',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            ...ativos.map((f) {
              final origem = f['origem'] ?? '-';
              final destino = f['destino'] ?? '-';
              final status = f['status'] ?? 'pendente';
              final valor =
                  double.tryParse(f['valor_frete']?.toString() ?? '') ?? 0.0;
              return ListTile(
                leading: const Icon(
                  Icons.local_shipping_outlined,
                  color: Color(0xFF1B5E20),
                ),
                title: Text(
                  '$origem → $destino',
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text('$status · R\$ ${valor.toStringAsFixed(2)}'),
                onTap: () => Navigator.pop(ctx, f['id']?.toString()),
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Exibe diálogo informando que não há frete ativo. Quando [onIniciarFrete] é
  /// fornecido, oferece o botão "Iniciar frete agora" que fecha o diálogo e
  /// executa a ação (abrir a tela de criação de frete). Não permite lançar sem
  /// frete — apenas facilita o caminho.
  static void mostrarSemFrete(BuildContext context, {VoidCallback? onIniciarFrete}) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Nenhum frete ativo'),
        content: const Text(
          'Você precisa iniciar um frete antes de lançar despesas, '
          'abastecimentos ou vales.',
          style: TextStyle(fontSize: 15),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Agora não'),
          ),
          if (onIniciarFrete != null)
            ElevatedButton.icon(
              onPressed: () {
                Navigator.pop(ctx);
                onIniciarFrete();
              },
              icon: const Icon(Icons.local_shipping_outlined, size: 20),
              label: const Text('Iniciar frete agora'),
            ),
        ],
      ),
    );
  }

  /// Resolve o frete ativo: 0 → mostra diálogo (retorna null),
  /// 1 → retorna o único id, 2+ → mostra seletor. [onIniciarFrete] é repassado
  /// ao diálogo de "nenhum frete ativo" para oferecer o atalho de criação.
  static Future<String?> resolver(
    BuildContext context,
    List<Map<String, dynamic>> fretesAtivos, {
    VoidCallback? onIniciarFrete,
  }) async {
    if (fretesAtivos.isEmpty) {
      mostrarSemFrete(context, onIniciarFrete: onIniciarFrete);
      return null;
    }
    if (fretesAtivos.length == 1) {
      return fretesAtivos.first['id']?.toString();
    }
    return mostrar(context, fretesAtivos);
  }
}