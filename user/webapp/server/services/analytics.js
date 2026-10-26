/**
 * ============================================================================
 *  MOTEUR DE CALCUL — RATIO MATIÈRE GLOBAL, DÉPASSEMENTS, ALERTES
 * ----------------------------------------------------------------------------
 *  C'est le module le plus sensible du logiciel : il agrège les mouvements de
 *  stock en respectant STRICTEMENT les règles anti-double comptage.
 *
 *  PÉRIMÈTRE MATIÈRES (utilisé pour la consommation valorisée) :
 *    matiere_premiere, ingredient_repas, consommable
 *  PÉRIMÈTRE FABRIQUÉ (exclu du solde, coût déjà capturé en production) :
 *    semi_fini, fini, perdu
 *
 *  Justification : les sorties d'ingrédients sont comptées au moment de la
 *  production. Compter aussi le produit fabriqué reviendrait à compter deux
 *  fois la même matière. Les transferts sont neutres (même périmètre).
 * ============================================================================
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { periodBounds, nowSql } from '../lib/numbering.js';
import {
  valuedConsumption,
  retainedMaterialCost,
  globalMaterialRatio,
  maxAllowedCost,
  marginBeforeOtherCharges,
  overrunAmount,
  ratioGapPoints,
  estimatedOperatingResult,
  roundMoney,
  roundPct,
  roundQty,
} from '../../shared/formulas.js';
import { revenueHt } from './sales.js';
import { expensesTotal, expensesByCategory } from './cash.js';
import { lossesReport } from './losses.js';
import { transfersClosing } from './transfers.js';

/** Types de produits formant le périmètre « matières » du ratio. */
export const MATERIAL_TYPES = ['matiere_premiere', 'ingredient_repas', 'consommable'];
/** Types fabriqués, exclus du solde matière (coût déjà capturé). */
export const FABRICATED_TYPES = ['semi_fini', 'fini', 'perdu'];

const MATERIAL_SQL_LIST = MATERIAL_TYPES.map((t) => `'${t}'`).join(',');
const FABRICATED_SQL_LIST = FABRICATED_TYPES.map((t) => `'${t}'`).join(',');

/**
 * Valeur du stock du périmètre matières à une date donnée (fin de journée).
 * @param {string} date YYYY-MM-DD
 * @param {'materials'|'fabricated'|'all'} [scope]
 * @returns {number}
 */
export function stockValueAt(date, scope = 'materials') {
  const typeClause = scope === 'materials'
    ? `AND p.type IN (${MATERIAL_SQL_LIST})`
    : scope === 'fabricated'
      ? `AND p.type IN (${FABRICATED_SQL_LIST})`
      : '';
  const row = get(
    `SELECT ROUND(COALESCE(SUM(s.qty * p.unit_cost), 0), 3) v
     FROM (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
           FROM stock_movements WHERE date(occurred_at) <= date(?)
           GROUP BY product_id) s
     JOIN products p ON p.id = s.product_id
     WHERE p.deleted_at IS NULL ${typeClause}`,
    [date],
  );
  return row?.v || 0;
}

/**
 * Détail du stock valorisé à une date (pour le drill-down).
 */
export function stockSnapshotAt(date, scope = 'materials') {
  const typeClause = scope === 'materials'
    ? `AND p.type IN (${MATERIAL_SQL_LIST})`
    : scope === 'fabricated'
      ? `AND p.type IN (${FABRICATED_SQL_LIST})`
      : '';
  return all(
    `SELECT p.id, p.code, p.name, p.type, p.unit, p.unit_cost,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0),4) AS qty,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0) * p.unit_cost, 3) AS value
     FROM products p
     LEFT JOIN stock_movements m ON m.product_id = p.id AND date(m.occurred_at) <= date(?)
     WHERE p.deleted_at IS NULL ${typeClause}
     GROUP BY p.id
     HAVING ABS(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty ELSE -m.qty END),0)) > 0.0001
     ORDER BY value DESC`,
    [date],
  );
}

/**
 * Achats réceptionnés (valorisation nette) sur une période.
 * On utilise le coût unitaire des mouvements de réception : c'est la valeur
 * réellement entrée en stock, remises déduites.
 */
export function purchasesReceivedValue(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(total_cost),0),3) v, ROUND(COALESCE(SUM(qty),0),4) q, COUNT(*) c
     FROM stock_movements
     WHERE movement_type = 'reception' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { value: row.v || 0, qty: row.q || 0, count: row.c || 0 };
}

/**
 * Retours fournisseurs sur une période (sorties de stock tracées).
 */
export function returnsValue(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(total_cost),0),3) v, COUNT(*) c
     FROM stock_movements
     WHERE movement_type = 'retour_fournisseur' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { value: row.v || 0, count: row.c || 0 };
}

