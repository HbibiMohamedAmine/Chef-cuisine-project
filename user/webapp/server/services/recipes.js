/**
 * Service Recettes & coût de revient.
 * Le coût est TOUJOURS recalculé à la lecture à partir du coût unitaire courant
 * des produits : si le prix d'un ingrédient change, le coût de la recette change
 * automatiquement (exigence du cahier des charges).
 */
import { all, get, run, transaction, getDb } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, conflict } from '../lib/errors.js';
import {
  recipeTotalCost,
  costPerPortion,
  dishCostRatio,
  dishGrossMargin,
  roundMoney,
} from '../../shared/formulas.js';

/**
 * Recalcule les coûts des lignes d'une recette depuis les fiches produit.
 * @param {number} recipeId
 */
function refreshRecipeCosts(recipeId) {
  const recipe = get('SELECT * FROM recipes WHERE id = ?', [recipeId]);
  if (!recipe) return;
  const items = all(
    `SELECT ri.*, p.unit AS product_unit, p.unit_cost AS product_cost
     FROM recipe_items ri JOIN products p ON p.id = ri.product_id
     WHERE ri.recipe_id = ?`,
    [recipeId],
  );
  for (const it of items) {
    const lineCost = recipeTotalCost([
      { qty: it.qty, unit: it.unit, productUnit: it.product_unit, unitCost: it.product_cost },
    ]);
    run('UPDATE recipe_items SET unit_cost = ?, line_cost = ? WHERE id = ?', [
      it.product_cost,
      lineCost,
      it.id,
    ]);
  }
  run(`UPDATE recipes SET updated_at = datetime('now') WHERE id = ?`, [recipeId]);
}

/**
 * Enrichit une recette avec ses coûts calculés.
 * @param {number} id
 */
export function getRecipe(id) {
  const recipe = get(
    `SELECT r.*, p.name AS output_product_name, p.code AS output_product_code, p.unit AS output_unit
     FROM recipes r LEFT JOIN products p ON p.id = r.output_product_id WHERE r.id = ?`,
    [id],
  );
  if (!recipe) throw notFound('Recette introuvable.');

  refreshRecipeCosts(id);

  const items = all(
    `SELECT ri.*, p.code AS product_code, p.name AS product_name, p.unit AS product_unit,
            p.unit_cost AS current_unit_cost, p.type AS product_type
     FROM recipe_items ri JOIN products p ON p.id = ri.product_id
     WHERE ri.recipe_id = ? ORDER BY p.name`,
    [id],
  );

  const totalCost = roundMoney(items.reduce((acc, i) => acc + Number(i.line_cost || 0), 0));
  const perPortion = costPerPortion(totalCost, recipe.portions);
  // Prix de vente HT par portion : si la recette a un produit fini associé, on
  // privilégie son prix ; sinon le prix porté par la recette.
  const outputPrice = recipe.output_product_id
    ? Number(get('SELECT sell_price_ht FROM products WHERE id = ?', [recipe.output_product_id])?.sell_price_ht || 0)
    : 0;
  const sellingPricePerPortion = outputPrice > 0
    ? costPerPortion(outputPrice, 1) * recipe.portions / recipe.portions
    : costPerPortion(recipe.selling_price_ht, 1) * (recipe.selling_price_ht > 0 ? 1 : 0) || costPerPortion(recipe.selling_price_ht, 1);
  const priceForRatio = outputPrice > 0 ? outputPrice / (recipe.portions || 1) : Number(recipe.selling_price_ht || 0);
  const ratio = dishCostRatio(perPortion, priceForRatio);
  const { margin, marginPct } = dishGrossMargin(perPortion, priceForRatio);

  return {
    ...recipe,
    items,
    total_cost: totalCost,
    cost_per_portion: perPortion,
    selling_price_per_portion: roundMoney(priceForRatio),
    ratio_pct: ratio,
    margin_per_portion: margin,
    margin_pct: marginPct,
  };
}

/**
 * Liste toutes les recettes avec coût et ratio calculés.
 */
