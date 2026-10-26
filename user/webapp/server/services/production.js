/**
 * Service PRODUCTION (cuisine centrale) et TRANSFORMATION.
 *
 * RÈGLE ANTI-DOUBLE COMPTAGE (production) :
 *   - les matières premières consommées SORTENT du stock (coût capturé ici),
 *   - le produit fabriqué ENTRE dans le stock à son coût de production,
 *   - on ne compte JAMAIS « ingrédients + produit fabriqué » ensemble : le coût
 *     du produit fabriqué est la somme des ingrédients, il n'est pas ajouté.
 *   Les pertes de production sont enregistrées séparément si elles ne sont pas
 *   incluses dans le coût (indicateur `loss_included`).
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nextNumber, nowSql } from '../lib/numbering.js';
import { postMovement, getStockQty } from './stock.js';
import {
  recipeTotalCost,
  costPerPortion,
  roundMoney,
  roundQty,
  yieldPct,
  lossPct,
  avgPortionWeight,
  classifyLoss,
  transformationUnitCost,
} from '../../shared/formulas.js';

/* ===========================================================================
 *  PRODUCTION
 * ========================================================================= */

export function listProductions({ from = null, to = null, status = null, kitchenId = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(pr.produced_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(pr.produced_at) <= date(?)'); params.push(to); }
  if (status) { where.push('pr.status = ?'); params.push(status); }
  if (kitchenId) { where.push('pr.kitchen_id = ?'); params.push(kitchenId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT pr.*, p.name AS product_name, p.code AS product_code, k.name AS kitchen_name,
            r.name AS recipe_name, r.code AS recipe_code
     FROM productions pr
     JOIN products p ON p.id = pr.product_id
     JOIN kitchens k ON k.id = pr.kitchen_id
     LEFT JOIN recipes r ON r.id = pr.recipe_id
     ${clause}
     ORDER BY pr.produced_at DESC, pr.id DESC LIMIT 300`,
    params,
  );
}

export function getProduction(id) {
  const production = get(
    `SELECT pr.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
            k.name AS kitchen_name, r.name AS recipe_name, r.code AS recipe_code
     FROM productions pr
     JOIN products p ON p.id = pr.product_id
     JOIN kitchens k ON k.id = pr.kitchen_id
     LEFT JOIN recipes r ON r.id = pr.recipe_id
     WHERE pr.id = ?`,
    [id],
  );
  if (!production) throw notFound('Production introuvable.');
  const items = all(
    `SELECT pi.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit
     FROM production_items pi JOIN products p ON p.id = pi.product_id
     WHERE pi.production_id = ? ORDER BY p.name`,
    [id],
  );
  const movements = all(
    `SELECT m.*, p.name AS product_name, k.name AS kitchen_name
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     JOIN kitchens k ON k.id = m.kitchen_id
     WHERE m.source_table = 'productions' AND m.source_id = ? ORDER BY m.id`,
    [id],
  );
  return { ...production, items, movements };
}

/**
 * Crée une production en brouillon (aucun stock touché).
 * @param {object} p
 */
export function createProduction(p, ip = null) {
  const kitchenId = requireNumber(p.kitchenId, 'Cuisine', { min: 1 });
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine introuvable.');
  if (kitchen.kind !== 'centrale') {
    throw badRequest('La production se fait uniquement dans la cuisine centrale.');
  }
  const productId = requireNumber(p.productId, 'Produit fabriqué', { min: 1 });
  const product = get('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw notFound('Produit fabriqué introuvable.');
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length) throw badRequest('Indiquez au moins un ingrédient consommé.');
  const qtyProduced = requireNumber(p.qtyProduced ?? 0, 'Quantité produite', { min: 0, required: false });
  const producedAt = p.producedAt ? requireDate(p.producedAt, 'Date de production') : nowSql();

  return transaction(() => {
    const number = nextNumber('production', new Date());
    let totalCost = 0;

    const r = run(
      `INSERT INTO productions
        (number, produced_at, kitchen_id, recipe_id, product_id, qty_theoretical, qty_produced,
         unit, portions, total_cost, unit_cost, loss_qty, loss_value, loss_included, status, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'brouillon', ?)`,
      [number, producedAt, kitchenId, p.recipeId || null, productId,
       requireNumber(p.qtyTheoretical ?? 0, 'Quantité théorique', { min: 0, required: false }),
       qtyProduced, product.unit,
       requireNumber(p.portions ?? 1, 'Portions', { min: 0.0001, required: false }),
       p.lossIncluded === false ? 0 : 1, p.comment || null],
    );
    const productionId = r.lastInsertRowid;

    for (const it of items) {
      const ing = get('SELECT * FROM products WHERE id = ?', [it.productId]);
      if (!ing) throw badRequest(`Ingrédient ${it.productId} introuvable.`);
      const qtyTheoretical = requireNumber(it.qtyTheoretical ?? 0, 'Quantité théorique', { min: 0, required: false });
      const qtyActual = requireNumber(it.qtyActual ?? qtyTheoretical, 'Quantité réelle', { min: 0, required: false });
      const lineCost = recipeTotalCost([
        { qty: qtyActual, unit: it.unit || ing.unit, productUnit: ing.unit, unitCost: ing.unit_cost },
      ]);
      totalCost = roundMoney(totalCost + lineCost);
      run(
        `INSERT INTO production_items
          (production_id, product_id, qty_theoretical, qty_actual, unit, unit_cost, total_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [productionId, ing.id, qtyTheoretical, qtyActual, it.unit || ing.unit, ing.unit_cost, lineCost],
      );
    }

    const lossQty = requireNumber(p.lossQty ?? 0, 'Quantité perdue', { min: 0, required: false });
    const lossValue = roundMoney(lossQty * (qtyProduced > 0 ? totalCost / qtyProduced : product.unit_cost));
    const unitCost = qtyProduced > 0 ? roundMoney(totalCost / qtyProduced) : 0;

    run(
      `UPDATE productions SET total_cost = ?, unit_cost = ?, loss_qty = ?, loss_value = ? WHERE id = ?`,
      [totalCost, unitCost, lossQty, lossValue, productionId],
    );

    audit({
      action: 'create', entity: 'production', entityId: productionId,
      summary: `Production ${number} — ${product.name} (${totalCost} DT)`, ip,
    });
    return getProduction(productionId);
  });
}

/**
 * VALIDE une production : sortie des matières, entrée du produit fabriqué.
 * Transaction atomique intégrale.
 */
export function validateProduction(id, ip = null) {
  const production = get('SELECT * FROM productions WHERE id = ?', [id]);
  if (!production) throw notFound('Production introuvable.');
  if (production.status !== 'brouillon') {
    throw badRequest(`Cette production est déjà « ${production.status} ».`);
  }
  if (production.qty_produced <= 0) {
    throw badRequest('Renseignez la quantité réellement produite avant validation.');
  }

  return transaction(() => {
    const items = all('SELECT * FROM production_items WHERE production_id = ?', [id]);
    const product = get('SELECT * FROM products WHERE id = ?', [production.product_id]);

    // 1) Sortie des matières premières
    for (const it of items) {
      if (it.qty_actual <= 0) continue;
      const available = getStockQty(it.product_id, production.kitchen_id);
      if (available + 0.0001 < it.qty_actual) {
        const p = get('SELECT name, unit FROM products WHERE id = ?', [it.product_id]);
        throw badRequest(
          `Stock insuffisant pour « ${p.name} » : ${available} ${p.unit} disponibles, ` +
          `${it.qty_actual} ${p.unit} requis. Ajustez les quantités ou réapprovisionnez.`,
        );
      }
      postMovement({
        occurredAt: production.produced_at,
        movementType: 'production_sortie',
        direction: 'out',
        kitchenId: production.kitchen_id,
        productId: it.product_id,
        qty: it.qty_actual,
        unit: it.unit,
        unitCost: it.unit_cost,
        sourceTable: 'productions',
        sourceId: id,
        reason: `Production ${production.number}`,
      });
    }

    // 2) Entrée du produit fabriqué (coût = coût de production, capturé en 1)
    postMovement({
      occurredAt: production.produced_at,
      movementType: 'production_entree',
      direction: 'in',
      kitchenId: production.kitchen_id,
      productId: production.product_id,
      qty: production.qty_produced,
      unit: production.unit,
      unitCost: production.unit_cost,
      sourceTable: 'productions',
      sourceId: id,
      reason: `Production ${production.number}`,
    });

    // Mise à jour du coût du produit fabriqué (semi-fini / fini)
    if (production.unit_cost > 0) {
      run('UPDATE products SET unit_cost = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        production.unit_cost,
        production.product_id,
      ]);
    }

    // 3) Pertes de production enregistrées séparément, SI non incluses
    if (production.loss_included === 0 && production.loss_qty > 0) {
      const lossNumber = nextNumber('loss', new Date(production.produced_at));
      run(
        `INSERT INTO losses (number, occurred_at, kitchen_id, product_id, qty, unit, unit_cost,
           total_cost, loss_type, reason, comment, already_in_consumption, status, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'perte_transformation', ?, ?, 0, 'valide', ?)`,
        [lossNumber, production.produced_at, production.kitchen_id, production.product_id,
         production.loss_qty, production.unit, production.unit_cost, production.loss_value,
         `Perte de production ${production.number}`, 'Perte non incluse dans le coût du produit fabriqué',
         nowSql()],
      );
    }

    run(`UPDATE productions SET status = 'valide', validated_at = ? WHERE id = ?`, [nowSql(), id]);
    audit({
      action: 'validate', entity: 'production', entityId: id,
      summary: `Production ${production.number} validée : ${items.length} matière(s) sorties, ` +
        `${production.qty_produced} ${production.unit} entrés (coût ${production.total_cost} DT)`,
      ip,
    });
    return getProduction(id);
  });
}

