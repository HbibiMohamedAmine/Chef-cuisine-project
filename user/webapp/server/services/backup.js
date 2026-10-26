/**
 * ============================================================================
 *  Service SAUVEGARDE / RESTAURATION / INTÉGRITÉ
 * ----------------------------------------------------------------------------
 *  - Sauvegarde : copie cohérente de la base SQLite (VACUUM INTO) + manifeste
 *    JSON (version, empreinte SHA-256, nombre de lignes par table).
 *  - Restauration : vérification d'intégrité AVANT remplacement, sauvegarde de
 *    sécurité automatique de l'état courant (« pre_restauration »).
 *  - Intégrité : PRAGMA integrity_check, foreign_key_check, contrôles métier
 *    (stocks négatifs, doubles comptages, périodes clôturées modifiées).
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb, all, run, get, scalar, closeDb, DB_PATH, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { nowSql } from '../lib/numbering.js';
import { roundQty } from '../../shared/formulas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
export const BACKUP_DIR = process.env.CCM_BACKUP_DIR || path.join(ROOT, 'backups');

const APP_VERSION = '1.0.0';

/** Empreinte SHA-256 d'un fichier. */
export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

/**
 * Crée une sauvegarde complète.
 * @param {{kind?:'manuel'|'auto'|'pre_restauration', notes?:string}} [opts]
 * @returns {{fileName:string, filePath:string, size:number, sha256:string}}
 */
export function createBackup({ kind = 'manuel', notes = null } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = nowSql().replace(/[-: ]/g, '').slice(0, 14);
  const fileName = `chef-cuisine-${stamp}-${kind}.db`;
  const filePath = path.join(BACKUP_DIR, fileName);

  const db = getDb();

  // Table de suivi (créée si besoin)
  run(`CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    file_name TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT,
    kind TEXT NOT NULL DEFAULT 'manuel', status TEXT NOT NULL DEFAULT 'ok', notes TEXT)`);

  // Copie cohérente même si la base est ouverte (WAL inclus)
  db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
  const size = fs.statSync(filePath).size;
  const sha = sha256File(filePath);

  // Manifeste lisible (utile pour vérifier une sauvegarde sans la restaurer)
  const tables = all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  const counts = {};
  for (const t of tables) {
    try {
      counts[t.name] = scalar(`SELECT COUNT(*) c FROM "${t.name}"`) || 0;
    } catch {
      counts[t.name] = null;
    }
  }
  const manifest = {
    app: 'Chef Cuisine Manager',
    version: APP_VERSION,
    created_at: nowSql(),
    kind,
    database: fileName,
    size_bytes: size,
    sha256: sha,
    table_counts: counts,
    notes,
  };
  fs.writeFileSync(filePath.replace(/\.db$/, '.json'), JSON.stringify(manifest, null, 2), 'utf8');

  run(
    `INSERT INTO backups (file_name, size_bytes, sha256, kind, status, notes)
     VALUES (?, ?, ?, ?, 'ok', ?)`,
    [fileName, size, sha, kind, notes],
  );

  audit({
    action: 'backup', entity: 'backup', entityId: fileName,
    summary: `Sauvegarde ${kind} : ${fileName} (${(size / 1024).toFixed(1)} Ko)`,
    severity: 'info',
  });

  return { fileName, filePath, manifestPath: filePath.replace(/\.db$/, '.json'), size, sha256: sha, manifest };
}