/**
 * INJECTION DE STOCK INITIAL sur la période.
 *
 * Pourquoi ce terme est indispensable :
 * un produit créé pendant la période avec un stock initial génère un mouvement
 * `initial` (entrée). Ce stock :
 *   - n'est PAS un achat (aucune facture fournisseur),
 *   - n'est PAS dans le stock d'ouverture (il n'existait pas avant),
 *   - EST dans le stock de clôture.
 * Sans ce terme, la formule « ouverture + achats − clôture » produirait une
 * consommation ARTIFICIELLEMENT NÉGATIVE (le stock apparaîtrait comme consommé
 * à l'envers), et donc un coût matière et un ratio faux.
 *
 * Le stock initial est une injection de valeur dans le périmètre : on l'ajoute
 * exactement comme un achat réceptionné.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{value:number, qty:number, count:number}}
 */
export function initialStockValue(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(m.total_cost),0),3) v,
            ROUND(COALESCE(SUM(m.qty),0),4) q,
            COUNT(*) c
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     WHERE m.movement_type = 'initial'
       AND m.direction = 'in'
       AND p.type IN (${MATERIAL_SQL_LIST})
       AND date(m.occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { value: row.v || 0, qty: row.q || 0, count: row.c || 0 };
}
/**
 * Ajustements justifiés sur une période (inventaires + ajustements manuels).
 * On renvoie le SOLDE NET signé puis les deux flux séparés pour le drill-down.
 */
