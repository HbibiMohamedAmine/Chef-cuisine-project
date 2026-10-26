/**
 * ============================================================================
 *  Couche d'accès aux données — abstraction SQLite (better-sqlite3)
 * ----------------------------------------------------------------------------
 *  Objectif : isoler TOUT l'accès à SQLite derrière ce module afin de pouvoir
 *  changer d'implémentation (ex. SQLCipher, ou un adaptateur Electron) sans
 *  toucher aux services métier.
 *
 *  En Electron, le chemin de la base sera fourni par le process main via
 *  la variable d'environnement CCM_DB_PATH (app.getPath('userData')).
 * ============================================================================
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/** Chemin de la base : surchargeable (Electron, tests, sandbox). */
export const DB_PATH =
  process.env.CCM_DB_PATH || path.join(ROOT, 'data', 'chef-cuisine.db');

let dbInstance = null;

/**
 * Ouvre (et met en cache) la connexion SQLite.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');   // reprise fiable après fermeture brutale
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  dbInstance = db;
  return db;
}

/** Ferme la connexion (utilisé par les tests et à l'arrêt du process). */
export function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
    }
  }
}

/**
 * Exécute une fonction dans une TRANSACTION atomique et immédiate.
 * Toute exception provoque un ROLLBACK complet (aucune écriture partielle).
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(fn) {
  const db = getDb();
  const run = db.transaction(fn);
  return run.immediate();
}

/* ---------------------------------------------------------------------------
 *  Helpers de requête
 * ------------------------------------------------------------------------- */

/** @returns {any} une ligne ou undefined */
export function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

/** @returns {any[]} toutes les lignes */
export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

/** Exécute un ordre et renvoie {changes, lastInsertRowid} */
export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

/** Renvoie la première valeur scalaire de la première ligne. */
export function scalar(sql, params = []) {
  const row = get(sql, params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

/* ---------------------------------------------------------------------------
 *  Paramètres typés (settings)
 * ------------------------------------------------------------------------- */

/**
 * Lit un paramètre et le convertit selon son type attendu.
 * @param {string} key
 * @param {any} [fallback]
 * @returns {any}
 */
export function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  return parseSettingValue(row.value, fallback);
}

/**
 * Désérialise une valeur stockée en TEXT (nombres, booléens, JSON).
 * @param {string} raw
 * @param {any} fallback
 */
export function parseSettingValue(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const s = String(raw);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Écrit un paramètre (upsert) avec trace d'audit gérée par l'appelant.
 * @param {string} key
 * @param {any} value
 * @param {{category?:string,label?:string,description?:string}} [meta]
 */
export function setSetting(key, value, meta = {}) {
  const serialized =
    typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  run(
    `INSERT INTO settings (key, value, category, label, description, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       category = COALESCE(excluded.category, settings.category),
       label = COALESCE(excluded.label, settings.label),
       description = COALESCE(excluded.description, settings.description),
       updated_at = datetime('now')`,
    [key, serialized, meta.category || 'general', meta.label || null, meta.description || null],
  );
}

/** Récupère tous les paramètres sous forme d'objet simple. */
export function getAllSettings() {
  const rows = all('SELECT key, value FROM settings ORDER BY key');
  /** @type {Record<string, any>} */
  const out = {};
  for (const r of rows) out[r.key] = parseSettingValue(r.value);
  return out;
}
