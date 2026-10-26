/**
 * Données initiales (idempotent).
 * - paramètres par défaut (objectif 30 %, seuils, TVA, valorisation)
 * - 3 cuisines
 * - unités de mesure
 * - catégories de produits
 * - motifs d'avarie
 * - mot de passe administrateur initial
 */
import { getDb, setSetting, run, all, get } from './index.js';
import { hashPassword } from '../lib/password.js';

/** Valeurs par défaut des paramètres. Modifiables depuis l'écran Paramètres. */
export const DEFAULT_SETTINGS = [
  // --- Objectif & ratio ---
  ['objective_ratio', '30', 'ratio', 'Objectif de ratio matière (%)',
    'Cible du ratio coût matière / CA HT. Valeur par défaut 30 %, réglable de 15 à 45 %.'],
  ['objective_min', '15', 'ratio', 'Borne basse objectif (%)', 'Limite de réglage du simulateur.'],
  ['objective_max', '45', 'ratio', 'Borne haute objectif (%)', 'Limite de réglage du simulateur.'],

  // --- Alertes ---
  ['alert_overrun_enabled', 'true', 'alertes', 'Alerte dépassement objectif', ''],
  ['alert_stock_enabled', 'true', 'alertes', 'Alerte stock insuffisant', ''],
  ['alert_expiry_days', '5', 'alertes', 'Seuil alerte péremption (jours)',
    'Nombre de jours avant la DLC à partir duquel un produit est signalé.'],
  ['alert_abnormal_loss_pct', '15', 'alertes', 'Seuil de perte anormale (%)',
    'Au-delà de ce taux de perte, la perte est qualifiée d’anormale.'],
  ['alert_inventory_gap_pct', '2', 'alertes', 'Seuil écart inventaire (%)',
    'Écart toléré entre stock théorique et stock physique.'],
  ['alert_gap_value_dt', '5', 'alertes', 'Seuil écart inventaire (DT)',
    'Écart valorisé au-delà duquel une alerte est levée.'],

  // --- Valorisation ---
  ['valuation_method', 'cmp', 'stock', 'Méthode de valorisation',
    'cmp = coût moyen pondéré (défaut) ; fifo = premier entré, premier sorti. À valider avec le comptable.'],

  // --- TVA ---
  ['vat_rates', '[0,7,13,19]', 'tva', 'Taux de TVA disponibles (%)',
    'Taux proposés dans les formulaires. À valider avec le comptable.'],
  ['vat_default_rate', '19', 'tva', 'Taux de TVA par défaut (%)', ''],

  // --- Devise / affichage ---
  ['currency', 'DT', 'general', 'Devise', 'Dinar tunisien.'],
  ['currency_decimals', '3', 'general', 'Décimales monétaires', 'Affichage à 3 décimales.'],
  ['restaurant_name', 'Mon Restaurant', 'general', 'Nom du restaurant', ''],
  ['restaurant_address', '', 'general', 'Adresse', ''],
  ['restaurant_tax_id', '', 'general', 'Matricule fiscal', ''],

  // --- Repas du personnel ---
  ['staff_meals_in_ratio', 'false', 'regles', 'Intégrer les repas du personnel au ratio',
    'Règle PARAMÉTRABLE, à valider avec le comptable. false = les repas du personnel ne sont pas intégrés au coût matière du ratio.'],
  ['staff_meal_cost_center', 'personnel', 'regles', 'Centre de coût des repas', ''],

  // --- Avaries ---
  ['loss_default_in_consumption', 'true', 'regles', 'Avaries déjà incluses par défaut',
    'Une avarie qui a réduit le stock est déjà incluse dans la consommation : ne pas la recompter.'],

  // --- Sauvegarde ---
  ['auto_backup_enabled', 'true', 'sauvegarde', 'Sauvegarde automatique', ''],
  ['auto_backup_hour', '22', 'sauvegarde', 'Heure de sauvegarde automatique (0-23)', ''],
  ['auto_backup_retention_days', '30', 'sauvegarde', 'Rétention des sauvegardes (jours)', ''],

  // --- Paie (valeurs indicatives, à valider avec le comptable) ---
  ['payroll_cnss_employee_rate', '9.18', 'paie', 'Taux CNSS salarié (%)',
    'Paramètre MODIFIABLE. Taux indicatif : à confirmer avec le comptable (réglementation tunisienne).'],
  ['payroll_cnss_employer_rate', '16.57', 'paie', 'Taux CNSS employeur (%)',
    'Paramètre MODIFIABLE. Taux indicatif : à confirmer avec le comptable.'],
  ['payroll_irpp_rate', '0', 'paie', 'Taux IRPP retenu (%)',
    'Paramètre MODIFIABLE. Barème réel à valider avec le comptable.'],
  ['payroll_monthly_hours', '191', 'paie', 'Heures légales mensuelles',
    'Base de calcul du taux horaire. Paramètre modifiable.'],
  ['payroll_overtime_rate', '1.25', 'paie', 'Majoration heures supplémentaires', ''],

  // --- Session ---
  ['session_hours', '12', 'securite', 'Durée de session (heures)', ''],
  ['failed_login_limit', '5', 'securite', 'Tentatives avant temporisation', ''],
  ['failed_login_lock_minutes', '5', 'securite', 'Durée de blocage (minutes)', ''],
];