/** Liste les sauvegardes présentes sur disque. */
export function listBackups() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db'));
  return files
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(full);
      const manifestPath = full.replace(/\.db$/, '.json');
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
          manifest = null;
        }
      }
      return {
        fileName: f,
        size: stat.size,
        createdAt: manifest?.created_at || stat.mtime.toISOString(),
        kind: manifest?.kind || f.includes('auto') ? 'auto' : 'manuel',
        sha256: manifest?.sha256 || null,
        tableCounts: manifest?.table_counts || null,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Vérifie l'intégrité d'un FICHIER de sauvegarde avant restauration.
 * @param {string} fileName
 */
export function verifyBackup(fileName) {
  const safe = path.basename(fileName);
  const filePath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(filePath)) throw new Error(`Sauvegarde introuvable : ${safe}`);

  const manifestPath = filePath.replace(/\.db$/, '.json');
  const problems = [];

  // 1. Empreinte
  const actualSha = sha256File(filePath);
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.sha256 && manifest.sha256 !== actualSha) {
      problems.push('L’empreinte SHA-256 ne correspond pas au manifeste : fichier altéré.');
    }
  } else {
    problems.push('Manifeste absent : impossible de vérifier l’empreinte d’origine.');
  }

  // 2. Ouverture SQLite en lecture seule + integrity_check
  let integrity = null;
  let counts = null;
  try {
    // Import dynamique pour éviter d'ouvrir une 2ᵉ connexion permanente
    const BetterSqlite3 = getDb().constructor;
    const db = new BetterSqlite3(filePath, { readonly: true });
    try {
      const res = db.prepare('PRAGMA integrity_check').all();
      integrity = res.map((r) => Object.values(r)[0]).join('; ');
      if (integrity !== 'ok') problems.push(`Intégrité SQLite : ${integrity}`);
      counts = {};
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      for (const t of tables) {
        try {
          counts[t.name] = db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c;
        } catch {
          counts[t.name] = null;
        }
      }
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      if (fk.length) problems.push(`${fk.length} violation(s) de clé étrangère.`);
    } finally {
      db.close();
    }
  } catch (e) {
    problems.push(`Fichier illisible : ${e.message}`);
  }

  return { fileName: safe, ok: problems.length === 0, problems, integrity, counts, manifest, sha256: actualSha };
}

/**
 * Restaure une sauvegarde.
 * ⚠️ Opération destructive : une sauvegarde de sécurité est créée AVANT.
 * @param {string} fileName
 * @param {string} confirmText doit valoir exactement 'RESTAURER'
 */
