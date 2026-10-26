/**
 * Numérotation des documents : séquence atomique par type d'opération.
 * Exemple : TRF-2026-000123, AVR-2026-000004, PRD-2026-000011.
 */
import { transaction, getDb } from '../db/index.js';

const PREFIX = {
  transfer: 'TRF',
  loss: 'AVR',
  production: 'PRD',
  transformation: 'TRS',
  purchase: 'ACH',
  sale: 'VTE',
  stock_count: 'INV',
  expense: 'DEP',
  backup: 'SAU',
};

/**
 * Renvoie le prochain numéro d'un scope sous la forme PREFIX-ANNÉE-000001.
 * ⚠️ À appeler DANS une transaction existante pour rester atomique avec
 * l'insertion du document.
 * @param {string} scope
 * @param {Date} [date]
 * @returns {string}
 */
export function nextNumber(scope, date = new Date()) {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO sequences (scope, next_value) VALUES (?, 2)
       ON CONFLICT(scope) DO UPDATE SET next_value = next_value + 1
       RETURNING next_value`,
    )
    .get(scope);
  const value = Number(row.next_value) - 1;
  const year = date.getFullYear();
  const prefix = PREFIX[scope] || scope.toUpperCase().slice(0, 3);
  return `${prefix}-${year}-${String(value).padStart(6, '0')}`;
}

/** Version autonome (crée sa propre transaction) — usage ponctuel. */
export function nextNumberTx(scope, date) {
  return transaction(() => nextNumber(scope, date));
}

/** Date/heure locale au format SQLite 'YYYY-MM-DD HH:MM:SS'. */
export function nowSql() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Date locale 'YYYY-MM-DD'. */
export function todaySql() {
  return nowSql().slice(0, 10);
}

/** Bornes [début, fin] incluses d'une période YYYY-MM. */
export function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${period}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}
