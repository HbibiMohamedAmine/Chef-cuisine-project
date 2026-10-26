/**
 * ============================================================================
 *  API REST — Chef Cuisine Manager
 * ----------------------------------------------------------------------------
 *  Toutes les routes sont préfixées par /api. Authentification par session
 *  cookie (sauf /api/auth/login et /api/health).
 * ============================================================================
 */
import { Router } from 'express';
import { asyncH, idParam } from '../lib/http.js';
import { unauthorized, badRequest } from '../lib/errors.js';
import { SESSION_COOKIE, login, logout, validateSession, changePassword, isDefaultPassword } from '../services/auth.js';
import * as settingsSvc from '../services/settings.js';
import * as productsSvc from '../services/products.js';
import * as purchasesSvc from '../services/purchases.js';
import * as stockSvc from '../services/stock.js';
import * as recipesSvc from '../services/recipes.js';
import * as productionSvc from '../services/production.js';
import * as transfersSvc from '../services/transfers.js';
import * as lossesSvc from '../services/losses.js';
import * as salesSvc from '../services/sales.js';
import * as cashSvc from '../services/cash.js';
import * as hrSvc from '../services/hr.js';
import * as staffSvc from '../services/staff.js';
import * as analytics from '../services/analytics.js';
import * as closingSvc from '../services/closing.js';
import * as backupSvc from '../services/backup.js';
import { listAudit } from '../lib/audit.js';
import * as reports from '../services/reports.js';
import { simulateMaterialCost } from '../../shared/formulas.js';

const router = Router();

/* ---------------------------------------------------------------------------
 *  Authentification
 * ------------------------------------------------------------------------- */

router.post('/auth/login', asyncH(async (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const result = login(String(username || '').trim(), String(password || ''), ip);
  res.cookie(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 3600 * 1000,
  });
  res.json({
    success: true,
    username: result.username,
    expiresAt: result.expiresAt,
    defaultPassword: isDefaultPassword(),
  });
}));

router.post('/auth/logout', asyncH(async (req, res) => {
  logout(req.cookies?.[SESSION_COOKIE], req.ip);
  res.clearCookie(SESSION_COOKIE);
  res.json({ success: true });
}));

router.get('/auth/session', asyncH(async (req, res) => {
  const session = validateSession(req.cookies?.[SESSION_COOKIE]);
  if (!session.valid) {
    return res.status(401).json({ authenticated: false, defaultPassword: isDefaultPassword() });
  }
  res.json({
    authenticated: true,
    username: session.username,
    defaultPassword: isDefaultPassword(),
  });
}));

router.post('/auth/password', asyncH(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  changePassword(oldPassword, newPassword, req.ip);
  res.json({ success: true, message: 'Mot de passe modifié. Reconnectez-vous.' });
}));

/* ---------------------------------------------------------------------------
 *  Garde d'authentification (tout le reste de l'API)
 * ------------------------------------------------------------------------- */
router.use((req, res, next) => {
  const session = validateSession(req.cookies?.[SESSION_COOKIE]);
  if (!session.valid) {
    return next(unauthorized('Session expirée ou inexistante. Reconnectez-vous.'));
  }
  req.user = session.username;
  next();
});

/* ---------------------------------------------------------------------------
 *  Santé / paramètres / référentiels
 * ------------------------------------------------------------------------- */

router.get('/health', (req, res) => {
  res.json({ ok: true, date: new Date().toISOString(), app: 'Chef Cuisine Manager' });
});

router.get('/settings', asyncH(async (req, res) => {
  res.json({
    settings: settingsSvc.getPublicSettings(),
    editable: settingsSvc.EDITABLE_SETTINGS,
    vatRates: settingsSvc.getVatRates(),
  });
}));

router.put('/settings', asyncH(async (req, res) => {
  res.json({ settings: settingsSvc.updateSettings(req.body || {}, req.ip) });
}));

