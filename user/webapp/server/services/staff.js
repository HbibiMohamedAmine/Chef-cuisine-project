/**
 * ============================================================================
 *  Service CUISINE DU PERSONNEL
 * ----------------------------------------------------------------------------
 *  La cuisine du personnel dispose de son PROPRE stock, alimenté par :
 *    - transferts depuis les autres cuisines,
 *    - achats directs,
 *    - productions éventuelles.
 *
 *  ⚠️ Les repas du personnel NE SONT PAS DES VENTES :
 *    - aucune ligne dans `sales`,
 *    - aucun impact sur le CA HT,
 *    - le coût est imputé au centre de coût « personnel ».
 *    Le paramètre `staff_meals_in_ratio` décide si ce coût entre ou non dans
 *    le ratio matière global (règle à valider avec le comptable).
 * ============================================================================
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nowSql, periodBounds } from '../lib/numbering.js';
import { postMovement, getStockQty } from './stock.js';
import { roundMoney, roundQty, formatMoney } from '../../shared/formulas.js';

/** Récupère (ou vérifie) la cuisine du personnel. */
export function staffKitchen() {
  const k = get("SELECT * FROM kitchens WHERE kind = 'personnel'");
  if (!k) throw notFound('Cuisine du personnel introuvable.');
  return k;
}

/**
 * Enregistre une CONSOMMATION DE REPAS (sortie de stock de la cuisine du
 * personnel). Ce n'est pas une vente : l'opération n'apparaît jamais dans le CA.
 *
 * @param {object} p
 * @param {Array<{productId:number, qty:number}>} p.items
 * @param {number} [p.meals] nombre de repas servis (traçabilité)
 * @param {string} [p.occurredAt]
 * @param {string} [p.notes]
 */
export function recordStaffMeal(p, ip = null) {
  const kitchen = staffKitchen();
  const items = Array.isArray(p.items) ? p.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) throw badRequest('Indiquez au moins un produit consommé.');
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date') : nowSql();
  const meals = requireNumber(p.meals ?? 1, 'Nombre de repas', { min: 1, required: false });

  return transaction(() => {
    let totalCost = 0;
    for (const it of items) {
      const product = get('SELECT * FROM products WHERE id = ?', [it.productId]);
      if (!product) throw badRequest(`Produit ${it.productId} introuvable.`);
      const qty = requireNumber(it.qty, `Quantité (${product.name})`, { min: 0.0001 });
      const available = getStockQty(product.id, kitchen.id);
      if (available + 0.0001 < qty) {
        throw badRequest(
          `Stock insuffisant en cuisine du personnel pour « ${product.name} » : ` +
          `${available} ${product.unit} disponibles, ${qty} ${product.unit} demandés.`,
        );
      }
      postMovement({
        occurredAt,
        movementType: 'consommation_repas',
        direction: 'out',
        kitchenId: kitchen.id,
        productId: product.id,
        qty,
        unit: product.unit,
        unitCost: product.unit_cost,
        sourceTable: 'staff_meals',
        reason: `Repas du personnel (${meals} repas)`,
        notes: p.notes || null,
      });
      totalCost = roundMoney(totalCost + qty * product.unit_cost);
    }

    audit({
      action: 'create', entity: 'staff_meal', entityId: null,
      summary: `Repas du personnel : ${meals} repas — ${formatMoney(totalCost)} ` +
        '(hors ventes, centre de coût personnel)',
      severity: 'info', ip,
    });
    return { meals, totalCost, costPerMeal: roundMoney(totalCost / meals), items: items.length };
  });
}

/**
 * Achat direct destiné à la cuisine du personnel.
 * (Achat ≠ consommation : l'entrée en stock est enregistrée, la consommation
 * viendra plus tard.)
 */
export function directPurchaseToStaff({ productId, qty, unitCost, supplierId = null, date = null, notes = null }, ip = null) {
  const kitchen = staffKitchen();
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit introuvable.');
  const q = requireNumber(qty, 'Quantité', { min: 0.0001 });
  const cost = requireNumber(unitCost ?? product.unit_cost, 'Coût unitaire', { min: 0 });

  return transaction(() => {
    postMovement({
      occurredAt: date ? requireDate(date, 'Date') : nowSql().slice(0, 10),
      movementType: 'reception',
      direction: 'in',
      kitchenId: kitchen.id,
      productId: product.id,
      qty: q,
      unit: product.unit,
      unitCost: cost,
      sourceTable: 'staff_purchase',
      reason: 'Achat direct cuisine du personnel',
      notes,
    });
    audit({ action: 'create', entity: 'staff_purchase', entityId: product.id,
      summary: `Achat direct personnel : ${q} ${product.unit} — ${formatMoney(q * cost)}`, ip });
    return { qty: q, value: roundMoney(q * cost) };
  });
}

