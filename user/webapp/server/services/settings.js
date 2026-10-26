/**
 * Service Paramètres — validation centralisée et exposition à l'interface.
 * Toute modification sensible est journalisée.
 */
import { all, get, run, setSetting, getAllSettings, getSetting, transaction } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, requireNumber, requireString } from '../lib/errors.js';

/** Définition des paramètres éditables depuis l'écran Paramètres. */
export const EDITABLE_SETTINGS = {
  objective_ratio: { type: 'number', min: 15, max: 45, label: 'Objectif de ratio matière (%)' },
  objective_min: { type: 'number', min: 1, max: 100, label: 'Borne basse objectif (%)' },
  objective_max: { type: 'number', min: 1, max: 100, label: 'Borne haute objectif (%)' },
  alert_overrun_enabled: { type: 'boolean', label: 'Alerte dépassement' },
  alert_stock_enabled: { type: 'boolean', label: 'Alerte stock insuffisant' },
  alert_expiry_days: { type: 'number', min: 0, max: 365, label: 'Alerte péremption (jours)' },
  alert_abnormal_loss_pct: { type: 'number', min: 0, max: 100, label: 'Seuil perte anormale (%)' },
  alert_inventory_gap_pct: { type: 'number', min: 0, max: 100, label: 'Seuil écart inventaire (%)' },
  alert_gap_value_dt: { type: 'number', min: 0, max: 100000, label: 'Seuil écart inventaire (DT)' },
  valuation_method: { type: 'enum', values: ['cmp', 'fifo'], label: 'Méthode de valorisation' },
  vat_default_rate: { type: 'number', min: 0, max: 30, label: 'TVA par défaut (%)' },
  restaurant_name: { type: 'string', maxLength: 120, label: 'Nom du restaurant' },
  restaurant_address: { type: 'string', maxLength: 300, label: 'Adresse' },
  restaurant_tax_id: { type: 'string', maxLength: 60, label: 'Matricule fiscal' },
  staff_meals_in_ratio: { type: 'boolean', label: 'Repas du personnel dans le ratio' },
  loss_default_in_consumption: { type: 'boolean', label: 'Avaries incluses par défaut' },
  auto_backup_enabled: { type: 'boolean', label: 'Sauvegarde automatique' },
  auto_backup_hour: { type: 'number', min: 0, max: 23, label: 'Heure de sauvegarde' },
  auto_backup_retention_days: { type: 'number', min: 1, max: 3650, label: 'Rétention (jours)' },
  payroll_cnss_employee_rate: { type: 'number', min: 0, max: 100, label: 'CNSS salarié (%)' },
  payroll_cnss_employer_rate: { type: 'number', min: 0, max: 100, label: 'CNSS employeur (%)' },
  payroll_irpp_rate: { type: 'number', min: 0, max: 100, label: 'IRPP (%)' },
  payroll_monthly_hours: { type: 'number', min: 1, max: 400, label: 'Heures mensuelles' },
  payroll_overtime_rate: { type: 'number', min: 1, max: 3, label: 'Majoration heures sup' },
  session_hours: { type: 'number', min: 1, max: 168, label: 'Durée de session (h)' },
};

/**
 * Renvoie tous les paramètres publics (sans secrets).
 * @returns {Record<string, any>}
 */
export function getPublicSettings() {
  const s = getAllSettings();
  delete s.admin_password_hash;
  return s;
}

/**
 * Met à jour un lot de paramètres avec validation par type.
 * @param {Record<string, any>} values
 * @param {string} [ip]
 * @returns {Record<string, any>}
 */
