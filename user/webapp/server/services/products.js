/**
 * Service Produits — fiches produit, unicité du code, soft delete.
 * Le stock n'est jamais porté par la fiche : il est dérivé des mouvements.
 */
import { all, get, run, transaction, scalar } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, conflict } from '../lib/errors.js';
import { getStockQty, listMovements, postMovement } from './stock.js';
import { roundMoney } from '../../shared/formulas.js';

export const PRODUCT_TYPES = [
  { value: 'matiere_premiere', label: 'Matière première' },
  { value: 'semi_fini', label: 'Semi-fini' },
  { value: 'fini', label: 'Plat / produit fini' },
  { value: 'ingredient_repas', label: 'Ingrédient repas personnel' },
  { value: 'consommable', label: 'Consommable' },
  { value: 'perdu', label: 'Produit perdu / périmé' },
];

const VALID_TYPES = PRODUCT_TYPES.map((t) => t.value);

/**
 * Liste filtrable des produits.
 * @param {{search?:string, type?:string, categoryId?:number, kitchenId?:number, includeDeleted?:boolean}} [f]
 */
export function listProducts(f = {}) {
  const { search = null, type = null, categoryId = null, includeDeleted = false } = f;
  const where = [];
  const params = [];
  if (!includeDeleted) where.push('p.deleted_at IS NULL');
  if (type) {
    where.push('p.type = ?');
    params.push(type);
  }
  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (search) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.lot_number LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT p.*, c.name AS category_name, s.name AS supplier_name,
            k.name AS kitchen_name,
            ROUND(COALESCE((SELECT SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END)
                            FROM stock_movements m WHERE m.product_id = p.id),0),4) AS stock_qty
     FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN kitchens k ON k.id = p.default_kitchen_id
     ${clause}
     ORDER BY p.name COLLATE NOCASE`,
    params,
  );
}

/** Fiche détaillée + stock par cuisine + derniers mouvements. */
export function getProduct(id) {
  const product = get(
    `SELECT p.*, c.name AS category_name, s.name AS supplier_name
     FROM products p
     LEFT JOIN product_categories c ON c.id = p.category_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = ?`,
    [id],
  );
  if (!product) throw notFound('Produit introuvable.');
  const stockByKitchen = all(
    `SELECT k.id AS kitchen_id, k.name AS kitchen_name, k.code AS kitchen_code,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0),4) AS qty
     FROM kitchens k
     LEFT JOIN stock_movements m ON m.kitchen_id = k.id AND m.product_id = ?
     GROUP BY k.id ORDER BY k.id`,
    [id],
  );
  return {
    ...product,
    stock_qty: getStockQty(id),
    stock_by_kitchen: stockByKitchen,
    movements: listMovements({ productId: id, limit: 50 }),
  };
}

/**
 * Crée un produit. Le code doit être unique (contrainte + message explicite).
 * @param {object} p
 * @param {string} [ip]
 */
export function createProduct(p, ip = null) {
  const code = requireString(p.code, 'Code produit', { maxLength: 40 }).toUpperCase();
  const name = requireString(p.name, 'Nom du produit', { maxLength: 160 });
  const type = requireString(p.type, 'Type de produit');
  if (!VALID_TYPES.includes(type)) throw badRequest('Type de produit invalide.');
  const unit = String(p.unit || 'kg').toLowerCase();

  const exists = get('SELECT id FROM products WHERE code = ? COLLATE NOCASE', [code]);
  if (exists) throw conflict(`Le code produit « ${code} » est déjà utilisé.`);

  const purchasePrice = requireNumber(p.purchasePrice ?? 0, 'Prix d’achat', { min: 0, required: false });
  const unitCost = requireNumber(p.unitCost ?? purchasePrice, 'Coût unitaire retenu', {
    min: 0,
    required: false,
  });
  const minStock = requireNumber(p.minStock ?? 0, 'Stock minimal', { min: 0, required: false });

  const r = run(
    `INSERT INTO products
      (code, name, category_id, type, unit, purchase_price, unit_cost, min_stock, supplier_id,
       default_kitchen_id, dlc, lot_number, valuation_method, is_sellable, sell_price_ht, tax_rate, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      name,
      p.categoryId || null,
      type,
      unit,
      roundMoney(purchasePrice),
      roundMoney(unitCost),
      minStock,
      p.supplierId || null,
      p.defaultKitchenId || null,
      p.dlc || null,
      p.lotNumber || null,
      p.valuationMethod === 'fifo' ? 'fifo' : 'cmp',
      p.isSellable ? 1 : 0,
      roundMoney(p.sellPriceHt || 0),
      requireNumber(p.taxRate ?? 19, 'TVA', { min: 0, max: 100, required: false }),
      p.notes || null,
    ],
  );

  const id = r.lastInsertRowid;

  // Stock initial éventuel (jamais écrit directement : via un mouvement)
  const initialQty = Number(p.initialQty || 0);
  if (initialQty > 0) {
    const kitchenId = p.defaultKitchenId || 1;
    postMovement({
      occurredAt: p.initialDate || undefined,
      movementType: 'initial',
      direction: 'in',
      kitchenId,
      productId: id,
      qty: initialQty,
      unit,
      unitCost: roundMoney(unitCost),
      reason: 'Stock initial à la création',
    });
  }

  audit({ action: 'create', entity: 'product', entityId: id, summary: `${code} — ${name}`, ip });
  return getProduct(id);
}

