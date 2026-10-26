/**
 * Service PERSONNEL & PRÉPARATION DE PAIE.
 *
 * ⚠️ AUCUN taux légal tunisien n'est figé dans le code : tous les taux
 * (CNSS salarié/employeur, IRPP, heures légales, majoration heures sup)
 * proviennent des PARAMÈTRES et doivent être validés avec le comptable.
 */
import { all, get, run, transaction, getSetting } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, requireNumber, requireString, requireDate, requirePeriod } from '../lib/errors.js';
import { nowSql, periodBounds } from '../lib/numbering.js';
import { payrollCompute, roundMoney } from '../../shared/formulas.js';

/* ===========================================================================
 *  EMPLOYÉS
 * ========================================================================= */

export function listEmployees({ includeInactive = false, search = null } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('deleted_at IS NULL AND active = 1');
  if (search) {
    where.push('(first_name LIKE ? OR last_name LIKE ? OR code LIKE ? OR function LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT * FROM employees ${clause}
     ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
    params,
  );
}

export function getEmployee(id) {
  const e = get('SELECT * FROM employees WHERE id = ?', [id]);
  if (!e) throw notFound('Employé introuvable.');
  const attendance = all(
    `SELECT * FROM attendance WHERE employee_id = ? ORDER BY att_date DESC LIMIT 90`,
    [id],
  );
  const payroll = all(
    `SELECT * FROM payroll_records WHERE employee_id = ? ORDER BY period DESC LIMIT 24`,
    [id],
  );
  return { ...e, attendance, payroll };
}

export function createEmployee(p, ip = null) {
  const firstName = requireString(p.firstName, 'Prénom', { maxLength: 80 });
  const lastName = requireString(p.lastName, 'Nom', { maxLength: 80 });
  const code = p.code
    ? requireString(p.code, 'Code employé', { maxLength: 30 }).toUpperCase()
    : `EMP${Date.now().toString().slice(-5)}`;
  if (get('SELECT id FROM employees WHERE code = ? COLLATE NOCASE', [code])) {
    throw badRequest(`Le code employé « ${code} » existe déjà.`);
  }
  const r = run(
    `INSERT INTO employees (code, first_name, last_name, function, hire_date, base_salary,
       contract_type, phone, cin, cnss_number, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, firstName, lastName, p.function || null,
     p.hireDate ? requireDate(p.hireDate, 'Date d’embauche') : null,
     requireNumber(p.baseSalary ?? 0, 'Salaire de base', { min: 0, required: false }),
     p.contractType || 'CDI', p.phone || null, p.cin || null, p.cnssNumber || null, p.notes || null],
  );
  audit({ action: 'create', entity: 'employee', entityId: r.lastInsertRowid,
    summary: `${firstName} ${lastName}`, ip });
  return getEmployee(r.lastInsertRowid);
}

export function updateEmployee(id, p, ip = null) {
  const e = get('SELECT * FROM employees WHERE id = ?', [id]);
  if (!e) throw notFound('Employé introuvable.');
  run(
    `UPDATE employees SET first_name = ?, last_name = ?, function = ?, hire_date = ?, end_date = ?,
       base_salary = ?, contract_type = ?, phone = ?, cin = ?, cnss_number = ?, active = ?, notes = ?
     WHERE id = ?`,
    [
      p.firstName !== undefined ? requireString(p.firstName, 'Prénom', { maxLength: 80 }) : e.first_name,
      p.lastName !== undefined ? requireString(p.lastName, 'Nom', { maxLength: 80 }) : e.last_name,
      p.function !== undefined ? p.function : e.function,
      p.hireDate !== undefined ? p.hireDate || null : e.hire_date,
      p.endDate !== undefined ? p.endDate || null : e.end_date,
      p.baseSalary !== undefined ? requireNumber(p.baseSalary, 'Salaire de base', { min: 0, required: false }) : e.base_salary,
      p.contractType !== undefined ? p.contractType : e.contract_type,
      p.phone !== undefined ? p.phone : e.phone,
      p.cin !== undefined ? p.cin : e.cin,
      p.cnssNumber !== undefined ? p.cnssNumber : e.cnss_number,
      p.active !== undefined ? (p.active ? 1 : 0) : e.active,
      p.notes !== undefined ? p.notes : e.notes,
      id,
    ],
  );
  audit({ action: 'update', entity: 'employee', entityId: id, summary: `${e.first_name} ${e.last_name}`, ip });
  return getEmployee(id);
}

/** Archive un employé (soft delete, historique conservé). */
export function archiveEmployee(id, ip = null) {
  run(`UPDATE employees SET active = 0, deleted_at = datetime('now') WHERE id = ?`, [id]);
  audit({ action: 'delete', entity: 'employee', entityId: id, severity: 'warning', ip });
  return { success: true };
}

/* ===========================================================================
 *  PRÉSENCES
 * ========================================================================= */

/**
 * Enregistre/actualise une présence (upsert sur employé + date).
 */
export function upsertAttendance(p, ip = null) {
  const employeeId = requireNumber(p.employeeId, 'Employé', { min: 1 });
  const employee = get('SELECT * FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw notFound('Employé introuvable.');
  const date = p.attDate ? requireDate(p.attDate, 'Date') : nowSql().slice(0, 10);
  const status = String(p.status || 'present');
  if (!['present', 'absent', 'retard', 'conge', 'ferie', 'maladie'].includes(status)) {
    throw badRequest('Statut de présence invalide.');
  }
  const hoursNormal = requireNumber(p.hoursNormal ?? 0, 'Heures normales', { min: 0, required: false });
  const hoursOvertime = requireNumber(p.hoursOvertime ?? 0, 'Heures supplémentaires', { min: 0, required: false });
  const lateMinutes = requireNumber(p.lateMinutes ?? 0, 'Minutes de retard', { min: 0, required: false });

  run(
    `INSERT INTO attendance (employee_id, att_date, status, hours_normal, hours_overtime, late_minutes, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, att_date) DO UPDATE SET
       status = excluded.status, hours_normal = excluded.hours_normal,
       hours_overtime = excluded.hours_overtime, late_minutes = excluded.late_minutes,
       notes = excluded.notes`,
    [employeeId, date, status, hoursNormal, hoursOvertime, lateMinutes, p.notes || null],
  );
  audit({ action: 'update', entity: 'attendance', entityId: `${employeeId}:${date}`,
    summary: `${employee.first_name} ${employee.last_name} — ${date} : ${status}`, ip });
  return get('SELECT * FROM attendance WHERE employee_id = ? AND att_date = ?', [employeeId, date]);
}

/** Feuille de présence d'un mois. */
export function attendanceSheet(period) {
  const p = period ? requirePeriod(period) : nowSql().slice(0, 7);
  const { start, end } = periodBounds(p);
  return all(
    `SELECT a.*, e.code, e.first_name, e.last_name, e.function
     FROM attendance a JOIN employees e ON e.id = a.employee_id
     WHERE a.att_date BETWEEN date(?) AND date(?)
     ORDER BY e.last_name, a.att_date`,
    [start, end],
  );
}

/**
 * Synthèse des heures d'un employé sur un mois (base du calcul de paie).
 */
export function attendanceSummary(employeeId, period) {
  const { start, end } = periodBounds(period);
  const row = get(
    `SELECT
       ROUND(COALESCE(SUM(hours_normal),0),2) AS hours_normal,
       ROUND(COALESCE(SUM(hours_overtime),0),2) AS hours_overtime,
       COALESCE(SUM(late_minutes),0) AS late_minutes,
       SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS days_present,
       SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) AS days_absent,
       SUM(CASE WHEN status='conge' THEN 1 ELSE 0 END) AS days_leave,
       SUM(CASE WHEN status='retard' THEN 1 ELSE 0 END) AS days_late
     FROM attendance WHERE employee_id = ? AND att_date BETWEEN date(?) AND date(?)`,
    [employeeId, start, end],
  );
  return row;
}

/* ===========================================================================
 *  PAIE
 * ========================================================================= */

/**
 * Calcule (sans persister) le bulletin d'un employé pour une période.
 * Taux lus dans les paramètres — jamais codés en dur.
 */
export function computePayroll(employeeId, period, overrides = {}) {
  const employee = get('SELECT * FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw notFound('Employé introuvable.');
  const p = requirePeriod(period);
  const summary = attendanceSummary(employeeId, p);

  const hoursNormalParam = Number(getSetting('payroll_monthly_hours', 191));
  const hoursNormal = overrides.hoursNormal !== undefined
    ? Number(overrides.hoursNormal)
    : (summary.hours_normal > 0 ? summary.hours_normal : hoursNormalParam);
  const hoursOvertime = overrides.hoursOvertime !== undefined
    ? Number(overrides.hoursOvertime)
    : Number(summary.hours_overtime || 0);

  const result = payrollCompute({
    baseSalary: overrides.baseSalary !== undefined ? overrides.baseSalary : employee.base_salary,
    hoursNormal,
    hoursOvertime,
    hourlyRate: overrides.hourlyRate ?? null,
    overtimeRate: overrides.overtimeRate !== undefined
      ? Number(overrides.overtimeRate)
      : Number(getSetting('payroll_overtime_rate', 1.25)),
    primes: overrides.primes !== undefined ? overrides.primes : 0,
    advances: overrides.advances !== undefined ? overrides.advances : (overrides.avances ?? 0),
    retenues: overrides.retenues !== undefined ? overrides.retenues : 0,
    cnssEmployeeRate: overrides.cnssEmployeeRate !== undefined
      ? Number(overrides.cnssEmployeeRate)
      : Number(getSetting('payroll_cnss_employee_rate', 0)),
    cnssEmployerRate: overrides.cnssEmployerRate !== undefined
      ? Number(overrides.cnssEmployerRate)
      : Number(getSetting('payroll_cnss_employer_rate', 0)),
    irppRate: overrides.irppRate !== undefined
      ? Number(overrides.irppRate)
      : Number(getSetting('payroll_irpp_rate', 0)),
  });

  return {
    employee: {
      id: employee.id, code: employee.code,
      name: `${employee.first_name} ${employee.last_name}`,
      function: employee.function,
    },
    period: p,
    attendance: summary,
    ...result,
  };
}

/**
 * Enregistre le bulletin de paie (brouillon ou validé).
 */
export function savePayroll(employeeId, period, overrides = {}, ip = null) {
  const computed = computePayroll(employeeId, period, overrides);
  const existing = get('SELECT * FROM payroll_records WHERE employee_id = ? AND period = ?', [
    employeeId, computed.period,
  ]);
  const status = overrides.status === 'valide' ? 'valide' : (existing ? existing.status : 'brouillon');
  if (existing && existing.status === 'valide' && overrides.force !== true) {
    throw badRequest('Ce bulletin est validé : repassez-le en brouillon pour le modifier.');
  }

  return transaction(() => {
    run(
      `INSERT INTO payroll_records
        (employee_id, period, base_salary, hours_normal, hours_overtime, overtime_amount, primes,
         gross, cnss_employee, cnss_employer, irpp, advances, retenues, net, total_employer_cost,
         status, details_json, notes, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, period) DO UPDATE SET
         base_salary = excluded.base_salary, hours_normal = excluded.hours_normal,
         hours_overtime = excluded.hours_overtime, overtime_amount = excluded.overtime_amount,
         primes = excluded.primes, gross = excluded.gross, cnss_employee = excluded.cnss_employee,
         cnss_employer = excluded.cnss_employer, irpp = excluded.irpp, advances = excluded.advances,
         retenues = excluded.retenues, net = excluded.net,
         total_employer_cost = excluded.total_employer_cost, status = excluded.status,
         details_json = excluded.details_json, notes = excluded.notes,
         validated_at = excluded.validated_at`,
      [employeeId, computed.period, computed.baseSalary, computed.hoursNormal, computed.hoursOvertime,
       computed.overtimeAmount, computed.primes, computed.gross, computed.cnssEmployee,
       computed.cnssEmployer, computed.irpp, computed.advances, computed.retenues, computed.net,
       computed.totalEmployerCost, status, JSON.stringify(computed),
       overrides.notes || null, status === 'valide' ? nowSql() : null],
    );
    audit({ action: status === 'valide' ? 'validate' : 'update', entity: 'payroll',
      entityId: `${employeeId}:${computed.period}`,
      summary: `Bulletin ${computed.period} — ${computed.employee.name} : net ${computed.net} DT`, ip });
    return get('SELECT * FROM payroll_records WHERE employee_id = ? AND period = ?', [employeeId, computed.period]);
  });
}

/** Liste des bulletins d'une période. */
export function payrollPeriod(period) {
  const p = requirePeriod(period);
  const rows = all(
    `SELECT pr.*, e.code, e.first_name, e.last_name, e.function
     FROM payroll_records pr JOIN employees e ON e.id = pr.employee_id
     WHERE pr.period = ? ORDER BY e.last_name`,
    [p],
  );
  const totals = rows.reduce(
    (acc, r) => ({
      gross: roundMoney(acc.gross + r.gross),
      cnssEmployee: roundMoney(acc.cnssEmployee + r.cnss_employee),
      cnssEmployer: roundMoney(acc.cnssEmployer + r.cnss_employer),
      irpp: roundMoney(acc.irpp + r.irpp),
      net: roundMoney(acc.net + r.net),
      employerCost: roundMoney(acc.employerCost + r.total_employer_cost),
    }),
    { gross: 0, cnssEmployee: 0, cnssEmployer: 0, irpp: 0, net: 0, employerCost: 0 },
  );
  return { period: p, rows, totals };
}

/**
 * EXPORT POUR LE COMPTABLE : lignes normalisées prêtes pour un tableur.
 */
export function payrollExport(period) {
  const { rows, totals } = payrollPeriod(period);
  const lines = rows.map((r) => ({
    Matricule: r.code,
    Nom: r.last_name,
    Prénom: r.first_name,
    Fonction: r.function || '',
    Période: r.period,
    'Salaire de base': r.base_salary,
    'Heures normales': r.hours_normal,
    'Heures sup.': r.hours_overtime,
    'Montant heures sup.': r.overtime_amount,
    Primes: r.primes,
    'Brut imposable': r.gross,
    'CNSS salarié': r.cnss_employee,
    'CNSS employeur': r.cnss_employer,
    IRPP: r.irpp,
    Avances: r.advances,
    Retenues: r.retenues,
    Net: r.net,
    'Coût employeur': r.total_employer_cost,
    Statut: r.status,
  }));
  return {
    period,
    lines,
    totals,
    disclaimer:
      'Export préparatoire. Les taux appliqués proviennent des paramètres saisis et doivent être ' +
      'vérifiés par le comptable. Ce logiciel n’est pas un système de paie homologué.',
  };
}