/**
 * RAPPORT MENSUEL de la cuisine du personnel (séparé des ventes).
 * @param {string} period YYYY-MM
 */
export function staffMonthlyReport(period) {
  const { start, end } = periodBounds(period);
  const kitchen = staffKitchen();

  const movements = all(
    `SELECT m.*, p.name AS product_name, p.unit AS product_unit
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.kitchen_id = ? AND date(m.occurred_at) BETWEEN date(?) AND date(?)
     ORDER BY m.occurred_at`,
    [kitchen.id, start, end],
  );

  const sumBy = (types, direction) =>
    roundMoney(
      movements
        .filter((m) => types.includes(m.movement_type) && (!direction || m.direction === direction))
        .reduce((a, m) => a + m.total_cost, 0),
    );

  const transfersIn = sumBy(['transfert_entree'], 'in');
  const directPurchases = movements
    .filter((m) => m.movement_type === 'reception' && m.source_table === 'staff_purchase')
    .reduce((a, m) => a + m.total_cost, 0);
  const mealsConsumed = sumBy(['consommation_repas'], 'out');
  const losses = sumBy(['avarie'], 'out');
  const adjustments = roundMoney(
    movements
      .filter((m) => m.movement_type.startsWith('ajustement'))
      .reduce((a, m) => a + (m.direction === 'in' ? m.total_cost : -m.total_cost), 0),
  );

  const stockValue = roundMoney(
    all(
      `SELECT ROUND(COALESCE(SUM(CASE WHEN direction='in' THEN qty ELSE -qty END),0),4) qty,
              p.unit_cost
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       WHERE m.kitchen_id = ? AND date(m.occurred_at) <= date(?)
       GROUP BY p.id`,
      [kitchen.id, end],
    ).reduce((a, r) => a + Number(r.qty) * Number(r.unit_cost), 0),
  );

  const byProduct = all(
    `SELECT p.id, p.name, p.unit,
            ROUND(COALESCE(SUM(CASE WHEN m.movement_type='consommation_repas' THEN m.qty ELSE 0 END),0),4) AS qty,
            ROUND(COALESCE(SUM(CASE WHEN m.movement_type='consommation_repas' THEN m.total_cost ELSE 0 END),0),3) AS value
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.kitchen_id = ? AND date(m.occurred_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id HAVING qty > 0 ORDER BY value DESC`,
    [kitchen.id, start, end],
  );

  return {
    period,
    from: start,
    to: end,
    kitchen: kitchen.name,
    transfersIn: roundMoney(transfersIn),
    directPurchases: roundMoney(directPurchases),
    mealsConsumed: roundMoney(mealsConsumed),
    losses: roundMoney(losses),
    adjustments,
    stockValue,
    byProduct,
    mealsMovementCount: movements.filter((m) => m.movement_type === 'consommation_repas').length,
    includedInRatio: Boolean(getSetting('staff_meals_in_ratio', false)),
    note:
      'Les repas du personnel ne sont pas des ventes. Leur coût est suivi séparément ; ' +
      'son intégration au ratio matière global est un paramètre à valider avec le comptable.',
    details: movements.map((m) => ({
      id: m.id, occurred_at: m.occurred_at, type: m.movement_type, direction: m.direction,
      product: m.product_name, qty: m.qty, unit: m.product_unit, value: m.total_cost,
      reason: m.reason,
    })),
  };
}

/** Stock actuel de la cuisine du personnel. */
export function staffStock() {
  const kitchen = staffKitchen();
  return all(
    `SELECT p.id, p.code, p.name, p.unit, p.unit_cost,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0),4) AS qty,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) * p.unit_cost,3) AS value
     FROM products p
     JOIN stock_movements m ON m.product_id = p.id AND m.kitchen_id = ?
     WHERE p.deleted_at IS NULL
     GROUP BY p.id
     HAVING ABS(qty) > 0.0001
     ORDER BY p.name`,
    [kitchen.id],
  );
}
