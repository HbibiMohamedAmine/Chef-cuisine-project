/**
 * TESTS — Formules métier (couche pure).
 * Contient le TEST DE RÉFÉRENCE OBLIGATOIRE du cahier des charges.
 * Exécution : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundMoney,
  ingredientLineCost,
  recipeTotalCost,
  costPerPortion,
  dishCostRatio,
  dishGrossMargin,
  yieldPct,
  lossPct,
  avgPortionWeight,
  classifyLoss,
  valuedConsumption,
  retainedMaterialCost,
  globalMaterialRatio,
  maxAllowedCost,
  marginBeforeOtherCharges,
  overrunAmount,
  ratioGapPoints,
  simulateMaterialCost,
  estimatedOperatingResult,
  vatBreakdown,
  vatFromTtc,
  saleLineTotals,
  weightedAverageCost,
  stockValue,
  convertQty,
  payrollCompute,
  transformationUnitCost,
  formatMoney,
} from '../shared/formulas.js';

/* ===========================================================================
 *  TEST DE RÉFÉRENCE OBLIGATOIRE
 *  CA HT 100 000 — consommation 24 000 — avaries non incluses 4 000
 *  => coût retenu 28 000, ratio 28 %, objectif 30 %, coût max 30 000,
 *     marge restante 72 000.
 * ========================================================================= */
test('RÉFÉRENCE — ratio global 28 % avec avaries non incluses', () => {
  const revenueHt = 100000;
  const consumption = 24000;
  const lossesNotIncluded = 4000;

  const retained = retainedMaterialCost(consumption, lossesNotIncluded);
  assert.equal(retained, 28000, 'coût matière retenu doit être 28 000 DT');

  const ratio = globalMaterialRatio(retained, revenueHt);
  assert.equal(ratio, 28, 'le ratio doit être 28 %');

  const objectivePct = 30;
  const maxCost = maxAllowedCost(revenueHt, objectivePct / 100);
  assert.equal(maxCost, 30000, 'le coût maximal autorisé doit être 30 000 DT');

  const margin = marginBeforeOtherCharges(revenueHt, retained);
  assert.equal(margin, 72000, 'la marge restante doit être 72 000 DT');

  // Objectif atteint : pas de dépassement
  assert.equal(overrunAmount(retained, maxCost), 0);
  assert.equal(ratioGapPoints(ratio, objectivePct), -2);

  // Simulateur : mêmes résultats
  const sim = simulateMaterialCost({ revenueHt, consumption, lossesNotIncluded, objectivePct });
  assert.equal(sim.retainedCost, 28000);
  assert.equal(sim.ratioPct, 28);
  assert.equal(sim.maxAllowedCost, 30000);
  assert.equal(sim.marginBeforeOtherCharges, 72000);
  assert.equal(sim.targetReached, true);
  assert.equal(sim.label, 'simulation indicative');
});

test('RÉFÉRENCE — dépassement avec un ratio de 35 %', () => {
  const sim = simulateMaterialCost({
    revenueHt: 100000,
    consumption: 31000,
    lossesNotIncluded: 4000,
    objectivePct: 30,
  });
  assert.equal(sim.retainedCost, 35000);
  assert.equal(sim.ratioPct, 35);
  assert.equal(sim.maxAllowedCost, 30000);
  assert.equal(sim.overrunAmount, 5000, 'dépassement de 5 000 DT');
  assert.equal(sim.gapPoints, 5, 'écart de +5 points');
  assert.equal(sim.marginBeforeOtherCharges, 65000);
  assert.equal(sim.targetReached, false);
});

/* ===========================================================================
 *  RECETTES
 * ========================================================================= */
test('Coût d’une recette = somme des coûts des ingrédients', () => {
  const items = [
    { qty: 0.5, unitCost: 8 },   // 4.000
    { qty: 0.25, unitCost: 12 }, // 3.000
    { qty: 2, unitCost: 1.5 },   // 3.000
  ];
  assert.equal(recipeTotalCost(items), 10);
});

test('Coût par portion et ratio du plat', () => {
  const total = recipeTotalCost([{ qty: 1, unitCost: 9 }]);
  const perPortion = costPerPortion(total, 3);
  assert.equal(perPortion, 3);
  // prix de vente HT par portion 12 DT -> ratio 25 %
  assert.equal(dishCostRatio(perPortion, 12), 25);
  const { margin, marginPct } = dishGrossMargin(perPortion, 12);
  assert.equal(margin, 9);
  assert.equal(marginPct, 75);
});

test('Recette : conversion d’unité g vers kg', () => {
  const cost = recipeTotalCost([
    { qty: 500, unit: 'g', productUnit: 'kg', unitCost: 10 }, // 500 g = 0.5 kg => 5.000
    { qty: 1, unit: 'kg', productUnit: 'kg', unitCost: 4 },    // 4.000
  ]);
  assert.equal(cost, 9);
});

test('Ratio d’un plat : prix nul ne provoque pas de division par zéro', () => {
  assert.equal(dishCostRatio(5, 0), 0);
  assert.equal(costPerPortion(10, 0), 0);
});

/* ===========================================================================
 *  TRANSFORMATION / RENDEMENT — exemple du cahier des charges
 * ========================================================================= */
