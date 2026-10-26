/**
 * ============================================================================
 *  Serveur HTTP — Chef Cuisine Manager
 * ----------------------------------------------------------------------------
 *  Sert :
 *    - l'API REST sous /api
 *    - l'application React compilée (dist/)
 *
 *  Conçu pour tourner :
 *    - en sandbox / développement : `node server/index.js`
 *    - dans Electron : lancé par le process main, écoute sur 127.0.0.1
 *
 *  Aucune dépendance à Internet : polices et styles sont embarqués au build.
 * ============================================================================
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import { errorMiddleware } from './lib/http.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { closeDb, DB_PATH, getDb } from './db/index.js';
import { maybeAutoBackup } from './services/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// --- Initialisation de la base -------------------------------------------------
// Le schéma est idempotent : sûr à chaque démarrage.
migrate();
seed();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(cookieParser());

// Exposition limitée de la couche DB au middleware d'erreur (journalisation)
globalThis.__ccmDb = { run: (sql, params) => getDb().prepare(sql).run(...params) };

// --- Sécurité de base ---------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Application locale : aucune ressource externe n'est nécessaire.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
  );
  next();
});

// --- Sauvegarde automatique paresseuse (compatible sans tâche planifiée) -------
app.use('/api', (req, res, next) => {
  try {
    maybeAutoBackup();
  } catch (e) {
    console.warn('[sauvegarde auto] ignorée :', e.message);
  }
  next();
});

// --- API ----------------------------------------------------------------------
app.use('/api', apiRouter);

// --- Frontend statique --------------------------------------------------------
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  // Toute route non-API renvoie l'application (routage côté client)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<h1>Chef Cuisine Manager</h1><p>Le frontend n’est pas compilé. Lancez <code>npm run build</code>.</p>',
      );
  });
}

// --- Erreurs ------------------------------------------------------------------
app.use(errorMiddleware);

// --- Démarrage ----------------------------------------------------------------
const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Chef Cuisine Manager`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Interface   : http://localhost:${PORT}`);
  console.log(`  API         : http://localhost:${PORT}/api/health`);
  console.log(`  Base        : ${DB_PATH}`);
  console.log(`  Mode        : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  ─────────────────────────────────────────────\n`);
});

/** Arrêt propre : ferme le serveur puis la base (WAL synchronisé). */
function shutdown(signal) {
  console.log(`\n[${signal}] Arrêt en cours…`);
  server.close(() => {
    closeDb();
    console.log('[arrêt] Base fermée proprement. Aucune donnée perdue.');
    process.exit(0);
  });
  // Filet de sécurité
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[exception non gérée]', err);
  try {
    getDb().prepare('INSERT INTO app_errors (context, message, stack) VALUES (?, ?, ?)').run(
      'uncaughtException', String(err.message), String(err.stack || '').slice(0, 4000),
    );
  } catch { /* ignore */ }
});
process.on('unhandledRejection', (reason) => {
  console.error('[promesse rejetée]', reason);
});

export default app;
