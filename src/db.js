import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { slugificar } from './util/slug.js';

const DIR_MIGRACIONES = path.join(import.meta.dirname, 'migraciones');

export function abrirBase(ruta) {
  const enMemoria = ruta === ':memory:';
  if (!enMemoria) mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON');
  if (!enMemoria) db.exec('PRAGMA journal_mode = WAL');
  // slugificar(texto) en SQL: para comparar sin tildes ni eñes (lower() de SQLite solo entiende ASCII).
  db.function('slugificar', { deterministic: true }, (texto) => slugificar(texto ?? ''));
  migrar(db);
  return db;
}

// Solo para funciones sincrónicas: node:sqlite no comparte la transacción entre awaits.
export function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Aplica en orden los .sql de src/migraciones que todavía no se aplicaron.
function migrar(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migraciones (
    nombre TEXT PRIMARY KEY,
    aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const aplicadas = new Set(db.prepare('SELECT nombre FROM migraciones').all().map((f) => f.nombre));
  const pendientes = readdirSync(DIR_MIGRACIONES)
    .filter((archivo) => archivo.endsWith('.sql') && !aplicadas.has(archivo))
    .sort();
  for (const archivo of pendientes) {
    enTransaccion(db, () => {
      db.exec(readFileSync(path.join(DIR_MIGRACIONES, archivo), 'utf8'));
      db.prepare('INSERT INTO migraciones (nombre) VALUES (?)').run(archivo);
    });
  }
}