export function listRecipes({ search = null, includeArchived = false } = {}) {
  const where = [];
  const params = [];
  if (!includeArchived) where.push('r.deleted_at IS NULL');
  if (search) {
    where.push('(r.name LIKE ? OR r.code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT r.*, p.name AS output_product_name, p.code AS output_product_code, p.unit AS output_unit
     FROM recipes r LEFT JOIN products p ON p.id = r.output_product_id
     ${clause} ORDER BY r.name COLLATE NOCASE`,
    params,
  );
  return rows.map((r) => {
    refreshRecipeCosts(r.id);
    const items = all('SELECT line_cost FROM recipe_items WHERE recipe_id = ?', [r.id]);
    const total = roundMoney(items.reduce((acc, i) => acc + Number(i.line_cost || 0), 0));
    const perPortion = costPerPortion(total, r.portions);
    const price = r.output_product_id
      ? Number(get('SELECT sell_price_ht FROM products WHERE id = ?', [r.output_product_id])?.sell_price_ht || 0) /
        (r.portions || 1)
      : Number(r.selling_price_ht || 0);
    return {
      ...r,
      total_cost: total,
      cost_per_portion: perPortion,
      selling_price_per_portion: roundMoney(price),
      ratio_pct: dishCostRatio(perPortion, price),
      items_count: items.length,
    };
  });
}

/**
 * Crée une recette avec ses ingrédients.
 */
export function createRecipe(p, ip = null) {
  const code = p.code
    ? requireString(p.code, 'Code recette', { maxLength: 40 }).toUpperCase()
    : `REC-${Date.now().toString().slice(-7)}`;
  const name = requireString(p.name, 'Nom de la recette', { maxLength: 160 });
  if (get('SELECT id FROM recipes WHERE code = ? COLLATE NOCASE', [code])) {
    throw conflict(`Le code recette « ${code} » existe déjà.`);
  }
  const portions = requireNumber(p.portions ?? 1, 'Nombre de portions', { min: 0.0001 });
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) throw badRequest('Ajoutez au moins un ingrédient à la recette.');

  return transaction(() => {
    const r = run(
      `INSERT INTO recipes (code, name, output_product_id, portions, selling_price_ht, tax_rate, instructions, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, p.outputProductId || null, portions,
       roundMoney(p.sellingPriceHt || 0), requireNumber(p.taxRate ?? 19, 'TVA', { min: 0, max: 100, required: false }),
       p.instructions || null, p.notes || null],
    );
    const recipeId = r.lastInsertRowid;
    insertItems(recipeId, items);
    refreshRecipeCosts(recipeId);
    audit({ action: 'create', entity: 'recipe', entityId: recipeId, summary: `${code} — ${name}`, ip });
    return getRecipe(recipeId);
  });
}

/**
 * Insère les lignes d'ingrédients en validant produits et quantités.
 */
function insertItems(recipeId, items) {
  for (const it of items) {
    const product = get('SELECT * FROM products WHERE id = ?', [it.productId]);
    if (!product) throw badRequest(`Ingrédient ${it.productId} introuvable.`);
    const qty = requireNumber(it.qty, `Quantité (${product.name})`, { min: 0.000001 });
    const lineCost = recipeTotalCost([
      { qty, unit: it.unit || product.unit, productUnit: product.unit, unitCost: product.unit_cost },
    ]);
    run(
      `INSERT INTO recipe_items (recipe_id, product_id, qty, unit, unit_cost, line_cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [recipeId, product.id, qty, it.unit || product.unit, product.unit_cost, lineCost, it.notes || null],
    );
  }
}

export function updateRecipe(id, p, ip = null) {
  const recipe = get('SELECT * FROM recipes WHERE id = ?', [id]);
  if (!recipe) throw notFound('Recette introuvable.');
  return transaction(() => {
    run(
      `UPDATE recipes SET name = ?, output_product_id = ?, portions = ?, selling_price_ht = ?,
         tax_rate = ?, instructions = ?, notes = ?, active = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        p.name !== undefined ? requireString(p.name, 'Nom de la recette', { maxLength: 160 }) : recipe.name,
        p.outputProductId !== undefined ? p.outputProductId || null : recipe.output_product_id,
        p.portions !== undefined ? requireNumber(p.portions, 'Nombre de portions', { min: 0.0001 }) : recipe.portions,
        p.sellingPriceHt !== undefined ? roundMoney(p.sellingPriceHt) : recipe.selling_price_ht,
        p.taxRate !== undefined ? requireNumber(p.taxRate, 'TVA', { min: 0, max: 100, required: false }) : recipe.tax_rate,
        p.instructions !== undefined ? p.instructions : recipe.instructions,
        p.notes !== undefined ? p.notes : recipe.notes,
        p.active !== undefined ? (p.active ? 1 : 0) : recipe.active,
        id,
      ],
    );
    if (p.items) {
      run('DELETE FROM recipe_items WHERE recipe_id = ?', [id]);
      insertItems(id, p.items);
    }
    refreshRecipeCosts(id);
    audit({ action: 'update', entity: 'recipe', entityId: id, summary: recipe.name, ip });
    return getRecipe(id);
  });
}

/** Archive une recette (soft delete). */
export function archiveRecipe(id, ip = null) {
  run(`UPDATE recipes SET deleted_at = datetime('now'), active = 0 WHERE id = ?`, [id]);
  audit({ action: 'delete', entity: 'recipe', entityId: id, severity: 'warning', ip });
  return { success: true };
}

/**
 * Recalcule TOUTES les recettes (appelé après un changement de prix d'achat).
 * @returns {number} nombre de recettes recalculées
 */
export function recalculateAllRecipes() {
  const ids = all('SELECT id FROM recipes WHERE deleted_at IS NULL').map((r) => r.id);
  transaction(() => {
    for (const id of ids) refreshRecipeCosts(id);
  });
  return ids.length;
}