export function adjustmentsValue(from, to) {
  const row = get(
    `SELECT
       ROUND(COALESCE(SUM(CASE WHEN direction='in' THEN total_cost ELSE -total_cost END),0),3) net,
       ROUND(COALESCE(SUM(CASE WHEN direction='in' THEN total_cost ELSE 0 END),0),3) positive,
       ROUND(COALESCE(SUM(CASE WHEN direction='out' THEN total_cost ELSE 0 END),0),3) negative,
       COUNT(*) c
     FROM stock_movements
     WHERE movement_type IN ('ajustement_inventaire','ajustement_manuel')
       AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { net: row.net || 0, positive: row.positive || 0, negative: row.negative || 0, count: row.c || 0 };
}

/**
 * Coût des avaries NON déjà incluses dans la consommation (à ajouter au ratio).
 */
export function lossesNotIncludedValue(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(total_cost),0),3) v, COUNT(*) c
     FROM losses
     WHERE status = 'valide' AND already_in_consumption = 0
       AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { value: row.v || 0, count: row.c || 0 };
}

/**
 * Coût des repas du personnel, selon la règle PARAMÉTRABLE.
 *
 * POINT CLÉ ANTI-DOUBLE COMPTAGE (règle n° 5) :
 * une consommation de repas est un mouvement de SORTIE de la cuisine du
 * personnel. Elle réduit donc le stock de clôture, ce qui l'inclut
 * MÉCANIQUEMENT dans la consommation valorisée. Si le paramètre
 * `staff_meals_in_ratio` vaut false (défaut), il faut donc RETIRER ce coût du
 * coût retenu pour ne pas l'imputer au ratio des ventes clients.
 * À l'inverse, il ne faut JAMAIS l'ajouter (ce serait un double comptage).
 *
 * Les repas du personnel ne sont PAS des ventes : ils n'entrent jamais dans le CA.
 *
 * @returns {{value:number, included:boolean, deduction:number, details:any[]}}
 */
export function staffMealsValue(from, to) {
  const kitchen = get("SELECT * FROM kitchens WHERE kind = 'personnel'");
  const included = Boolean(getSetting('staff_meals_in_ratio', false));
  if (!kitchen) return { value: 0, included, deduction: 0, details: [] };

  const details = all(
    `SELECT p.id, p.name, p.unit,
            ROUND(COALESCE(SUM(m.qty),0),4) AS qty,
            p.unit_cost,
            ROUND(COALESCE(SUM(m.total_cost),0),3) AS value
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.kitchen_id = ? AND m.movement_type = 'consommation_repas'
       AND date(m.occurred_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id ORDER BY value DESC`,
    [kitchen.id, from, to],
  );
  const value = roundMoney(details.reduce((a, d) => a + (Number(d.value) || 0), 0));

  return {
    value,
    included,
    // Si les repas NE doivent PAS entrer dans le ratio, on les déduit du coût.
    deduction: included ? 0 : value,
    details,
  };
}

/**
 * ============================================================================
 *  CALCUL PRINCIPAL : période complète
 * ============================================================================
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @param {{objectivePct?:number, includeClosingStock?:boolean}} [opts]
 */
export function computePeriod(from, to, opts = {}) {
  const objectivePct = Number(opts.objectivePct ?? getSetting('objective_ratio', 30));

  // --- Stocks (périmètre matières) ---
  // Stock d'ouverture = stock à la fin de la veille du premier jour.
  const beforeStart = previousDay(from);
  const openingStock = stockValueAt(beforeStart, 'materials');
  const closingStock = stockValueAt(to, 'materials');

  // --- Flux ---
  const purchases = purchasesReceivedValue(from, to);
  const returns = returnsValue(from, to);
  const adjustments = adjustmentsValue(from, to);
  const initialStock = initialStockValue(from, to);
  const lossesNotIncl = lossesNotIncludedValue(from, to);
  const staffMeals = staffMealsValue(from, to);

  // --- Consommation valorisée ---
  // Le stock initial saisi pendant la période est une INJECTION de valeur :
  // ni achat, ni stock d'ouverture. Sans lui, la formule produirait une
  // consommation négative (cf. commentaire de initialStockValue).
  const consumption = valuedConsumption({
    openingStock,
    purchasesReceived: roundMoney(purchases.value + initialStock.value),
    returns: returns.value,
    adjustments: adjustments.net,
    closingStock,
  });

  // Repas du personnel : déjà présents dans la consommation (sortie de stock).
  // Le paramètre décide s'ils restent imputés au ratio ou s'ils en sont retirés.
  const staffMealsAdjustment = staffMeals.deduction;

  // --- Coût matière retenu ---
  // retenu = consommation + pertes non incluses − repas du personnel (si exclus)
  const retainedCost = roundMoney(
    retainedMaterialCost(consumption, lossesNotIncl.value) - staffMealsAdjustment,
  );

  // --- CA et indicateurs ---
  const revenue = revenueHt(from, to);
  const ratio = globalMaterialRatio(retainedCost, revenue.ht);
  const maxCost = maxAllowedCost(revenue.ht, objectivePct / 100);
  const overrun = overrunAmount(retainedCost, maxCost);
  const gap = ratioGapPoints(ratio, objectivePct);
  const margin = marginBeforeOtherCharges(revenue.ht, retainedCost);
  const otherExpenses = expensesTotal(from, to);
  const estimatedResult = estimatedOperatingResult(revenue.ht, retainedCost, otherExpenses.total);

  return {
    from,
    to,
    // Stocks
    openingStock,
    closingStock,
    stockVariation: roundMoney(closingStock - openingStock),
    // Flux
    purchasesReceived: purchases.value,
    purchasesCount: purchases.count,
    initialStock: initialStock.value,
    returns: returns.value,
    adjustments: adjustments.net,
    adjustmentsPositive: adjustments.positive,
    adjustmentsNegative: adjustments.negative,
    // Coûts
    consumption,
    lossesNotIncluded: lossesNotIncl.value,
    lossesNotIncludedCount: lossesNotIncl.count,
    staffMeals: staffMeals.value,
    staffMealsIncluded: staffMeals.included,
    // Montant retiré du ratio au titre des repas du personnel (0 si inclus)
    staffMealsDeducted: staffMealsAdjustment,
    retainedCost,
    // CA & ratio
    revenueHt: revenue.ht,
    revenueTax: revenue.tax,
    revenueTtc: revenue.ttc,
    salesCount: revenue.count,
    ratioPct: ratio,
    objectivePct: roundPct(objectivePct),
    maxAllowedCost: maxCost,
    overrunAmount: overrun,
    gapPoints: gap,
    // Marges (jamais présentées comme un bénéfice net)
    marginBeforeOtherCharges: margin,
    otherExpenses: otherExpenses.total,
    otherExpensesCount: otherExpenses.count,
    estimatedResult,
    targetReached: revenue.ht > 0 ? ratio <= objectivePct : null,
    disclaimers: [
      'La marge restante n’est pas un bénéfice net.',
      'Le résultat de gestion est estimatif et hors obligations fiscales.',
      'La méthode de valorisation retenue est paramétrable et à valider avec le comptable.',
    ],
  };
}

function previousDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Calcul pour une période mensuelle YYYY-MM.
 * @param {string} period
 * @param {object} [opts]
 */
export function computeMonth(period, opts = {}) {
  const { start, end } = periodBounds(period);
  return { ...computePeriod(start, end, opts), period };
}

/* ===========================================================================
 *  DRILL-DOWN : chaque montant du rapport retrouve ses opérations
 * ========================================================================= */

/**
 * Explique un poste du rapport par la liste des opérations qui le composent.
 * @param {'purchases'|'returns'|'adjustments'|'losses'|'opening'|'closing'|'sales'} poste
 * @param {string} from
 * @param {string} to
 */
export function explainPost(poste, from, to) {
  switch (poste) {
    case 'purchases':
      return all(
        `SELECT m.id, m.occurred_at, p.name AS product_name, m.qty, m.unit, m.unit_cost,
                m.total_cost, k.name AS kitchen_name, pu.number AS document
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN kitchens k ON k.id = m.kitchen_id
         LEFT JOIN purchases pu ON pu.id = m.source_id AND m.source_table = 'purchases'
         WHERE m.movement_type = 'reception' AND date(m.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY m.occurred_at, m.id`,
        [from, to],
      );
    case 'returns':
      return all(
        `SELECT m.id, m.occurred_at, p.name AS product_name, m.qty, m.unit, m.unit_cost,
                m.total_cost, m.reason, k.name AS kitchen_name
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         JOIN kitchens k ON k.id = m.kitchen_id
         WHERE m.movement_type = 'retour_fournisseur' AND date(m.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY m.occurred_at`,
        [from, to],
      );
    case 'adjustments':
      return all(
        `SELECT m.id, m.occurred_at, p.name AS product_name, m.direction, m.qty, m.unit,
                m.unit_cost, m.total_cost, m.reason, m.movement_type, k.name AS kitchen_name
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         JOIN kitchens k ON k.id = m.kitchen_id
         WHERE m.movement_type IN ('ajustement_inventaire','ajustement_manuel')
           AND date(m.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY m.occurred_at`,
        [from, to],
      );
    case 'losses':
      return all(
        `SELECT l.id, l.number, l.occurred_at, p.name AS product_name, l.qty, l.unit, l.total_cost,
                l.loss_type, l.already_in_consumption, l.reason, k.name AS kitchen_name
         FROM losses l JOIN products p ON p.id = l.product_id
         JOIN kitchens k ON k.id = l.kitchen_id
         WHERE l.status = 'valide' AND date(l.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY l.occurred_at`,
        [from, to],
      );
    case 'opening':
      return stockSnapshotAt(previousDay(from), 'materials');
    case 'closing':
      return stockSnapshotAt(to, 'materials');
    case 'sales':
      return all(
        `SELECT s.id, s.number, s.occurred_at, s.subtotal_ht, s.discount, s.tax, s.total_ttc,
                s.payment_method, s.status
         FROM sales s WHERE date(s.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY s.occurred_at`,
        [from, to],
      );
    default:
      return [];
  }
}

/* ===========================================================================
 *  DÉPASSEMENT : aide à la décision, pas seulement un chiffre
 * ========================================================================= */

/**
 * Analyse détaillée en cas de dépassement du seuil.
 * Le chef doit pouvoir AGIR : produits contributeurs, avaries, écarts de
 * rendement, variations de prix d'achat, mouvements à contrôler.
 *
 * @param {string} from
 * @param {string} to
 */
export function overrunAnalysis(from, to) {
  const p = computePeriod(from, to);
  const objectivePct = p.objectivePct;

  if (p.revenueHt <= 0) {
    return {
      ...p,
      hasOverrun: false,
      reason: 'Aucun chiffre d’affaires sur la période : le ratio n’est pas interprétable.',
      topCostProducts: [],
      topLosses: [],
      yieldIssues: [],
      priceVariations: [],
      movementsToCheck: [],
    };
  }

  // 1) Produits contribuant le plus au coût consommé
  const topCostProducts = all(
    `SELECT p.id, p.code, p.name, p.unit,
            ROUND(SUM(
              CASE WHEN m.movement_type = 'reception' THEN 0
                   WHEN m.direction = 'out' AND p.type IN (${MATERIAL_SQL_LIST}) THEN m.total_cost
                   ELSE 0 END), 3) AS consumed_value,
            ROUND(SUM(CASE WHEN m.movement_type = 'reception' THEN m.total_cost ELSE 0 END),3) AS purchased_value
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE date(m.occurred_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id
     HAVING consumed_value > 0 OR purchased_value > 0
     ORDER BY consumed_value DESC, purchased_value DESC LIMIT 10`,
    [from, to],
  );

  // 2) Avaries les plus coûteuses
  const topLosses = all(
    `SELECT l.id, l.number, l.occurred_at, p.name AS product_name, l.qty, l.unit,
            l.total_cost, l.loss_type, l.already_in_consumption, k.name AS kitchen_name
     FROM losses l JOIN products p ON p.id = l.product_id
     JOIN kitchens k ON k.id = l.kitchen_id
     WHERE l.status = 'valide' AND date(l.occurred_at) BETWEEN date(?) AND date(?)
     ORDER BY l.total_cost DESC LIMIT 10`,
    [from, to],
  );

  // 3) Écarts de rendement (rendement sous la médiane de la période)
  const yieldIssues = all(
    `SELECT t.id, t.number, t.occurred_at, p.name AS product_name,
            t.initial_weight, t.final_weight, t.yield_pct, t.loss_pct, t.loss_type
     FROM transformations t JOIN products p ON p.id = t.source_product_id
     WHERE t.status = 'valide' AND date(t.occurred_at) BETWEEN date(?) AND date(?)
       AND t.loss_type = 'anormale'
     ORDER BY t.loss_pct DESC LIMIT 10`,
    [from, to],
  );

  // 4) Variations de prix d'achat (compare le prix moyen de la période au CMP)
  const priceVariations = all(
    `SELECT p.id, p.code, p.name, p.unit, p.unit_cost AS current_cost,
            ROUND(AVG(CASE WHEN m.movement_type='reception' THEN m.unit_cost ELSE NULL END),3) AS period_avg_cost,
            ROUND(AVG(CASE WHEN m.movement_type='reception' THEN m.unit_cost ELSE NULL END) - p.unit_cost, 3) AS delta,
            CASE WHEN p.unit_cost > 0
                 THEN ROUND((AVG(CASE WHEN m.movement_type='reception' THEN m.unit_cost ELSE NULL END)
                             - p.unit_cost) * 100.0 / p.unit_cost, 2)
                 ELSE 0 END AS delta_pct
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE date(m.occurred_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id
     HAVING period_avg_cost IS NOT NULL AND ABS(delta_pct) >= 5
     ORDER BY ABS(delta_pct) DESC LIMIT 10`,
    [from, to],
  );

  // 5) Mouvements de stock à contrôler (gros écarts, transferts forcés)
  const movementsToCheck = all(
    `SELECT m.id, m.occurred_at, m.movement_type, m.direction, p.name AS product_name,
            m.qty, m.unit, m.total_cost, m.reason, k.name AS kitchen_name
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     JOIN kitchens k ON k.id = m.kitchen_id
     WHERE date(m.occurred_at) BETWEEN date(?) AND date(?)
       AND (m.movement_type IN ('ajustement_inventaire','ajustement_manuel','contre_ecriture')
            OR m.reversed_by_id IS NOT NULL
            OR m.total_cost >= 100)
     ORDER BY m.total_cost DESC LIMIT 15`,
    [from, to],
  );

  const hasOverrun = p.targetReached === false;

  return {
    ...p,
    hasOverrun,
    thresholdPct: objectivePct,
    excessPoints: p.gapPoints,
    excessAmount: p.overrunAmount,
    topCostProducts,
    topLosses,
    yieldIssues,
    priceVariations,
    movementsToCheck,
    actions: buildActionSuggestions(p, { topCostProducts, topLosses, yieldIssues, priceVariations }),
  };
}

/**
 * Suggestions d'action concrètes selon les chiffres (aide à la décision).
 */
function buildActionSuggestions(p, ctx) {
  const suggestions = [];
  if (p.revenueHt <= 0) return suggestions;

  if (p.overrunAmount > 0) {
    suggestions.push({
      priority: 'high',
      title: `Réduire le coût matière de ${p.overrunAmount.toFixed(3)} DT pour revenir à ${p.objectivePct} %`,
      detail: `Ou augmenter le CA HT de ${Math.round(p.overrunAmount / (p.objectivePct / 100))} DT à coût constant.`,
    });
  }
  if (ctx.topLosses.length) {
    const totalLoss = ctx.topLosses.reduce((a, l) => a + l.total_cost, 0);
    suggestions.push({
      priority: totalLoss > p.revenueHt * 0.02 ? 'high' : 'medium',
      title: `Contrôler les avaries (${roundMoney(totalLoss)} DT sur la période)`,
      detail: `Premier poste : ${ctx.topLosses[0].product_name} (${ctx.topLosses[0].total_cost} DT).`,
    });
  }
  if (ctx.yieldIssues.length) {
    suggestions.push({
      priority: 'medium',
      title: `${ctx.yieldIssues.length} transformation(s) avec perte anormale`,
      detail: `La plus élevée : ${ctx.yieldIssues[0].product_name} à ${ctx.yieldIssues[0].loss_pct} % de perte.`,
    });
  }
  if (ctx.priceVariations.length) {
    suggestions.push({
      priority: 'medium',
      title: `${ctx.priceVariations.length} variation(s) de prix d’achat supérieure(s) à 5 %`,
      detail: `À revoir : ${ctx.priceVariations[0].product_name} (${ctx.priceVariations[0].delta_pct} %).`,
    });
  }
  if (p.stockVariation > p.purchasesReceived * 0.2 && p.purchasesReceived > 0) {
    suggestions.push({
      priority: 'medium',
      title: 'Stock en forte hausse',
      detail:
        'Une part importante des achats est encore en stock : la consommation est mécaniquement sous-estimée. ' +
        'Vérifiez les inventaires de clôture.',
    });
  }
  if (!suggestions.length) {
    suggestions.push({
      priority: 'low',
      title: 'Aucune anomalie majeure détectée',
      detail: 'Le ratio est conforme à l’objectif sur la période analysée.',
    });
  }
  return suggestions;
}

/* ===========================================================================
 *  TABLEAU DE BORD
 * ========================================================================= */

/**
 * Données synthétiques du tableau de bord (jour + mois).
 */
export function dashboard(date = null) {
  const today = date || nowSql().slice(0, 10);
  const period = today.slice(0, 7);
  const { start, end } = periodBounds(period);

  const todayMetrics = computePeriod(today, today);
  const monthMetrics = computePeriod(start, end);

  // Produits en rupture / proches de rupture
  const lowStock = all(
    `WITH stock AS (
       SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
       FROM stock_movements GROUP BY product_id
     )
     SELECT p.id, p.code, p.name, p.unit, p.min_stock, p.type,
            ROUND(COALESCE(s.qty,0),4) AS qty
     FROM products p LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.deleted_at IS NULL AND p.active = 1
       AND COALESCE(s.qty,0) <= p.min_stock
     ORDER BY (COALESCE(s.qty,0) <= 0) DESC, p.name LIMIT 20`,
  );

  // Produits proches d'expiration
  const expiryDays = Number(getSetting('alert_expiry_days', 5));
  const expiring = all(
    `WITH stock AS (
       SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
       FROM stock_movements GROUP BY product_id
     )
     SELECT p.id, p.code, p.name, p.unit, p.dlc, p.lot_number,
            ROUND(COALESCE(s.qty,0),4) AS qty,
            CAST(julianday(p.dlc) - julianday(date(?)) AS INTEGER) AS days_left
     FROM products p LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.dlc IS NOT NULL AND p.deleted_at IS NULL
       AND COALESCE(s.qty,0) > 0
       AND date(p.dlc) <= date(?, '+' || ? || ' days')
     ORDER BY p.dlc ASC LIMIT 20`,
    [today, today, expiryDays],
  );

  // Opérations en attente
  const pending = {
    transfersDraft: get("SELECT COUNT(*) c FROM transfers WHERE status = 'brouillon'").c || 0,
    transfersDraftValue: get(
      "SELECT ROUND(COALESCE(SUM(total_cost),0),3) v FROM transfers WHERE status = 'brouillon'",
    ).v || 0,
    lossesDraft: get("SELECT COUNT(*) c FROM losses WHERE status = 'brouillon'").c || 0,
    productionsDraft: get("SELECT COUNT(*) c FROM productions WHERE status = 'brouillon'").c || 0,
    purchasesPending: get("SELECT COUNT(*) c FROM purchases WHERE status IN ('brouillon','commandee','partielle')").c || 0,
    stockCountsDraft: get("SELECT COUNT(*) c FROM stock_counts WHERE status = 'brouillon'").c || 0,
    payrollDraft: get("SELECT COUNT(*) c FROM payroll_records WHERE status = 'brouillon'").c || 0,
  };

  // Transferts du mois
  const transfersMonth = get(
    `SELECT COUNT(*) c, ROUND(COALESCE(SUM(total_cost),0),3) v FROM transfers
     WHERE status='valide' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [start, end],
  );

  // Rendements moyens
  const yieldsMonth = get(
    `SELECT ROUND(AVG(yield_pct),2) avg_yield, ROUND(AVG(loss_pct),2) avg_loss, COUNT(*) c
     FROM transformations
     WHERE status='valide' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [start, end],
  );

  // Stock total valorisé (matières + fabriqués)
  const stockTotal = get(
    `SELECT ROUND(COALESCE(SUM(s.qty * p.unit_cost),0),3) v FROM
      (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
       FROM stock_movements GROUP BY product_id) s
     JOIN products p ON p.id = s.product_id WHERE p.deleted_at IS NULL`,
  ).v || 0;

  // Ventes 7 derniers jours (graphique)
  const salesTrend = all(
    `SELECT date(occurred_at) AS day,
            ROUND(COALESCE(SUM(subtotal_ht - discount),0),3) AS revenue_ht,
            ROUND(COALESCE(SUM(cost_total),0),3) AS cost
     FROM sales WHERE status='valide' AND date(occurred_at) >= date(?, '-6 days')
     GROUP BY date(occurred_at) ORDER BY day`,
    [today],
  );

  // Dépenses du mois par catégorie (graphique)
  const expenseBreakdown = expensesByCategory(start, end);

  return {
    date: today,
    period,
    today: todayMetrics,
    month: monthMetrics,
    stockTotalValue: stockTotal,
    stockMaterialsValue: stockValueAt(today, 'materials'),
    lowStock,
    expiring,
    expiryDays,
    pending,
    pendingTotal:
      pending.transfersDraft + pending.lossesDraft + pending.productionsDraft + pending.stockCountsDraft,
    transfersMonth: { count: transfersMonth.c || 0, value: transfersMonth.v || 0 },
    yieldsMonth: {
      avgYield: yieldsMonth.avg_yield || 0,
      avgLoss: yieldsMonth.avg_loss || 0,
      count: yieldsMonth.c || 0,
    },
    salesTrend,
    expenseBreakdown,
  };
}

/* ===========================================================================
 *  ALERTES GLOBALES
 * ========================================================================= */

/**
 * Construit la liste d'alertes configurables du tableau de bord.
 * @param {string} [date]
 */
export function buildAlerts(date = null) {
  const today = date || nowSql().slice(0, 10);
  const period = today.slice(0, 7);
  const { start, end } = periodBounds(period);
  const alerts = [];

  // 1) Dépassement de l'objectif
  if (getSetting('alert_overrun_enabled', true)) {
    const month = computePeriod(start, end);
    if (month.revenueHt > 0 && month.ratioPct > month.objectivePct) {
      alerts.push({
        code: 'OVER_TARGET',
        severity: 'critical',
        title: `Objectif matière dépassé : ${month.ratioPct} % (seuil ${month.objectivePct} %)`,
        detail: `Écart de +${month.gapPoints} pts, soit ${month.overrunAmount.toFixed(3)} DT de dépassement.`,
        link: '/analyses',
      });
    }
  }

  // 2) Stock insuffisant
  if (getSetting('alert_stock_enabled', true)) {
    const out = get(
      `WITH stock AS (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
                      FROM stock_movements GROUP BY product_id)
       SELECT COUNT(*) c FROM products p LEFT JOIN stock s ON s.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.active=1 AND COALESCE(s.qty,0) <= 0`,
    ).c || 0;
    const low = get(
      `WITH stock AS (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
                      FROM stock_movements GROUP BY product_id)
       SELECT COUNT(*) c FROM products p LEFT JOIN stock s ON s.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.active=1 AND COALESCE(s.qty,0) > 0
         AND COALESCE(s.qty,0) <= p.min_stock`,
    ).c || 0;
    if (out > 0) {
      alerts.push({
        code: 'OUT_OF_STOCK', severity: 'critical',
        title: `${out} produit(s) en rupture de stock`,
        detail: 'Des produits sont à zéro : production et ventes peuvent être bloquées.',
        link: '/stock',
      });
    }
    if (low > 0) {
      alerts.push({
        code: 'LOW_STOCK', severity: 'warning',
        title: `${low} produit(s) sous le stock minimal`,
        detail: 'Anticipez les achats pour éviter les ruptures.',
        link: '/stock',
      });
    }
  }

  // 3) Péremptions
  const expiryDays = Number(getSetting('alert_expiry_days', 5));
  const expiringCount = get(
    `WITH stock AS (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
                    FROM stock_movements GROUP BY product_id)
     SELECT COUNT(*) c FROM products p LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.dlc IS NOT NULL AND COALESCE(s.qty,0) > 0
       AND date(p.dlc) <= date(?, '+' || ? || ' days')`,
    [today, expiryDays],
  ).c || 0;
  const expiredCount = get(
    `WITH stock AS (SELECT product_id, SUM(CASE WHEN direction='in' THEN qty ELSE -qty END) qty
                    FROM stock_movements GROUP BY product_id)
     SELECT COUNT(*) c FROM products p LEFT JOIN stock s ON s.product_id = p.id
     WHERE p.dlc IS NOT NULL AND COALESCE(s.qty,0) > 0 AND date(p.dlc) < date(?)`,
    [today],
  ).c || 0;

  if (expiredCount > 0) {
    alerts.push({
      code: 'EXPIRED', severity: 'critical',
      title: `${expiredCount} produit(s) périmé(s) en stock`,
      detail: 'Enregistrez une avarie pour chaque produit périmé afin d’assainir le stock.',
      link: '/avaries',
    });
  }
  if (expiringCount > 0) {
    alerts.push({
      code: 'EXPIRING', severity: 'warning',
      title: `${expiringCount} produit(s) arrivent à expiration sous ${expiryDays} jours`,
      detail: 'Planifiez leur utilisation ou enregistrez une perte.',
      link: '/stock',
    });
  }

  // 4) Pertes anormales
  const abnormalThreshold = Number(getSetting('alert_abnormal_loss_pct', 15));
  const abnormal = get(
    `SELECT COUNT(*) c, ROUND(COALESCE(SUM(total_cost),0),3) v FROM losses
     WHERE status='valide' AND already_in_consumption=0
       AND date(occurred_at) BETWEEN date(?) AND date(?)
       AND loss_type IN ('erreur_preparation','renverse','detérioré','mauvaise_conservation')`,
    [start, end],
  );
  if ((abnormal.c || 0) > 0) {
    alerts.push({
      code: 'ABNORMAL_LOSS', severity: 'warning',
      title: `${abnormal.c} perte(s) anormale(s) ce mois (${abnormal.v} DT)`,
      detail: `Vérifiez les causes : erreurs de préparation, mauvaise conservation, casse.`,
      link: '/avaries',
    });
  }
  const yieldIssues = get(
    `SELECT COUNT(*) c FROM transformations
     WHERE status='valide' AND loss_type='anormale'
       AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [start, end],
  ).c || 0;
  if (yieldIssues > 0) {
    alerts.push({
      code: 'YIELD_ISSUE', severity: 'warning',
      title: `${yieldIssues} rendement(s) sous le seuil (${abnormalThreshold} %)`,
      detail: 'Analysez les transformations concernées pour ajuster les portions ou le fournisseur.',
      link: '/transformations',
    });
  }

  // 5) Écarts d'inventaire
  const inventoryGap = get(
    `SELECT COUNT(*) c, ROUND(COALESCE(SUM(ABS(variance_value)),0),3) v
     FROM stock_count_items i JOIN stock_counts sc ON sc.id = i.stock_count_id
     WHERE sc.status='valide' AND date(sc.count_date) BETWEEN date(?) AND date(?)`,
    [start, end],
  );
  const gapThresholdValue = Number(getSetting('alert_gap_value_dt', 5));
  if ((inventoryGap.v || 0) > gapThresholdValue) {
    alerts.push({
      code: 'INVENTORY_GAP', severity: 'warning',
      title: `Écarts d’inventaire de ${inventoryGap.v} DT ce mois`,
      detail: `Au-delà du seuil de ${gapThresholdValue} DT : vérifiez la saisie des mouvements.`,
      link: '/inventaires',
    });
  }

  // 6) Opérations non validées
  const drafts = {
    transfers: get("SELECT COUNT(*) c FROM transfers WHERE status='brouillon'").c || 0,
    losses: get("SELECT COUNT(*) c FROM losses WHERE status='brouillon'").c || 0,
    productions: get("SELECT COUNT(*) c FROM productions WHERE status='brouillon'").c || 0,
    counts: get("SELECT COUNT(*) c FROM stock_counts WHERE status='brouillon'").c || 0,
  };
  const draftTotal = drafts.transfers + drafts.losses + drafts.productions + drafts.counts;
  if (draftTotal > 0) {
    alerts.push({
      code: 'PENDING_OPS', severity: 'info',
      title: `${draftTotal} opération(s) en attente de validation`,
      detail: `Transferts : ${drafts.transfers} · Avaries : ${drafts.losses} · ` +
        `Productions : ${drafts.productions} · Inventaires : ${drafts.counts}.`,
      link: '/transferts',
    });
  }

  // 7) Clôture en attente
  const monthClosed = get("SELECT id FROM monthly_closings WHERE period = ? AND status = 'cloture'", [period]);
  const todayDate = new Date(`${today}T00:00:00`);
  if (!monthClosed && todayDate.getDate() >= 28) {
    alerts.push({
      code: 'CLOSING_PENDING', severity: 'warning',
      title: `Clôture du mois ${period} en attente`,
      detail: 'La fin de mois approche : préparez la clôture mensuelle.',
      link: '/cloture',
    });
  }

  return alerts;
}

/* ===========================================================================
 *  COMPARAISON DE PÉRIODES
 * ========================================================================= */

/**
 * Compare deux périodes mensuelles et calcule les tendances.
 * @param {string} periodA YYYY-MM
 * @param {string} periodB YYYY-MM
 */
export function comparePeriods(periodA, periodB) {
  const a = computeMonth(periodA);
  const b = computeMonth(periodB);

  const delta = (x, y) => (y === 0 ? (x === 0 ? 0 : 100) : roundPct(((x - y) / y) * 100));

  return {
    periodA: a,
    periodB: b,
    evolution: {
      revenueHt: { current: a.revenueHt, previous: b.revenueHt, deltaPct: delta(a.revenueHt, b.revenueHt) },
      purchases: { current: a.purchasesReceived, previous: b.purchasesReceived, deltaPct: delta(a.purchasesReceived, b.purchasesReceived) },
      consumption: { current: a.consumption, previous: b.consumption, deltaPct: delta(a.consumption, b.consumption) },
      retainedCost: { current: a.retainedCost, previous: b.retainedCost, deltaPct: delta(a.retainedCost, b.retainedCost) },
      ratioPct: { current: a.ratioPct, previous: b.ratioPct, deltaPoints: roundPct(a.ratioPct - b.ratioPct) },
      otherExpenses: { current: a.otherExpenses, previous: b.otherExpenses, deltaPct: delta(a.otherExpenses, b.otherExpenses) },
      estimatedResult: { current: a.estimatedResult, previous: b.estimatedResult, deltaPct: delta(a.estimatedResult, b.estimatedResult) },
    },
  };
}

/** Période mensuelle précédente (YYYY-MM). */
export function previousMonth(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Même mois de l'année précédente. */
export function sameMonthLastYear(period) {
  const [y, m] = period.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}`;
}

/* ===========================================================================
 *  DÉTAIL PAR CUISINE
 * ========================================================================= */

/**
 * Consommations valorisées par cuisine sur une période.
 */
export function consumptionByKitchen(from, to) {
  return all(
    `SELECT k.id, k.name AS kitchen_name, k.kind,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='out' AND p.type IN (${MATERIAL_SQL_LIST})
                                    THEN m.total_cost ELSE 0 END),0),3) AS consumed,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' AND p.type IN (${MATERIAL_SQL_LIST})
                                    THEN m.total_cost ELSE 0 END),0),3) AS entered,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='out' THEN m.total_cost ELSE 0 END),0),3) AS all_out,
            ROUND(COALESCE(SUM(CASE WHEN m.direction='in' THEN m.total_cost ELSE 0 END),0),3) AS all_in
     FROM kitchens k
     LEFT JOIN stock_movements m ON m.kitchen_id = k.id
       AND date(m.occurred_at) BETWEEN date(?) AND date(?)
     LEFT JOIN products p ON p.id = m.product_id
     GROUP BY k.id ORDER BY k.id`,
    [from, to],
  );
}