export function restoreBackup(fileName, confirmText) {
  if (confirmText !== 'RESTAURER') {
    throw new Error('Confirmation requise : saisissez exactement RESTAURER.');
  }
  const check = verifyBackup(fileName);
  if (!check.ok) {
    throw new Error(`Restauration refusée — ${check.problems.join(' ')}`);
  }

  const safe = path.basename(fileName);
  const source = path.join(BACKUP_DIR, safe);

  // 1. Sauvegarde de sécurité de l'état courant
  const safety = createBackup({
    kind: 'pre_restauration',
    notes: `État avant restauration de ${safe}`,
  });

  // 2. Remplacement du fichier de base
  closeDb();
  for (const suffix of ['-wal', '-shm']) {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.copyFileSync(source, DB_PATH);

  // 3. Vérification post-restauration
  const check2 = integrityCheck();
  audit({
    action: 'restore', entity: 'backup', entityId: safe,
    summary: `Base restaurée depuis ${safe} (sauvegarde de sécurité : ${safety.fileName})`,
    severity: 'critical',
    payload: { integrity: check2.ok, problems: check2.problems },
  });

  return { restored: safe, safetyBackup: safety.fileName, integrity: check2 };
}

/**
 * Vérification d'intégrité de la base ACTIVE, incluant des contrôles métier.
 */
export function integrityCheck() {
  const db = getDb();
  const problems = [];
  const warnings = [];

  // 1. Intégrité structurelle
  const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).join('; ');
  if (integrity !== 'ok') problems.push(`Intégrité SQLite : ${integrity}`);

  // 2. Clés étrangères
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) problems.push(`${fk.length} violation(s) de clé étrangère.`);

  // 3. Stocks négatifs : anomalie SAUF s'ils découlent d'un transfert forcé justifié
  const negative = all(
    `SELECT p.id AS product_id, p.code, p.name, s.qty, s.kitchen_id, k.name AS kitchen
     FROM (SELECT product_id, kitchen_id,
                  SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
           FROM stock_movements GROUP BY product_id, kitchen_id) s
     JOIN products p ON p.id = s.product_id
     JOIN kitchens k ON k.id = s.kitchen_id
     WHERE s.qty < -0.0001`,
  );
  for (const n of negative) {
    // Un découvert est acceptable uniquement s'il est couvert par un transfert
    // forcé explicitement justifié et tracé sur ce produit.
    const justified = get(
      `SELECT t.id, t.number, t.force_justification
       FROM transfers t
       WHERE t.product_id = ? AND t.status = 'valide' AND t.force_negative = 1
         AND t.force_justification IS NOT NULL AND TRIM(t.force_justification) <> ''
       ORDER BY t.validated_at DESC LIMIT 1`,
      [n.product_id],
    );
    if (justified) {
      warnings.push(
        `Stock négatif justifié : ${n.name} (${n.kitchen}) = ${roundQty(n.qty)} — ` +
        `transfert forcé ${justified.number} (« ${justified.force_justification} »). ` +
        'Régularisez par un inventaire physique.',
      );
    } else {
      problems.push(`Stock négatif non justifié : ${n.name} (${n.kitchen}) = ${roundQty(n.qty)}`);
    }
  }

  // 4. Mouvements orphelins (source inexistante)
  const orphans = get(
    `SELECT COUNT(*) c FROM stock_movements m
     WHERE m.source_table IN ('transfers','losses','productions','sales','purchases','transformations')
       AND m.source_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM transfers t WHERE m.source_table='transfers' AND t.id=m.source_id
         UNION ALL SELECT 1 FROM losses l WHERE m.source_table='losses' AND l.id=m.source_id
         UNION ALL SELECT 1 FROM productions pr WHERE m.source_table='productions' AND pr.id=m.source_id
         UNION ALL SELECT 1 FROM sales s WHERE m.source_table='sales' AND s.id=m.source_id
         UNION ALL SELECT 1 FROM purchases pu WHERE m.source_table='purchases' AND pu.id=m.source_id
         UNION ALL SELECT 1 FROM transformations tr WHERE m.source_table='transformations' AND tr.id=m.source_id
       )`,
  ).c || 0;
  if (orphans > 0) warnings.push(`${orphans} mouvement(s) de stock sans document source identifiable.`);

  // 5. Transferts validés sans leurs deux mouvements
  const badTransfers = all(
    `SELECT t.id, t.number FROM transfers t
     WHERE t.status = 'valide'
       AND (SELECT COUNT(*) FROM stock_movements m
            WHERE m.source_table='transfers' AND m.source_id=t.id) NOT IN (2, 4)`,
  );
  for (const t of badTransfers) {
    problems.push(`Transfert ${t.number} validé sans ses mouvements de stock complets.`);
  }

  // 6. Doubles comptages possibles : avaries validées sans mouvement
  //    Sont EXCLUES les pertes de transformation / production : par conception,
  //    leur coût est déjà porté par le produit transformé (perte incluse dans le
  //    coût unitaire final) et aucun mouvement séparé ne doit exister.
  const lossWithoutMovement = all(
    `SELECT l.id, l.number, l.loss_type FROM losses l
     WHERE l.status='valide'
       AND l.loss_type <> 'perte_transformation'
       AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.source_table='losses' AND m.source_id=l.id)`,
  );
  for (const l of lossWithoutMovement) {
    problems.push(`Avarie ${l.number} (${l.loss_type}) validée sans mouvement de stock associé.`);
  }

  // 7. Périodes clôturées : mouvements postérieurs à la clôture
  const closings = all("SELECT * FROM monthly_closings WHERE status = 'cloture'");
  for (const c of closings) {
    const lastDay = `${c.period}-31`;
    const after = get(
      `SELECT COUNT(*) n FROM audit_logs
       WHERE occurred_at > ? AND entity IN ('transfer','loss','production','sale','stock_count','settings')`,
      [c.closed_at],
    ).n || 0;
    if (after > 0) {
      warnings.push(
        `${after} opération(s) sensible(s) postérieure(s) à la clôture de ${c.period} : vérifiez qu’elles ne concernent pas la période clôturée.`,
      );
    }
  }

  // 8. Sauvegardes récentes
  const lastBackup = get('SELECT * FROM backups ORDER BY id DESC LIMIT 1');
  if (!lastBackup) {
    warnings.push('Aucune sauvegarde enregistrée : pensez à en créer une.');
  } else {
    const days = (Date.now() - new Date(lastBackup.created_at.replace(' ', 'T')).getTime()) / 86400000;
    if (days > 7) warnings.push(`Dernière sauvegarde il y a ${Math.round(days)} jours.`);
  }

  const tableCounts = {};
  const tables = all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  for (const t of tables) {
    try {
      tableCounts[t.name] = scalar(`SELECT COUNT(*) c FROM "${t.name}"`);
    } catch {
      tableCounts[t.name] = null;
    }
  }

  return {
    ok: problems.length === 0,
    checkedAt: nowSql(),
    integrity,
    problems,
    warnings,
    tableCounts,
    databaseSize: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
    lastBackup: lastBackup || null,
  };
}

