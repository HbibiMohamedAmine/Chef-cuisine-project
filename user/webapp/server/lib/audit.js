/**
 * Journal d'audit : trace immuable des opérations sensibles.
 * Toute validation, annulation, clôture, réouverture, changement de paramètre
 * ou connexion y laisse une ligne.
 */
import { run, all, scalar } from '../db/index.js';

/**
 * Enregistre une entrée d'audit.
 * @param {object} p
 * @param {string} p.action create|update|validate|cancel|delete|login|logout|close|reopen|backup|restore|settings
 * @param {string} p.entity table ou domaine concerné
 * @param {string|number} [p.entityId]
 * @param {string} [p.summary] résumé lisible
 * @param {any} [p.payload] données techniques (sérialisées)
 * @param {'info'|'warning'|'critical'} [p.severity]
 * @param {string} [p.actor]
 * @param {string} [p.ip]
 */
export function audit({
  action,
  entity,
  entityId = null,
  summary = '',
  payload = null,
  severity = 'info',
  actor = 'chef',
  ip = null,
}) {
  run(
    `INSERT INTO audit_logs (actor, action, entity, entity_id, summary, payload_json, severity, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor,
      action,
      entity,
      entityId === null ? null : String(entityId),
      summary,
      payload === null ? null : JSON.stringify(payload),
      severity,
      ip,
    ],
  );
}

/**
 * Liste paginée du journal d'audit.
 * @param {{limit?:number, offset?:number, entity?:string, action?:string, from?:string, to?:string}} [opts]
 */
export function listAudit(opts = {}) {
  const { limit = 100, offset = 0, entity = null, action = null, from = null, to = null } = opts;
  const where = [];
  const params = [];
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (from) {
    where.push('date(occurred_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(occurred_at) <= date(?)');
    params.push(to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = scalar(`SELECT COUNT(*) c FROM audit_logs ${clause}`, params) || 0;
  return { rows, total };
}