/**
 * Annule une production EN BROUILLON (aucun mouvement n'existe encore).
 */
export function cancelProduction(id, reason, ip = null) {
  const production = get('SELECT * FROM productions WHERE id = ?', [id]);
  if (!production) throw notFound('Production introuvable.');
  if (production.status === 'valide') {
    throw badRequest(
      'Une production validée ne peut être annulée : créez une production inverse ou une avarie justifiée.',
    );
  }
  run(`UPDATE productions SET status = 'annule', comment = COALESCE(comment,'') || ? WHERE id = ?`,
    [`\n[Annulé] ${reason || 'sans motif'}`, id]);
  audit({ action: 'cancel', entity: 'production', entityId: id, summary: reason, severity: 'warning', ip });
  return getProduction(id);
}

/**
 * Rendements de production sur une période.
 */
export function productionYields(from, to) {
  return all(
    `SELECT pr.id, pr.number, pr.produced_at, p.name AS product_name, pr.qty_theoretical,
            pr.qty_produced, pr.unit,
            CASE WHEN pr.qty_theoretical > 0
                 THEN ROUND(pr.qty_produced * 100.0 / pr.qty_theoretical, 2) ELSE NULL END AS yield_pct,
            pr.total_cost, pr.unit_cost
     FROM productions pr JOIN products p ON p.id = pr.product_id
     WHERE pr.status = 'valide' AND date(pr.produced_at) BETWEEN date(?) AND date(?)
     ORDER BY pr.produced_at DESC`,
    [from, to],
  );
}

