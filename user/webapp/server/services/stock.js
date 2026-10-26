/**
 * ============================================================================
 *  Service STOCK — cœur du système
 * ----------------------------------------------------------------------------
 *  Le stock N'EST JAMAIS écrit directement : toute variation passe par un
 *  mouvement (`stock_movements`) qui est la source de vérité, immuable.
 *  Les corrections se font par CONTRE-ÉCRITURE (nouveau mouvement inverse).
 * ============================================================================
 */
import { all, get, run, scalar, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nowSql, nextNumber } from '../lib/numbering.js';
import { weightedAverageCost, roundQty } from '../../shared/formulas.js';

/**
 * Enregistre un mouvement de stock. À APPELER DANS UNE TRANSACTION.
 *
 * @param {object} p
 * @param {string} p.occurredAt
 * @param {string} p.movementType
 * @param {'in'|'out'} p.direction
 * @param {number} p.kitchenId
 * @param {number} p.productId
 * @param {number} p.qty
 * @param {string} [p.unit]
 * @param {number} [p.unitCost]
 * @param {string|null} [p.lotNumber]
 * @param {string} [p.sourceTable]
 * @param {number} [p.sourceId]
 * @param {string} [p.reason]
 * @param {string} [p.notes]
 * @param {number} [p.reversedById]
 * @returns {number} id du mouvement créé
 */
export function postMovement(p) {
  const product = get('SELECT * FROM products WHERE id = ?', [p.productId]);
  if (!product) throw notFound(`Produit ${p.productId} introuvable.`);

  const qty = Number(p.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw badRequest('La quantité du mouvement doit être strictement positive.');
  }
  const unit = p.unit || product.unit;
  const unitCost = Number.isFinite(Number(p.unitCost)) ? Number(p.unitCost) : product.unit_cost;

  const r = run(
    `INSERT INTO stock_movements
      (occurred_at, movement_type, direction, kitchen_id, product_id, lot_number, qty, unit,
       unit_cost, total_cost, source_table, source_id, reason, notes, reversed_by_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chef')`,
    [
      p.occurredAt || nowSql(),
      p.movementType,
      p.direction,
      p.kitchenId,
      p.productId,
      p.lotNumber || null,
      roundQty(qty),
      unit,
      unitCost,
      Math.round(qty * unitCost * 1000) / 1000,
      p.sourceTable || null,
      p.sourceId || null,
      p.reason || null,
      p.notes || null,
      p.reversedById || null,
    ],
  );
  return r.lastInsertRowid;
}

/**
 * Contre-écriture : crée le mouvement inverse et marque l'original comme
 * annulé (via reversed_by_id). Aucun mouvement n'est jamais supprimé.
 * @param {number} movementId
 * @param {string} reason
 */
export function reverseMovement(movementId, reason) {
  const mv = get('SELECT * FROM stock_movements WHERE id = ?', [movementId]);
  if (!mv) throw notFound('Mouvement introuvable.');
  if (mv.reversed_by_id) throw badRequest('Ce mouvement a déjà été annulé.');
  const newId = postMovement({
    occurredAt: nowSql(),
    movementType: 'contre_ecriture',
    direction: mv.direction === 'in' ? 'out' : 'in',
    kitchenId: mv.kitchen_id,
    productId: mv.product_id,
    qty: mv.qty,
    unit: mv.unit,
    unitCost: mv.unit_cost,
    lotNumber: mv.lot_number,
    sourceTable: 'stock_movements',
    sourceId: mv.id,
    reason: reason || 'Contre-écriture',
  });
  run('UPDATE stock_movements SET reversed_by_id = ? WHERE id = ?', [newId, mv.id]);
  return newId;
}

/* ---------------------------------------------------------------------------
 *  LECTURES DE STOCK (dérivées)
 * ------------------------------------------------------------------------- */

/**
 * Quantité en stock d'un produit, éventuellement filtrée par cuisine.
 * @param {number} productId
 * @param {number|null} [kitchenId]
 * @returns {number}
 */
export function getStockQty(productId, kitchenId = null) {
  const row = kitchenId
    ? get(
        `SELECT ROUND(SUM(CASE WHEN direction='in' THEN qty ELSE -qty END), 4) q
         FROM stock_movements WHERE product_id = ? AND kitchen_id = ?`,
        [productId, kitchenId],
      )
    : get(
        `SELECT ROUND(SUM(CASE WHEN direction='in' THEN qty ELSE -qty END), 4) q
         FROM stock_movements WHERE product_id = ?`,
        [productId],
      );
  return row && row.q ? Number(row.q) : 0;
}

