/**
 * ============================================================================
 *  Service VENTES
 * ----------------------------------------------------------------------------
 *  - HT / TVA / TTC avec taux par ligne (paramétrables).
 *  - Remises par ligne, annulation par contre-écriture.
 *  - SORTIE DE STOCK : on enregistre la sortie physique du produit vendu, MAIS
 *    le moteur de consommation ne compte que le périmètre MATIÈRES
 *    (matière première / ingrédient / consommable). Les produits finis et
 *    semi-finis sont exclus de ce périmètre, car leurs ingrédients ont déjà
 *    été capturés au moment de la production.
 *    => AUCUN double comptage des ingrédients.
 * ============================================================================
 */
import { all, get, run, transaction } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nextNumber, nowSql, periodBounds } from '../lib/numbering.js';
import { postMovement, getStockQty } from './stock.js';
import { saleLineTotals, roundMoney, roundQty, formatMoney } from '../../shared/formulas.js';

export function listSales({ from = null, to = null, status = null, channel = null, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(s.occurred_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.occurred_at) <= date(?)'); params.push(to); }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (channel) { where.push('s.channel = ?'); params.push(channel); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT s.*, (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS items_count
     FROM sales s ${clause} ORDER BY s.occurred_at DESC, s.id DESC LIMIT ?`,
    [...params, limit],
  );
}

export function getSale(id) {
  const sale = get('SELECT * FROM sales WHERE id = ?', [id]);
  if (!sale) throw notFound('Vente introuvable.');
  const items = all(
    `SELECT si.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit
     FROM sale_items si JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = ? ORDER BY si.id`,
    [id],
  );
  const movements = all(
    `SELECT m.*, p.name AS product_name FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     WHERE m.source_table = 'sales' AND m.source_id = ? ORDER BY m.id`,
    [id],
  );
  return { ...sale, items, movements };
}

/**
 * Enregistre une vente et VALIDE immédiatement (vente au comptoir).
 * Saisie atomique : lignes, totaux, sorties de stock, mouvement de caisse.
 *
 * @param {object} p
 * @param {string} [p.occurredAt]
 * @param {Array<{productId:number, qty:number, unitPriceHt?:number, discountPct?:number, taxRate?:number}>} p.items
 * @param {string} [p.paymentMethod] espece | carte | cheque | credit
 * @param {number} [p.amountPaid] montant réellement encaissé
 */
export function createSale(p, ip = null) {
  const items = Array.isArray(p.items) ? p.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) throw badRequest('Ajoutez au moins une ligne à la vente.');
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date de vente') : nowSql();
  const kitchenId = Number(p.kitchenId || 1);
  const paymentMethod = String(p.paymentMethod || 'espece');

  return transaction(() => {
    // Pré-calcul des lignes et contrôle de stock
    const prepared = [];
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let costTotal = 0;

    for (const it of items) {
      const product = get('SELECT * FROM products WHERE id = ?', [it.productId]);
      if (!product) throw badRequest(`Produit ${it.productId} introuvable.`);
      const qty = requireNumber(it.qty, `Quantité (${product.name})`, { min: 0.0001 });
      const unitPrice = it.unitPriceHt !== undefined && it.unitPriceHt !== ''
        ? requireNumber(it.unitPriceHt, 'Prix unitaire HT', { min: 0 })
        : Number(product.sell_price_ht || 0);
      if (unitPrice <= 0 && !p.allowZeroPrice) {
        throw badRequest(`Le prix de vente HT de « ${product.name} » n’est pas renseigné.`);
      }
      const discountPct = requireNumber(it.discountPct ?? 0, 'Remise', { min: 0, max: 100, required: false });
      const taxRate = it.taxRate !== undefined
        ? requireNumber(it.taxRate, 'TVA', { min: 0, max: 100, required: false })
        : Number(product.tax_rate ?? 0);

      const totals = saleLineTotals(qty, unitPrice, discountPct, taxRate);
      const unitCost = Number(product.unit_cost || 0);
      const lineCost = roundMoney(qty * unitCost);

      // Contrôle de disponibilité pour les produits stockés
      if (p.checkStock !== false && product.type !== 'consommable') {
        const available = getStockQty(product.id, kitchenId);
        if (available + 0.0001 < qty && !p.force) {
          throw badRequest(
            `Stock insuffisant pour « ${product.name} » : ${available} ${product.unit} disponibles, ` +
            `${qty} ${product.unit} demandés.`,
          );
        }
      }

      subtotal = roundMoney(subtotal + totals.subtotalHt);
      discountTotal = roundMoney(discountTotal + totals.discount);
      taxTotal = roundMoney(taxTotal + totals.tax);
      costTotal = roundMoney(costTotal + lineCost);

      prepared.push({ product, qty, unitPrice, discountPct, taxRate, totals, unitCost, lineCost });
    }

    const totalHt = roundMoney(subtotal - discountTotal);
    const totalTtc = roundMoney(totalHt + taxTotal);

    const number = nextNumber('sale', new Date());
    const r = run(
      `INSERT INTO sales (number, occurred_at, status, subtotal_ht, discount, tax, total_ttc,
         cost_total, payment_method, channel, notes, validated_at)
       VALUES (?, ?, 'valide', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [number, occurredAt, subtotal, discountTotal, taxTotal, totalTtc, costTotal,
       paymentMethod, p.channel || 'sur_place', p.notes || null, nowSql()],
    );
    const saleId = r.lastInsertRowid;

    for (const l of prepared) {
      run(
        `INSERT INTO sale_items (sale_id, product_id, qty, unit_price_ht, discount_pct, tax_rate,
           line_ht, line_tax, line_ttc, unit_cost, line_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, l.product.id, l.qty, l.unitPrice, l.discountPct, l.taxRate,
         l.totals.ht, l.totals.tax, l.totals.ttc, l.unitCost, l.lineCost],
      );

      // Sortie de stock physique (traçabilité). Le moteur de consommation ne
      // compte que le périmètre matières : pas de double comptage.
      if (l.product.type !== 'consommable') {
        postMovement({
          occurredAt,
          movementType: 'vente_sortie',
          direction: 'out',
          kitchenId,
          productId: l.product.id,
          qty: l.qty,
          unit: l.product.unit,
          unitCost: l.unitCost,
          sourceTable: 'sales',
          sourceId: saleId,
          reason: `Vente ${number}`,
        });
      }
    }

    // Encaissement en caisse
    const paid = p.amountPaid !== undefined ? Number(p.amountPaid) : totalTtc;
    if (paid > 0 && paymentMethod !== 'credit') {
      run(
        `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table, source_id)
         VALUES (?, 'encaissement', 'vente', ?, ?, ?, ?, 'sales', ?)`,
        [occurredAt, roundMoney(paid), paymentMethod, number, `Encaissement vente ${number}`, saleId],
      );
    }

    audit({
      action: 'create', entity: 'sale', entityId: saleId,
      summary: `Vente ${number} : ${formatMoney(totalTtc)} TTC (${formatMoney(totalHt)} HT)`,
      ip,
    });
    return getSale(saleId);
  });
}

/**
 * Annule une vente : contre-écritures des sorties de stock + sortie de caisse.
 * La vente reste visible avec le statut « annule ».
 */
export function cancelSale(id, reason, ip = null) {
  const sale = get('SELECT * FROM sales WHERE id = ?', [id]);
  if (!sale) throw notFound('Vente introuvable.');
  if (sale.status === 'annule') throw badRequest('Cette vente est déjà annulée.');
  const motif = requireString(reason, 'Motif d’annulation', { maxLength: 300 });

  return transaction(() => {
    const items = all('SELECT * FROM sale_items WHERE sale_id = ?', [id]);
    for (const it of items) {
      const product = get('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (product.type === 'consommable') continue;
      postMovement({
        occurredAt: nowSql(),
        movementType: 'contre_ecriture',
        direction: 'in',
        kitchenId: 1,
        productId: it.product_id,
        qty: it.qty,
        unitCost: it.unit_cost,
        sourceTable: 'sales',
        sourceId: id,
        reason: `Annulation vente ${sale.number} : ${motif}`,
      });
    }

    if (sale.payment_method !== 'credit') {
      run(
        `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table, source_id)
         VALUES (?, 'remboursement', 'vente_annulee', ?, ?, ?, ?, 'sales', ?)`,
        [nowSql(), sale.total_ttc, sale.payment_method, sale.number,
         `Remboursement vente ${sale.number} : ${motif}`, id],
      );
    }

    run(`UPDATE sales SET status = 'annule', cancelled_at = ?, notes = COALESCE(notes,'') || ? WHERE id = ?`,
      [nowSql(), `\n[Annulé] ${motif}`, id]);

    audit({ action: 'cancel', entity: 'sale', entityId: id,
      summary: `Vente ${sale.number} annulée : ${motif}`, severity: 'warning', ip });
    return getSale(id);
  });
}

/**
 * Chiffre d'affaires HT d'une période (ventes validées uniquement).
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 */
export function revenueHt(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(subtotal_ht - discount),0),3) ht,
            ROUND(COALESCE(SUM(tax),0),3) tax,
            ROUND(COALESCE(SUM(total_ttc),0),3) ttc,
            COUNT(*) count
     FROM sales WHERE status = 'valide' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { ht: row.ht || 0, tax: row.tax || 0, ttc: row.ttc || 0, count: row.count || 0 };
}

/** Analyse des ventes par plat et par catégorie. */
export function salesAnalysis(from, to) {
  const byProduct = all(
    `SELECT p.id, p.code, p.name, p.unit, c.name AS category_name,
            ROUND(SUM(si.qty),4) AS qty,
            ROUND(SUM(si.line_ht),3) AS revenue_ht,
            ROUND(SUM(si.line_cost),3) AS cost,
            ROUND(SUM(si.line_ht) - SUM(si.line_cost),3) AS margin,
            CASE WHEN SUM(si.line_ht) > 0
                 THEN ROUND(SUM(si.line_cost) * 100.0 / SUM(si.line_ht), 2) ELSE 0 END AS ratio_pct,
            COUNT(*) AS lines
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN product_categories c ON c.id = p.category_id
     WHERE s.status = 'valide' AND date(s.occurred_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id ORDER BY revenue_ht DESC`,
    [from, to],
  );

  const byCategory = new Map();
  for (const r of byProduct) {
    const key = r.category_name || 'Non classé';
    const cur = byCategory.get(key) || { category: key, qty: 0, revenue_ht: 0, cost: 0, margin: 0 };
    cur.qty = roundQty(cur.qty + r.qty);
    cur.revenue_ht = roundMoney(cur.revenue_ht + r.revenue_ht);
    cur.cost = roundMoney(cur.cost + r.cost);
    cur.margin = roundMoney(cur.margin + r.margin);
    byCategory.set(key, cur);
  }

  // Ventes du jour / du mois (comparatif rapide)
  const today = nowSql().slice(0, 10);
  const todayRevenue = revenueHt(today, today);

  return {
    from,
    to,
    byProduct,
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue_ht - a.revenue_ht),
    today: todayRevenue,
  };
}

/**
 * RAPPROCHEMENT VENTES / SORTIES DE STOCK.
 * Montre explicitement les deux flux et rappelle la règle anti-double comptage.
 */
export function salesStockReconciliation(from, to) {
  const revenue = revenueHt(from, to);

  // Coût des produits finis/semi-finis vendus (déjà capturé en production)
  const costFinished = get(
    `SELECT ROUND(COALESCE(SUM(si.line_cost),0),3) v FROM sale_items si
     JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.status='valide' AND date(s.occurred_at) BETWEEN date(?) AND date(?)
       AND p.type IN ('fini','semi_fini')`,
    [from, to],
  ).v;

  // Coût des produits du périmètre matières vendus directement (boissons…)
  const costDirect = get(
    `SELECT ROUND(COALESCE(SUM(si.line_cost),0),3) v FROM sale_items si
     JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.status='valide' AND date(s.occurred_at) BETWEEN date(?) AND date(?)
       AND p.type IN ('matiere_premiere','ingredient_repas')`,
    [from, to],
  ).v;

  return {
    from,
    to,
    revenueHt: revenue.ht,
    salesCount: revenue.count,
    costOfFinishedGoodsSold: costFinished || 0,
    costOfMaterialsSoldDirectly: costDirect || 0,
    note:
      'Les produits finis vendus ne sont PAS recomptés : leur coût matière a déjà été ' +
      'consommé lors de la production. Seuls les produits du périmètre matières vendus ' +
      'directement influencent le solde de consommation (via le stock de clôture).',
  };
}

/** Ventes journalières (pour la caisse et le tableau de bord). */
export function dailySales(date) {
  return all(
    `SELECT s.id, s.number, s.occurred_at, s.total_ttc, s.payment_method,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS items_count
     FROM sales s WHERE s.status = 'valide' AND date(s.occurred_at) = date(?)
     ORDER BY s.occurred_at DESC`,
    [date],
  );
}