/* ===========================================================================
 *  TRANSFORMATION
 * ========================================================================= */

export function listTransformations({ from = null, to = null, status = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(t.occurred_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(t.occurred_at) <= date(?)'); params.push(to); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT t.*, p.name AS source_product_name, p.code AS source_product_code,
            tp.name AS target_product_name, k.name AS kitchen_name
     FROM transformations t
     JOIN products p ON p.id = t.source_product_id
     LEFT JOIN products tp ON tp.id = t.target_product_id
     JOIN kitchens k ON k.id = t.kitchen_id
     ${clause} ORDER BY t.occurred_at DESC, t.id DESC LIMIT 300`,
    params,
  );
}

export function getTransformation(id) {
  const t = get(
    `SELECT t.*, p.name AS source_product_name, p.unit AS source_unit,
            tp.name AS target_product_name, k.name AS kitchen_name
     FROM transformations t
     JOIN products p ON p.id = t.source_product_id
     LEFT JOIN products tp ON tp.id = t.target_product_id
     JOIN kitchens k ON k.id = t.kitchen_id
     WHERE t.id = ?`,
    [id],
  );
  if (!t) throw notFound('Transformation introuvable.');
  return t;
}

/**
 * Crée et VALIDE une transformation en une transaction atomique.
 *
 * Formules appliquées :
 *   rendement % = poids final / poids initial × 100
 *   perte %     = (initial − final) / initial × 100
 *   poids moyen/portion = poids final / portions
 *   coût final/portion = coût initial / portions
 *
 * @param {object} p
 */
export function createTransformation(p, ip = null) {
  const kitchenId = requireNumber(p.kitchenId, 'Cuisine', { min: 1 });
  const kitchen = get('SELECT * FROM kitchens WHERE id = ?', [kitchenId]);
  if (!kitchen) throw notFound('Cuisine introuvable.');
  const sourceId = requireNumber(p.sourceProductId, 'Produit initial', { min: 1 });
  const source = get('SELECT * FROM products WHERE id = ?', [sourceId]);
  if (!source) throw notFound('Produit initial introuvable.');

  const initialWeight = requireNumber(p.initialWeight, 'Poids initial', { min: 0.0001 });
  const finalWeight = requireNumber(p.finalWeight, 'Poids final utilisable', { min: 0 });
  if (finalWeight > initialWeight + 0.0001) {
    throw badRequest('Le poids final utilisable ne peut pas dépasser le poids initial.');
  }
  const portions = requireNumber(p.portions ?? 1, 'Nombre de portions', { min: 0.0001 });
  const threshold = requireNumber(
    p.lossThresholdPct ?? getSetting('alert_abnormal_loss_pct', 15),
    'Seuil de perte (%)',
    { min: 0, max: 100, required: false },
  );
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date') : nowSql();

  const computedYield = yieldPct(finalWeight, initialWeight);
  const computedLoss = lossPct(initialWeight, finalWeight);
  const lossType = classifyLoss(computedLoss, threshold);
  const avgWeight = avgPortionWeight(finalWeight, portions);

  return transaction(() => {
    // Vérification de disponibilité AVANT toute écriture
    const available = getStockQty(sourceId, kitchenId);
    if (available + 0.0001 < initialWeight) {
      throw badRequest(
        `Stock insuffisant : ${available} ${source.unit} de « ${source.name} » disponibles, ` +
        `${initialWeight} ${source.unit} requis pour la transformation.`,
      );
    }
    if (lossType === 'anormale' && !String(p.reason || '').trim()) {
      throw badRequest(
        `Perte de ${computedLoss} % supérieure au seuil de ${threshold} % : un motif est obligatoire.`,
      );
    }

    const initialCost = roundMoney(initialWeight * source.unit_cost);
    const finalUnitCost = transformationUnitCost(initialCost, finalWeight);
    const number = nextNumber('transformation', new Date());

    const r = run(
      `INSERT INTO transformations
        (number, occurred_at, kitchen_id, source_product_id, target_product_id, lot_number,
         initial_weight, initial_cost, final_weight, portions, avg_portion_weight, loss_weight,
         loss_pct, yield_pct, loss_threshold_pct, loss_type, reason, unit_cost_final, status, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valide', ?)`,
      [number, occurredAt, kitchenId, sourceId, p.targetProductId || null, p.lotNumber || null,
       initialWeight, initialCost, finalWeight, portions, avgWeight,
       roundQty(initialWeight - finalWeight), computedLoss, computedYield, threshold,
       lossType, p.reason || null, finalUnitCost, nowSql()],
    );
    const transformationId = r.lastInsertRowid;

    // Sortie du produit initial
    postMovement({
      occurredAt,
      movementType: 'transformation_sortie',
      direction: 'out',
      kitchenId,
      productId: sourceId,
      qty: initialWeight,
      unit: source.unit,
      unitCost: source.unit_cost,
      lotNumber: p.lotNumber || null,
      sourceTable: 'transformations',
      sourceId: transformationId,
      reason: `Transformation ${number}`,
    });

    // Entrée du produit transformé (si un produit cible est défini)
    if (p.targetProductId) {
      const target = get('SELECT * FROM products WHERE id = ?', [p.targetProductId]);
      if (!target) throw notFound('Produit transformé introuvable.');
      postMovement({
        occurredAt,
        movementType: 'transformation_entree',
        direction: 'in',
        kitchenId,
        productId: target.id,
        qty: finalWeight,
        unit: target.unit,
        unitCost: finalUnitCost,
        sourceTable: 'transformations',
        sourceId: transformationId,
        reason: `Transformation ${number}`,
      });
      run('UPDATE products SET unit_cost = ? WHERE id = ?', [finalUnitCost, target.id]);
    }

    // La perte de transformation est DÉJÀ incluse dans le coût (le coût initial
    // se répartit sur un poids plus faible). On la trace sans la recompter.
    if (computedLoss > 0) {
      const lossNumber = nextNumber('loss', new Date());
      run(
        `INSERT INTO losses (number, occurred_at, kitchen_id, product_id, lot_number, qty, unit,
           unit_cost, total_cost, loss_type, reason, comment, already_in_consumption, status, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'perte_transformation', ?, ?, 1, 'valide', ?)`,
        [lossNumber, occurredAt, kitchenId, sourceId, p.lotNumber || null,
         roundQty(initialWeight - finalWeight), source.unit, source.unit_cost,
         roundMoney((initialWeight - finalWeight) * source.unit_cost),
         p.reason || 'Perte de transformation',
         `Perte ${computedLoss} % (${lossType}). Déjà incluse dans le coût du produit transformé.`,
         nowSql()],
      );
    }

    audit({
      action: 'validate', entity: 'transformation', entityId: transformationId,
      summary: `Transformation ${number} : ${initialWeight} → ${finalWeight} ${source.unit} ` +
        `(rendement ${computedYield} %, perte ${computedLoss} % ${lossType})`,
      severity: lossType === 'anormale' ? 'warning' : 'info',
      ip,
    });
    return getTransformation(transformationId);
  });
}

/** Rendements moyens de transformation sur une période. */
export function transformationYields(from, to) {
  return all(
    `SELECT t.number, t.occurred_at, p.name AS product_name, t.initial_weight, t.final_weight,
            t.yield_pct, t.loss_pct, t.loss_type, t.avg_portion_weight, t.portions,
            ROUND(t.initial_cost / NULLIF(t.portions, 0), 3) AS cost_per_portion,
            k.name AS kitchen_name
     FROM transformations t
     JOIN products p ON p.id = t.source_product_id
     JOIN kitchens k ON k.id = t.kitchen_id
     WHERE t.status = 'valide' AND date(t.occurred_at) BETWEEN date(?) AND date(?)
     ORDER BY t.occurred_at DESC`,
    [from, to],
  );
}