router.get('/referentials', asyncH(async (req, res) => {
  res.json({
    kitchens: settingsSvc.listKitchens(),
    units: settingsSvc.listUnits(),
    categories: settingsSvc.listCategories(),
    lossTypes: settingsSvc.listLossTypes(),
    productTypes: productsSvc.PRODUCT_TYPES,
    expenseCategories: cashSvc.EXPENSE_CATEGORIES,
    paymentMethods: cashSvc.PAYMENT_METHODS,
    vatRates: settingsSvc.getVatRates(),
  });
}));

router.post('/categories', asyncH(async (req, res) => {
  res.json(settingsSvc.createCategory(req.body?.name));
}));
router.put('/categories/:id', asyncH(async (req, res) => {
  res.json(settingsSvc.updateCategory(idParam(req), req.body || {}));
}));
router.post('/loss-types', asyncH(async (req, res) => {
  res.json(settingsSvc.createLossType(req.body?.label));
}));

/* ---------------------------------------------------------------------------
 *  Produits
 * ------------------------------------------------------------------------- */

router.get('/products', asyncH(async (req, res) => {
  res.json(productsSvc.listProducts({
    search: req.query.search || null,
    type: req.query.type || null,
    categoryId: req.query.categoryId ? Number(req.query.categoryId) : null,
    includeDeleted: req.query.includeDeleted === '1',
  }));
}));

router.get('/products/:id', asyncH(async (req, res) => {
  res.json({
    ...productsSvc.getProduct(idParam(req)),
    usage: productsSvc.productUsage(idParam(req)),
  });
}));

router.post('/products', asyncH(async (req, res) => {
  res.status(201).json(productsSvc.createProduct(req.body || {}, req.ip));
}));

router.put('/products/:id', asyncH(async (req, res) => {
  res.json(productsSvc.updateProduct(idParam(req), req.body || {}, req.ip));
}));

router.delete('/products/:id', asyncH(async (req, res) => {
  res.json(productsSvc.archiveProduct(idParam(req), req.body?.reason || null, req.ip));
}));

router.post('/products/:id/restore', asyncH(async (req, res) => {
  res.json(productsSvc.restoreProduct(idParam(req), req.ip));
}));

/* ---------------------------------------------------------------------------
 *  Fournisseurs
 * ------------------------------------------------------------------------- */

router.get('/suppliers', asyncH(async (req, res) => {
  res.json(purchasesSvc.listSuppliers({
    search: req.query.search || null,
    includeArchived: req.query.includeArchived === '1',
  }));
}));
router.get('/suppliers/:id', asyncH(async (req, res) => res.json(purchasesSvc.getSupplier(idParam(req)))));
router.post('/suppliers', asyncH(async (req, res) => {
  res.status(201).json(purchasesSvc.createSupplier(req.body || {}, req.ip));
}));
router.put('/suppliers/:id', asyncH(async (req, res) => {
  res.json(purchasesSvc.updateSupplier(idParam(req), req.body || {}, req.ip));
}));
router.delete('/suppliers/:id', asyncH(async (req, res) => {
  res.json(purchasesSvc.archiveSupplier(idParam(req), req.ip));
}));

/* ---------------------------------------------------------------------------
 *  Achats / réceptions
 * ------------------------------------------------------------------------- */

