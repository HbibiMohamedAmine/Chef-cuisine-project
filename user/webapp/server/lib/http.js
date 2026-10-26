/**
 * Utilitaires de routage : enveloppe async, gestion d'erreurs homogène.
 */
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

/**
 * Enveloppe un handler async pour propager les erreurs au middleware.
 * @param {(req:any,res:any)=>Promise<any>} fn
 */
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Lecture d'un paramètre numérique d'URL. */
export function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('Identifiant invalide.', 400, 'BAD_ID');
  }
  return id;
}

/**
 * Middleware d'erreur central : renvoie un JSON stable à l'interface.
 */
export function errorMiddleware(err, req, res, _next) {
  const status = err.status || 500;
  const isKnown = err instanceof AppError;

  if (!isKnown) {
    // Erreur technique inattendue : journalisée pour diagnostic
    try {
      const { run } = requireDb();
      run('INSERT INTO app_errors (context, message, stack) VALUES (?, ?, ?)', [
        `${req.method} ${req.originalUrl}`,
        String(err.message || err),
        String(err.stack || '').slice(0, 4000),
      ]);
    } catch {
      /* ignore */
    }
    console.error('[erreur]', req.method, req.originalUrl, err);
  }

  res.status(status).json({
    error: true,
    code: err.code || (isKnown ? 'ERROR' : 'INTERNAL_ERROR'),
    message: isKnown
      ? err.message
      : 'Une erreur interne est survenue. L’opération a été annulée ; vos données sont intactes.',
    details: err.details || null,
  });
}

// Import paresseux pour éviter une dépendance circulaire au chargement
function requireDb() {
  // eslint-disable-next-line global-require
  return globalThis.__ccmDb || { run: () => {} };
}

export { audit };
