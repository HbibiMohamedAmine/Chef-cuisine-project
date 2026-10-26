/**
 * ============================================================================
 *  Service CLÔTURE MENSUELLE / RÉOUVERTURE
 * ----------------------------------------------------------------------------
 *  Une clôture :
 *    1. VÉRIFIE qu'aucune opération ne reste en attente,
 *    2. FIGE les stocks d'ouverture et de clôture,
 *    3. CALCULE les indicateurs et conserve le détail (snapshot JSON),
 *    4. devient IMMUABLE : toute modification ultérieure exige une réouverture
 *       motivée et journalisée.
 *
 *  Aucune période clôturée n'est jamais modifiée silencieusement.
 * ============================================================================
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireString, requirePeriod, conflict } from '../lib/errors.js';
import { nowSql, periodBounds } from '../lib/numbering.js';
import {
  computeMonth,
  consumptionByKitchen,
  lossesNotIncludedValue,
  explainPost,
} from './analytics.js';
import { transfersClosing } from './transfers.js';
import { lossesReport } from './losses.js';
import { expensesByCategory, expensesTotal } from './cash.js';
import { productionYields, transformationYields } from './production.js';
import { staffMonthlyReport } from './staff.js';
import { salesAnalysis } from './sales.js';
import { roundMoney } from '../../shared/formulas.js';

/**
 * Contrôles préalables à la clôture.
 * @param {string} period
 * @returns {{blocking:any[], warnings:any[]}}
 */
export function closingChecks(period) {
  const p = requirePeriod(period);
  const { start, end } = periodBounds(p);
  const blocking = [];
  const warnings = [];

  const inPeriod = (table, dateCol, extra = '') =>
    all(
      `SELECT * FROM ${table} WHERE date(${dateCol}) BETWEEN date(?) AND date(?) ${extra}`,
      [start, end],
    );

  // 1. Opérations non validées (bloquantes)
  const draftTransfers = inPeriod('transfers', 'occurred_at', "AND status = 'brouillon'");
  if (draftTransfers.length) {
    blocking.push({
      code: 'TRANSFERS_DRAFT',
      message: `${draftTransfers.length} transfert(s) en brouillon sur la période.`,
      count: draftTransfers.length,
      items: draftTransfers.map((t) => ({ id: t.id, number: t.number, qty: t.qty, cost: t.total_cost })),
    });
  }

  const draftLosses = inPeriod('losses', 'occurred_at', "AND status = 'brouillon'");
  if (draftLosses.length) {
    blocking.push({
      code: 'LOSSES_DRAFT',
      message: `${draftLosses.length} avarie(s) en brouillon sur la période.`,
      count: draftLosses.length,
      items: draftLosses.map((l) => ({ id: l.id, number: l.number, cost: l.total_cost })),
    });
  }

  const draftProductions = inPeriod('productions', 'produced_at', "AND status = 'brouillon'");
  if (draftProductions.length) {
    blocking.push({
      code: 'PRODUCTIONS_DRAFT',
      message: `${draftProductions.length} production(s) en brouillon sur la période.`,
      count: draftProductions.length,
      items: draftProductions.map((x) => ({ id: x.id, number: x.number })),
    });
  }

  const draftCounts = inPeriod('stock_counts', 'count_date', "AND status = 'brouillon'");
  if (draftCounts.length) {
    blocking.push({
      code: 'COUNTS_DRAFT',
      message: `${draftCounts.length} inventaire(s) en brouillon sur la période.`,
      count: draftCounts.length,
      items: draftCounts.map((c) => ({ id: c.id, number: c.number })),
    });
  }

  // 2. Avertissements (non bloquants)
  const pendingPurchases = inPeriod('purchases', 'order_date', "AND status IN ('brouillon','commandee','partielle')");
  if (pendingPurchases.length) {
    warnings.push({
      code: 'PURCHASES_PENDING',
      message: `${pendingPurchases.length} achat(s) non réceptionné(s) : ils n’entreront pas dans le stock de clôture.`,
      count: pendingPurchases.length,
    });
  }

  const unpaid = inPeriod('purchases', 'order_date', "AND status = 'receptionnee' AND payment_status != 'payee'");
  if (unpaid.length) {
    warnings.push({
      code: 'PURCHASES_UNPAID',
      message: `${unpaid.length} facture(s) fournisseur non soldée(s).`,
      count: unpaid.length,
    });
  }

  const draftPayroll = all('SELECT * FROM payroll_records WHERE period = ? AND status = ?', [p, 'brouillon']);
  if (draftPayroll.length) {
    warnings.push({
      code: 'PAYROLL_DRAFT',
      message: `${draftPayroll.length} bulletin(aux) de paie encore en brouillon.`,
      count: draftPayroll.length,
    });
  }

  // 3. Inventaire de clôture recommandé
  const lastCount = get(
    `SELECT * FROM stock_counts WHERE status = 'valide' AND date(count_date) <= date(?)
     ORDER BY count_date DESC LIMIT 1`,
    [end],
  );
  if (!lastCount || lastCount.count_date < start) {
    warnings.push({
      code: 'NO_INVENTORY',
      message:
        'Aucun inventaire physique validé sur la période : le stock de clôture est purement théorique.',
    });
  }

  // 4. Écarts d'inventaire importants
  const gap = get(
    `SELECT ROUND(COALESCE(SUM(ABS(i.variance_value)),0),3) v, COUNT(*) c
     FROM stock_count_items i JOIN stock_counts sc ON sc.id = i.stock_count_id
     WHERE sc.status='valide' AND date(sc.count_date) BETWEEN date(?) AND date(?)`,
    [start, end],
  );
  const threshold = Number(getSetting('alert_gap_value_dt', 5));
  if ((gap.v || 0) > threshold) {
    warnings.push({
      code: 'INVENTORY_GAP',
      message: `Écarts d’inventaire valorisés à ${gap.v} DT (seuil ${threshold} DT).`,
      count: gap.c,
    });
  }

  const existing = get('SELECT * FROM monthly_closings WHERE period = ?', [p]);
  if (existing && existing.status === 'cloture') {
    blocking.push({
      code: 'ALREADY_CLOSED',
      message: `La période ${p} est déjà clôturée. Réouvrez-la avec un motif pour la recalculer.`,
      count: 1,
      items: [{ id: existing.id, closed_at: existing.closed_at }],
    });
  }

  return {
    period: p,
    from: start,
    to: end,
    canClose: blocking.length === 0,
    blocking,
    warnings,
  };
}