router.get('/purchases', asyncH(async (req, res) => {
  res.json(purchasesSvc.listPurchases({
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : null,
    status: req.query.status || null,
    from: req.query.from || null,
    to: req.query.to || null,
    search: req.query.search || null,
  }));
}));
router.get('/purchases/:id', asyncH(async (req, res) => res.json(purchasesSvc.getPurchase(idParam(req)))));
router.post('/purchases', asyncH(async (req, res) => {
  res.status(201).json(purchasesSvc.createPurchase(req.body || {}, req.ip));
}));
router.put('/purchases/:id', asyncH(async (req, res) => {
  res.json(purchasesSvc.updatePurchase(idParam(req), req.body || {}, req.ip));
}));
router.post('/purchases/:id/receive', asyncH(async (req, res) => {
  res.json(purchasesSvc.receivePurchase(idParam(req), req.body || {}, req.ip));
}));
router.post('/purchases/:id/pay', asyncH(async (req, res) => {
  res.json(purchasesSvc.payPurchase(idParam(req), req.body || {}, req.ip));
}));
router.post('/purchases/:id/cancel', asyncH(async (req, res) => {
  res.json(purchasesSvc.cancelPurchase(idParam(req), req.body?.reason, req.ip));
}));
router.post('/purchases/returns', asyncH(async (req, res) => {
  res.json(purchasesSvc.createPurchaseReturn(req.body || {}, req.ip));
}));
router.get('/price-comparison/:productId', asyncH(async (req, res) => {
  res.json(purchasesSvc.priceComparison(Number(req.params.productId)));
}));

/* ---------------------------------------------------------------------------
 *  Stock / mouvements / inventaires
 * ------------------------------------------------------------------------- */

router.get('/stock', asyncH(async (req, res) => {
  res.json({
    rows: stockSvc.listStock({
      kitchenId: req.query.kitchenId ? Number(req.query.kitchenId) : null,
      type: req.query.type || null,
      search: req.query.search || null,
      onlyAlerts: req.query.onlyAlerts === '1',
    }),
    totalValue: stockSvc.totalStockValue(),
    alerts: stockSvc.stockAlerts(),
  });
}));

router.get('/stock/products', asyncH(async (req, res) => {
  res.json(stockSvc.listStockProducts({ type: req.query.type || null }));
}));

router.get('/stock/movements', asyncH(async (req, res) => {
  res.json(stockSvc.listMovements({
    productId: req.query.productId ? Number(req.query.productId) : null,
    kitchenId: req.query.kitchenId ? Number(req.query.kitchenId) : null,
    from: req.query.from || null,
    to: req.query.to || null,
    limit: req.query.limit ? Number(req.query.limit) : 200,
  }));
}));

router.post('/stock/movements/:id/reverse', asyncH(async (req, res) => {
  res.json({ newMovementId: stockSvc.reverseMovement(idParam(req), req.body?.reason) });
}));

router.post('/stock/adjust', asyncH(async (req, res) => {
  const { productId, kitchenId, qty, direction, reason, unitCost } = req.body || {};
  res.json(stockSvc.adjustStock({ productId, kitchenId, qty, direction, reason, unitCost }, req.ip));
}));

router.get('/stock-counts', asyncH(async (req, res) => res.json(stockSvc.listStockCounts())));
router.get('/stock-counts/:id', asyncH(async (req, res) => res.json(stockSvc.getStockCount(idParam(req)))));
router.post('/stock-counts', asyncH(async (req, res) => {
  res.status(201).json(stockSvc.createStockCount(req.body || {}, req.ip));
}));
router.put('/stock-counts/:id', asyncH(async (req, res) => {
  res.json(stockSvc.updateStockCount(idParam(req), req.body?.items || []));
}));
router.post('/stock-counts/:id/validate', asyncH(async (req, res) => {
  res.json(stockSvc.validateStockCount(idParam(req), req.ip));
}));
router.post('/stock-counts/:id/cancel', asyncH(async (req, res) => {
  res.json(stockSvc.cancelStockCount(idParam(req), req.body?.reason, req.ip));
}));

/* ---------------------------------------------------------------------------
 *  Recettes
 * ------------------------------------------------------------------------- */