/**
 * Purge des sauvegardes automatiques dépassant la rétention.
 */
export function purgeOldBackups() {
  const retention = Number(getSetting('auto_backup_retention_days', 30));
  const cutoff = Date.now() - retention * 86400000;
  const purged = [];
  for (const b of listBackups()) {
    if (b.kind !== 'auto') continue;
    const t = new Date(String(b.createdAt).replace(' ', 'T')).getTime();
    if (t < cutoff) {
      const full = path.join(BACKUP_DIR, b.fileName);
      if (fs.existsSync(full)) fs.unlinkSync(full);
      const mf = full.replace(/\.db$/, '.json');
      if (fs.existsSync(mf)) fs.unlinkSync(mf);
      purged.push(b.fileName);
    }
  }
  return purged;
}

/**
 * Sauvegarde automatique si l'heure configurée est atteinte et si aucune
 * sauvegarde n'a été faite aujourd'hui. Appelée à chaque requête (lazy) :
 * compatible avec un environnement sans tâche planifiée.
 */
export function maybeAutoBackup() {
  if (!Boolean(getSetting('auto_backup_enabled', true))) return null;
  const hour = Number(getSetting('auto_backup_hour', 22));
  const now = new Date();
  if (now.getHours() < hour) return null;
  const today = nowSql().slice(0, 10);
  const existing = get(
    "SELECT id FROM backups WHERE kind = 'auto' AND date(created_at) = date(?)",
    [today],
  );
  if (existing) return null;
  const res = createBackup({ kind: 'auto', notes: 'Sauvegarde automatique quotidienne' });
  purgeOldBackups();
  return res;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--now')) {
    const res = createBackup({ kind: 'manuel', notes: 'Sauvegarde manuelle en ligne de commande' });
    console.log(`[backup] ${res.filePath} (${(res.size / 1024).toFixed(1)} Ko)`);
    console.log(`[backup] SHA-256 : ${res.sha256}`);
  } else if (process.argv.includes('--check')) {
    const res = integrityCheck();
    console.log(`[intégrité] ${res.ok ? 'OK' : 'ANOMALIES DÉTECTÉES'}`);
    res.problems.forEach((p) => console.log(`  ✗ ${p}`));
    res.warnings.forEach((w) => console.log(`  ! ${w}`));
  } else {
    console.log('Usage : node server/services/backup.js [--now|--check]');
  }
}
