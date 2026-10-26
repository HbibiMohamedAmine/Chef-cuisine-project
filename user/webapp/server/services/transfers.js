/**
 * ============================================================================
 *  Service TRANSFERTS INTERNES
 * ----------------------------------------------------------------------------
 *  RÈGLES ABSOLUES (cahier des charges) :
 *   1. Un transfert N'EST PAS un achat.
 *   2. Un transfert N'EST PAS une consommation finale.
 *   3. Un transfert NE CRÉE AUCUN COÛT : il déplace une quantité et son coût
 *      unitaire retenu d'une cuisine à l'autre. Comme les deux cuisines
 *      appartiennent au MÊME périmètre de calcul, le coût matière global est
 *      strictement inchangé.
 *   4. Validation ATOMIQUE des deux stocks (sortie source + entrée destination).
 *   5. Interdit si quantité > stock disponible, SAUF ajustement explicite
 *      justifié (forceNegative + justification).
 *   6. Jamais de suppression : brouillon → supprimable logiquement ;
 *      validé → annulation par CONTRE-ÉCRITURE tracée.
 * ============================================================================
 */
import { all, get, run, transaction } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nextNumber, nowSql, periodBounds } from '../lib/numbering.js';
import { postMovement, getStockQty } from './stock.js';
import { roundMoney, roundQty, formatMoney } from '../../shared/formulas.js';

/**
 * Liste des transferts filtrable.
 */
export function listTransfers({ from = null, to = null, status = null, sourceKitchenId = null,
  destKitchenId = null, productId = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(t.occurred_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(t.occurred_at) <= date(?)'); params.push(to); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (sourceKitchenId) { where.push('t.source_kitchen_id = ?'); params.push(sourceKitchenId); }
  if (destKitchenId) { where.push('t.dest_kitchen_id = ?'); params.push(destKitchenId); }
  if (productId) { where.push('t.product_id = ?'); params.push(productId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT t.*, p.name AS product_name, p.code AS product_code,
            ks.name AS source_name, kd.name AS dest_name
     FROM transfers t
     JOIN products p ON p.id = t.product_id
     JOIN kitchens ks ON ks.id = t.source_kitchen_id
     JOIN kitchens kd ON kd.id = t.dest_kitchen_id
     ${clause} ORDER BY t.occurred_at DESC, t.id DESC LIMIT 500`,
    params,
  );
}

export function getTransfer(id) {
  const t = get(
    `SELECT t.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
            ks.name AS source_name, kd.name AS dest_name
     FROM transfers t
     JOIN products p ON p.id = t.product_id
     JOIN kitchens ks ON ks.id = t.source_kitchen_id
     JOIN kitchens kd ON kd.id = t.dest_kitchen_id
     WHERE t.id = ?`,
    [id],
  );
  if (!t) throw notFound('Transfert introuvable.');
  const movements = all(
    `SELECT m.*, k.name AS kitchen_name FROM stock_movements m
     JOIN kitchens k ON k.id = m.kitchen_id
     WHERE m.source_table = 'transfers' AND m.source_id = ? ORDER BY m.id`,
    [id],
  );
  return { ...t, movements };
}

/**
 * Crée un transfert en BROUILLON (aucun mouvement de stock).
 * @param {object} p
 */
export function createTransfer(p, ip = null) {
  const sourceKitchenId = requireNumber(p.sourceKitchenId, 'Cuisine source', { min: 1 });
  const destKitchenId = requireNumber(p.destKitchenId, 'Cuisine destination', { min: 1 });
  if (sourceKitchenId === destKitchenId) {
    throw badRequest('La cuisine source et la cuisine destination doivent être différentes.');
  }
  const source = get('SELECT * FROM kitchens WHERE id = ?', [sourceKitchenId]);
  const dest = get('SELECT * FROM kitchens WHERE id = ?', [destKitchenId]);
  if (!source) throw notFound('Cuisine source introuvable.');
  if (!dest) throw notFound('Cuisine destination introuvable.');

  const productId = requireNumber(p.productId, 'Produit', { min: 1 });
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit introuvable.');

  const qty = requireNumber(p.qty, 'Quantité', { min: 0.0001 });
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date du transfert') : nowSql();
  const unitCost = p.unitCost !== undefined && p.unitCost !== ''
    ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0 })
    : product.unit_cost;
  const reason = p.reason ? String(p.reason).trim() : null;

  const forceNegative = Boolean(p.forceNegative);
  if (forceNegative && !String(p.forceJustification || '').trim()) {
    throw badRequest('Un transfert autorisé au-delà du stock exige une justification écrite.');
  }

  return transaction(() => {
    const number = nextNumber('transfer', new Date());
    const r = run(
      `INSERT INTO transfers (number, occurred_at, source_kitchen_id, dest_kitchen_id, product_id,
         lot_number, qty, unit, unit_cost, total_cost, reason, status, force_negative, force_justification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon', ?, ?)`,
      [number, occurredAt, sourceKitchenId, destKitchenId, productId, p.lotNumber || null,
       roundQty(qty), product.unit, roundMoney(unitCost), roundMoney(qty * unitCost),
       reason, forceNegative ? 1 : 0, forceNegative ? p.forceJustification : null],
    );
    audit({
      action: 'create', entity: 'transfer', entityId: r.lastInsertRowid,
      summary: `Transfert ${number} créé : ${qty} ${product.unit} ${source.name} → ${dest.name}`,
      ip,
    });
    return getTransfer(r.lastInsertRowid);
  });
}

export function updateTransfer(id, p, ip = null) {
  const t = get('SELECT * FROM transfers WHERE id = ?', [id]);
  if (!t) throw notFound('Transfert introuvable.');
  if (t.status !== 'brouillon') {
    throw badRequest('Seul un transfert en brouillon peut être modifié.');
  }
  return transaction(() => {
    const product = get('SELECT * FROM products WHERE id = ?', [t.product_id]);
    const qty = p.qty !== undefined ? requireNumber(p.qty, 'Quantité', { min: 0.0001 }) : t.qty;
    const unitCost = p.unitCost !== undefined
      ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0 })
      : t.unit_cost;
    run(
      `UPDATE transfers SET qty = ?, unit_cost = ?, total_cost = ?, reason = ?, lot_number = ?,
         occurred_at = COALESCE(?, occurred_at) WHERE id = ?`,
      [roundQty(qty), roundMoney(unitCost), roundMoney(qty * unitCost),
       p.reason !== undefined ? p.reason : t.reason,
       p.lotNumber !== undefined ? p.lotNumber : t.lot_number,
       p.occurredAt || null, id],
    );
    audit({ action: 'update', entity: 'transfer', entityId: id, summary: `${t.number}`, ip });
    return getTransfer(id);
  });
}