router.get('/recipes', asyncH(async (req, res) => {
  res.json(recipesSvc.listRecipes({ search: req.query.search || null }));
}));
router.get('/recipes/:id', asyncH(async (req, res) => res.json(recipesSvc.getRecipe(idParam(req)))));
router.post('/recipes', asyncH(async (req, res) => {
  res.status(201).json(recipesSvc.createRecipe(req.body || {}, req.ip));
}));
router.put('/recipes/:id', asyncH(async (req, res) => {
  res.json(recipesSvc.updateRecipe(idParam(req), req.body || {}, req.ip));
}));
router.delete('/recipes/:id', asyncH(async (req, res) => {
  res.json(recipesSvc.archiveRecipe(idParam(req), req.ip));
}));
router.post('/recipes/recalculate', asyncH(async (req, res) => {
  res.json({ updated: recipesSvc.recalculateAllRecipes() });
}));

/* ---------------------------------------------------------------------------
 *  Production
 * ------------------------------------------------------------------------- */

router.get('/productions', asyncH(async (req, res) => {
  res.json(productionSvc.listProductions({
    from: req.query.from || null, to: req.query.to || null,
    status: req.query.status || null,
    kitchenId: req.query.kitchenId ? Number(req.query.kitchenId) : null,
  }));
}));
router.get('/productions/:id', asyncH(async (req, res) => res.json(productionSvc.getProduction(idParam(req)))));
router.post('/productions', asyncH(async (req, res) => {
  res.status(201).json(productionSvc.createProduction(req.body || {}, req.ip));
}));
router.post('/productions/:id/validate', asyncH(async (req, res) => {
  res.json(productionSvc.validateProduction(idParam(req), req.ip));
}));
router.post('/productions/:id/cancel', asyncH(async (req, res) => {
  res.json(productionSvc.cancelProduction(idParam(req), req.body?.reason, req.ip));
}));
router.get('/productions/yields', asyncH(async (req, res) => {
  res.json(productionSvc.productionYields(req.query.from, req.query.to));
}));

/* ---------------------------------------------------------------------------
 *  Transformations
 * ------------------------------------------------------------------------- */

router.get('/transformations', asyncH(async (req, res) => {
  res.json(productionSvc.listTransformations({
    from: req.query.from || null, to: req.query.to || null, status: req.query.status || null,
  }));
}));
router.get('/transformations/:id', asyncH(async (req, res) => res.json(productionSvc.getTransformation(idParam(req)))));
router.post('/transformations', asyncH(async (req, res) => {
  res.status(201).json(productionSvc.createTransformation(req.body || {}, req.ip));
}));
router.get('/transformations/yields', asyncH(async (req, res) => {
  res.json(productionSvc.transformationYields(req.query.from, req.query.to));
}));

/* ---------------------------------------------------------------------------
 *  Transferts
 * ------------------------------------------------------------------------- */

router.get('/transfers', asyncH(async (req, res) => {
  res.json(transfersSvc.listTransfers({
    from: req.query.from || null, to: req.query.to || null,
    status: req.query.status || null,
    sourceKitchenId: req.query.sourceKitchenId ? Number(req.query.sourceKitchenId) : null,
    destKitchenId: req.query.destKitchenId ? Number(req.query.destKitchenId) : null,
    productId: req.query.productId ? Number(req.query.productId) : null,
  }));
}));
router.get('/transfers/:id', asyncH(async (req, res) => res.json(transfersSvc.getTransfer(idParam(req)))));
router.post('/transfers', asyncH(async (req, res) => {
  res.status(201).json(transfersSvc.createTransfer(req.body || {}, req.ip));
}));
router.put('/transfers/:id', asyncH(async (req, res) => {
  res.json(transfersSvc.updateTransfer(idParam(req), req.body || {}, req.ip));
}));
router.post('/transfers/:id/validate', asyncH(async (req, res) => {
  res.json(transfersSvc.validateTransfer(idParam(req), req.body || {}, req.ip));
}));
router.post('/transfers/:id/cancel', asyncH(async (req, res) => {
  res.json(transfersSvc.cancelTransfer(idParam(req), req.body?.reason, req.ip));
}));
router.get('/transfers-closing/:period', asyncH(async (req, res) => {
  res.json(transfersSvc.transfersClosing(req.params.period));
}));