test('RÉFÉRENCE — rendement 75 % : 10 kg -> 7,5 kg utilisables', () => {
  assert.equal(yieldPct(7.5, 10), 75);
  assert.equal(lossPct(10, 7.5), 25);
  assert.equal(avgPortionWeight(7.5, 5), 1.5);
  // Seuil de perte normale fixé par le chef : 30 % => 25 % reste normal
  assert.equal(classifyLoss(lossPct(10, 7.5), 30), 'normale');
  // Seuil plus strict (20 %) => 25 % devient anormal
  assert.equal(classifyLoss(lossPct(10, 7.5), 20), 'anormale');
});

test('Transformation : coût par portion et coût unitaire final', () => {
  // 10 kg achetés 5 DT/kg = 50 DT, après parage 7,5 kg utilisables
  assert.equal(transformationUnitCost(50, 7.5), 6.667);
  assert.equal(costPerPortion(50, 5), 10);
});

test('Rendement : poids initial nul protégé', () => {
  assert.equal(yieldPct(5, 0), 0);
  assert.equal(lossPct(0, 0), 0);
});

/* ===========================================================================
 *  CONSOMMATION VALORISÉE
 * ========================================================================= */
test('Consommation valorisée = ouverture + achats − retours + ajustements − clôture', () => {
  const c = valuedConsumption({
    openingStock: 10000,
    purchasesReceived: 30000,
    returns: 500,
    adjustments: 200,
    closingStock: 12000,
  });
  // 10000 + 30000 - 500 + 200 - 12000 = 27700
  assert.equal(c, 27700);
});

test('Consommation valorisée : valeurs par défaut à zéro', () => {
  assert.equal(valuedConsumption({}), 0);
});

/* ===========================================================================
 *  ARRONDI MONÉTAIRE (3 décimales — millimes)
 * ========================================================================= */
test('Arrondi monétaire à 3 décimales sans erreur binaire', () => {
  assert.equal(roundMoney(1.0005), 1.001);
  assert.equal(roundMoney(2.6755), 2.676);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(-1.2345), -1.235);
  assert.equal(roundMoney(NaN), 0);
  assert.equal(formatMoney(1234.5), '1\u00a0234,500\u00a0DT');
});

/* ===========================================================================
 *  TVA
 * ========================================================================= */
test('Décomposition TVA 19 %', () => {
  const { ht, tax, ttc } = vatBreakdown(100, 19);
  assert.equal(ht, 100);
  assert.equal(tax, 19);
  assert.equal(ttc, 119);
});

test('Retour TTC -> HT', () => {
  const { ht, tax, ttc } = vatFromTtc(119, 19);
  assert.equal(ht, 100);
  assert.equal(tax, 19);
  assert.equal(ttc, 119);
});

test('Ligne de vente avec remise', () => {
  const l = saleLineTotals(2, 10, 10, 19);
  // 20 HT - 10 % = 18 HT ; TVA 3.42 ; TTC 21.42
  assert.equal(l.subtotalHt, 20);
  assert.equal(l.discount, 2);
  assert.equal(l.ht, 18);
  assert.equal(l.tax, 3.42);
  assert.equal(l.ttc, 21.42);
});

/* ===========================================================================
 *  COÛT MOYEN PONDÉRÉ
 * ========================================================================= */
test('Coût moyen pondéré après entrée', () => {
  // 10 kg à 4 DT puis 10 kg à 6 DT => 5 DT
  assert.equal(weightedAverageCost(10, 4, 10, 6), 5);
  // entrée sur stock vide : le CMP devient le coût d'entrée
  assert.equal(weightedAverageCost(0, 0, 5, 3), 3);
  assert.equal(stockValue(10, 4.5), 45);
});

/* ===========================================================================
 *  UNITÉS
 * ========================================================================= */
test('Conversions d’unités valides et invalides', () => {
  assert.equal(convertQty(1, 'kg', 'g').value, 1000);
  assert.equal(convertQty(500, 'g', 'kg').value, 0.5);
  assert.equal(convertQty(2, 'l', 'ml').value, 2000);
  const bad = convertQty(1, 'kg', 'l');
  assert.ok(bad.error, 'kg -> L doit être refusé');
});

/* ===========================================================================
 *  RÉSULTAT DE GESTION
 * ========================================================================= */
test('Résultat de gestion estimatif ≠ bénéfice net', () => {
  // CA 100 000, coût matière 28 000, autres charges 20 000 => 52 000
  assert.equal(estimatedOperatingResult(100000, 28000, 20000), 52000);
});

/* ===========================================================================
 *  PAIE
 * ========================================================================= */
test('Paie : calcul avec taux paramétrables', () => {
  const p = payrollCompute({
    baseSalary: 1000,
    hoursOvertime: 10,
    hourlyRate: 5,
    overtimeRate: 1.25,
    primes: 50,
    advances: 100,
    cnssEmployeeRate: 9.18,
    cnssEmployerRate: 16.57,
    irppRate: 0,
  });
  // heures sup : 10 * 5 * 1.25 = 62.5
  assert.equal(p.overtimeAmount, 62.5);
  assert.equal(p.gross, 1112.5);
  assert.equal(p.cnssEmployee, 102.128); // 1112.5 * 9.18 %
  assert.equal(p.cnssEmployer, 184.341); // 1112.5 * 16.57 %
  assert.equal(p.net, 910.372);          // 1112.5 - 102.128 - 0 - 100
  assert.equal(p.totalEmployerCost, 1296.841);
});