/**
 * Stock détaillé par produit et cuisine, avec valeur et statut d'alerte.
 * @param {{kitchenId?:number, type?:string, search?:string, onlyAlerts?:boolean}} [filters]
 */
export function listStock(filters = {}) {
  const { kitchenId = null, type = null, search = null, onlyAlerts = false } = filters;
  const params = [];
  let where = 'WHERE p.deleted_at IS NULL AND p.active = 1';
  if (type) {
    where += ' AND p.type = ?';
    params.push(type);
  }
  if (search) {
    where += ' AND (p.name LIKE ? OR p.code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const sql = `
    WITH stock AS (
      SELECT product_id,
             kitchen_id,
             ROUND(SUM(CASE WHEN direction='in' THEN qty ELSE -qty END), 4) AS qty
      FROM stock_movements
      ${kitchenId ? 'WHERE kitchen_id = ' + Number(kitchenId) : ''}
      GROUP BY product_id, kitchen_id
    )
    SELECT p.id, p.code, p.name, p.type, p.unit, p.unit_cost, p.min_stock, p.dlc, p.lot_number,
           p.is_sellable, p.sell_price_ht, p.tax_rate, c.name AS category_name,
           k.id AS kitchen_id, k.name AS kitchen_name,
           COALESCE(s.qty, 0) AS qty,
           ROUND(COALESCE(s.qty, 0) * p.unit_cost, 3) AS value,
           CASE WHEN COALESCE(s.qty,0) <= 0 THEN 'rupture'
                WHEN COALESCE(s.qty,0) <= p.min_stock THEN 'bas'
                ELSE 'ok' END AS stock_status
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN stock s ON s.product_id = p.id
    LEFT JOIN kitchens k ON k.id = s.kitchen_id
    ${where}
    ORDER BY (COALESCE(s.qty,0) <= p.min_stock) DESC, p.name
  `;
  const rows = all(sql, params);
  return onlyAlerts ? rows.filter((r) => r.stock_status !== 'ok') : rows;
}

/**
 * Synthèse du stock (toutes cuisines) par produit.
 * @param {{type?:string}} [filters]
 */
export function listStockProducts(filters = {}) {
  const { type = null } = filters;
  const params = [];
  let typeClause = '';
  if (type) {
    typeClause = 'AND p.type = ?';
    params.push(type);
  }
  return all(
    `SELECT p.id, p.code, p.name, p.type, p.unit, p.unit_cost, p.min_stock, p.dlc,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0),4) AS qty,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) * p.unit_cost, 3) AS value,
            CASE WHEN COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) <= 0 THEN 'rupture'
                 WHEN COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) <= p.min_stock THEN 'bas'
                 ELSE 'ok' END AS stock_status
     FROM products p
     LEFT JOIN stock_movements m ON m.product_id = p.id
     WHERE p.deleted_at IS NULL AND p.active = 1 ${typeClause}
     GROUP BY p.id
     ORDER BY (COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) <= p.min_stock) DESC, p.name`,
    params,
  );
}

/** Valeur totale du stock (toutes cuisines, produits non supprimés). */
export function totalStockValue() {
  return (
    scalar(
      `SELECT ROUND(COALESCE(SUM(s.qty * p.unit_cost), 0), 3) v
       FROM (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
             FROM stock_movements GROUP BY product_id) s
       JOIN products p ON p.id = s.product_id
       WHERE p.deleted_at IS NULL AND p.active = 1`,
    ) || 0
  );
}

/**
 * Historique des mouvements avec libellés.
 * @param {{productId?:number, kitchenId?:number, from?:string, to?:string, limit?:number}} [f]
 */
export function listMovements(f = {}) {
  const { productId = null, kitchenId = null, from = null, to = null, limit = 200 } = f;
  const where = [];
  const params = [];
  if (productId) {
    where.push('m.product_id = ?');
    params.push(productId);
  }
  if (kitchenId) {
    where.push('m.kitchen_id = ?');
    params.push(kitchenId);
  }
  if (from) {
    where.push('date(m.occurred_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(m.occurred_at) <= date(?)');
    params.push(to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT m.*, p.name AS product_name, p.code AS product_code, k.name AS kitchen_name
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     JOIN kitchens k ON k.id = m.kitchen_id
     ${clause}
     ORDER BY m.occurred_at DESC, m.id DESC
     LIMIT ?`,
    [...params, limit],
  );
}