/* ---------------------------------------------------------------------------
 *  Avaries
 * ------------------------------------------------------------------------- */

router.get('/losses', asyncH(async (req, res) => {
  res.json(lossesSvc.listLosses({
    from: req.query.from || null, to: req.query.to || null, status: req.query.status || null,
    kitchenId: req.query.kitchenId ? Number(req.query.kitchenId) : null,
    lossType: req.query.lossType || null,
    productId: req.query.productId ? Number(req.query.productId) : null,
  }));
}));
router.get('/losses/:id', asyncH(async (req, res) => res.json(lossesSvc.getLoss(idParam(req)))));
router.post('/losses', asyncH(async (req, res) => {
  res.status(201).json(lossesSvc.createLoss(req.body || {}, req.ip));
}));
router.put('/losses/:id', asyncH(async (req, res) => {
  res.json(lossesSvc.updateLoss(idParam(req), req.body || {}, req.ip));
}));
router.post('/losses/:id/validate', asyncH(async (req, res) => {
  res.json(lossesSvc.validateLoss(idParam(req), req.ip));
}));
router.post('/losses/:id/cancel', asyncH(async (req, res) => {
  res.json(lossesSvc.cancelLoss(idParam(req), req.body?.reason, req.ip));
}));
router.get('/losses-report', asyncH(async (req, res) => {
  res.json(lossesSvc.lossesReport(req.query.from, req.query.to));
}));

/* ---------------------------------------------------------------------------
 *  Ventes
 * ------------------------------------------------------------------------- */

router.get('/sales', asyncH(async (req, res) => {
  res.json(salesSvc.listSales({
    from: req.query.from || null, to: req.query.to || null,
    status: req.query.status || null, channel: req.query.channel || null,
    limit: req.query.limit ? Number(req.query.limit) : 300,
  }));
}));
router.get('/sales/:id', asyncH(async (req, res) => res.json(salesSvc.getSale(idParam(req)))));
router.post('/sales', asyncH(async (req, res) => {
  res.status(201).json(salesSvc.createSale(req.body || {}, req.ip));
}));
router.post('/sales/:id/cancel', asyncH(async (req, res) => {
  res.json(salesSvc.cancelSale(idParam(req), req.body?.reason, req.ip));
}));
router.get('/sales-analysis', asyncH(async (req, res) => {
  res.json(salesSvc.salesAnalysis(req.query.from, req.query.to));
}));
router.get('/sales-reconciliation', asyncH(async (req, res) => {
  res.json(salesSvc.salesStockReconciliation(req.query.from, req.query.to));
}));

/* ---------------------------------------------------------------------------
 *  Caisse & dépenses
 * ------------------------------------------------------------------------- */

router.get('/cash', asyncH(async (req, res) => {
  res.json({
    movements: cashSvc.listCashMovements({
      from: req.query.from || null, to: req.query.to || null, type: req.query.type || null,
    }),
    balance: cashSvc.cashBalance(req.query.to || null),
    day: req.query.date ? cashSvc.cashDay(req.query.date) : null,
  });
}));
router.post('/cash', asyncH(async (req, res) => {
  res.status(201).json(cashSvc.createCashMovement(req.body || {}, req.ip));
}));
router.post('/cash/close', asyncH(async (req, res) => {
  res.json(cashSvc.closeCashDay(req.body || {}, req.ip));
}));
router.post('/cash/reopen', asyncH(async (req, res) => {
  res.json(cashSvc.reopenCashDay(req.body?.date, req.body?.reason, req.ip));
}));

router.get('/expenses', asyncH(async (req, res) => {
  res.json({
    rows: cashSvc.listExpenses({
      from: req.query.from || null, to: req.query.to || null, category: req.query.category || null,
    }),
    total: cashSvc.expensesTotal(req.query.from, req.query.to),
    byCategory: cashSvc.expensesByCategory(req.query.from, req.query.to),
  });
}));
router.post('/expenses', asyncH(async (req, res) => {
  res.status(201).json(cashSvc.createExpense(req.body || {}, req.ip));
}));
router.delete('/expenses/:id', asyncH(async (req, res) => {
  res.json(cashSvc.deleteExpense(idParam(req), req.ip));
}));

