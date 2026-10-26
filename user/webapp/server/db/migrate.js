/**
 * Application du schéma SQLite.
 * Usage :
 *   node server/db/migrate.js           -> applique le schéma (idempotent)
 *   node server/db/migrate.js --reset   -> supprime puis recrée la base
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, DB_PATH } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applique le schéma complet. Idempotent grâce aux IF NOT EXISTS.
 * @returns {{dbPath:string, tables:number}}
 */
export function migrate({ reset = false } = {}) {
  if (reset) {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${DB_PATH}${suffix}`;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  const db = getDb();
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  const tables =
    db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()
      .c || 0;
  return { dbPath: DB_PATH, tables };
}

// Exécution directe en CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes('--reset');
  const res = migrate({ reset });
  console.log(`[migrate] Base : ${res.dbPath}`);
  console.log(`[migrate] ${res.tables} tables disponibles${reset ? ' (base réinitialisée)' : ''}.`);
  closeDb();
}
