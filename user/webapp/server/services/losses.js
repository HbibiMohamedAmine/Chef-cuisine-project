/**
 * ============================================================================
 *  Service AVARIES / PERTES
 * ----------------------------------------------------------------------------
 *  - Une avarie VALIDÉE réduit le stock (mouvement de sortie tracé).
 *  - Elle apparaît TOUJOURS dans le rapport des pertes (jamais masquée).
 *  - Le drapeau `already_in_consumption` empêche le DOUBLE COMPTAGE :
 *      * true  = la perte a déjà réduit le stock du périmètre matières, donc elle
 *                est déjà incluse dans la consommation valorisée → on ne
 *                l'ajoute PAS au coût matière retenu ;
 *      * false = la perte n'a pas été capturée dans le solde matière → on
 *                l'ajoute explicitement.
 *  - Aucune suppression : brouillon → annulé ; validée → contre-écriture.
 * ============================================================================
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nextNumber, nowSql, periodBounds } from '../lib/numbering.js';
import { postMovement, getStockQty } from './stock.js';
import { roundMoney, roundQty } from '../../shared/formulas.js';

export function listLosses({ from = null, to = null, status = null, kitchenId = null,
  lossType = null, productId = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(l.occurred_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(l.occurred_at) <= date(?)'); params.push(to); }
  if (status) { where.push('l.status = ?'); params.push(status); }
  if (kitchenId) { where.push('l.kitchen_id = ?'); params.push(kitchenId); }
  if (lossType) { where.push('l.loss_type = ?'); params.push(lossType); }
  if (productId) { where.push('l.product_id = ?'); params.push(productId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT l.*, p.name AS product_name, p.code AS product_code, k.name AS kitchen_name,
            lt.label AS loss_type_label
     FROM losses l
     JOIN products p ON p.id = l.product_id
     JOIN kitchens k ON k.id = l.kitchen_id
     LEFT JOIN loss_types lt ON lt.code = l.loss_type
     ${clause} ORDER BY l.occurred_at DESC, l.id DESC LIMIT 500`,
    params,
  );
}

export function getLoss(id) {
  const l = get(
    `SELECT l.*, p.name AS product_name, p.unit AS product_unit, k.name AS kitchen_name,
            lt.label AS loss_type_label
     FROM losses l JOIN products p ON p.id = l.product_id
     JOIN kitchens k ON k.id = l.kitchen_id
     LEFT JOIN loss_types lt ON lt.code = l.loss_type
     WHERE l.id = ?`,
    [id],
  );
  if (!l) throw notFound('Avarie introuvable.');
  return l;
}

/**
 * Crée une avarie (brouillon par défaut, ou validée si `validate: true`).
 * @param {object} p
 */
export function createLoss(p, ip = null) {
  const kitchenId = requireNumber(p.kitchenId, 'Cuisine', { min: 1 });
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine introuvable.');

  const productId = requireNumber(p.productId, 'Produit', { min: 1 });
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit introuvable.');

  const qty = requireNumber(p.qty, 'Quantité', { min: 0.0001 });
  const lossType = requireString(p.lossType, 'Type d’avarie', { maxLength: 60 });
  const knownType = get('SELECT * FROM loss_types WHERE code = ? AND active = 1', [lossType]);
  if (!knownType) throw badRequest(`Type d’avarie inconnu : « ${lossType} ».`);
  if (lossType === 'autre' && !String(p.reason || '').trim()) {
    throw badRequest('Pour le motif « Autre », précisez le motif réel.');
  }
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date') : nowSql();
  const unitCost = p.unitCost !== undefined && p.unitCost !== ''
    ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0 })
    : product.unit_cost;
  const defaultIncluded = Boolean(getSetting('loss_default_in_consumption', true));
  const alreadyIncluded = p.alreadyInConsumption === undefined
    ? defaultIncluded
    : Boolean(p.alreadyInConsumption);

  const shouldValidate = Boolean(p.validate);

  return transaction(() => {
    const number = nextNumber('loss', new Date());
    const r = run(
      `INSERT INTO losses (number, occurred_at, kitchen_id, product_id, lot_number, qty, unit,
         unit_cost, total_cost, loss_type, reason, comment, photo_path, already_in_consumption, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')`,
      [number, occurredAt, kitchenId, productId, p.lotNumber || null, roundQty(qty), product.unit,
       roundMoney(unitCost), roundMoney(qty * unitCost), lossType, p.reason || null,
       p.comment || null, p.photoPath || null, alreadyIncluded ? 1 : 0],
    );
    const lossId = r.lastInsertRowid;

    if (shouldValidate) {
      applyValidation(lossId, ip);
    } else {
      audit({
        action: 'create', entity: 'loss', entityId: lossId,
        summary: `Avarie ${number} créée (brouillon) : ${qty} ${product.unit} — ${product.name}`, ip,
      });
    }
    return getLoss(lossId);
  });
}