/* ---------------------------------------------------------------------------
 *  Personnel & paie
 * ------------------------------------------------------------------------- */

router.get('/employees', asyncH(async (req, res) => {
  res.json(hrSvc.listEmployees({
    includeInactive: req.query.includeInactive === '1',
    search: req.query.search || null,
  }));
}));
router.get('/employees/:id', asyncH(async (req, res) => res.json(hrSvc.getEmployee(idParam(req)))));
router.post('/employees', asyncH(async (req, res) => {
  res.status(201).json(hrSvc.createEmployee(req.body || {}, req.ip));
}));
router.put('/employees/:id', asyncH(async (req, res) => {
  res.json(hrSvc.updateEmployee(idParam(req), req.body || {}, req.ip));
}));
router.delete('/employees/:id', asyncH(async (req, res) => {
  res.json(hrSvc.archiveEmployee(idParam(req), req.ip));
}));

router.get('/attendance', asyncH(async (req, res) => {
  res.json(hrSvc.attendanceSheet(req.query.period));
}));
router.post('/attendance', asyncH(async (req, res) => {
  res.json(hrSvc.upsertAttendance(req.body || {}, req.ip));
}));

router.get('/payroll/compute', asyncH(async (req, res) => {
  res.json(hrSvc.computePayroll(Number(req.query.employeeId), req.query.period, {}));
}));
router.get('/payroll', asyncH(async (req, res) => {
  res.json(hrSvc.payrollPeriod(req.query.period));
}));
router.post('/payroll', asyncH(async (req, res) => {
  const { employeeId, period, ...rest } = req.body || {};
  res.json(hrSvc.savePayroll(Number(employeeId), period, rest, req.ip));
}));
router.get('/payroll/export', asyncH(async (req, res) => {
  res.json(hrSvc.payrollExport(req.query.period));
}));

/* ---------------------------------------------------------------------------
 *  Cuisine du personnel
 * ------------------------------------------------------------------------- */

router.get('/staff/stock', asyncH(async (req, res) => res.json(staffSvc.staffStock())));
router.post('/staff/meals', asyncH(async (req, res) => {
  res.status(201).json(staffSvc.recordStaffMeal(req.body || {}, req.ip));
}));
router.post('/staff/purchase', asyncH(async (req, res) => {
  res.json(staffSvc.directPurchaseToStaff(req.body || {}, req.ip));
}));
router.get('/staff/report/:period', asyncH(async (req, res) => {
  res.json(staffSvc.staffMonthlyReport(req.params.period));
}));

/* ---------------------------------------------------------------------------
 *  Analytique : tableau de bord, ratios, simulateur, alertes
 * ------------------------------------------------------------------------- */

router.get('/dashboard', asyncH(async (req, res) => {
  res.json({
    dashboard: analytics.dashboard(req.query.date || null),
    alerts: analytics.buildAlerts(req.query.date || null),
  });
}));

router.get('/analytics/period', asyncH(async (req, res) => {
  res.json(analytics.computePeriod(req.query.from, req.query.to, {
    objectivePct: req.query.objective ? Number(req.query.objective) : undefined,
  }));
}));

router.get('/analytics/month/:period', asyncH(async (req, res) => {
  res.json(analytics.computeMonth(req.params.period));
}));

router.get('/analytics/overrun', asyncH(async (req, res) => {
  res.json(analytics.overrunAnalysis(req.query.from, req.query.to));
}));

router.get('/analytics/compare', asyncH(async (req, res) => {
  res.json(analytics.comparePeriods(req.query.periodA, req.query.periodB));
}));