/* ---------------------------------------------------------------------------
 *  ALERTES DE STOCK & PÉREMPTION
 * ------------------------------------------------------------------------- */

/**
 * Produits en rupture ou sous le seuil, et produits proches de la DLC.
 * @returns {{lowStock:any[], expiring:any[], expired:any[]}}
 */
export function stockAlerts() {
  const days = Number(getSetting('alert_expiry_days', 5));
  const rows = listStockProducts();
  const lowStock = rows.filter((r) => Number(r.qty) <= Number(r.min_stock));

  const dated = all(
    `SELECT p.id, p.code, p.name, p.unit, p.dlc, p.lot_number,
            ROUND(COALESCE((SELECT SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END)
                            FROM stock_movements m WHERE m.product_id = p.id),0),4) AS qty
     FROM products p
     WHERE p.dlc IS NOT NULL AND p.deleted_at IS NULL AND p.active = 1
     ORDER BY p.dlc`,
  ).filter((r) => Number(r.qty) > 0);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const limitStr = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);

  return {
    lowStock,
    expiring: dated.filter((r) => r.dlc >= todayStr && r.dlc <= limitStr),
    expired: dated.filter((r) => r.dlc < todayStr),
    expiryDays: days,
  };
}

/* ---------------------------------------------------------------------------
 *  INVENTAIRES PHYSIQUES
 * ------------------------------------------------------------------------- */

/**
 * Crée un inventaire en brouillon avec les quantités théoriques figées.
 * @param {{countDate?:string, kitchenId:number, notes?:string, lines?:Array<{productId:number, physicalQty:number, lotNumber?:string, justification?:string}>}} p
 */