/**
 * Interne : valide une avarie et crée la sortie de stock.
 * Doit être appelée DANS une transaction.
 */
function applyValidation(lossId, ip = null) {
  const l = get('SELECT * FROM losses WHERE id = ?', [lossId]);
  if (!l) throw notFound('Avarie introuvable.');
  if (l.status !== 'brouillon') throw badRequest('Cette avarie est déjà traitée.');

  const product = get('SELECT * FROM products WHERE id = ?', [l.product_id]);
  const available = getStockQty(l.product_id, l.kitchen_id);
  if (available + 0.0001 < l.qty) {
    throw badRequest(
      `Stock insuffisant : ${available} ${product.unit} de « ${product.name} » disponibles, ` +
      `${l.qty} ${product.unit} déclarés en avarie.`,
    );
  }

  postMovement({
    occurredAt: l.occurred_at,
    movementType: 'avarie',
    direction: 'out',
    kitchenId: l.kitchen_id,
    productId: l.product_id,
    qty: l.qty,
    unit: l.unit,
    unitCost: l.unit_cost,
    lotNumber: l.lot_number,
    sourceTable: 'losses',
    sourceId: l.id,
    reason: `Avarie ${l.number} — ${l.loss_type}`,
  });

  run(`UPDATE losses SET status = 'valide', validated_at = ? WHERE id = ?`, [nowSql(), l.id]);
  audit({
    action: 'validate', entity: 'loss', entityId: l.id,
    summary: `Avarie ${l.number} validée : ${l.qty} ${l.unit} (${roundMoney(l.total_cost)} DT) — ` +
      (l.already_in_consumption ? 'déjà incluse dans le coût consommé' : 'à ajouter au coût retenu'),
    severity: 'warning', ip,
  });
  return getLoss(l.id);
}

/** Valide une avarie en brouillon. */
export function validateLoss(id, ip = null) {
  return transaction(() => applyValidation(id, ip));
}

/** Met à jour une avarie en brouillon. */
export function updateLoss(id, p, ip = null) {
  const l = get('SELECT * FROM losses WHERE id = ?', [id]);
  if (!l) throw notFound('Avarie introuvable.');
  if (l.status !== 'brouillon') {
    throw badRequest('Une avarie validée ne peut pas être modifiée : annulez-la et créez une nouvelle opération.');
  }
  const product = get('SELECT * FROM products WHERE id = ?', [l.product_id]);
  const qty = p.qty !== undefined ? requireNumber(p.qty, 'Quantité', { min: 0.0001 }) : l.qty;
  const unitCost = p.unitCost !== undefined ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0 })
    : l.unit_cost;

  run(
    `UPDATE losses SET qty = ?, unit_cost = ?, total_cost = ?, loss_type = ?, reason = ?,
       comment = ?, photo_path = ?, already_in_consumption = ? WHERE id = ?`,
    [roundQty(qty), roundMoney(unitCost), roundMoney(qty * unitCost),
     p.lossType || l.loss_type, p.reason !== undefined ? p.reason : l.reason,
     p.comment !== undefined ? p.comment : l.comment,
     p.photoPath !== undefined ? p.photoPath : l.photo_path,
     p.alreadyInConsumption !== undefined ? (p.alreadyInConsumption ? 1 : 0) : l.already_in_consumption,
     id],
  );
  audit({ action: 'update', entity: 'loss', entityId: id, summary: `${l.number} (${product.name})`, ip });
  return getLoss(id);
}

/**
 * Annule une avarie. Si validée → contre-écriture (retour en stock).
 */