const KITCHENS = [
  ['CENTRALE', 'Cuisine centrale', 'centrale'],
  ['TRANSFORMATION', 'Cuisine de transformation', 'transformation'],
  ['PERSONNEL', 'Cuisine du personnel', 'personnel'],
];

const UNITS = [
  ['kg', 'Kilogramme', 'masse', 1000],
  ['g', 'Gramme', 'masse', 1],
  ['l', 'Litre', 'volume', 1000],
  ['ml', 'Millilitre', 'volume', 1],
  ['unite', 'Unité', 'compte', 1],
  ['carton', 'Carton', 'compte', 1],
];

const CATEGORIES = [
  'Légumes', 'Fruits', 'Viandes', 'Volailles', 'Poissons', 'Épicerie sèche',
  'Produits laitiers', 'Huiles et graisses', 'Boissons', 'Consommables',
  'Semi-finis', 'Plats',
];

const LOSS_TYPES = [
  ['perime', 'Périmé'],
  ['detérioré', 'Détérioré'],
  ['mauvaise_conservation', 'Mauvaise conservation'],
  ['erreur_preparation', 'Erreur de préparation'],
  ['perte_transformation', 'Perte de transformation'],
  ['renverse', 'Renversé / détruit'],
  ['ecart_inventaire', 'Écart d’inventaire justifié'],
  ['autre', 'Autre'],
];

/**
 * Applique les données initiales.
 * @param {{password?:string, resetPassword?:boolean}} [opts]
 */
export function seed({ password = 'chef1234', resetPassword = false } = {}) {
  const db = getDb();

  const tx = db.transaction(() => {
    // Paramètres
    const insertSetting = db.prepare(
      `INSERT INTO settings (key, value, category, label, description)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO NOTHING`,
    );
    for (const [key, value, category, label, description] of DEFAULT_SETTINGS) {
      insertSetting.run(key, value, category, label, description);
    }

    // Cuisines
    const insertKitchen = db.prepare(
      `INSERT INTO kitchens (code, name, kind) VALUES (?, ?, ?)
       ON CONFLICT(code) DO NOTHING`,
    );
    for (const k of KITCHENS) insertKitchen.run(...k);

    // Unités
    const insertUnit = db.prepare(
      `INSERT INTO units (code, label, family, factor) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO NOTHING`,
    );
    for (const u of UNITS) insertUnit.run(...u);

    // Catégories
    const insertCat = db.prepare(
      `INSERT INTO product_categories (name, sort_order) VALUES (?, ?)
       ON CONFLICT(name) DO NOTHING`,
    );
    CATEGORIES.forEach((name, i) => insertCat.run(name, i * 10));

    // Motifs d'avarie
    const insertLossType = db.prepare(
      `INSERT INTO loss_types (code, label) VALUES (?, ?)
       ON CONFLICT(code) DO NOTHING`,
    );
    for (const [code, label] of LOSS_TYPES) insertLossType.run(code, label);

    // Mot de passe : uniquement s'il n'existe pas (sauf demande explicite)
    const existing = db
      .prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'")
      .get();
    if (!existing || resetPassword) {
      db.prepare(
        `INSERT INTO settings (key, value, category, label, description)
         VALUES ('admin_password_hash', ?, 'securite', 'Mot de passe administrateur', 'Hash scrypt — jamais en clair')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ).run(hashPassword(password));
    }

    // Nom d'utilisateur unique
    db.prepare(
      `INSERT INTO settings (key, value, category, label, description)
       VALUES ('admin_username', 'chef', 'securite', 'Identifiant administrateur', 'Utilisateur unique')
       ON CONFLICT(key) DO NOTHING`,
    ).run();
  });

  tx();

  return {
    kitchens: all('SELECT * FROM kitchens'),
    units: all('SELECT * FROM units'),
    categories: all('SELECT * FROM product_categories'),
    settingsCount: get('SELECT COUNT(*) c FROM settings').c,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = seed();
  console.log('[seed] Cuisines :', result.kitchens.map((k) => k.name).join(', '));
  console.log('[seed] Unités :', result.units.map((u) => u.code).join(', '));
  console.log('[seed] Catégories :', result.categories.length);
  console.log(`[seed] Paramètres : ${result.settingsCount}`);
  console.log('[seed] Mot de passe initial : chef1234 (à changer dès la première connexion)');
}