export function createStockCount(p) {
  const kitchenId = requireNumber(p.kitchenId, 'Cuisine', { min: 1 });
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine introuvable.');
  const countDate = p.countDate ? requireDate(p.countDate, 'Date d’inventaire') : nowSql().slice(0, 10);

  return transaction(() => {
    const number = nextNumber('stock_count');
    const r = run(
      `INSERT INTO stock_counts (number, count_date, kitchen_id, notes) VALUES (?, ?, ?, ?)`,
      [number, countDate, kitchenId, p.notes || null],
    );
    const countId = r.lastInsertRowid;

    // Lignes proposées : tout produit ayant du stock ou un stock minimal > 0
    const candidates = p.lines && p.lines.length
      ? p.lines.map((l) => ({ productId: l.productId, lotNumber: l.lotNumber || null, justification: l.justification || null }))
      : all(
          `SELECT DISTINCT product_id FROM stock_movements WHERE kitchen_id = ?`,
          [kitchenId],
        ).map((row) => ({ productId: row.product_id, lotNumber: null, justification: null }));

    const provided = new Map((p.lines || []).map((l) => [l.productId, l]));
    for (const c of candidates) {
      const product = get('SELECT * FROM products WHERE id = ?', [c.productId]);
      if (!product) continue;
      const theoretical = getStockQty(product.id, kitchenId);
      const physical = provided.has(product.id) ? Number(provided.get(product.id).physicalQty) || 0 : theoretical;
      const varianceQty = roundQty(physical - theoretical);
      const varianceValue = Math.round(varianceQty * product.unit_cost * 1000) / 1000;
      run(
        `INSERT INTO stock_count_items
          (stock_count_id, product_id, lot_number, theoretical_qty, physical_qty, unit_cost,
           variance_qty, variance_value, justification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          countId, product.id, c.lotNumber, theoretical, physical, product.unit_cost,
          varianceQty, varianceValue, provided.get(product.id)?.justification || c.justification,
        ],
      );
    }

    audit({
      action: 'create', entity: 'stock_count', entityId: countId,
      summary: `Inventaire ${number} créé (${kitchen.name})`,
    });
    return get('SELECT * FROM stock_counts WHERE id = ?', [countId]);
  });
}

/** Liste les inventaires. */
export function listStockCounts(limit = 50) {
  return all(
    `SELECT sc.*, k.name AS kitchen_name,
            (SELECT COUNT(*) FROM stock_count_items i WHERE i.stock_count_id = sc.id) AS items_count
     FROM stock_counts sc JOIN kitchens k ON k.id = sc.kitchen_id
     ORDER BY sc.id DESC LIMIT ?`,
    [limit],
  );
}

/** Détail d'un inventaire. */
export function getStockCount(id) {
  const count = get(
    `SELECT sc.*, k.name AS kitchen_name FROM stock_counts sc
     JOIN kitchens k ON k.id = sc.kitchen_id WHERE sc.id = ?`,
    [id],
  );
  if (!count) throw notFound('Inventaire introuvable.');
  const items = all(
    `SELECT i.*, p.code, p.name, p.unit
     FROM stock_count_items i JOIN products p ON p.id = i.product_id
     WHERE i.stock_count_id = ? ORDER BY p.name`,
    [id],
  );
  return { ...count, items };
}

/**
 * Met à jour les quantités physiques d'un inventaire en brouillon.
 * @param {number} id
 * @param {Array<{id:number, physicalQty:number, justification?:string}>} items
 */
export function updateStockCount(id, items) {
  const count = get('SELECT * FROM stock_counts WHERE id = ?', [id]);
  if (!count) throw notFound('Inventaire introuvable.');
  if (count.status !== 'brouillon') throw badRequest('Seul un inventaire en brouillon peut être modifié.');

  transaction(() => {
    for (const it of items || []) {
      const line = get('SELECT * FROM stock_count_items WHERE id = ? AND stock_count_id = ?', [it.id, id]);
      if (!line) continue;
      const physical = requireNumber(it.physicalQty, 'Quantité physique', { min: 0 });
      const varianceQty = roundQty(physical - line.theoretical_qty);
      const varianceValue = Math.round(varianceQty * line.unit_cost * 1000) / 1000;
      run(
        `UPDATE stock_count_items SET physical_qty = ?, variance_qty = ?, variance_value = ?,
         justification = ? WHERE id = ?`,
        [physical, varianceQty, varianceValue, it.justification ?? line.justification, it.id],
      );
    }
  });
  return getStockCount(id);
}

/**
 * Valide un inventaire : crée les mouvements d'ajustement justifiés.
 * Un écart sans justification est refusé (règle : toute correction est justifiée).
 * @param {number} id
 * @param {string} [ip]
 */
export function validateStockCount(id, ip = null) {
  const count = get('SELECT * FROM stock_counts WHERE id = ?', [id]);
  if (!count) throw notFound('Inventaire introuvable.');
  if (count.status !== 'brouillon') throw badRequest('Cet inventaire est déjà validé ou annulé.');

  return transaction(() => {
    const items = all('SELECT * FROM stock_count_items WHERE stock_count_id = ?', [id]);
    let totalVariance = 0;

    for (const it of items) {
      const variance = roundQty(it.variance_qty);
      if (Math.abs(variance) < 0.0001) continue;
      if (!it.justification || !String(it.justification).trim()) {
        throw badRequest(
          `Un écart d’inventaire doit être justifié (produit ${it.product_id}, écart ${variance}).`,
        );
      }
      postMovement({
        occurredAt: count.count_date,
        movementType: 'ajustement_inventaire',
        direction: variance > 0 ? 'in' : 'out',
        kitchenId: count.kitchen_id,
        productId: it.product_id,
        qty: Math.abs(variance),
        unitCost: it.unit_cost,
        lotNumber: it.lot_number,
        sourceTable: 'stock_counts',
        sourceId: id,
        reason: it.justification,
      });
      totalVariance += Number(it.variance_value) || 0;
    }

    run(
      `UPDATE stock_counts SET status = 'valide', validated_at = ?, total_variance_value = ? WHERE id = ?`,
      [nowSql(), Math.round(totalVariance * 1000) / 1000, id],
    );
    audit({
      action: 'validate', entity: 'stock_count', entityId: id,
      summary: `Inventaire ${count.number} validé (écart valorisé ${totalVariance.toFixed(3)} DT)`,
      severity: 'warning', ip,
    });
    return getStockCount(id);
  });
}

/** Annule un inventaire en brouillon. */
export function cancelStockCount(id, reason, ip = null) {
  const count = get('SELECT * FROM stock_counts WHERE id = ?', [id]);
  if (!count) throw notFound('Inventaire introuvable.');
  if (count.status === 'valide') {
    throw badRequest('Un inventaire validé ne peut pas être annulé (corrigez par un nouvel inventaire).');
  }
  run(`UPDATE stock_counts SET status = 'annule', notes = COALESCE(notes,'') || ? WHERE id = ?`, [
    `\n[Annulation] ${reason || 'sans motif'}`,
    id,
  ]);
  audit({ action: 'cancel', entity: 'stock_count', entityId: id, summary: reason, ip });
  return getStockCount(id);
}

/* ---------------------------------------------------------------------------
 *  AJUSTEMENT MANUEL JUSTIFIÉ
 * ------------------------------------------------------------------------- */

/**
 * Crée un ajustement de stock manuel (jamais une écriture directe).
 * RÈGLE : toute correction de stock est justifiée et crée une opération
 * distincte, avec la valeur avant / après conservée dans le motif.
 *
 * @param {{productId:number, kitchenId:number, qty:number, direction:'in'|'out',
 *          reason:string, unitCost?:number}} p
 * @param {string} [ip]
 */
export function adjustStock(p, ip = null) {
  const kitchenId = requireNumber(p.kitchenId, 'Cuisine', { min: 1 });
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine introuvable.');

  const productId = requireNumber(p.productId, 'Produit', { min: 1 });
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit introuvable.');

  const qty = requireNumber(p.qty, 'Quantité', { min: 0.0001 });
  const direction = p.direction === 'in' ? 'in' : p.direction === 'out' ? 'out' : null;
  if (!direction) throw badRequest('Le sens de l’ajustement doit être « in » ou « out ».');
  const reason = requireString(p.reason, 'Motif de l’ajustement', { maxLength: 400 });
  const unitCost = p.unitCost !== undefined && p.unitCost !== ''
    ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0 })
    : product.unit_cost;

  return transaction(() => {
    const before = getStockQty(productId, kitchenId);
    const after = roundQty(before + (direction === 'in' ? qty : -qty));
    if (after < -0.0001) {
      throw badRequest(
        `Ajustement refusé : le stock deviendrait négatif (${before} → ${after} ${product.unit}).`,
      );
    }

    const movementId = postMovement({
      occurredAt: p.occurredAt || undefined,
      movementType: 'ajustement_manuel',
      direction,
      kitchenId,
      productId,
      qty,
      unit: product.unit,
      unitCost,
      sourceTable: 'manual_adjustment',
      reason: `${reason} [avant ${before} → après ${after} ${product.unit}]`,
    });

    audit({
      action: 'create',
      entity: 'stock_adjustment',
      entityId: movementId,
      summary: `Ajustement ${product.code} (${kitchen.name}) : ${before} → ${after} ${product.unit} — ${reason}`,
      severity: 'warning',
      ip,
    });

    return {
      movementId,
      product: product.name,
      unit: product.unit,
      qtyBefore: before,
      qtyAfter: after,
      value: Math.round(qty * unitCost * 1000) / 1000,
      reason,
    };
  });
}

/* ---------------------------------------------------------------------------
 *  COÛT MOYEN PONDÉRÉ & VALORISATION
 * ------------------------------------------------------------------------- */

/**
 * Recalcule le coût unitaire (CMP) d'un produit après une entrée.
 * À appeler dans une transaction, après le mouvement d'entrée.
 * @param {number} productId
 * @param {number} qtyIn
 * @param {number} unitCostIn
 */
export function updateWeightedAverageCost(productId, qtyIn, unitCostIn) {
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) return;
  const qtyAfter = getStockQty(productId);
  const qtyBefore = qtyAfter - qtyIn;
  if (qtyAfter <= 0) return;
  const cmp = weightedAverageCost(qtyBefore, product.unit_cost, qtyIn, unitCostIn);
  run(`UPDATE products SET unit_cost = ?, updated_at = datetime('now') WHERE id = ?`, [
    Math.round(cmp * 1e6) / 1e6,
    productId,
  ]);
}

/**
 * Valorisation FIFO par rejeu des mouvements (option paramétrable).
 * Les entrées forment des couches ; les sorties consomment les plus anciennes.
 * @param {number} productId
 * @returns {number} valeur du stock restant
 */
export function fifoStockValue(productId) {
  const movements = all(
    `SELECT direction, qty, unit_cost FROM stock_movements
     WHERE product_id = ? ORDER BY occurred_at ASC, id ASC`,
    [productId],
  );
  /** @type {Array<{qty:number, cost:number}>} */
  const layers = [];
  for (const m of movements) {
    if (m.direction === 'in') {
      layers.push({ qty: m.qty, cost: m.unit_cost });
    } else {
      let toConsume = m.qty;
      while (toConsume > 0.00001 && layers.length) {
        const layer = layers[0];
        const take = Math.min(layer.qty, toConsume);
        layer.qty -= take;
        toConsume -= take;
        if (layer.qty <= 0.00001) layers.shift();
      }
    }
  }
  return Math.round(layers.reduce((acc, l) => acc + l.qty * l.cost, 0) * 1000) / 1000;
}