export function cancelLoss(id, reason, ip = null) {
  const l = get('SELECT * FROM losses WHERE id = ?', [id]);
  if (!l) throw notFound('Avarie introuvable.');
  if (l.status === 'annule') throw badRequest('Cette avarie est déjà annulée.');
  const motif = requireString(reason, 'Motif d’annulation', { maxLength: 300 });

  return transaction(() => {
    if (l.status === 'valide') {
      postMovement({
        occurredAt: nowSql(),
        movementType: 'contre_ecriture',
        direction: 'in',
        kitchenId: l.kitchen_id,
        productId: l.product_id,
        qty: l.qty,
        unit: l.unit,
        unitCost: l.unit_cost,
        sourceTable: 'losses',
        sourceId: l.id,
        reason: `Annulation avarie ${l.number} : ${motif}`,
      });
    }
    run(`UPDATE losses SET status = 'annule', comment = COALESCE(comment,'') || ? WHERE id = ?`,
      [`\n[Annulé] ${motif}`, id]);
    audit({ action: 'cancel', entity: 'loss', entityId: id, summary: `Avarie ${l.number} : ${motif}`,
      severity: 'warning', ip });
    return getLoss(id);
  });
}

/**
 * Rapport des pertes sur une période, avec distinction
 * « déjà incluses » / « non incluses » pour le calcul du ratio.
 * @param {string} from
 * @param {string} to
 */
export function lossesReport(from, to) {
  const rows = all(
    `SELECT l.*, p.name AS product_name, p.type AS product_type, k.name AS kitchen_name,
            lt.label AS loss_type_label
     FROM losses l
     JOIN products p ON p.id = l.product_id
     JOIN kitchens k ON k.id = l.kitchen_id
     LEFT JOIN loss_types lt ON lt.code = l.loss_type
     WHERE l.status = 'valide' AND date(l.occurred_at) BETWEEN date(?) AND date(?)
     ORDER BY l.occurred_at ASC`,
    [from, to],
  );

  const included = rows.filter((r) => r.already_in_consumption === 1);
  const notIncluded = rows.filter((r) => r.already_in_consumption === 0);

  const byType = new Map();
  const byKitchen = new Map();
  const byProduct = new Map();

  for (const r of rows) {
    const t = byType.get(r.loss_type) || {
      code: r.loss_type, label: r.loss_type_label || r.loss_type, count: 0, qty: 0, value: 0,
    };
    t.count += 1;
    t.qty = roundQty(t.qty + r.qty);
    t.value = roundMoney(t.value + r.total_cost);
    byType.set(r.loss_type, t);

    const k = byKitchen.get(r.kitchen_name) || { kitchen: r.kitchen_name, count: 0, value: 0 };
    k.count += 1;
    k.value = roundMoney(k.value + r.total_cost);
    byKitchen.set(r.kitchen_name, k);

    const p = byProduct.get(r.product_id) || {
      product_id: r.product_id, product: r.product_name, unit: r.unit, count: 0, qty: 0, value: 0,
    };
    p.count += 1;
    p.qty = roundQty(p.qty + r.qty);
    p.value = roundMoney(p.value + r.total_cost);
    byProduct.set(r.product_id, p);
  }

  const totalValue = roundMoney(rows.reduce((a, r) => a + r.total_cost, 0));
  const notIncludedValue = roundMoney(notIncluded.reduce((a, r) => a + r.total_cost, 0));

  return {
    from,
    to,
    count: rows.length,
    totalValue,
    includedValue: roundMoney(totalValue - notIncludedValue),
    notIncludedValue,
    byType: [...byType.values()].sort((a, b) => b.value - a.value),
    byKitchen: [...byKitchen.values()].sort((a, b) => b.value - a.value),
    byProduct: [...byProduct.values()].sort((a, b) => b.value - a.value),
    details: rows.map((r) => ({
      id: r.id, number: r.number, occurred_at: r.occurred_at, kitchen: r.kitchen_name,
      product: r.product_name, qty: r.qty, unit: r.unit, unit_cost: r.unit_cost,
      total_cost: r.total_cost, loss_type_label: r.loss_type_label, reason: r.reason,
      already_in_consumption: r.already_in_consumption,
    })),
    note: 'Une avarie déjà incluse dans le coût consommé n’est jamais ajoutée une seconde fois au ratio.',
  };
}

/** Avaries en attente de validation (pour les alertes de clôture). */
export function pendingLosses() {
  return all(
    `SELECT l.id, l.number, l.occurred_at, l.qty, l.unit, l.total_cost, p.name AS product_name
     FROM losses l JOIN products p ON p.id = l.product_id
     WHERE l.status = 'brouillon' ORDER BY l.occurred_at`,
  );
}