/**
 * Met à jour un produit. Le CODE n'est pas modifiable (traçabilité) :
 * il faut créer un nouveau produit et désactiver l'ancien.
 */
export function updateProduct(id, p, ip = null) {
  const existing = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!existing) throw notFound('Produit introuvable.');
  if (existing.deleted_at) throw badRequest('Ce produit est archivé.');

  const name = p.name !== undefined ? requireString(p.name, 'Nom du produit', { maxLength: 160 }) : existing.name;
  const type = p.type !== undefined ? requireString(p.type, 'Type de produit') : existing.type;
  if (!VALID_TYPES.includes(type)) throw badRequest('Type de produit invalide.');

  run(
    `UPDATE products SET name = ?, category_id = ?, type = ?, unit = ?,
       purchase_price = ?, unit_cost = ?, min_stock = ?, supplier_id = ?, default_kitchen_id = ?,
       dlc = ?, lot_number = ?, valuation_method = ?, is_sellable = ?, sell_price_ht = ?, tax_rate = ?,
       notes = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      name,
      p.categoryId !== undefined ? p.categoryId || null : existing.category_id,
      type,
      p.unit !== undefined ? String(p.unit).toLowerCase() : existing.unit,
      p.purchasePrice !== undefined ? requireNumber(p.purchasePrice, 'Prix d’achat', { min: 0, required: false }) : existing.purchase_price,
      p.unitCost !== undefined ? requireNumber(p.unitCost, 'Coût unitaire', { min: 0, required: false }) : existing.unit_cost,
      p.minStock !== undefined ? requireNumber(p.minStock, 'Stock minimal', { min: 0, required: false }) : existing.min_stock,
      p.supplierId !== undefined ? p.supplierId || null : existing.supplier_id,
      p.defaultKitchenId !== undefined ? p.defaultKitchenId || null : existing.default_kitchen_id,
      p.dlc !== undefined ? p.dlc || null : existing.dlc,
      p.lotNumber !== undefined ? p.lotNumber || null : existing.lot_number,
      p.valuationMethod !== undefined ? (p.valuationMethod === 'fifo' ? 'fifo' : 'cmp') : existing.valuation_method,
      p.isSellable !== undefined ? (p.isSellable ? 1 : 0) : existing.is_sellable,
      p.sellPriceHt !== undefined ? roundMoney(requireNumber(p.sellPriceHt, 'Prix de vente HT', { min: 0, required: false })) : existing.sell_price_ht,
      p.taxRate !== undefined ? requireNumber(p.taxRate, 'TVA', { min: 0, max: 100, required: false }) : existing.tax_rate,
      p.notes !== undefined ? p.notes : existing.notes,
      p.active !== undefined ? (p.active ? 1 : 0) : existing.active,
      id,
    ],
  );
  audit({ action: 'update', entity: 'product', entityId: id, summary: name, ip });
  return getProduct(id);
}

/**
 * Soft delete : le produit est archivé, jamais supprimé (historique conservé).
 * Refusé si du stock subsiste (il faut d'abord le solder ou l'ajuster).
 * @param {number} id
 * @param {string} [reason]
 */
export function archiveProduct(id, reason = null, ip = null) {
  const product = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) throw notFound('Produit introuvable.');
  const qty = getStockQty(id);
  if (Math.abs(qty) > 0.0001) {
    throw badRequest(
      `Impossible d’archiver : il reste ${qty} ${product.unit} en stock. Soldez le stock par un ajustement justifié.`,
    );
  }
  run(
    `UPDATE products SET active = 0, deleted_at = datetime('now'), notes = COALESCE(notes,'') || ?
     WHERE id = ?`,
    [`\n[Archivé] ${reason || 'sans motif'}`, id],
  );
  audit({ action: 'delete', entity: 'product', entityId: id, summary: reason, severity: 'warning', ip });
  return { success: true };
}

/** Réactive un produit archivé. */
export function restoreProduct(id, ip = null) {
  run(`UPDATE products SET active = 1, deleted_at = NULL WHERE id = ?`, [id]);
  audit({ action: 'update', entity: 'product', entityId: id, summary: 'Produit réactivé', ip });
  return getProduct(id);
}

/** Statistiques d'usage d'un produit (pour éviter les suppressions dangereuses). */
export function productUsage(id) {
  const usage = {
    stock_movements: scalar('SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?', [id]),
    recipe_items: scalar('SELECT COUNT(*) c FROM recipe_items WHERE product_id = ?', [id]),
    purchase_items: scalar('SELECT COUNT(*) c FROM purchase_items WHERE product_id = ?', [id]),
    sale_items: scalar('SELECT COUNT(*) c FROM sale_items WHERE product_id = ?', [id]),
    transfers: scalar('SELECT COUNT(*) c FROM transfers WHERE product_id = ?', [id]),
    losses: scalar('SELECT COUNT(*) c FROM losses WHERE product_id = ?', [id]),
  };
  return usage;
}
