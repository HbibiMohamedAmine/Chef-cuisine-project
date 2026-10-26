/**
 * Service CAISSE et DÉPENSES HORS MATIÈRES.
 *
 * IMPORTANT (cahier des charges) : on n'affiche JAMAIS la marge comme un
 * bénéfice net. On distingue :
 *   - coût matière
 *   - autres charges (dépenses hors matières)
 *   - marge après coût matière
 *   - résultat de gestion ESTIMATIF
 */
import { all, get, run, transaction, scalar } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate } from '../lib/errors.js';
import { nextNumber, nowSql, periodBounds } from '../lib/numbering.js';
import { roundMoney, estimatedOperatingResult } from '../../shared/formulas.js';

export const EXPENSE_CATEGORIES = [
  { code: 'loyer', label: 'Loyer' },
  { code: 'eau_electricite', label: 'Eau / Électricité' },
  { code: 'gaz', label: 'Gaz' },
  { code: 'telephone_internet', label: 'Téléphone / Internet' },
  { code: 'transport', label: 'Transport' },
  { code: 'entretien', label: 'Entretien / Réparation' },
  { code: 'nettoyage', label: 'Nettoyage' },
  { code: 'administratif', label: 'Administratif' },
  { code: 'salaires', label: 'Salaires (hors paie détaillée)' },
  { code: 'autre', label: 'Autres' },
];

export const PAYMENT_METHODS = [
  { code: 'espece', label: 'Espèces' },
  { code: 'carte', label: 'Carte bancaire' },
  { code: 'cheque', label: 'Chèque' },
  { code: 'virement', label: 'Virement' },
  { code: 'credit', label: 'Crédit (à payer)' },
];

/* ===========================================================================
 *  DÉPENSES HORS MATIÈRES
 * ========================================================================= */

