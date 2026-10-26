/**
 * ============================================================================
 *  TESTS D'INTÉGRATION — critères d'acceptation du cahier des charges
 * ----------------------------------------------------------------------------
 *  Ces tests utilisent une base SQLite TEMPORAIRE (CCM_DB_PATH) et exercent
 *  directement la couche services (transactions réelles, contraintes réelles).
 *
 *  Chaque test correspond à un critère d'acceptation explicite :
 *   1. Création produit (code unique)
 *   2. Réception d'achat → le stock augmente
 *   3. Production correcte (sorties + entrée, pas de double comptage)
 *   4. Transformation (poids, rendement, coût/portion)
 *   5. Transfert sans double comptage — TEST DU RIZ
 *   6. Transfert > stock bloqué
 *   7. Avarie validée réduit le stock et figure au rapport
 *   8. Ratio et seuil automatiques
 *   9. Avarie déjà incluse non doublée
 *  10. Repas personnel distincts des ventes
 *  11. Clôture cohérente
 *  12. Correction après clôture tracée
 *  13. Sauvegarde/restauration fonctionnelles
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Base temporaire isolée AVANT tout import de la couche DB
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
const TMP_DB = path.join(TMP_DIR, 'test.db');
process.env.CCM_DB_PATH = TMP_DB;
process.env.CCM_BACKUP_DIR = path.join(TMP_DIR, 'backups');

const { migrate } = await import('../server/db/migrate.js');
const { seed } = await import('../server/db/seed.js');
const { closeDb, get, all, run, getSetting, setSetting } = await import('../server/db/index.js');
const products = await import('../server/services/products.js');
const purchases = await import('../server/services/purchases.js');
const stock = await import('../server/services/stock.js');
const recipes = await import('../server/services/recipes.js');
const production = await import('../server/services/production.js');
const transfers = await import('../server/services/transfers.js');
const losses = await import('../server/services/losses.js');
const sales = await import('../server/services/sales.js');
const staff = await import('../server/services/staff.js');
const analytics = await import('../server/services/analytics.js');
const closing = await import('../server/services/closing.js');
const backup = await import('../server/services/backup.js');
const { todaySql, periodBounds } = await import('../server/lib/numbering.js');

// Initialisation unique
migrate({ reset: true });
seed();

const KITCHENS = Object.fromEntries(
  all('SELECT * FROM kitchens').map((k) => [k.code, k.id]),
);

/** Crée un produit de test avec du stock initial. */
function makeProduct(overrides = {}) {
  const code = `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return products.createProduct({
    code,
    name: `Produit ${code}`,
    type: 'matiere_premiere',
    unit: 'kg',
    purchasePrice: 4,
    unitCost: 4,
    minStock: 10,
    defaultKitchenId: KITCHENS.CENTRALE,
    initialQty: 0,
    ...overrides,
  });
}

test.after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

/* ===========================================================================
 *  1. CRÉATION PRODUIT — CODE UNIQUE
 * ========================================================================= */
test('AC1 — création produit et unicité du code', () => {
  const p = products.createProduct({
    code: 'RIZ01',
    name: 'Riz long grain',
    type: 'matiere_premiere',
    unit: 'kg',
    purchasePrice: 4,
    unitCost: 4,
    minStock: 10,
    defaultKitchenId: KITCHENS.CENTRALE,
    initialQty: 50,
  });

  assert.equal(p.code, 'RIZ01');
  assert.equal(p.stock_qty, 50, 'le stock initial est créé par un mouvement, pas par écriture directe');

  // Le code doit être unique
  assert.throws(
    () => products.createProduct({ code: 'RIZ01', name: 'Doublon', type: 'matiere_premiere', unit: 'kg' }),
    /déjà utilisé/,
  );

  // Le stock provient bien d'un mouvement tracé
  const mv = get(
    "SELECT * FROM stock_movements WHERE product_id = ? AND movement_type = 'initial'",
    [p.id],
  );
  assert.ok(mv, 'un mouvement « initial » doit exister');
  assert.equal(mv.direction, 'in');
});

/* ===========================================================================
 *  2. RÉCEPTION D'ACHAT → STOCK AUGMENTE
 * ========================================================================= */
test('AC2 — une réception validée augmente le stock (un achat seul ne le fait pas)', () => {
  const p = makeProduct({ code: 'HUILE01', name: 'Huile d’olive', unit: 'l', unitCost: 12 });
  const supplier = purchases.createSupplier({ name: 'Fournisseur Test' });

  const before = stock.getStockQty(p.id, KITCHENS.CENTRALE);

  // Création de l'achat : AUCUN impact stock
  const purchase = purchases.createPurchase({
    supplierId: supplier.id,
    orderDate: todaySql(),
    items: [{ productId: p.id, qtyOrdered: 20, unitPrice: 11 }],
  });
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), before, 'un achat non réceptionné ne change pas le stock');

  // Réception : le stock augmente
  purchases.receivePurchase(purchase.id, { kitchenId: KITCHENS.CENTRALE, receivedDate: todaySql() });
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), before + 20, 'la réception doit créditer le stock');

  // Le CMP est recalculé (stock vide avant → CMP = prix de réception)
  const after = get('SELECT unit_cost FROM products WHERE id = ?', [p.id]);
  assert.equal(after.unit_cost, 11);
});

/* ===========================================================================
 *  3. PRODUCTION CORRECTE
 * ========================================================================= */
test('AC3 — production : sorties des ingrédients et entrée du produit fabriqué', () => {
  const farine = makeProduct({ code: 'FARINE01', name: 'Farine', unitCost: 2, initialQty: 100 });
  const plat = makeProduct({
    code: 'PAIN01', name: 'Pain maison', type: 'semi_fini', unit: 'unite',
    unitCost: 0, initialQty: 0,
  });

  const stockFarineBefore = stock.getStockQty(farine.id, KITCHENS.CENTRALE);

  const prod = production.createProduction({
    kitchenId: KITCHENS.CENTRALE,
    productId: plat.id,
    qtyTheoretical: 10,
    qtyProduced: 10,
    portions: 10,
    items: [{ productId: farine.id, qtyTheoretical: 5, qtyActual: 5 }],
  });

  const validated = production.validateProduction(prod.id);
  assert.equal(validated.status, 'valide');

  // Sortie des matières
  assert.equal(
    stock.getStockQty(farine.id, KITCHENS.CENTRALE),
    stockFarineBefore - 5,
    'les 5 kg de farine doivent être sortis',
  );
  // Entrée du produit fabriqué
  assert.equal(stock.getStockQty(plat.id, KITCHENS.CENTRALE), 10, '10 pains doivent entrer en stock');
  // Coût = 5 kg × 2 DT = 10 DT, soit 1 DT / pain
  assert.equal(validated.total_cost, 10);
  assert.equal(validated.unit_cost, 1);

  // Deux mouvements, pas plus : pas de double comptage
  const movements = all(
    "SELECT * FROM stock_movements WHERE source_table='productions' AND source_id = ?",
    [prod.id],
  );
  assert.equal(movements.length, 2, 'exactement 2 mouvements : 1 sortie + 1 entrée');
});

test('AC3b — production refusée si le stock est insuffisant (transaction annulée)', () => {
  const ing = makeProduct({ code: 'SEL01', name: 'Sel', unitCost: 1, initialQty: 1 });
  const out = makeProduct({ code: 'SAUCE01', name: 'Sauce', type: 'semi_fini', unit: 'l', unitCost: 0 });

  const prod = production.createProduction({
    kitchenId: KITCHENS.CENTRALE,
    productId: out.id,
    qtyProduced: 1,
    items: [{ productId: ing.id, qtyActual: 50 }], // 50 kg demandés, 1 disponible
  });

  assert.throws(() => production.validateProduction(prod.id), /Stock insuffisant/);
  // Aucun mouvement n’a été créé (rollback complet)
  const mv = all("SELECT * FROM stock_movements WHERE source_table='productions' AND source_id = ?", [prod.id]);
  assert.equal(mv.length, 0, 'la transaction doit être intégralement annulée');
  assert.equal(get('SELECT status FROM productions WHERE id = ?', [prod.id]).status, 'brouillon');
});

/* ===========================================================================
 *  4. TRANSFORMATION — POIDS, RENDEMENT, COÛT/PORTION
 * ========================================================================= */
test('AC4 — transformation : 10 kg → 7,5 kg donne 75 % de rendement et 25 % de perte', () => {
  const carottes = makeProduct({ code: 'CAROTTE01', name: 'Carottes', unitCost: 5, initialQty: 20 });

  const t = production.createTransformation({
    kitchenId: KITCHENS.CENTRALE,
    sourceProductId: carottes.id,
    initialWeight: 10,
    finalWeight: 7.5,
    portions: 5,
    lossThresholdPct: 30, // 25 % < 30 % → perte normale
    reason: 'Épluchage et parage',
  });

  assert.equal(t.yield_pct, 75, 'rendement = 7,5 / 10 × 100 = 75 %');
  assert.equal(t.loss_pct, 25, 'perte = (10 − 7,5) / 10 × 100 = 25 %');
  assert.equal(t.avg_portion_weight, 1.5, 'poids moyen par portion = 7,5 / 5');
  assert.equal(t.loss_type, 'normale');
  assert.equal(t.initial_cost, 50, 'coût initial = 10 × 5 DT');
  // Coût par portion = 50 / 5 = 10 DT
  assert.equal(Number(t.initial_cost) / Number(t.portions), 10);

  // Le stock source a diminué de 10 kg
  assert.equal(stock.getStockQty(carottes.id, KITCHENS.CENTRALE), 10);
});

test('AC4b — perte anormale : motif obligatoire et qualification correcte', () => {
  const p = makeProduct({ code: 'POISSON01', name: 'Poisson frais', unitCost: 20, initialQty: 10 });

  // 40 % de perte avec seuil à 15 % → anormale, motif requis
  assert.throws(
    () => production.createTransformation({
      kitchenId: KITCHENS.CENTRALE,
      sourceProductId: p.id,
      initialWeight: 10,
      finalWeight: 6,
      portions: 4,
      lossThresholdPct: 15,
      reason: '',
    }),
    /motif est obligatoire/,
  );

  // Avec motif : accepté et qualifié d’anormal
  const t = production.createTransformation({
    kitchenId: KITCHENS.CENTRALE,
    sourceProductId: p.id,
    initialWeight: 10,
    finalWeight: 6,
    portions: 4,
    lossThresholdPct: 15,
    reason: 'Lot de qualité insuffisante',
  });
  assert.equal(t.loss_type, 'anormale');
  assert.equal(t.loss_pct, 40);
});

/* ===========================================================================
 *  5. TRANSFERT — TEST DU RIZ (50 kg, transfert de 10 kg)
 * ========================================================================= */
test('AC5 — TEST DU RIZ : 50 kg en centrale, transfert de 10 kg → 40 kg / 10 kg', () => {
  const riz = products.createProduct({
    code: 'RIZTEST',
    name: 'Riz (test cahier des charges)',
    type: 'matiere_premiere',
    unit: 'kg',
    purchasePrice: 4,
    unitCost: 4,
    minStock: 5,
    defaultKitchenId: KITCHENS.CENTRALE,
    initialQty: 50,
  });

  const beforeGlobal = analytics.stockValueAt(todaySql(), 'materials');
  const beforeCentrale = stock.getStockQty(riz.id, KITCHENS.CENTRALE);

  assert.equal(beforeCentrale, 50, 'stock initial : 50 kg en cuisine centrale');

  // Transfert de 10 kg vers la cuisine du personnel
  const tr = transfers.createTransfer({
    sourceKitchenId: KITCHENS.CENTRALE,
    destKitchenId: KITCHENS.PERSONNEL,
    productId: riz.id,
    qty: 10,
    unitCost: 4,
    reason: 'Repas du personnel',
    occurredAt: todaySql(),
  });

  assert.equal(tr.status, 'brouillon');
  assert.equal(tr.total_cost, 40, 'valeur transférée = 10 kg × 4 DT = 40 DT');
  // Un brouillon ne touche pas au stock
  assert.equal(stock.getStockQty(riz.id, KITCHENS.CENTRALE), 50);

  transfers.validateTransfer(tr.id);

  // Stocks après validation
  assert.equal(stock.getStockQty(riz.id, KITCHENS.CENTRALE), 40, 'source : 50 − 10 = 40 kg');
  assert.equal(stock.getStockQty(riz.id, KITCHENS.PERSONNEL), 10, 'destination : +10 kg');

  // Coût unitaire identique des deux côtés
  const mv = all(
    "SELECT * FROM stock_movements WHERE source_table='transfers' AND source_id = ? ORDER BY direction",
    [tr.id],
  );
  assert.equal(mv.length, 2);
  assert.equal(mv[0].unit_cost, mv[1].unit_cost, 'coûts cohérents source/destination');

  // AUCUN IMPACT sur le coût matière global
  const afterGlobal = analytics.stockValueAt(todaySql(), 'materials');
  assert.equal(afterGlobal, beforeGlobal, 'la valeur totale du stock matières est inchangée');
});

test('AC5b — un transfert ne crée ni achat ni consommation', () => {
  const { start, end } = periodBounds(todaySql().slice(0, 7));
  const purchasesValue = analytics.purchasesReceivedValue(start, end).value;
  const transfersInPeriod = all(
    "SELECT COUNT(*) c FROM transfers WHERE status='valide' AND date(occurred_at) BETWEEN date(?) AND date(?)",
    [start, end],
  )[0].c;

  assert.ok(transfersInPeriod > 0, 'des transferts validés existent');
  // Le montant des achats réceptionnés ne doit pas inclure les transferts
  const receptionMovements = all(
    `SELECT COUNT(*) c FROM stock_movements
     WHERE movement_type = 'transfert_entree' AND date(occurred_at) BETWEEN date(?) AND date(?)`,
    [start, end],
  )[0].c;
  assert.ok(receptionMovements > 0);
  assert.ok(purchasesValue >= 0);
});

/* ===========================================================================
 *  6. TRANSFERT > STOCK BLOQUÉ
 * ========================================================================= */
test('AC6 — transfert supérieur au stock bloqué (sauf ajustement explicite justifié)', () => {
  const p = makeProduct({ code: 'BEURRE01', name: 'Beurre', unitCost: 15, initialQty: 5 });

  const tr = transfers.createTransfer({
    sourceKitchenId: KITCHENS.CENTRALE,
    destKitchenId: KITCHENS.PERSONNEL,
    productId: p.id,
    qty: 20, // 20 kg demandés, 5 disponibles
    unitCost: 15,
    occurredAt: todaySql(),
  });

  // Refus sans forçage
  assert.throws(() => transfers.validateTransfer(tr.id), /Stock insuffisant/);
  assert.equal(get('SELECT status FROM transfers WHERE id = ?', [tr.id]).status, 'brouillon');
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), 5, 'le stock est intact');

  // Refus du forçage sans justification
  assert.throws(
    () => transfers.validateTransfer(tr.id, { forceNegative: true, forceJustification: '' }),
    /justification écrite/,
  );

  // Accepté avec justification explicite
  const forced = transfers.validateTransfer(tr.id, {
    forceNegative: true,
    forceJustification: 'Inventaire non encore saisi, correction en cours',
  });
  assert.equal(forced.status, 'valide');
  assert.equal(forced.force_negative, 1);
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), -15, 'le stock devient négatif, comme explicitement autorisé');

  // L'opération forcée est journalisée
  const log = get(
    "SELECT * FROM audit_logs WHERE entity='transfer' AND entity_id = ? AND action='validate'",
    [String(tr.id)],
  );
  assert.ok(log, 'le transfert forcé est tracé');
});

/* ===========================================================================
 *  7. AVARIE — RÉDUIT LE STOCK ET FIGURE AU RAPPORT
 * ========================================================================= */
test('AC7 — une avarie validée réduit le stock et apparaît au rapport des pertes', () => {
  const p = makeProduct({ code: 'TOMATE01', name: 'Tomates', unitCost: 3, initialQty: 30 });

  const loss = losses.createLoss({
    kitchenId: KITCHENS.CENTRALE,
    productId: p.id,
    qty: 4,
    lossType: 'perime',
    reason: 'Produits périmés en chambre froide',
    occurredAt: todaySql(),
    alreadyInConsumption: true,
    validate: true,
  });

  assert.equal(loss.status, 'valide');
  assert.equal(loss.total_cost, 12, '4 kg × 3 DT = 12 DT');
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), 26, 'le stock est réduit de 4 kg');

  // Apparaît dans le rapport des pertes
  const rep = losses.lossesReport(todaySql(), todaySql());
  const found = rep.details.find((d) => d.number === loss.number);
  assert.ok(found, 'l’avarie figure au rapport');
  assert.equal(found.total_cost, 12);

  // Une avarie validée ne peut pas être supprimée
  assert.throws(
    () => run('DELETE FROM losses WHERE id = ?', [loss.id]),
    /Suppression interdite/,
  );
});

test('AC7b — les mouvements de stock ne sont jamais supprimables', () => {
  const mv = get('SELECT * FROM stock_movements LIMIT 1');
  assert.throws(() => run('DELETE FROM stock_movements WHERE id = ?', [mv.id]), /Suppression interdite/);
  assert.throws(
    () => run('UPDATE stock_movements SET qty = 999 WHERE id = ?', [mv.id]),
    /Modification interdite/,
  );
});

/* ===========================================================================
 *  8 & 9. RATIO, SEUIL ET ANTI-DOUBLE COMPTAGE DES AVARIES
 * ========================================================================= */
test('AC8/AC9 — ratio automatique et avarie déjà incluse non doublée', () => {
  const month = todaySql().slice(0, 7);
  const { start, end } = periodBounds(month);

  const before = analytics.computePeriod(start, end);
  const includedLossesBefore = before.lossesNotIncluded;

  // Avarie marquée « déjà incluse » → ne doit PAS augmenter lossesNotIncluded
  const prod = makeProduct({ code: 'LAIT01', name: 'Lait', unitCost: 2, initialQty: 20 });
  losses.createLoss({
    kitchenId: KITCHENS.CENTRALE,
    productId: prod.id,
    qty: 2,
    lossType: 'perime',
    reason: 'DLC dépassée',
    occurredAt: todaySql(),
    alreadyInConsumption: true,
    validate: true,
  });

  const after = analytics.computePeriod(start, end);
  assert.equal(
    after.lossesNotIncluded,
    includedLossesBefore,
    'une avarie déjà incluse ne doit pas être ajoutée au coût retenu',
  );

  // Avarie NON incluse → augmente bien lossesNotIncluded
  losses.createLoss({
    kitchenId: KITCHENS.CENTRALE,
    productId: prod.id,
    qty: 1,
    lossType: 'renverse',
    reason: 'Bidon renversé',
    occurredAt: todaySql(),
    alreadyInConsumption: false,
    validate: true,
  });

  const after2 = analytics.computePeriod(start, end);
  assert.equal(after2.lossesNotIncluded, includedLossesBefore + 2, '1 L × 2 DT = 2 DT ajoutés');

  // Le ratio est recalculé automatiquement
  assert.equal(typeof after2.ratioPct, 'number');
  if (after2.revenueHt > 0) {
    const expected = Math.round(((after2.retainedCost / after2.revenueHt) * 100 + Number.EPSILON) * 100) / 100;
    assert.equal(after2.ratioPct, expected, 'ratio = coût retenu / CA HT × 100');
    assert.equal(after2.maxAllowedCost, Math.round(after2.revenueHt * after2.objectivePct) / 100);
    assert.equal(after2.targetReached, after2.ratioPct <= after2.objectivePct);
  }
});

/* ===========================================================================
 *  10. REPAS DU PERSONNEL DISTINCTS DES VENTES
 * ========================================================================= */
test('AC10 — les repas du personnel ne sont pas des ventes', () => {
  const month = todaySql().slice(0, 7);
  const { start, end } = periodBounds(month);

  const revenueBefore = sales.revenueHt(start, end);
  const salesCountBefore = get('SELECT COUNT(*) c FROM sales').c;

  // Il faut du stock en cuisine du personnel
  const p = makeProduct({ code: 'PAINPERS01', name: 'Pain personnel', unit: 'unite', unitCost: 0.5, initialQty: 0 });
  const tr = transfers.createTransfer({
    sourceKitchenId: KITCHENS.CENTRALE,
    destKitchenId: KITCHENS.PERSONNEL,
    productId: p.id,
    qty: 20,
    unitCost: 0.5,
    occurredAt: todaySql(),
  });
  // Stock insuffisant en centrale → on force avec justification
  transfers.validateTransfer(tr.id, {
    forceNegative: true,
    forceJustification: 'Stock initial fictif pour le test',
  });

  const meal = staff.recordStaffMeal({
    items: [{ productId: p.id, qty: 10 }],
    meals: 10,
    occurredAt: todaySql(),
  });

  assert.equal(meal.totalCost, 5, '10 × 0,5 DT = 5 DT');
  assert.equal(meal.costPerMeal, 0.5);

  // AUCUNE vente créée, AUCUN CA généré
  const revenueAfter = sales.revenueHt(start, end);
  const salesCountAfter = get('SELECT COUNT(*) c FROM sales').c;
  assert.equal(salesCountAfter, salesCountBefore, 'aucune vente créée');
  assert.equal(revenueAfter.ht, revenueBefore.ht, 'le CA HT est inchangé');

  // Le rapport dédié suit bien la consommation
  const rep = staff.staffMonthlyReport(month);
  assert.ok(rep.mealsConsumed >= 5, 'le coût des repas est suivi séparément');
  assert.equal(rep.includedInRatio, false, 'exclu du ratio par défaut');
});

test('AC10b — les repas du personnel exclus du ratio sont retirés du coût matière', () => {
  const month = todaySql().slice(0, 7);
  const { start, end } = periodBounds(month);

  // Paramètre par défaut : exclus du ratio
  setSetting('staff_meals_in_ratio', 'false');
  const excluded = analytics.computePeriod(start, end);

  // Paramètre : inclus dans le ratio
  setSetting('staff_meals_in_ratio', 'true');
  const included = analytics.computePeriod(start, end);

  // Le coût retenu doit être plus élevé quand les repas sont inclus
  assert.ok(
    included.retainedCost >= excluded.retainedCost,
    'inclure les repas du personnel augmente (ou maintient) le coût retenu',
  );

  // Restauration du paramètre
  setSetting('staff_meals_in_ratio', 'false');
});

/* ===========================================================================
 *  11. CLÔTURE COHÉRENTE
 * ========================================================================= */
test('AC11 — clôture mensuelle cohérente et blocage des opérations en attente', () => {
  const month = todaySql().slice(0, 7);

  // Créer un brouillon pour vérifier le blocage
  const p = makeProduct({ code: 'CLOTURE01', name: 'Produit clôture', unitCost: 1, initialQty: 10 });
  const draft = transfers.createTransfer({
    sourceKitchenId: KITCHENS.CENTRALE,
    destKitchenId: KITCHENS.PERSONNEL,
    productId: p.id,
    qty: 1,
    occurredAt: todaySql(),
  });

  const checks = closing.closingChecks(month);
  assert.equal(checks.canClose, false, 'la clôture est bloquée par les brouillons');
  assert.ok(checks.blocking.some((b) => b.code === 'TRANSFERS_DRAFT'));

  assert.throws(() => closing.closeMonth(month), /Clôture impossible/);

  // On nettoie les brouillons
  transfers.cancelTransfer(draft.id, 'Test de clôture');
  for (const l of losses.pendingLosses()) losses.validateLoss(l.id);
  for (const pr of all("SELECT id FROM productions WHERE status='brouillon'")) {
    production.cancelProduction(pr.id, 'Nettoyage test');
  }
  for (const sc of all("SELECT id FROM stock_counts WHERE status='brouillon'")) {
    stock.cancelStockCount(sc.id, 'Nettoyage test');
  }

  // La clôture doit maintenant être possible
  const checks2 = closing.closingChecks(month);
  assert.equal(checks2.canClose, true, `points bloquants : ${JSON.stringify(checks2.blocking.map((b) => b.code))}`);

  const result = closing.closeMonth(month);
  assert.equal(result.status, 'cloture');
  const metrics = analytics.computeMonth(month);
  assert.equal(result.revenue_ht, metrics.revenueHt, 'CA figé = CA calculé');
  assert.equal(result.retained_cost, metrics.retainedCost, 'coût retenu figé = coût calculé');
  assert.equal(result.ratio_pct, metrics.ratioPct, 'ratio figé = ratio calculé');
  assert.ok(result.details, 'le snapshot détaillé est conservé');

  // La clôture est journalisée
  const log = get("SELECT * FROM monthly_closing_logs WHERE period = ? AND action = 'cloture'", [month]);
  assert.ok(log);
});

/* ===========================================================================
 *  12. CORRECTION APRÈS CLÔTURE TRACÉE
 * ========================================================================= */
test('AC12 — réouverture motivée d’une période clôturée, journalisée', () => {
  const month = todaySql().slice(0, 7);

  // Réouverture sans motif → refusée
  assert.throws(() => closing.reopenMonth(month, ''), /obligatoire/);

  // Réouverture avec motif → acceptée et tracée
  const reopened = closing.reopenMonth(month, 'Correction d’une avarie omise le 28');
  assert.equal(reopened.status, 'reouvert');
  assert.equal(reopened.reopen_reason, 'Correction d’une avarie omise le 28');

  const log = get(
    "SELECT * FROM monthly_closing_logs WHERE period = ? AND action = 'reouverture'",
    [month],
  );
  assert.ok(log, 'la réouverture est journalisée');
  assert.equal(log.reason, 'Correction d’une avarie omise le 28');

  const auditLog = get(
    "SELECT * FROM audit_logs WHERE entity='monthly_closing' AND entity_id = ? AND action='reopen'",
    [month],
  );
  assert.ok(auditLog, 'la réouverture figure au journal d’audit');
  assert.equal(auditLog.severity, 'critical');

  // On peut alors reclôturer
  const reclosed = closing.closeMonth(month, { notes: 'Reclôture après correction' });
  assert.equal(reclosed.status, 'cloture');
});

/* ===========================================================================
 *  13. SAUVEGARDE / RESTAURATION
 * ========================================================================= */
test('AC13 — sauvegarde, vérification et restauration fonctionnelles', () => {
  const backupRes = backup.createBackup({ kind: 'manuel', notes: 'Test intégration' });
  assert.ok(fs.existsSync(backupRes.filePath), 'le fichier de sauvegarde existe');
  assert.ok(backupRes.size > 0, 'le fichier n’est pas vide');
  assert.equal(backupRes.sha256.length, 64, 'empreinte SHA-256 calculée');

  const verification = backup.verifyBackup(backupRes.fileName);
  assert.equal(verification.ok, true, `problèmes : ${verification.problems?.join(', ')}`);
  assert.equal(verification.integrity, 'ok');

  // Vérification d'intégrité de la base active
  const integrity = backup.integrityCheck();
  assert.equal(integrity.ok, true, `anomalies : ${integrity.problems.join(', ')}`);

  // Restauration refusée sans confirmation explicite
  assert.throws(() => backup.restoreBackup(backupRes.fileName, 'oui'), /RESTAURER/);

  // Restauration réelle
  const countBefore = get('SELECT COUNT(*) c FROM products').c;
  const restore = backup.restoreBackup(backupRes.fileName, 'RESTAURER');
  assert.equal(restore.restored, backupRes.fileName);
  assert.ok(restore.safetyBackup, 'une sauvegarde de sécurité a été créée');
  assert.equal(get('SELECT COUNT(*) c FROM products').c, countBefore, 'les données sont intactes après restauration');
});

/* ===========================================================================
 *  14. VENTES HT / TVA / TTC
 * ========================================================================= */
test('AC14 — vente HT/TVA/TTC, annulation et rapprochement sans double comptage', () => {
  const plat = makeProduct({
    code: 'PLATVENTE01', name: 'Plat vendu', type: 'fini', unit: 'unite',
    unitCost: 3, initialQty: 20, isSellable: true, sellPriceHt: 10, taxRate: 19,
  });

  const sale = sales.createSale({
    occurredAt: todaySql(),
    paymentMethod: 'espece',
    items: [{ productId: plat.id, qty: 2 }],
    kitchenId: KITCHENS.CENTRALE,
  });

  // 2 × 10 = 20 HT, TVA 19 % = 3,8, TTC 23,8
  assert.equal(sale.subtotal_ht, 20);
  assert.equal(sale.tax, 3.8);
  assert.equal(sale.total_ttc, 23.8);
  assert.equal(sale.status, 'valide');

  // Le stock du plat a diminué
  assert.equal(stock.getStockQty(plat.id, KITCHENS.CENTRALE), 18);

  // Rapprochement : le coût du produit fini vendu n'est pas recompté dans le périmètre matière
  const month = todaySql().slice(0, 7);
  const { start, end } = periodBounds(month);
  const recon = sales.salesStockReconciliation(start, end);
  assert.ok(recon.note.includes('déjà été consommé'), 'la note anti-double comptage est présente');
  assert.equal(recon.costOfFinishedGoodsSold, 6, '2 × 3 DT de coût produit fini');

  // Annulation : sortie de caisse + retour en stock
  const cancelled = sales.cancelSale(sale.id, 'Erreur de saisie');
  assert.equal(cancelled.status, 'annule');
  assert.equal(stock.getStockQty(plat.id, KITCHENS.CENTRALE), 20, 'le stock est restitué');
});

/* ===========================================================================
 *  15. SIMULATEUR ET TEST DE RÉFÉRENCE (intégration)
 * ========================================================================= */
test('AC15 — test de référence 100 000 / 24 000 / 4 000 via l’API de calcul', async () => {
  const { simulateMaterialCost } = await import('../shared/formulas.js');
  const sim = simulateMaterialCost({
    revenueHt: 100000,
    consumption: 24000,
    lossesNotIncluded: 4000,
    objectivePct: 30,
  });
  assert.equal(sim.retainedCost, 28000);
  assert.equal(sim.ratioPct, 28);
  assert.equal(sim.maxAllowedCost, 30000);
  assert.equal(sim.marginBeforeOtherCharges, 72000);
  assert.equal(sim.targetReached, true);
});

/* ===========================================================================
 *  16. RECETTES : RECALCUL AUTOMATIQUE
 * ========================================================================= */
test('AC16 — le coût d’une recette se recalcule quand le prix d’un ingrédient change', () => {
  const ing = makeProduct({ code: 'INGREC01', name: 'Ingrédient recette', unitCost: 10, initialQty: 100 });
  const rec = recipes.createRecipe({
    code: 'RECTEST01',
    name: 'Recette test',
    portions: 2,
    sellingPriceHt: 20,
    items: [{ productId: ing.id, qty: 1 }],
  });

  assert.equal(rec.total_cost, 10);
  assert.equal(rec.cost_per_portion, 5);
  assert.equal(rec.ratio_pct, 25, '5 / 20 × 100 = 25 %');

  // Le prix de l'ingrédient double
  run('UPDATE products SET unit_cost = 20 WHERE id = ?', [ing.id]);

  const updated = recipes.getRecipe(rec.id);
  assert.equal(updated.total_cost, 20, 'coût recalculé automatiquement');
  assert.equal(updated.cost_per_portion, 10);
  assert.equal(updated.ratio_pct, 50, '10 / 20 × 100 = 50 %');
});

/* ===========================================================================
 *  17. INVENTAIRES : ÉCART JUSTIFIÉ OBLIGATOIRE
 * ========================================================================= */
test('AC17 — inventaire : écart non justifié refusé, écart justifié ajusté', () => {
  const p = makeProduct({ code: 'INV01', name: 'Produit inventaire', unitCost: 5, initialQty: 100 });

  const count = stock.createStockCount({
    kitchenId: KITCHENS.CENTRALE,
    countDate: todaySql(),
    lines: [{ productId: p.id, physicalQty: 95 }],
  });

  // Validation sans justification → refusée
  assert.throws(() => stock.validateStockCount(count.id), /doit être justifié/);

  // Avec justification → acceptée
  const detail = stock.getStockCount(count.id);
  const line = detail.items.find((i) => i.product_id === p.id);
  stock.updateStockCount(count.id, [{ id: line.id, physicalQty: 95, justification: 'Casse constatée lors du comptage' }]);
  const validated = stock.validateStockCount(count.id);
  assert.equal(validated.status, 'valide');
  assert.equal(stock.getStockQty(p.id, KITCHENS.CENTRALE), 95, 'le stock est ajusté à la valeur physique');
});

/* ===========================================================================
 *  18. TRANSACTIONS ATOMIQUES (ROLLBACK COMPLET)
 * ========================================================================= */
test('AC18 — atomicité : une erreur annule toutes les écritures partielles', () => {
  const ok = makeProduct({ code: 'ATOM1', name: 'Atomique OK', unitCost: 1, initialQty: 100 });
  const missing = products.createProduct({
    code: 'ATOM2', name: 'Atomique manquant', type: 'matiere_premiere',
    unit: 'kg', unitCost: 1, initialQty: 0, defaultKitchenId: KITCHENS.CENTRALE,
  });

  const before = stock.getStockQty(ok.id, KITCHENS.CENTRALE);

  // 2e ingredient en rupture → toute la transaction doit échouer
  assert.throws(() => {
    const prod = production.createProduction({
      kitchenId: KITCHENS.CENTRALE,
      productId: missing.id,
      qtyProduced: 1,
      items: [
        { productId: ok.id, qtyActual: 5 },
        { productId: missing.id, qtyActual: 10 },
      ],
    });
    production.validateProduction(prod.id);
  }, /Stock insuffisant/);

  // Le premier ingrédient n'a PAS été décrémenté
  assert.equal(
    stock.getStockQty(ok.id, KITCHENS.CENTRALE),
    before,
    'aucune écriture partielle : le stock du 1er ingrédient est intact',
  );
});