/**
 * VALIDE un transfert : sortie de la source + entrée à la destination,
 * dans UNE SEULE transaction atomique, avec un coût unitaire IDENTIQUE des deux
 * côtés (règle n° 7 : coûts cohérents entre cuisine source et destinataire).
 * @param {number} id
 * @param {{forceNegative?:boolean, forceJustification?:string}} [opts]
 * @param {string} [ip]
 */
export function validateTransfer(id, opts = {}, ip = null) {
  const t = get('SELECT * FROM transfers WHERE id = ?', [id]);
  if (!t) throw notFound('Transfert introuvable.');
  if (t.status === 'valide') throw badRequest('Ce transfert est déjà validé.');
  if (t.status === 'annule') throw badRequest('Ce transfert est annulé.');

  const product = get('SELECT * FROM products WHERE id = ?', [t.product_id]);
  const force = Boolean(opts.forceNegative || t.force_negative);
  const justification = opts.forceJustification || t.force_justification;

  return transaction(() => {
    const available = getStockQty(t.product_id, t.source_kitchen_id);

    if (available + 0.0001 < t.qty) {
      if (!force) {
        throw badRequest(
          `Stock insuffisant : ${available} ${product.unit} de « ${product.name} » disponibles en ` +
          `cuisine source, ${t.qty} ${product.unit} demandés. ` +
          `Réduisez la quantité ou utilisez un ajustement explicite justifié.`,
          { available, requested: t.qty, productUnit: product.unit },
        );
      }
      if (!String(justification || '').trim()) {
        throw badRequest('Un transfert forcé doit porter une justification écrite.');
      }
    }

    // Sortie source
    postMovement({
      occurredAt: t.occurred_at,
      movementType: 'transfert_sortie',
      direction: 'out',
      kitchenId: t.source_kitchen_id,
      productId: t.product_id,
      qty: t.qty,
      unit: t.unit,
      unitCost: t.unit_cost,
      lotNumber: t.lot_number,
      sourceTable: 'transfers',
      sourceId: t.id,
      reason: `Transfert ${t.number}`,
      notes: justification || null,
    });

    // Entrée destination — MÊME coût unitaire (aucun coût créé)
    postMovement({
      occurredAt: t.occurred_at,
      movementType: 'transfert_entree',
      direction: 'in',
      kitchenId: t.dest_kitchen_id,
      productId: t.product_id,
      qty: t.qty,
      unit: t.unit,
      unitCost: t.unit_cost,
      lotNumber: t.lot_number,
      sourceTable: 'transfers',
      sourceId: t.id,
      reason: `Transfert ${t.number}`,
      notes: justification || null,
    });

    run(
      `UPDATE transfers SET status = 'valide', validated_at = ?, force_negative = ?,
         force_justification = COALESCE(?, force_justification) WHERE id = ?`,
      [nowSql(), force ? 1 : 0, justification || null, id],
    );

    audit({
      action: 'validate', entity: 'transfer', entityId: id,
      summary: `Transfert ${t.number} validé : ${t.qty} ${t.unit} (${formatMoney(t.total_cost)}) ` +
        `— aucun impact sur le coût matière global`,
      severity: force && available + 0.0001 < t.qty ? 'warning' : 'info',
      payload: { available, qty: t.qty, justification: justification || null },
      ip,
    });
    return getTransfer(id);
  });
}