export function listExpenses({ from = null, to = null, category = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(expense_date) >= date(?)'); params.push(from); }
  if (to) { where.push('date(expense_date) <= date(?)'); params.push(to); }
  if (category) { where.push('category = ?'); params.push(category); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(`SELECT * FROM expenses ${clause} ORDER BY expense_date DESC, id DESC LIMIT 500`, params);
}

/**
 * Crée une dépense hors matières. Si payée immédiatement, un mouvement de
 * caisse de décaissement est créé dans la même transaction.
 */
export function createExpense(p, ip = null) {
  const category = requireString(p.category, 'Catégorie', { maxLength: 60 });
  const known = EXPENSE_CATEGORIES.find((c) => c.code === category);
  if (!known && category !== 'autre') throw badRequest(`Catégorie de dépense inconnue : ${category}.`);
  const amount = requireNumber(p.amount, 'Montant', { min: 0.001 });
  const expenseDate = p.expenseDate ? requireDate(p.expenseDate, 'Date') : nowSql().slice(0, 10);
  const paymentMethod = String(p.paymentMethod || 'espece');
  const paidImmediately = paymentMethod !== 'credit';

  return transaction(() => {
    const number = nextNumber('expense', new Date());
    let cashId = null;
    if (paidImmediately) {
      const cr = run(
        `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table)
         VALUES (?, 'decaissement', 'depense', ?, ?, ?, ?, 'expenses')`,
        [expenseDate, roundMoney(amount), paymentMethod, p.reference || number,
         `Dépense ${known ? known.label : category}${p.beneficiary ? ' — ' + p.beneficiary : ''}`],
      );
      cashId = cr.lastInsertRowid;
    }
    const r = run(
      `INSERT INTO expenses (number, expense_date, category, amount, payment_method, beneficiary,
         reference, notes, cash_movement_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [number, expenseDate, category, roundMoney(amount), paymentMethod,
       p.beneficiary || null, p.reference || null, p.notes || null, cashId],
    );
    audit({
      action: 'create', entity: 'expense', entityId: r.lastInsertRowid,
      summary: `Dépense ${number} — ${known ? known.label : category} : ${formatAmount(amount)}`,
      ip,
    });
    return get('SELECT * FROM expenses WHERE id = ?', [r.lastInsertRowid]);
  });
}

function formatAmount(v) {
  return `${roundMoney(v).toFixed(3)} DT`;
}

export function deleteExpense(id, ip = null) {
  const exp = get('SELECT * FROM expenses WHERE id = ?', [id]);
  if (!exp) throw notFound('Dépense introuvable.');
  return transaction(() => {
    if (exp.cash_movement_id) {
      run(
        `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description, source_table, source_id)
         VALUES (?, 'ajustement', 'annulation_depense', ?, ?, ?, ?, 'expenses', ?)`,
        [nowSql(), exp.amount, exp.payment_method, exp.number, `Annulation dépense ${exp.number}`, id],
      );
    }
    run('UPDATE expenses SET notes = COALESCE(notes,\'\') || ? WHERE id = ?',
      [`\n[Annulée le ${nowSql()}]`, id]);
    audit({ action: 'cancel', entity: 'expense', entityId: id, summary: exp.number, severity: 'warning', ip });
    return { success: true, note: 'La dépense est marquée annulée ; l’historique est conservé.' };
  });
}

/** Total des dépenses hors matières sur une période. */
export function expensesTotal(from, to) {
  const row = get(
    `SELECT ROUND(COALESCE(SUM(amount),0),3) total, COUNT(*) count
     FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)`,
    [from, to],
  );
  return { total: row.total || 0, count: row.count || 0 };
}

/** Répartition des dépenses par catégorie. */
export function expensesByCategory(from, to) {
  return all(
    `SELECT category, ROUND(SUM(amount),3) total, COUNT(*) count
     FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)
     GROUP BY category ORDER BY total DESC`,
    [from, to],
  );
}

/* ===========================================================================
 *  CAISSE
 * ========================================================================= */

export function listCashMovements({ from = null, to = null, type = null } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('date(occurred_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(occurred_at) <= date(?)'); params.push(to); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(`SELECT * FROM cash_movements ${clause} ORDER BY occurred_at DESC, id DESC LIMIT 500`, params);
}

/**
 * Solde théorique de caisse à une date donnée.
 * Encaissements − décaissements − remboursements ± ajustements.
 */
export function cashBalance(date = null) {
  const clause = date ? 'AND date(occurred_at) <= date(?)' : '';
  const row = get(
    `SELECT
       ROUND(COALESCE(SUM(CASE WHEN type IN ('encaissement') THEN amount ELSE 0 END),0),3) AS inflow,
       ROUND(COALESCE(SUM(CASE WHEN type IN ('decaissement','remboursement') THEN amount ELSE 0 END),0),3) AS outflow,
       ROUND(COALESCE(SUM(CASE WHEN type = 'ajustement' THEN amount ELSE 0 END),0),3) AS adjustments
     FROM cash_movements WHERE 1=1 ${clause}`,
    date ? [date] : [],
  );
  return {
    inflow: row.inflow || 0,
    outflow: row.outflow || 0,
    adjustments: row.adjustments || 0,
    balance: roundMoney((row.inflow || 0) - (row.outflow || 0) + (row.adjustments || 0)),
  };
}

/** Ajoute un mouvement de caisse manuel (entrée/sortie/ajustement). */
export function createCashMovement(p, ip = null) {
  const type = requireString(p.type, 'Type de mouvement');
  if (!['encaissement', 'decaissement', 'remboursement', 'ajustement'].includes(type)) {
    throw badRequest('Type de mouvement de caisse invalide.');
  }
  const amount = requireNumber(p.amount, 'Montant', { min: 0.001 });
  const occurredAt = p.occurredAt ? requireDate(p.occurredAt, 'Date') : nowSql();
  const r = run(
    `INSERT INTO cash_movements (occurred_at, type, category, amount, payment_method, reference, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [occurredAt, type, p.category || 'manuel', roundMoney(amount),
     p.paymentMethod || 'espece', p.reference || null, p.description || null],
  );
  audit({ action: 'create', entity: 'cash_movement', entityId: r.lastInsertRowid,
    summary: `${type} ${formatAmount(amount)}`, ip });
  return get('SELECT * FROM cash_movements WHERE id = ?', [r.lastInsertRowid]);
}

/** Détail de la caisse d'une journée. */
export function cashDay(date) {
  const movements = listCashMovements({ from: date, to: date });
  const totals = cashBalance(date);
  const closing = get('SELECT * FROM cash_closings WHERE closing_date = date(?)', [date]);
  return { date, movements, ...totals, closing: closing || null };
}

/**
 * CLÔTURE JOURNALIÈRE DE CAISSE.
 * Compare le solde théorique au comptage physique ; l'écart doit être justifié.
 */
export function closeCashDay({ date, countedBalance, justification }, ip = null) {
  const day = date ? requireDate(date, 'Date') : nowSql().slice(0, 10);
  const counted = requireNumber(countedBalance, 'Montant compté', { min: 0 });
  const existing = get('SELECT * FROM cash_closings WHERE closing_date = date(?)', [day]);
  if (existing && existing.status === 'cloturee') {
    throw badRequest('La caisse de ce jour est déjà clôturée. Réouvrez-la avec un motif.');
  }

  const previous = get(
    `SELECT theoretical_balance FROM cash_closings WHERE closing_date < date(?) ORDER BY closing_date DESC LIMIT 1`,
    [day],
  );
  const opening = previous ? Number(previous.theoretical_balance) : 0;
  const dayMovements = listCashMovements({ from: day, to: day });
  const totalIn = roundMoney(
    dayMovements.filter((m) => m.type === 'encaissement' || m.type === 'ajustement')
      .reduce((a, m) => a + m.amount, 0),
  );
  const totalOut = roundMoney(
    dayMovements.filter((m) => m.type === 'decaissement' || m.type === 'remboursement')
      .reduce((a, m) => a + m.amount, 0),
  );
  const theoretical = roundMoney(opening + totalIn - totalOut);
  const variance = roundMoney(counted - theoretical);

  if (Math.abs(variance) > 0.001 && !String(justification || '').trim()) {
    throw badRequest(
      `Écart de caisse de ${formatAmount(variance)} : une justification est obligatoire.`,
    );
  }

  return transaction(() => {
    if (existing) {
      run(
        `UPDATE cash_closings SET opening_balance = ?, total_in = ?, total_out = ?,
           theoretical_balance = ?, counted_balance = ?, variance = ?, justification = ?,
           status = 'cloturee', created_at = datetime('now') WHERE id = ?`,
        [opening, totalIn, totalOut, theoretical, counted, variance, justification || null, existing.id],
      );
    } else {
      run(
        `INSERT INTO cash_closings (closing_date, opening_balance, total_in, total_out,
           theoretical_balance, counted_balance, variance, justification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [day, opening, totalIn, totalOut, theoretical, counted, variance, justification || null],
      );
    }
    audit({ action: 'close', entity: 'cash_closing', entityId: day,
      summary: `Clôture caisse ${day} : théorique ${formatAmount(theoretical)}, compté ${formatAmount(counted)}, écart ${formatAmount(variance)}`,
      severity: Math.abs(variance) > 0.001 ? 'warning' : 'info', ip });
    return get('SELECT * FROM cash_closings WHERE closing_date = date(?)', [day]);
  });
}

/** Réouverture d'une caisse journalière (motif obligatoire, journalisé). */
export function reopenCashDay(date, reason, ip = null) {
  const day = requireDate(date, 'Date');
  const closing = get('SELECT * FROM cash_closings WHERE closing_date = date(?)', [day]);
  if (!closing) throw notFound('Aucune clôture de caisse pour cette date.');
  if (closing.status === 'reouverte') throw badRequest('Cette caisse est déjà réouverte.');
  const motif = requireString(reason, 'Motif de réouverture', { maxLength: 300 });
  run(`UPDATE cash_closings SET status = 'reouverte', reopened_at = ?, reopen_reason = ? WHERE id = ?`,
    [nowSql(), motif, closing.id]);
  audit({ action: 'reopen', entity: 'cash_closing', entityId: day,
    summary: `Caisse ${day} réouverte : ${motif}`, severity: 'warning', ip });
  return get('SELECT * FROM cash_closings WHERE id = ?', [closing.id]);
}

/**
 * Synthèse financière d'une période (matière / autres charges / marge / résultat).
 * @param {string} from
 * @param {string} to
 */
export function financialSummary(from, to, revenueHtValue, retainedCost) {
  const otherExpenses = expensesTotal(from, to).total;
  return {
    revenueHt: roundMoney(revenueHtValue),
    materialCost: roundMoney(retainedCost),
    otherExpenses: roundMoney(otherExpenses),
    marginBeforeOtherCharges: roundMoney(revenueHtValue - retainedCost),
    estimatedResult: estimatedOperatingResult(revenueHtValue, retainedCost, otherExpenses),
    byCategory: expensesByCategory(from, to),
    cash: cashBalance(to),
    warning:
      'Le résultat affiché est un RÉSULTAT DE GESTION ESTIMATIF, pas un bénéfice net comptable.',
  };
}