router.get('/analytics/explain/:poste', asyncH(async (req, res) => {
  res.json(analytics.explainPost(req.params.poste, req.query.from, req.query.to));
}));

router.get('/analytics/by-kitchen', asyncH(async (req, res) => {
  res.json(analytics.consumptionByKitchen(req.query.from, req.query.to));
}));

router.post('/simulator', asyncH(async (req, res) => {
  const { revenueHt, consumption, lossesNotIncluded, objectivePct } = req.body || {};
  const objective = Number(objectivePct ?? 30);
  if (objective < 15 || objective > 45) {
    throw badRequest('L’objectif doit être compris entre 15 % et 45 %.');
  }
  res.json(simulateMaterialCost({
    revenueHt: Number(revenueHt) || 0,
    consumption: Number(consumption) || 0,
    lossesNotIncluded: Number(lossesNotIncluded) || 0,
    objectivePct: objective,
  }));
}));

/* ---------------------------------------------------------------------------
 *  Clôtures
 * ------------------------------------------------------------------------- */

router.get('/closings', asyncH(async (req, res) => res.json(closingSvc.listClosings())));
router.get('/closings/:period/checks', asyncH(async (req, res) => {
  res.json(closingSvc.closingChecks(req.params.period));
}));
router.get('/closings/:period', asyncH(async (req, res) => res.json(closingSvc.getClosing(req.params.period))));
router.post('/closings/:period/close', asyncH(async (req, res) => {
  res.json(closingSvc.closeMonth(req.params.period, req.body || {}, req.ip));
}));
router.post('/closings/:period/reopen', asyncH(async (req, res) => {
  res.json(closingSvc.reopenMonth(req.params.period, req.body?.reason, req.ip));
}));

/* ---------------------------------------------------------------------------
 *  Rapports & exports
 * ------------------------------------------------------------------------- */

router.get('/reports/monthly/:period', asyncH(async (req, res) => {
  res.json(reports.monthlyReport(req.params.period));
}));

router.get('/reports/export/pdf', asyncH(async (req, res) => {
  const { period } = req.query;
  const buffer = await reports.monthlyReportPdf(period);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="rapport-${period}.pdf"`);
  res.send(buffer);
}));

router.get('/reports/export/xlsx', asyncH(async (req, res) => {
  const { period } = req.query;
  const buffer = await reports.monthlyReportXlsx(period);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rapport-${period}.xlsx"`);
  res.send(buffer);
}));

router.get('/reports/export/csv', asyncH(async (req, res) => {
  const { period, type } = req.query;
  const csv = reports.csvExport(period, type || 'movements');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${type || 'export'}-${period}.csv"`);
  res.send('\uFEFF' + csv); // BOM pour Excel
}));

/* ---------------------------------------------------------------------------
 *  Sauvegardes / intégrité / audit
 * ------------------------------------------------------------------------- */

router.get('/backups', asyncH(async (req, res) => {
  res.json({ backups: backupSvc.listBackups(), integrity: backupSvc.integrityCheck() });
}));
router.post('/backups', asyncH(async (req, res) => {
  res.status(201).json(backupSvc.createBackup({ kind: 'manuel', notes: req.body?.notes }));
}));
router.get('/backups/:file/verify', asyncH(async (req, res) => {
  res.json(backupSvc.verifyBackup(req.params.file));
}));
router.post('/backups/restore', asyncH(async (req, res) => {
  res.json(backupSvc.restoreBackup(req.body?.fileName, req.body?.confirmText));
}));
router.get('/integrity', asyncH(async (req, res) => res.json(backupSvc.integrityCheck())));

router.get('/audit', asyncH(async (req, res) => {
  res.json(listAudit({
    limit: req.query.limit ? Number(req.query.limit) : 100,
    offset: req.query.offset ? Number(req.query.offset) : 0,
    entity: req.query.entity || null,
    action: req.query.action || null,
    from: req.query.from || null,
    to: req.query.to || null,
  }));
}));

export default router;
