/**
 * Service Fournisseurs & Achats / Réceptions.
 *
 * RÈGLE FONDAMENTALE : un achat n'est PAS une consommation.
 * Seule une RÉCEPTION VALIDÉE augmente le stock. La consommation est calculée
 * plus tard par le moteur de ratio (stock d'ouverture + achats − stock de
 * clôture), jamais à la saisie de la facture.
 */
import { all, get, run, transaction, scalar } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate, conflict } from '../lib/errors.js';
import { nextNumber, nowSql } from '../lib/numbering.js';
import { postMovement, updateWeightedAverageCost } from './stock.js';
import { roundMoney, saleLineTotals, roundQty } from '../../shared/formulas.js';

/* ---------------------------------------------------------------------------
 *  FOURNISSEURS
 * ------------------------------------------------------------------------- */

export function listSuppliers({ search = null, includeArchived = false } = {}) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push('deleted_at IS NULL');
  if (search) {
    where.push('(name LIKE ? OR code LIKE ? OR contact_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT s.*,
            (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchases_count,
            (SELECT ROUND(COALESCE(SUM(p.total),0),3) FROM purchases p
              WHERE p.supplier_id = s.id AND p.status = 'receptionnee') AS total_purchased,
            (SELECT ROUND(COALESCE(SUM(p.total - p.paid_amount),0),3) FROM purchases p
              WHERE p.supplier_id = s.id AND p.status IN ('receptionnee','partielle')) AS outstanding
     FROM suppliers s ${clause}
     ORDER BY s.name COLLATE NOCASE`,
    params,
  );
}

export function getSupplier(id) {
  const supplier = get('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (!supplier) throw notFound('Fournisseur introuvable.');
  const purchases = all(
    `SELECT * FROM purchases WHERE supplier_id = ? ORDER BY order_date DESC, id DESC LIMIT 100`,
    [id],
  );
  // Comparaison des prix par produit chez ce fournisseur
  const priceHistory = all(
    `SELECT pi.product_id, p.name AS product_name, p.unit,
            ROUND(MIN(pi.unit_price),3) AS min_price,
            ROUND(MAX(pi.unit_price),3) AS max_price,
            ROUND(AVG(pi.unit_price),3) AS avg_price,
            COUNT(*) AS occurrences,
            MAX(pu.order_date) AS last_date
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN products p ON p.id = pi.product_id
     WHERE pu.supplier_id = ? AND pu.status = 'receptionnee' AND pi.qty_received > 0
     GROUP BY pi.product_id ORDER BY p.name`,
    [id],
  );
  return { ...supplier, purchases, priceHistory };
}

export function createSupplier(p, ip = null) {
  const name = requireString(p.name, 'Nom du fournisseur', { maxLength: 160 });
  const code = p.code
    ? requireString(p.code, 'Code fournisseur', { maxLength: 30 }).toUpperCase()
    : `F${Date.now().toString().slice(-6)}`;
  if (get('SELECT id FROM suppliers WHERE code = ? COLLATE NOCASE', [code])) {
    throw conflict(`Le code fournisseur « ${code} » existe déjà.`);
  }
  const r = run(
    `INSERT INTO suppliers (code, name, contact_name, phone, email, address, tax_id, payment_terms, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, name, p.contactName || null, p.phone || null, p.email || null, p.address || null,
     p.taxId || null, p.paymentTerms || null, p.notes || null],
  );
  audit({ action: 'create', entity: 'supplier', entityId: r.lastInsertRowid, summary: name, ip });
  return get('SELECT * FROM suppliers WHERE id = ?', [r.lastInsertRowid]);
}

export function updateSupplier(id, p, ip = null) {
  const s = get('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (!s) throw notFound('Fournisseur introuvable.');
  run(
    `UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?,
       tax_id = ?, payment_terms = ?, notes = ?, active = ? WHERE id = ?`,
    [
      p.name !== undefined ? requireString(p.name, 'Nom du fournisseur', { maxLength: 160 }) : s.name,
      p.contactName !== undefined ? p.contactName : s.contact_name,
      p.phone !== undefined ? p.phone : s.phone,
      p.email !== undefined ? p.email : s.email,
      p.address !== undefined ? p.address : s.address,
      p.taxId !== undefined ? p.taxId : s.tax_id,
      p.paymentTerms !== undefined ? p.paymentTerms : s.payment_terms,
      p.notes !== undefined ? p.notes : s.notes,
      p.active !== undefined ? (p.active ? 1 : 0) : s.active,
      id,
    ],
  );
  audit({ action: 'update', entity: 'supplier', entityId: id, summary: s.name, ip });
  return get('SELECT * FROM suppliers WHERE id = ?', [id]);
}

/** Archive (soft delete) — refusé si des achats existent. */
export function archiveSupplier(id, ip = null) {
  const count = scalar('SELECT COUNT(*) c FROM purchases WHERE supplier_id = ?', [id]);
  if (count > 0) {
    throw badRequest('Ce fournisseur a des achats enregistrés : désactivez-le au lieu de l’archiver.');
  }
  run(`UPDATE suppliers SET deleted_at = datetime('now'), active = 0 WHERE id = ?`, [id]);
  audit({ action: 'delete', entity: 'supplier', entityId: id, severity: 'warning', ip });
  return { success: true };
}

/* ---------------------------------------------------------------------------
 *  ACHATS / RÉCEPTIONS
 * ------------------------------------------------------------------------- */

/**
 * Liste les achats avec filtres.
 */
export function listPurchases({ supplierId = null, status = null, from = null, to = null, search = null } = {}) {
  const where = [];
  const params = [];
  if (supplierId) {
    where.push('pu.supplier_id = ?');
    params.push(supplierId);
  }
  if (status) {
    where.push('pu.status = ?');
    params.push(status);
  }
  if (from) {
    where.push('date(pu.order_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(pu.order_date) <= date(?)');
    params.push(to);
  }
  if (search) {
    where.push('(pu.number LIKE ? OR pu.invoice_number LIKE ? OR s.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT pu.*, s.name AS supplier_name, s.code AS supplier_code,
            (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS items_count
     FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
     ${clause}
     ORDER BY pu.order_date DESC, pu.id DESC LIMIT 300`,
    params,
  );
}

export function getPurchase(id) {
  const purchase = get(
    `SELECT pu.*, s.name AS supplier_name, s.code AS supplier_code, s.tax_id AS supplier_tax_id
     FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = ?`,
    [id],
  );
  if (!purchase) throw notFound('Achat introuvable.');
  const items = all(
    `SELECT i.*, p.code AS product_code, p.name AS product_name, p.unit AS product_unit,
            p.type AS product_type
     FROM purchase_items i JOIN products p ON p.id = i.product_id
     WHERE i.purchase_id = ? ORDER BY p.name`,
    [id],
  );
  return { ...purchase, items };
}

/**
 * Crée un achat (brouillon ou commande) avec ses lignes.
 * Aucun stock n'est touché à ce stade.
 */
export function createPurchase(p, ip = null) {
  const supplierId = requireNumber(p.supplierId, 'Fournisseur', { min: 1 });
  const supplier = get('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
  if (!supplier) throw notFound('Fournisseur introuvable.');
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) throw badRequest('Ajoutez au moins une ligne à l’achat.');

  const status = ['brouillon', 'commandee'].includes(p.status) ? p.status : 'brouillon';
  const orderDate = p.orderDate ? requireDate(p.orderDate, 'Date de commande') : nowSql().slice(0, 10);

  return transaction(() => {
    const number = nextNumber('purchase', new Date());
    let subtotal = 0;
    let discountTotal = 0;
    const prepared = [];

    for (const it of items) {
      const product = get('SELECT * FROM products WHERE id = ?', [it.productId]);
      if (!product) throw badRequest(`Produit ${it.productId} introuvable.`);
      const qtyOrdered = requireNumber(it.qtyOrdered, 'Quantité commandée', { min: 0 });
      const unitPrice = requireNumber(it.unitPrice, 'Prix unitaire', { min: 0 });
      const discountPct = requireNumber(it.discountPct ?? 0, 'Remise', { min: 0, max: 100, required: false });
      const lineTotal = roundMoney(qtyOrdered * unitPrice * (1 - discountPct / 100));
      subtotal += qtyOrdered * unitPrice;
      discountTotal += qtyOrdered * unitPrice * (discountPct / 100);
      prepared.push({ ...it, product, qtyOrdered, unitPrice, discountPct, lineTotal });
    }

    const taxRate = Number(p.taxRate ?? 0);
    const netHt = roundMoney(subtotal - discountTotal);
    const tax = roundMoney((netHt * taxRate) / 100);

    const r = run(
      `INSERT INTO purchases
        (number, supplier_id, order_date, expected_date, status, invoice_number, invoice_date,
         subtotal, discount, tax, total, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [number, supplierId, orderDate, p.expectedDate || null, status,
       p.invoiceNumber || null, p.invoiceDate || null,
       roundMoney(subtotal), roundMoney(discountTotal), tax, roundMoney(netHt + tax),
       p.notes || null],
    );
    const purchaseId = r.lastInsertRowid;

    for (const it of prepared) {
      run(
        `INSERT INTO purchase_items
          (purchase_id, product_id, qty_ordered, qty_received, unit, unit_price, discount_pct,
           line_total, lot_number, dlc)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, it.product.id, it.qtyOrdered, it.product.unit, it.unitPrice,
         it.discountPct, it.lineTotal, it.lotNumber || null, it.dlc || null],
      );
    }

    audit({
      action: 'create', entity: 'purchase', entityId: purchaseId,
      summary: `Achat ${number} — ${supplier.name} (${roundMoney(netHt + tax)} DT)`, ip,
    });
    return getPurchase(purchaseId);
  });
}

export function updatePurchase(id, p, ip = null) {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', [id]);
  if (!purchase) throw notFound('Achat introuvable.');
  if (purchase.status === 'receptionnee') {
    throw badRequest('Un achat réceptionné ne peut plus être modifié. Créez un retour fournisseur ou un nouvel achat.');
  }
  // Remplacement complet des lignes
  return transaction(() => {
    if (p.items) {
      run('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
      let subtotal = 0;
      let discountTotal = 0;
      for (const it of p.items) {
        const product = get('SELECT * FROM products WHERE id = ?', [it.productId]);
        if (!product) throw badRequest(`Produit ${it.productId} introuvable.`);
        const qtyOrdered = requireNumber(it.qtyOrdered, 'Quantité commandée', { min: 0 });
        const unitPrice = requireNumber(it.unitPrice, 'Prix unitaire', { min: 0 });
        const discountPct = requireNumber(it.discountPct ?? 0, 'Remise', { min: 0, max: 100, required: false });
        const lineTotal = roundMoney(qtyOrdered * unitPrice * (1 - discountPct / 100));
        subtotal += qtyOrdered * unitPrice;
        discountTotal += qtyOrdered * unitPrice * (discountPct / 100);
        run(
          `INSERT INTO purchase_items
            (purchase_id, product_id, qty_ordered, qty_received, unit, unit_price, discount_pct,
             line_total, lot_number, dlc)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          [id, product.id, qtyOrdered, product.unit, unitPrice, discountPct, lineTotal,
           it.lotNumber || null, it.dlc || null],
        );
      }
      const netHt = roundMoney(subtotal - discountTotal);
      const tax = roundMoney((netHt * Number(p.taxRate ?? 0)) / 100);
      run(
        `UPDATE purchases SET subtotal = ?, discount = ?, tax = ?, total = ?, updated_at = datetime('now') WHERE id = ?`,
        [roundMoney(subtotal), roundMoney(discountTotal), tax, roundMoney(netHt + tax), id],
      );
    }
    if (p.status) run('UPDATE purchases SET status = ? WHERE id = ?', [p.status, id]);
    if (p.invoiceNumber !== undefined) {
      run('UPDATE purchases SET invoice_number = ?, invoice_date = ? WHERE id = ?',
        [p.invoiceNumber || null, p.invoiceDate || null, id]);
    }
    if (p.notes !== undefined) run('UPDATE purchases SET notes = ? WHERE id = ?', [p.notes, id]);
    audit({ action: 'update', entity: 'purchase', entityId: id, summary: purchase.number, ip });
    return getPurchase(id);
  });
}

/**
 * RÉCEPTION : valide l'entrée en stock.
 * Atomique : mise à jour des lignes, mouvements d'entrée, CMP, statut, audit.
 *
 * @param {number} id
 * @param {{items?:Array<{id:number, qtyReceived:number, lotNumber?:string, dlc?:string, unitPrice?:number}>,
 *          receivedDate?:string, invoiceNumber?:string, invoiceDate?:string, paidAmount?:number,
 *          paymentMethod?:string, kitchenId?:number}} [payload]
 * @param {string} [ip]
 */
export function receivePurchase(id, payload = {}, ip = null) {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', [id]);
  if (!purchase) throw notFound('Achat introuvable.');
  if (purchase.status === 'receptionnee') throw badRequest('Cet achat est déjà réceptionné.');
  if (purchase.status === 'annulee') throw badRequest('Cet achat est annulé.');

  const kitchenId = Number(payload.kitchenId || 1);
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine de réception introuvable.');

  const receivedDate = payload.receivedDate
    ? requireDate(payload.receivedDate, 'Date de réception')
    : nowSql().slice(0, 10);

  return transaction(() => {
    const lines = all('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    const overrides = new Map((payload.items || []).map((i) => [i.id, i]));
    let receivedValue = 0;
    let fullyReceived = true;
    let anyReceived = false;

    for (const line of lines) {
      const ov = overrides.get(line.id) || {};
      const qtyReceived = ov.qtyReceived !== undefined
        ? requireNumber(ov.qtyReceived, 'Quantité reçue', { min: 0 })
        : line.qty_ordered;

      if (qtyReceived <= 0) {
        if (line.qty_ordered > 0) fullyReceived = false;
        continue;
      }
      anyReceived = true;

      const unitPrice = ov.unitPrice !== undefined
        ? requireNumber(ov.unitPrice, 'Prix unitaire', { min: 0 })
        : line.unit_price;
      const discountPct = line.discount_pct || 0;
      const netUnitCost = roundMoney(unitPrice * (1 - discountPct / 100));
      const lot = ov.lotNumber || line.lot_number || null;
      const dlc = ov.dlc || line.dlc || null;

      run(
        `UPDATE purchase_items SET qty_received = ?, unit_price = ?, lot_number = ?, dlc = ?,
           line_total = ? WHERE id = ?`,
        [qtyReceived, unitPrice, lot, dlc,
         roundMoney(qtyReceived * unitPrice * (1 - discountPct / 100)), line.id],
      );

      // Entrée en stock (source de vérité)
      postMovement({
        occurredAt: receivedDate,
        movementType: 'reception',
        direction: 'in',
        kitchenId,
        productId: line.product_id,
        qty: qtyReceived,
        unit: line.unit,
        unitCost: netUnitCost,
        lotNumber: lot,
        sourceTable: 'purchases',
        sourceId: id,
        reason: `Réception ${purchase.number}`,
      });

      // Coût moyen pondéré
      updateWeightedAverageCost(line.product_id, qtyReceived, netUnitCost);

      // Mise à jour de la DLC / lot sur la fiche produit si fournie
      if (dlc || lot) {
        run(
          `UPDATE products SET dlc = COALESCE(?, dlc), lot_number = COALESCE(?, lot_number),
             purchase_price = ? WHERE id = ?`,
          [dlc, lot, netUnitCost, line.product_id],
        );
      } else {
        run('UPDATE products SET purchase_price = ? WHERE id = ?', [netUnitCost, line.product_id]);
      }
      if (qtyReceived < line.qty_ordered) fullyReceived = false;
      receivedValue += qtyReceived * netUnitCost;
    }

    if (!anyReceived) throw badRequest('Saisissez au moins une quantité reçue supérieure à zéro.');

    const newStatus = fullyReceived ? 'receptionnee' : 'partielle';
    const paid = Number(payload.paidAmount || 0);
    const totalPaid = roundMoney(purchase.paid_amount + paid);
    const paymentStatus = totalPaid <= 0 ? 'impayee' : totalPaid + 0.0001 >= purchase.total ? 'payee' : 'partielle';

    run(
      `UPDATE purchases SET status = ?, received_date = ?, validated_at = ?,
         invoice_number = COALESCE(?, invoice_number), invoice_date = COALESCE(?, invoice_date),
         paid_amount = ?, payment_status = ?, payment_method = COALESCE(?, payment_method),
         updated_at = datetime('now')
       WHERE id = ?`,
      [newStatus, receivedDate, nowSql(), payload.invoiceNumber || null, payload.invoiceDate || null,
       totalPaid, paymentStatus, payload.paymentMethod || null, id],
    );

    // Encaissement/décaissement de caisse si payé immédiatement
    if (paid > 0) {
      run(
        `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table, source_id)
         VALUES (?, 'decaissement', 'achat_matiere', ?, ?, ?, ?, 'purchases', ?)`,
        [receivedDate, paid, payload.paymentMethod || 'espece', purchase.number,
         `Paiement achat ${purchase.number}`, id],
      );
    }

    audit({
      action: 'validate', entity: 'purchase', entityId: id,
      summary: `Réception ${purchase.number} — ${roundMoney(receivedValue)} DT entrés en stock (${kitchen.name})`,
      severity: 'info', ip,
    });
    return getPurchase(id);
  });
}

/** Enregistre un paiement sur un achat (sans toucher au stock). */
export function payPurchase(id, { amount, paymentMethod = 'espece', date = null }, ip = null) {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', [id]);
  if (!purchase) throw notFound('Achat introuvable.');
  const amt = requireNumber(amount, 'Montant', { min: 0.001 });
  const remaining = roundMoney(purchase.total - purchase.paid_amount);
  if (amt > remaining + 0.001) {
    throw badRequest(`Le montant dépasse le reste à payer (${remaining.toFixed(3)} DT).`);
  }
  return transaction(() => {
    const totalPaid = roundMoney(purchase.paid_amount + amt);
    const paymentStatus = totalPaid + 0.0001 >= purchase.total ? 'payee' : 'partielle';
    run('UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?',
      [totalPaid, paymentStatus, id]);
    run(
      `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table, source_id)
       VALUES (?, 'decaissement', 'achat_matiere', ?, ?, ?, ?, 'purchases', ?)`,
      [date || nowSql().slice(0, 10), amt, paymentMethod, purchase.number,
       `Paiement achat ${purchase.number}`, id],
    );
    audit({ action: 'update', entity: 'purchase', entityId: id, summary: `Paiement ${amt} DT`, ip });
    return getPurchase(id);
  });
}

/** Annule un achat non réceptionné. */
export function cancelPurchase(id, reason, ip = null) {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', [id]);
  if (!purchase) throw notFound('Achat introuvable.');
  if (purchase.status === 'receptionnee') {
    throw badRequest('Un achat réceptionné ne peut pas être annulé : enregistrez un retour fournisseur.');
  }
  run(`UPDATE purchases SET status = 'annulee', notes = COALESCE(notes,'') || ? WHERE id = ?`,
    [`\n[Annulé] ${reason || 'sans motif'}`, id]);
  audit({ action: 'cancel', entity: 'purchase', entityId: id, summary: reason, severity: 'warning', ip });
  return getPurchase(id);
}

/**
 * Retour fournisseur : sortie de stock tracée, valorisée au coût courant.
 * @param {{purchaseId:number, productId:number, qty:number, reason:string, kitchenId?:number}} p
 */
export function createPurchaseReturn(p, ip = null) {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', [p.purchaseId]);
  if (!purchase) throw notFound('Achat introuvable.');
  const product = get('SELECT * FROM products WHERE id = ?', [p.productId]);
  if (!product) throw notFound('Produit introuvable.');
  const qty = requireNumber(p.qty, 'Quantité retournée', { min: 0.0001 });
  const reason = requireString(p.reason, 'Motif du retour', { maxLength: 300 });
  const kitchenId = Number(p.kitchenId || 1);

  return transaction(() => {
    postMovement({
      occurredAt: p.date || nowSql().slice(0, 10),
      movementType: 'retour_fournisseur',
      direction: 'out',
      kitchenId,
      productId: product.id,
      qty,
      unit: product.unit,
      unitCost: product.unit_cost,
      sourceTable: 'purchases',
      sourceId: purchase.id,
      reason,
    });
    const amount = roundMoney(qty * product.unit_cost);
    audit({
      action: 'create', entity: 'purchase_return', entityId: purchase.id,
      summary: `Retour fournisseur ${qty} ${product.unit} — ${amount} DT`, severity: 'warning', ip,
    });
    return { qty, amount };
  });
}

/** Statistiques d'achats par fournisseur (comparaison de prix). */
export function priceComparison(productId) {
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit introuvable.');
  const rows = all(
    `SELECT s.id AS supplier_id, s.name AS supplier_name,
            ROUND(AVG(pi.unit_price),3) AS avg_price,
            ROUND(MIN(pi.unit_price),3) AS min_price,
            ROUND(MAX(pi.unit_price),3) AS max_price,
            MAX(pu.order_date) AS last_date,
            COUNT(*) AS entries
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     JOIN suppliers s ON s.id = pu.supplier_id
     WHERE pi.product_id = ? AND pu.status IN ('receptionnee','partielle')
     GROUP BY s.id ORDER BY avg_price ASC`,
    [productId],
  );
  return { product, suppliers: rows };
}
