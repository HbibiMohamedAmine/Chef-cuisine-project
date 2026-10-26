/**
 * Hachage de mot de passe — scrypt (natif Node, aucune dépendance).
 * Format stocké : scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 * Le mot de passe en clair n'est JAMAIS stocké ni journalisé.
 */
import crypto from 'node:crypto';

const N = 16384; // coût CPU/mémoire
const R = 8;
const P = 1;
const KEYLEN = 64;

/**
 * @param {string} password
 * @returns {string} hash sérialisé
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 4) {
    throw new Error('Le mot de passe doit contenir au moins 4 caractères.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Vérifie un mot de passe contre un hash stocké (comparaison à temps constant).
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N: n, r, p });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Jeton de session aléatoire (32 octets). */
export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
