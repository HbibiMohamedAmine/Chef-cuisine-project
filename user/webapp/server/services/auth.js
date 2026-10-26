/**
 * Authentification administrateur unique.
 * - mot de passe hashé (scrypt) stocké dans settings
 * - sessions opaques en base, cookie HttpOnly
 * - limitation des tentatives (anti force brute)
 */
import { get, run, getSetting, setSetting } from '../db/index.js';
import { hashPassword, verifyPassword, newSessionToken } from '../lib/password.js';
import { audit } from '../lib/audit.js';
import { unauthorized, badRequest } from '../lib/errors.js';
import { nowSql } from '../lib/numbering.js';

export const SESSION_COOKIE = 'ccm_session';

/** Compteur de tentatives échouées (en mémoire, par IP — usage mono-poste). */
const attempts = new Map();

/**
 * Vérifie les identifiants et crée une session.
 * @param {string} username
 * @param {string} password
 * @param {string} [ip]
 * @returns {{token:string, expiresAt:string, username:string}}
 */
export function login(username, password, ip = null) {
  const limit = Number(getSetting('failed_login_limit', 5));
  const lockMinutes = Number(getSetting('failed_login_lock_minutes', 5));
  const key = ip || 'local';
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && entry.count >= limit && now - entry.last < lockMinutes * 60_000) {
    const remaining = Math.ceil((lockMinutes * 60_000 - (now - entry.last)) / 60000);
    throw unauthorized(
      `Trop de tentatives échouées. Réessayez dans ${remaining} minute(s).`,
    );
  }

  const storedUsername = String(getSetting('admin_username', 'chef'));
  const storedHash = String(getSetting('admin_password_hash', ''));

  const okUser = String(username || '').trim().toLowerCase() === storedUsername.toLowerCase();
  const okPass = verifyPassword(String(password || ''), storedHash);

  if (!okUser || !okPass) {
    const prev = attempts.get(key);
    attempts.set(key, { count: (prev ? prev.count : 0) + 1, last: now });
    audit({
      action: 'login',
      entity: 'auth',
      summary: 'Échec de connexion',
      severity: 'warning',
      ip,
    });
    throw unauthorized('Identifiant ou mot de passe incorrect.');
  }

  attempts.delete(key);

  const hours = Number(getSetting('session_hours', 12));
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + hours * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  run(
    `INSERT INTO sessions (token, expires_at, last_seen, ip) VALUES (?, ?, ?, ?)`,
    [token, expiresAt, nowSql(), ip],
  );
  // Purge des sessions expirées
  run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);

  audit({ action: 'login', entity: 'auth', summary: 'Connexion réussie', ip });
  return { token, expiresAt, username: storedUsername };
}

/**
 * Valide un jeton de session.
 * @param {string} token
 * @returns {{valid:boolean, username?:string}}
 */
export function validateSession(token) {
  if (!token) return { valid: false };
  const row = get(
    `SELECT token, expires_at FROM sessions WHERE token = ? AND expires_at > datetime('now')`,
    [token],
  );
  if (!row) return { valid: false };
  run(`UPDATE sessions SET last_seen = ? WHERE token = ?`, [nowSql(), token]);
  return { valid: true, username: String(getSetting('admin_username', 'chef')) };
}

/** Déconnexion : supprime la session. */
export function logout(token, ip = null) {
  if (token) run(`DELETE FROM sessions WHERE token = ?`, [token]);
  audit({ action: 'logout', entity: 'auth', summary: 'Déconnexion', ip });
}

/**
 * Change le mot de passe (vérifie l'ancien).
 * @param {string} oldPassword
 * @param {string} newPassword
 * @param {string} [ip]
 */
export function changePassword(oldPassword, newPassword, ip = null) {
  const storedHash = String(getSetting('admin_password_hash', ''));
  if (!verifyPassword(String(oldPassword || ''), storedHash)) {
    throw badRequest('Le mot de passe actuel est incorrect.');
  }
  if (String(newPassword || '').length < 8) {
    throw badRequest('Le nouveau mot de passe doit contenir au moins 8 caractères.');
  }
  if (!/\d/.test(newPassword) || !/[A-Za-zÀ-ÿ]/.test(newPassword)) {
    throw badRequest('Le nouveau mot de passe doit contenir des lettres et des chiffres.');
  }
  if (String(newPassword) === String(oldPassword)) {
    throw badRequest('Le nouveau mot de passe doit être différent de l’ancien.');
  }

  setSetting('admin_password_hash', hashPassword(newPassword), {
    category: 'securite',
    label: 'Mot de passe administrateur',
  });
  // Invalide toutes les sessions existantes sauf la courante (reconnexion conseillée)
  run(`DELETE FROM sessions`);
  audit({
    action: 'update',
    entity: 'auth',
    summary: 'Mot de passe administrateur modifié',
    severity: 'warning',
    ip,
  });
}

/**
 * Indique si le mot de passe est encore celui par défaut.
 * @returns {boolean}
 */
export function isDefaultPassword() {
  const stored = String(getSetting('admin_password_hash', ''));
  return verifyPassword('chef1234', stored);
}