export function updateSettings(values, ip = null) {
  if (!values || typeof values !== 'object') throw badRequest('Paramètres invalides.');

  const changes = [];
  transaction(() => {
    for (const [key, raw] of Object.entries(values)) {
      const def = EDITABLE_SETTINGS[key];
      if (!def) continue; // clé non éditable : ignorée silencieusement côté API
      const before = getSetting(key);
      let value = raw;

      if (def.type === 'number') {
        value = requireNumber(raw, def.label, { min: def.min, max: def.max });
      } else if (def.type === 'boolean') {
        value = raw === true || raw === 'true' || raw === 1 || raw === '1';
      } else if (def.type === 'enum') {
        value = requireString(raw, def.label);
        if (!def.values.includes(value)) {
          throw badRequest(`Valeur invalide pour « ${def.label} » : ${value}.`);
        }
      } else {
        value = raw === null || raw === undefined ? '' : String(raw).trim();
        if (def.maxLength && value.length > def.maxLength) {
          throw badRequest(`« ${def.label} » est trop long.`);
        }
      }

      if (before !== value) {
        setSetting(key, value, { category: 'general', label: def.label });
        changes.push({ key, before, after: value });
      }
    }

    // Cohérence de l'objectif
    const min = Number(getSetting('objective_min', 15));
    const max = Number(getSetting('objective_max', 45));
    const objective = Number(getSetting('objective_ratio', 30));
    if (min >= max) throw badRequest('La borne basse doit être inférieure à la borne haute.');
    if (objective < min || objective > max) {
      throw badRequest(
        `L’objectif (${objective} %) doit rester entre ${min} % et ${max} %.`,
      );
    }
  });

  if (changes.length) {
    audit({
      action: 'settings',
      entity: 'settings',
      summary: `${changes.length} paramètre(s) modifié(s)`,
      payload: changes,
      severity: 'warning',
      ip,
    });
  }
  return getPublicSettings();
}

/* ---------------------------------------------------------------------------
 *  Référentiels
 * ------------------------------------------------------------------------- */

export function listKitchens() {
  return all('SELECT * FROM kitchens ORDER BY id');
}

export function listUnits() {
  return all('SELECT * FROM units WHERE active = 1 ORDER BY family, factor DESC');
}

export function listCategories() {
  return all('SELECT * FROM product_categories ORDER BY sort_order, name');
}

export function createCategory(name) {
  const clean = requireString(name, 'Nom de catégorie', { maxLength: 80 });
  const exists = get('SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE', [clean]);
  if (exists) throw badRequest('Cette catégorie existe déjà.');
  const r = run('INSERT INTO product_categories (name) VALUES (?)', [clean]);
  audit({ action: 'create', entity: 'product_category', entityId: r.lastInsertRowid, summary: clean });
  return get('SELECT * FROM product_categories WHERE id = ?', [r.lastInsertRowid]);
}

export function updateCategory(id, { name, active }) {
  const cat = get('SELECT * FROM product_categories WHERE id = ?', [id]);
  if (!cat) throw badRequest('Catégorie introuvable.');
  const clean = name ? requireString(name, 'Nom de catégorie', { maxLength: 80 }) : cat.name;
  run('UPDATE product_categories SET name = ?, active = ? WHERE id = ?', [
    clean,
    active === undefined ? cat.active : active ? 1 : 0,
    id,
  ]);
  audit({ action: 'update', entity: 'product_category', entityId: id, summary: clean });
  return get('SELECT * FROM product_categories WHERE id = ?', [id]);
}

export function listLossTypes() {
  return all('SELECT * FROM loss_types ORDER BY label');
}

export function createLossType(label) {
  const clean = requireString(label, 'Libellé du motif', { maxLength: 80 });
  const code = clean
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const exists = get('SELECT id FROM loss_types WHERE code = ?', [code]);
  if (exists) throw badRequest('Ce motif existe déjà.');
  const r = run('INSERT INTO loss_types (code, label) VALUES (?, ?)', [code, clean]);
  audit({ action: 'create', entity: 'loss_type', entityId: r.lastInsertRowid, summary: clean });
  return get('SELECT * FROM loss_types WHERE id = ?', [r.lastInsertRowid]);
}

/** Taux de TVA disponibles. */
export function getVatRates() {
  const list = getSetting('vat_rates', [0, 7, 13, 19]);
  return Array.isArray(list) ? list : [0, 7, 13, 19];
}
