/**
 * ============================================================================
 *  Chef Cuisine Manager — Formules métier (couche pure, sans I/O)
 * ----------------------------------------------------------------------------
 *  Ce module ne dépend NI de la base de données, NI de React, NI de Node.
 *  Il est importé :
 *    - par les services serveur (calculs officiels),
 *    - par l'interface React (simulateur, aperçus),
 *    - par les tests unitaires (node --test).
 *
 *  Convention monétaire : dinar tunisien (DT), arrondi à 3 décimales.
 *  Convention de quantité : nombre réel, dans l'unité de stock du produit.
 * ============================================================================
 */

/** Nombre de décimales monétaires (DT accepte 3 décimales : millimes). */
export const MONEY_DECIMALS = 3;

const DEC = 10 ** MONEY_DECIMALS;

/**
 * Arrondit un montant en DT à 3 décimales (millimes) en évitant les erreurs
 * classiques de représentation binaire (ex: 1.005).
 * @param {number} value
 * @returns {number}
 */
export function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  // Correction epsilon pour les cas type 2.675 -> 2.675 (et non 2.674)
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return (sign * Math.round((abs + Number.EPSILON * abs) * DEC)) / DEC;
}

/**
 * Arrondit une quantité (kg, L, unités…) à 4 décimales pour rester précis
 * sur les grammes et millilitres.
 * @param {number} value
 * @returns {number}
 */