/**
 * Effectue la clôture mensuelle.
 * @param {string} period YYYY-MM
 * @param {{force?:boolean, notes?:string}} [opts]
 * @param {string} [ip]
 */
export function closeMonth(period, opts = {}, ip = null) {
  const p = requirePeriod(period);
  const checks = closingChecks(p);
  if (!checks.canClose && !opts.force) {
    throw badRequest(
      `Clôture impossible : ${checks.blocking.map((b) => b.message).join(' ')}`,
      checks.blocking,
    );
  }

  const { start, end } = periodBounds(p);
  const metrics = computeMonth(p);

  // Snapshot complet — conserve le détail de ce qui a produit les chiffres.
  const snapshot = {
    computed_at: nowSql(),
    metrics,
    consumptionByKitchen: consumptionByKitchen(start, end),
    transfers: transfersClosing(p),
    losses: lossesReport(start, end),
    expenses: { total: expensesTotal(start, end), byCategory: expensesByCategory(start, end) },
    production: productionYields(start, end),
    transformation: transformationYields(start, end),
    staffMeals: staffMonthlyReport(p),
    sales: salesAnalysis(start, end),
    drillDown: {
      purchases: explainPost('purchases', start, end),
      returns: explainPost('returns', start, end),
      adjustments: explainPost('adjustments', start, end),
      losses: explainPost('losses', start, end),
      openingStock: explainPost('opening', start, end),
      closingStock: explainPost('closing', start, end),
    },
    settings: {
      objective_ratio: getSetting('objective_ratio', 30),
      valuation_method: getSetting('valuation_method', 'cmp'),
      staff_meals_in_ratio: getSetting('staff_meals_in_ratio', false),
    },
    checks,
  };

  return transaction(() => {
    const existing = get('SELECT * FROM monthly_closings WHERE period = ?', [p]);

    const values = [
      metrics.openingStock, metrics.closingStock, metrics.purchasesReceived,
      metrics.consumption, metrics.lossesNotIncluded, metrics.retainedCost,
      metrics.revenueHt, metrics.ratioPct, metrics.objectivePct,
      metrics.marginBeforeOtherCharges, metrics.otherExpenses, JSON.stringify(snapshot),
    ];

    if (existing) {
      run(
        `UPDATE monthly_closings SET status = 'cloture', closed_at = ?, reopened_at = NULL,
           reopen_reason = NULL, opening_stock_value = ?, closing_stock_value = ?,
           purchases_received = ?, consumption = ?, losses_not_included = ?, retained_cost = ?,
           revenue_ht = ?, ratio_pct = ?, objective_pct = ?, margin_before_charges = ?,
           other_expenses = ?, details_json = ?
         WHERE period = ?`,
        [nowSql(), ...values, p],
      );
    } else {
      run(
        `INSERT INTO monthly_closings
          (period, status, closed_at, opening_stock_value, closing_stock_value, purchases_received,
           consumption, losses_not_included, retained_cost, revenue_ht, ratio_pct, objective_pct,
           margin_before_charges, other_expenses, details_json)
         VALUES (?, 'cloture', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p, nowSql(), ...values],
      );
    }

    run(
      `INSERT INTO monthly_closing_logs (period, action, reason, snapshot_json)
       VALUES (?, 'cloture', ?, ?)`,
      [p, opts.notes || 'Clôture mensuelle', JSON.stringify({
        ratio: metrics.ratioPct, revenue: metrics.revenueHt, retained: metrics.retainedCost,
      })],
    );

    audit({
      action: 'close', entity: 'monthly_closing', entityId: p,
      summary: `Clôture ${p} — CA ${metrics.revenueHt} DT, coût retenu ${metrics.retainedCost} DT, ` +
        `ratio ${metrics.ratioPct} % (objectif ${metrics.objectivePct} %)`,
      severity: 'warning', ip,
    });

    return getClosing(p);
  });
}

/**
 * Réouverture motivée d'une période clôturée.
 * @param {string} period
 * @param {string} reason motif obligatoire
 */
export function reopenMonth(period, reason, ip = null) {
  const p = requirePeriod(period);
  const closing = get('SELECT * FROM monthly_closings WHERE period = ?', [p]);
  if (!closing) throw notFound('Aucune clôture pour cette période.');
  if (closing.status === 'reouvert') throw badRequest('Cette période est déjà réouverte.');
  const motif = requireString(reason, 'Motif de réouverture', { maxLength: 500 });

  return transaction(() => {
    run(
      `UPDATE monthly_closings SET status = 'reouvert', reopened_at = ?, reopen_reason = ? WHERE period = ?`,
      [nowSql(), motif, p],
    );
    run(
      `INSERT INTO monthly_closing_logs (period, action, reason, snapshot_json)
       VALUES (?, 'reouverture', ?, ?)`,
      [p, motif, JSON.stringify({ previous: {
        ratio: closing.ratio_pct, revenue: closing.revenue_ht, retained: closing.retained_cost,
        closed_at: closing.closed_at,
      } })],
    );
    audit({
      action: 'reopen', entity: 'monthly_closing', entityId: p,
      summary: `Période ${p} réouverte : ${motif}`,
      severity: 'critical', ip,
    });
    return getClosing(p);
  });
}

/** Détail d'une clôture (avec snapshot décodé). */
export function getClosing(period) {
  const row = get('SELECT * FROM monthly_closings WHERE period = ?', [period]);
  if (!row) throw notFound('Clôture introuvable.');
  let details = null;
  try {
    details = row.details_json ? JSON.parse(row.details_json) : null;
  } catch {
    details = null;
  }
  const logs = all(
    'SELECT * FROM monthly_closing_logs WHERE period = ? ORDER BY id DESC',
    [period],
  );
  return { ...row, details, logs };
}

/** Liste des clôtures. */
export function listClosings() {
  return all(
    `SELECT mc.*,
            (SELECT COUNT(*) FROM monthly_closing_logs l WHERE l.period = mc.period) AS log_count
     FROM monthly_closings mc ORDER BY mc.period DESC`,
  );
}

/**
 * Vérifie si une période est clôturée (garde-fou pour les écritures).
 * @param {string} period
 * @returns {boolean}
 */
export function isPeriodClosed(period) {
  const row = get('SELECT status FROM monthly_closings WHERE period = ?', [period]);
  return Boolean(row && row.status === 'cloture');
}

/**
 * Garde-fou : refuse une écriture sur une période clôturée.
 * @param {string} dateOrPeriod date YYYY-MM-DD ou période YYYY-MM
 * @param {string} [action]
 */
export function assertPeriodOpen(dateOrPeriod, action = 'modification') {
  const period = String(dateOrPeriod).slice(0, 7);
  if (isPeriodClosed(period)) {
    throw conflict(
      `La période ${period} est clôturée : la ${action} est impossible. ` +
      'Réouvrez la période avec un motif (opération journalisée).',
      { period, requiresReopen: true },
    );
  }
}
