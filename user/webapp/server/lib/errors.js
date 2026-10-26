/**
 * Erreurs applicatives typées : le routeur les transforme en réponses HTTP
 * propres, avec un code métier lisible par l'interface.
 */

export class AppError extends Error {
  /**
   * @param {string} message message destiné à l'utilisateur (français)
   * @param {number} [status] code HTTP
   * @param {string} [code] code métier
   * @param {any} [details]
   */
  constructor(message, status = 400, code = 'BAD_REQUEST', details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, 'BAD_REQUEST', details);
export const notFound = (msg = 'Élément introuvable.') => new AppError(msg, 404, 'NOT_FOUND');
export const conflict = (msg, details) => new AppError(msg, 409, 'CONFLICT', details);
export const unauthorized = (msg = 'Authentification requise.') =>
  new AppError(msg, 401, 'UNAUTHORIZED');
export const forbidden = (msg = 'Accès refusé.') => new AppError(msg, 403, 'FORBIDDEN');

/**
 * Valide qu'un champ est un nombre fini >= min.
 * @param {any} value
 * @param {string} label
 * @param {{min?:number, max?:number, required?:boolean}} [opts]
 * @returns {number}
 */
export function requireNumber(value, label, opts = {}) {
  const { min = -Infinity, max = Infinity, required = true } = opts;
  if (value === '' || value === null || value === undefined) {
    if (required) throw badRequest(`Le champ « ${label} » est obligatoire.`);
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`Le champ « ${label} » doit être un nombre.`);
  if (n < min) throw badRequest(`Le champ « ${label} » doit être supérieur ou égal à ${min}.`);
  if (n > max) throw badRequest(`Le champ « ${label} » doit être inférieur ou égal à ${max}.`);
  return n;
}

/**
 * Valide qu'une chaîne est non vide et renvoie sa version nettoyée.
 * @param {any} value
 * @param {string} label
 * @param {{maxLength?:number}} [opts]
 * @returns {string}
 */
export function requireString(value, label, opts = {}) {
  const { maxLength = 500 } = opts;
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (!s) throw badRequest(`Le champ « ${label} » est obligatoire.`);
  if (s.length > maxLength) throw badRequest(`Le champ « ${label} » est trop long.`);
  return s;
}

/**
 * Valide une date ISO (YYYY-MM-DD ou datetime SQLite).
 * @param {any} value
 * @param {string} label
 * @returns {string}
 */
export function requireDate(value, label) {
  const s = requireString(value, label, { maxLength: 30 });
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    throw badRequest(`La date « ${label} » doit être au format AAAA-MM-JJ.`);
  }
  return s;
}

/** Valide une période comptable YYYY-MM. */
export function requirePeriod(value, label = 'Période') {
  const s = requireString(value, label, { maxLength: 7 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
    throw badRequest(`${label} doit être au format AAAA-MM.`);
  }
  return s;
}