/**
 * ANNULE un transfert. Si validé → contre-écritures des deux mouvements
 * (jamais de suppression silencieuse). Le motif est obligatoire.
 * @param {number} id
 * @param {string} reason
 */
export function cancelTransfer(id, reason, ip = null) {
  const t = get('SELECT * FROM transfers WHERE id = ?', [id]);
  if (!t) throw notFound('Transfert introuvable.');
  if (t.status === 'annule') throw badRequest('Ce transfert est déjà annulé.');
  const motif = requireString(reason, 'Motif d’annulation', { maxLength: 300 });

  return transaction(() => {
    if (t.status === 'valide') {
      // Contre-écritures : entrée inverse en source, sortie inverse en destination
      postMovement({
        occurredAt: nowSql(),
        movementType: 'contre_ecriture',
        direction: 'in',
        kitchenId: t.source_kitchen_id,
        productId: t.product_id,
        qty: t.qty,
        unit: t.unit,
        unitCost: t.unit_cost,
        sourceTable: 'transfers',
        sourceId: t.id,
        reason: `Annulation transfert ${t.number} : ${motif}`,
      });
      postMovement({
        occurredAt: nowSql(),
        movementType: 'contre_ecriture',
        direction: 'out',
        kitchenId: t.dest_kitchen_id,
        productId: t.product_id,
        qty: t.qty,
        unit: t.unit,
        unitCost: t.unit_cost,
        sourceTable: 'transfers',
        sourceId: t.id,
        reason: `Annulation transfert ${t.number} : ${motif}`,
      });
    }
    run(
      `UPDATE transfers SET status = 'annule', cancelled_at = ?, cancel_reason = ? WHERE id = ?`,
      [nowSql(), motif, id],
    );
    audit({
      action: 'cancel', entity: 'transfer', entityId: id,
      summary: `Transfert ${t.number} annulé : ${motif}`,
      severity: 'warning', ip,
    });
    return getTransfer(id);
  });
}

/**
 * CLÔTURE MENSUELLE DES TRANSFERTS — nombre, quantités, valeurs, dates,
 * source/destination, motifs, total.
 * @param {string} period YYYY-MM
 */
export function transfersClosing(period) {
  const { start, end } = periodBounds(period);
  const rows = all(
    `SELECT t.*, p.name AS product_name, p.unit AS product_unit,
            ks.name AS source_name, kd.name AS dest_name
     FROM transfers t
     JOIN products p ON p.id = t.product_id
     JOIN kitchens ks ON ks.id = t.source_kitchen_id
     JOIN kitchens kd ON kd.id = t.dest_kitchen_id
     WHERE date(t.occurred_at) BETWEEN date(?) AND date(?)
     ORDER BY t.occurred_at ASC, t.id ASC`,
    [start, end],
  );

  const validated = rows.filter((r) => r.status === 'valide');
  const byProduct = new Map();
  const byRoute = new Map();

  for (const r of validated) {
    const key = r.product_id;
    const cur = byProduct.get(key) || {
      product_id: r.product_id,
      product_name: r.product_name,
      unit: r.product_unit,
      count: 0,
      qty: 0,
      value: 0,
    };
    cur.count += 1;
    cur.qty = roundQty(cur.qty + r.qty);
    cur.value = roundMoney(cur.value + r.total_cost);
    byProduct.set(key, cur);

    const routeKey = `${r.source_name} → ${r.dest_name}`;
    const rc = byRoute.get(routeKey) || { route: routeKey, count: 0, qty: 0, value: 0 };
    rc.count += 1;
    rc.qty = roundQty(rc.qty + r.qty);
    rc.value = roundMoney(rc.value + r.total_cost);
    byRoute.set(routeKey, rc);
  }

  return {
    period,
    start,
    end,
    count: validated.length,
    drafts: rows.filter((r) => r.status === 'brouillon').length,
    cancelled: rows.filter((r) => r.status === 'annule').length,
    totalQty: roundQty(validated.reduce((a, r) => a + r.qty, 0)),
    totalValue: roundMoney(validated.reduce((a, r) => a + r.total_cost, 0)),
    byProduct: [...byProduct.values()],
    byRoute: [...byRoute.values()],
    details: rows.map((r) => ({
      id: r.id,
      number: r.number,
      occurred_at: r.occurred_at,
      product_name: r.product_name,
      qty: r.qty,
      unit: r.product_unit,
      unit_cost: r.unit_cost,
      total_cost: r.total_cost,
      source_name: r.source_name,
      dest_name: r.dest_name,
      reason: r.reason,
      status: r.status,
    })),
    // Rappel méthodologique affiché dans le rapport
    note: 'Les transferts internes ne sont ni des achats ni des consommations : '
      + 'ils n’ont aucun impact sur le coût matière global.',
  };
}
