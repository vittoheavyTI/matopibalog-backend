import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'api_service.dart';

class OfflineSync {
  static Database? _database;

  static Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB();
    return _database!;
  }

  static Future<Database> _initDB() async {
    String path = join(await getDatabasesPath(), 'offline_sync.db');
    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE sync_queue (
            id TEXT PRIMARY KEY,
            task_type TEXT,
            fields TEXT,
            local_path TEXT,
            attempts INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending'
          )
        ''');
      },
    );
  }

  static Future<void> addPendingTask({
    required String id,
    required String taskType,
    required Map<String, String> fields,
    required String localPath,
  }) async {
    final db = await database;
    await db.insert('sync_queue', {
      'id': id,
      'task_type': taskType,
      'fields': jsonEncode(fields),
      'local_path': localPath,
      'attempts': 0,
      'status': 'pending',
    });
  }

  static Future<void> syncPendingTasks() async {
    final db = await database;
    final List<Map<String, dynamic>> tasks = await db.query(
      'sync_queue',
      where: 'status = ? AND attempts < ?',
      whereArgs: ['pending', 5],
    );

    for (var task in tasks) {
      bool success = false;
      final fields = Map<String, String>.from(jsonDecode(task['fields']));
      final endpoint = _getEndpoint(task['task_type']);

      try {
        success = await ApiService.createMovementWithPhoto(endpoint, fields, task['local_path']);
        
        if (success) {
          await db.delete('sync_queue', where: 'id = ?', whereArgs: [task['id']]);
        } else {
          await db.update(
            'sync_queue',
            {'attempts': task['attempts'] + 1},
            where: 'id = ?',
            whereArgs: [task['id']],
          );
        }
      } catch (e) {
        // Log ou tratamento de erro
      }
    }
  }

  static String _getEndpoint(String taskType) {
    switch (taskType) {
      case 'CREATE_DESPESA': return 'despesas';
      case 'CREATE_ABASTECIMENTO': return 'abastecimentos';
      case 'CREATE_VALE': return 'vales';
      default: return '';
    }
  }
}