export function roundQty(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * Arrondit un pourcentage à 2 décimales.
 * @param {number} value
 * @returns {number}
 */
export function roundPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Somme sûre d'une liste de nombres (ignore null/undefined/NaN). */
export function sum(values) {
  return (values || []).reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}

/* ---------------------------------------------------------------------------
 *  1. CONVERSIONS D'UNITÉS
 * ------------------------------------------------------------------------- */

/**
 * Table de conversion vers une unité pivot par famille.
 * kg -> g (1000), L -> ml (1000), unité -> unité, carton -> carton.
 * Cette table est un socle technique ; les unités affichées proviennent de la
 * table `units` en base (configurable par le chef).
 */
const UNIT_FAMILY = {
  kg: { family: 'masse', factor: 1000 },
  g: { family: 'masse', factor: 1 },
  mg: { family: 'masse', factor: 0.001 },
  l: { family: 'volume', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  cl: { family: 'volume', factor: 10 },
  unite: { family: 'compte', factor: 1 },
  carton: { family: 'compte', factor: 1 },
};

/**
 * Convertit une quantité d'une unité vers une autre si elles appartiennent
 * à la même famille (masse/volume/compte).
 * @param {number} qty
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {{value:number, converted:boolean, error?:string}}
 */
export function convertQty(qty, fromUnit, toUnit) {
  const from = UNIT_FAMILY[String(fromUnit || '').toLowerCase()];
  const to = UNIT_FAMILY[String(toUnit || '').toLowerCase()];
  if (fromUnit === toUnit) return { value: qty, converted: false };
  if (!from || !to) {
    return { value: qty, converted: false, error: `Unité inconnue : ${!from ? fromUnit : toUnit}` };
  }
  if (from.family !== to.family) {
    return {
      value: qty,
      converted: false,
      error: `Conversion impossible entre ${fromUnit} (${from.family}) et ${toUnit} (${to.family})`,
    };
  }
  return { value: (qty * from.factor) / to.factor, converted: true };
}

/* ---------------------------------------------------------------------------
 *  2. RECETTES & COÛT DE REVIENT
 * ------------------------------------------------------------------------- */

/**
 * Coût d'une ligne d'ingrédient = quantité × coût unitaire retenu.
 * @param {number} qty quantité (dans l'unité de la ligne)
 * @param {number} unitCost coût unitaire retenu (DT par unité)
 * @returns {number}
 */
export function ingredientLineCost(qty, unitCost) {
  return roundMoney((Number(qty) || 0) * (Number(unitCost) || 0));
}

/**
 * Coût total d'une recette = somme des coûts des ingrédients.
 * @param {Array<{qty:number, unitCost:number, unit?:string, productUnit?:string}>} items
 * @returns {number}
 */
export function recipeTotalCost(items) {
  return roundMoney(
    sum(
      (items || []).map((it) => {
        // Si l'unité de la ligne diffère de l'unité de stock, on convertit.
        let qty = Number(it.qty) || 0;
        if (it.unit && it.productUnit && it.unit !== it.productUnit) {
          const conv = convertQty(qty, it.unit, it.productUnit);
          if (!conv.error) qty = conv.value;
        }
        return qty * (Number(it.unitCost) || 0);
      }),
    ),
  );
}

/**
 * Coût par portion = coût recette / nombre de portions.
 * @param {number} totalCost
 * @param {number} portions
 * @returns {number}
 */
export function costPerPortion(totalCost, portions) {
  const p = Number(portions) || 0;
  if (p <= 0) return 0;
  return roundMoney((Number(totalCost) || 0) / p);
}

/**
 * Ratio matière d'un plat (%) = (coût matière / portion ÷ prix de vente HT / portion) × 100
 * @param {number} costPortion
 * @param {number} sellingPriceHtPortion
 * @returns {number}
 */
export function dishCostRatio(costPortion, sellingPriceHtPortion) {
  const price = Number(sellingPriceHtPortion) || 0;
  if (price <= 0) return 0;
  return roundPct(((Number(costPortion) || 0) / price) * 100);
}

/**
 * Marge brute théorique d'un plat (en DT et en %).
 * @param {number} costPortion
 * @param {number} sellingPriceHtPortion
 * @returns {{margin:number, marginPct:number}}
 */
export function dishGrossMargin(costPortion, sellingPriceHtPortion) {
  const price = Number(sellingPriceHtPortion) || 0;
  const margin = roundMoney(price - (Number(costPortion) || 0));
  return { margin, marginPct: price > 0 ? roundPct((margin / price) * 100) : 0 };
}

/* ---------------------------------------------------------------------------
 *  3. TRANSFORMATION & RENDEMENTS
 * ------------------------------------------------------------------------- */

/**
 * Rendement (%) = (poids final utilisable / poids initial) × 100
 * @param {number} finalWeight
 * @param {number} initialWeight
 * @returns {number}
 */
export function yieldPct(finalWeight, initialWeight) {
  const init = Number(initialWeight) || 0;
  if (init <= 0) return 0;
  return roundPct(((Number(finalWeight) || 0) / init) * 100);
}

/**
 * Taux de perte (%) = ((poids initial − poids final utilisable) / poids initial) × 100
 * @param {number} initialWeight
 * @param {number} finalWeight
 * @returns {number}
 */
export function lossPct(initialWeight, finalWeight) {
  const init = Number(initialWeight) || 0;
  if (init <= 0) return 0;
  const loss = init - (Number(finalWeight) || 0);
  // Une perte négative (gain de poids) est plafonnée à 0 pour l'affichage.
  if (loss <= 0) return 0;
  return roundPct((loss / init) * 100);
}

/**
 * Poids moyen par portion = poids final utilisable / nombre de portions.
 * @param {number} finalWeight
 * @param {number} portions
 * @returns {number}
 */
export function avgPortionWeight(finalWeight, portions) {
  const p = Number(portions) || 0;
  if (p <= 0) return 0;
  return roundQty((Number(finalWeight) || 0) / p);
}

/**
 * Coût final par portion après transformation.
 * Le coût total de la matière ne change pas : il se répartit sur un poids plus
 * faible, ce qui augmente mécaniquement le coût au kilo.
 * @param {number} initialCost coût initial de la matière
 * @param {number} portions
 * @returns {number}
 */
export function transformationCostPerPortion(initialCost, portions) {
  return costPerPortion(initialCost, portions);
}

/**
 * Coût unitaire après transformation (DT par unité de poids utilisable).
 * @param {number} initialCost
 * @param {number} finalWeight
 * @returns {number}
 */
export function transformationUnitCost(initialCost, finalWeight) {
  const w = Number(finalWeight) || 0;
  if (w <= 0) return 0;
  return roundMoney((Number(initialCost) || 0) / w);
}

/**
 * Qualification d'une perte de transformation selon le seuil du chef.
 * @param {number} lossPctValue taux de perte calculé (%)
 * @param {number} threshold seuil de perte normale (%)
 * @returns {'normale'|'anormale'}
 */
export function classifyLoss(lossPctValue, threshold) {
  const t = Number.isFinite(threshold) ? threshold : 0;
  return (Number(lossPctValue) || 0) > t ? 'anormale' : 'normale';
}

/* ---------------------------------------------------------------------------
 *  4. CONSOMMATION VALORISÉE & COÛT MATIÈRE RETENU
 * ------------------------------------------------------------------------- */

/**
 * Consommation valorisée (formule officielle) :
 *   stock d'ouverture + achats réceptionnés − retours + ajustements justifiés
 *   − stock de clôture
 *
 * NOTE ANTI-DOUBLE COMPTAGE (documentée dans le README) :
 * ce solde matière est établi sur le PÉRIMÈTRE DES MATIÈRES PREMIÈRES
 * (matières premières, ingrédients, consommables). Les produits fabriqués
 * (semi-finis / finis) sont valorisés dans leur propre stock mais sont EXCLUS
 * de ce solde : leur coût a déjà été capturé au moment où les ingrédients sont
 * sortis en production. Ainsi :
 *   - production : les sorties d'ingrédients entrent dans la consommation,
 *     l'entrée du produit fabriqué ne la réduit pas ;
 *   - ventes : la sortie du plat fini ne vient pas s'ajouter une 2ᵉ fois ;
 *   - transferts : neutres, les deux cuisines sont dans le même périmètre.
 *
 * @param {object} p
 * @param {number} p.openingStock stock d'ouverture valorisé (matières)
 * @param {number} p.purchasesReceived achats réceptionnés sur la période
 * @param {number} [p.returns] retours fournisseurs
 * @param {number} [p.adjustments] ajustements justifiés (inventaires)
 * @param {number} p.closingStock stock de clôture valorisé (matières)
 * @returns {number}
 */
export function valuedConsumption({
  openingStock = 0,
  purchasesReceived = 0,
  returns = 0,
  adjustments = 0,
  closingStock = 0,
}) {
  return roundMoney(
    (Number(openingStock) || 0) +
      (Number(purchasesReceived) || 0) -
      (Number(returns) || 0) +
      (Number(adjustments) || 0) -
      (Number(closingStock) || 0),
  );
}

/**
 * Coût matière retenu = consommation valorisée + pertes NON déjà incluses.
 * Les pertes déjà comptabilisées dans la consommation (parce qu'elles ont
 * réduit le stock du périmètre) ne sont JAMAIS ajoutées une seconde fois.
 * @param {number} consumption
 * @param {number} lossesNotIncluded
 * @returns {number}
 */
export function retainedMaterialCost(consumption, lossesNotIncluded) {
  return roundMoney((Number(consumption) || 0) + (Number(lossesNotIncluded) || 0));
}

/* ---------------------------------------------------------------------------
 *  5. RATIO GLOBAL, OBJECTIF, DÉPASSEMENT
 * ------------------------------------------------------------------------- */

/**
 * Ratio matière global (%) = (coût matière retenu / CA HT de la même période) × 100
 * @param {number} retainedCost
 * @param {number} revenueHt
 * @returns {number}
 */
export function globalMaterialRatio(retainedCost, revenueHt) {
  const rev = Number(revenueHt) || 0;
  if (rev <= 0) return 0;
  return roundPct(((Number(retainedCost) || 0) / rev) * 100);
}

/**
 * Coût maximal autorisé = CA HT × objectif (objectif exprimé en fraction, ex 0.30).
 * @param {number} revenueHt
 * @param {number} objectiveRatio fraction (0.30 = 30 %)
 * @returns {number}
 */
export function maxAllowedCost(revenueHt, objectiveRatio) {
  return roundMoney((Number(revenueHt) || 0) * (Number(objectiveRatio) || 0));
}

/**
 * Marge restante avant autres charges = CA HT − coût matière retenu.
 * ⚠️ Ce n'est PAS un bénéfice net : les autres charges ne sont pas déduites ici.
 * @param {number} revenueHt
 * @param {number} retainedCost
 * @returns {number}
 */
export function marginBeforeOtherCharges(revenueHt, retainedCost) {
  return roundMoney((Number(revenueHt) || 0) - (Number(retainedCost) || 0));
}

/**
 * Dépassement en DT = max(0, coût retenu − coût maximal autorisé).
 * @param {number} retainedCost
 * @param {number} maxCost
 * @returns {number}
 */
export function overrunAmount(retainedCost, maxCost) {
  return roundMoney(Math.max(0, (Number(retainedCost) || 0) - (Number(maxCost) || 0)));
}

/**
 * Écart en points de ratio = ratio − objectif (en points de %).
 * @param {number} ratioPct
 * @param {number} objectivePct
 * @returns {number}
 */
export function ratioGapPoints(ratioPct, objectivePct) {
  return roundPct((Number(ratioPct) || 0) - (Number(objectivePct) || 0));
}

/**
 * Résultat de gestion estimatif = CA HT − coût matière retenu − autres charges.
 * ⚠️ Indicateur de gestion, pas un résultat comptable certifié.
 * @param {number} revenueHt
 * @param {number} retainedCost
 * @param {number} otherExpenses
 * @returns {number}
 */
export function estimatedOperatingResult(revenueHt, retainedCost, otherExpenses) {
  return roundMoney(
    (Number(revenueHt) || 0) - (Number(retainedCost) || 0) - (Number(otherExpenses) || 0),
  );
}

/**
 * Moteur complet du simulateur de coût matière.
 * @param {object} p
 * @param {number} p.revenueHt chiffre d'affaires HT
 * @param {number} p.consumption coût matière consommée
 * @param {number} [p.lossesNotIncluded] avaries non déjà comptabilisées
 * @param {number} [p.objectivePct] objectif en % (15..45, défaut 30)
 * @returns {object} résultat complet et libellés
 */
export function simulateMaterialCost({
  revenueHt = 0,
  consumption = 0,
  lossesNotIncluded = 0,
  objectivePct = 30,
}) {
  const revenue = Number(revenueHt) || 0;
  const cons = Number(consumption) || 0;
  const losses = Number(lossesNotIncluded) || 0;
  const objective = Number(objectivePct) || 0;

  const retainedCost = retainedMaterialCost(cons, losses);
  const ratio = globalMaterialRatio(retainedCost, revenue);
  const maxCost = maxAllowedCost(revenue, objective / 100);
  const overrun = overrunAmount(retainedCost, maxCost);
  const gap = ratioGapPoints(ratio, objective);
  const margin = marginBeforeOtherCharges(revenue, retainedCost);
  const targetReached = revenue > 0 && ratio <= objective;

  return {
    revenueHt: roundMoney(revenue),
    consumption: roundMoney(cons),
    lossesNotIncluded: roundMoney(losses),
    retainedCost,
    objectivePct: roundPct(objective),
    ratioPct: ratio,
    maxAllowedCost: maxCost,
    overrunAmount: overrun,
    gapPoints: gap,
    marginBeforeOtherCharges: margin,
    targetReached,
    // Le libellé est imposé par le cahier des charges.
    label: 'simulation indicative',
    message: targetReached
      ? `Objectif atteint : ${ratio} % pour un objectif de ${roundPct(objective)} %.`
      : revenue <= 0
        ? 'Renseignez un chiffre d’affaires HT pour interpréter le ratio.'
        : `Objectif dépassé : ${ratio} % pour un objectif de ${roundPct(objective)} % ` +
          `(${gap > 0 ? '+' : ''}${gap} pts, ${overrun.toFixed(3)} DT de dépassement).`,
  };
}

/* ---------------------------------------------------------------------------
 *  6. VENTES : HT / TVA / TTC
 * ------------------------------------------------------------------------- */

/**
 * Décompose un montant HT en TVA et TTC.
 * @param {number} amountHt
 * @param {number} taxRate taux en % (ex 19)
 * @returns {{ht:number, tax:number, ttc:number}}
 */
export function vatBreakdown(amountHt, taxRate) {
  const ht = roundMoney(amountHt);
  const tax = roundMoney(((Number(amountHt) || 0) * (Number(taxRate) || 0)) / 100);
  return { ht, tax, ttc: roundMoney(ht + tax) };
}

/**
 * Retrouve le HT à partir du TTC (utile pour les saisies « prix affiché TTC »).
 * @param {number} amountTtc
 * @param {number} taxRate
 * @returns {{ht:number, tax:number, ttc:number}}
 */
export function vatFromTtc(amountTtc, taxRate) {
  const ttc = roundMoney(amountTtc);
  const rate = Number(taxRate) || 0;
  const ht = roundMoney(ttc / (1 + rate / 100));
  return { ht, tax: roundMoney(ttc - ht), ttc };
}

/**
 * Montant d'une ligne de vente après remise.
 * @param {number} qty
 * @param {number} unitPriceHt
 * @param {number} discountPct remise en %
 * @param {number} taxRate
 * @returns {{subtotalHt:number, discount:number, ht:number, tax:number, ttc:number}}
 */
export function saleLineTotals(qty, unitPriceHt, discountPct, taxRate) {
  const grossHt = roundMoney((Number(qty) || 0) * (Number(unitPriceHt) || 0));
  const discount = roundMoney((grossHt * (Number(discountPct) || 0)) / 100);
  const ht = roundMoney(grossHt - discount);
  const { tax, ttc } = vatBreakdown(ht, taxRate);
  return { subtotalHt: grossHt, discount, ht, tax, ttc };
}

/* ---------------------------------------------------------------------------
 *  7. PAIE (paramètres légaux modifiables — jamais codés en dur comme définitifs)
 * ------------------------------------------------------------------------- */

/**
 * Calcul d'un bulletin de paie simplifié à partir des taux fournis en
 * paramètres. Aucun taux tunisien n'est codé en dur : ils sont lus dans les
 * paramètres et doivent être validés par le comptable.
 *
 * @param {object} p
 * @param {number} p.baseSalary salaire de base mensuel
 * @param {number} [p.hoursNormal]
 * @param {number} [p.hoursOvertime]
 * @param {number} [p.hourlyRate] taux horaire (si absent : base / 191 h)
 * @param {number} [p.overtimeRate] majoration heures sup (ex 1.25)
 * @param {number} [p.primes] primes et indemnités
 * @param {number} [p.advances] avances à déduire
 * @param {number} [p.retenues] autres retenues
 * @param {number} [p.cnssEmployeeRate] taux salarial CNSS (%)
 * @param {number} [p.cnssEmployerRate] taux patronal CNSS (%)
 * @param {number} [p.irppRate] taux IRPP retenu (%)
 * @returns {object}
 */
export function payrollCompute({
  baseSalary = 0,
  hoursNormal = 191,
  hoursOvertime = 0,
  hourlyRate = null,
  overtimeRate = 1.25,
  primes = 0,
  advances = 0,
  retenues = 0,
  cnssEmployeeRate = 0,
  cnssEmployerRate = 0,
  irppRate = 0,
}) {
  const base = Number(baseSalary) || 0;
  const rate = Number(hourlyRate) || (base > 0 ? base / 191 : 0);
  const overtimeAmount = roundMoney((Number(hoursOvertime) || 0) * rate * (Number(overtimeRate) || 1));
  const gross = roundMoney(base + overtimeAmount + (Number(primes) || 0));
  const cnssEmployee = roundMoney((gross * (Number(cnssEmployeeRate) || 0)) / 100);
  const cnssEmployer = roundMoney((gross * (Number(cnssEmployerRate) || 0)) / 100);
  const taxable = roundMoney(gross - cnssEmployee);
  const irpp = roundMoney((taxable * (Number(irppRate) || 0)) / 100);
  const net = roundMoney(
    gross - cnssEmployee - irpp - (Number(advances) || 0) - (Number(retenues) || 0),
  );
  return {
    baseSalary: roundMoney(base),
    hourlyRate: roundMoney(rate),
    hoursNormal: Number(hoursNormal) || 0,
    hoursOvertime: Number(hoursOvertime) || 0,
    overtimeAmount,
    primes: roundMoney(primes),
    gross,
    cnssEmployee,
    cnssEmployer,
    ircc: irpp, // alias historique
    irpp,
    advances: roundMoney(advances),
    retenues: roundMoney(retenues),
    net,
    totalEmployerCost: roundMoney(gross + cnssEmployer),
  };
}

/* ---------------------------------------------------------------------------
 *  8. VALEUR DE STOCK & COÛT MOYEN PONDÉRÉ
 * ------------------------------------------------------------------------- */

/**
 * Coût moyen pondéré après une entrée en stock.
 * CMP' = (qtyAvant × cmpAvant + qtyEntrée × coûtEntrée) / (qtyAvant + qtyEntrée)
 * @param {number} qtyBefore
 * @param {number} avgCostBefore
 * @param {number} qtyIn
 * @param {number} unitCostIn
 * @returns {number}
 */
export function weightedAverageCost(qtyBefore, avgCostBefore, qtyIn, unitCostIn) {
  const qb = Number(qtyBefore) || 0;
  const cb = Number(avgCostBefore) || 0;
  const qi = Number(qtyIn) || 0;
  const ci = Number(unitCostIn) || 0;
  const totalQty = qb + qi;
  if (totalQty <= 0) return ci;
  // Précision conservée au millième de millime pour éviter la dérive.
  return Math.round(((qb * cb + qi * ci) / totalQty) * 1e6) / 1e6;
}

/**
 * Valeur d'un stock = quantité × coût unitaire.
 * @param {number} qty
 * @param {number} unitCost
 * @returns {number}
 */
export function stockValue(qty, unitCost) {
  return roundMoney((Number(qty) || 0) * (Number(unitCost) || 0));
}

/* ---------------------------------------------------------------------------
 *  9. FORMATAGE (affichage uniquement — aucune logique métier)
 * ------------------------------------------------------------------------- */

/**
 * Formate un montant en DT à 3 décimales, séparateur d'espace fine insécable.
 * @param {number} value
 * @param {{suffix?:boolean}} [opts]
 * @returns {string}
 */
export function formatMoney(value, opts = {}) {
  const v = roundMoney(value);
  // Intl 'fr-*' insère une espace fine insécable (U+202F) ; on la normalise en
  // espace insécable (U+00A0) pour un rendu homogène dans toute l'interface.
  const s = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
    .format(v)
    .replace(/\u202f/g, '\u00a0');
  return opts.suffix === false ? s : `${s}\u00a0DT`;
}

/**
 * Formate une quantité (max 4 décimales, sans zéros inutiles).
 * @param {number} value
 * @param {string} [unit]
 * @returns {string}
 */
export function formatQty(value, unit) {
  const v = roundQty(value);
  const s = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(v);
  return unit ? `${s} ${unit}` : s;
}

/**
 * Formate un pourcentage à 2 décimales.
 * @param {number} value
 * @returns {string}
 */
export function formatPct(value) {
  return `${roundPct(value).toFixed(2)} %`;
}
