/**
 * ============================================================================
 *  Service RAPPORTS & EXPORTS (PDF, Excel, CSV)
 * ----------------------------------------------------------------------------
 *  Chaque rapport conserve la traçabilité : les totaux proviennent du moteur
 *  analytique, et le détail (drill-down) est inclus ou exportable.
 *  Les libellés rappellent systématiquement les avertissements comptables.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { get, all, getSetting } from '../db/index.js';
import { requirePeriod } from '../lib/errors.js';
import { periodBounds } from '../lib/numbering.js';
import { computeMonth, consumptionByKitchen, explainPost, comparePeriods, previousMonth, sameMonthLastYear } from './analytics.js';
import { transfersClosing } from './transfers.js';
import { lossesReport } from './losses.js';
import { expensesByCategory, expensesTotal } from './cash.js';
import { productionYields, transformationYields } from './production.js';
import { staffMonthlyReport } from './staff.js';
import { salesAnalysis } from './sales.js';
import { roundMoney, formatMoney, roundPct } from '../../shared/formulas.js';

const DISCLAIMER =
  'Document de gestion interne. Ne constitue pas un document comptable certifié ni une déclaration fiscale. ' +
  'À valider avec votre comptable (méthode de valorisation, TVA, repas du personnel, traitement des avaries).';

/**
 * Assemble le rapport mensuel complet (données structurées réutilisables).
 * @param {string} period YYYY-MM
 */
export function monthlyReport(period) {
  const p = requirePeriod(period);
  const { start, end } = periodBounds(p);
  const metrics = computeMonth(p);
  const closing = get('SELECT * FROM monthly_closings WHERE period = ?', [p]);

  const prev = previousMonth(p);
  const lastYear = sameMonthLastYear(p);
  const prevExists = all('SELECT 1 FROM sales WHERE ?', [1]).length >= 0; // toujours vrai
  const comparison = comparePeriods(p, prev);

  const report = {
    period: p,
    from: start,
    to: end,
    generatedAt: new Date().toISOString(),
    restaurant: {
      name: getSetting('restaurant_name', 'Mon Restaurant'),
      address: getSetting('restaurant_address', ''),
      taxId: getSetting('restaurant_tax_id', ''),
    },
    metrics,
    closing: closing || null,
    comparison,
    comparisonLastYear: comparePeriods(p, lastYear),
    byKitchen: consumptionByKitchen(start, end),
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
    warnings: [
      'La marge restante avant autres charges n’est pas un bénéfice net.',
      'Le résultat de gestion estimatif exclut les obligations fiscales et sociales non encore comptabilisées.',
      'Les transferts internes ne créent aucun coût : ils ne sont ni des achats ni des consommations.',
      'Une avarie déjà incluse dans le coût consommé n’est jamais ajoutée une seconde fois.',
    ],
    disclaimer: DISCLAIMER,
  };
  return report;
}

/* ===========================================================================
 *  EXPORT PDF
 * ========================================================================= */

const COLORS = {
  primary: '#166534',
  dark: '#111827',
  gray: '#6B7280',
  light: '#F3F4F6',
  danger: '#B91C1C',
  success: '#15803D',
};

/**
 * Génère le PDF du rapport mensuel.
 * @param {string} period
 * @returns {Promise<Buffer>}
 */
export function monthlyReportPdf(period) {
  const report = monthlyReport(period);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const M = 40;
      const W = doc.page.width - M * 2;

      const rule = (y) => {
        doc.moveTo(M, y).lineTo(M + W, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      };

      // --- En-tête ---
      doc.rect(0, 0, doc.page.width, 96).fill(COLORS.primary);
      doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold')
        .text('Rapport mensuel', M, 32);
      doc.fontSize(11).font('Helvetica')
        .text(`${report.restaurant.name} — période ${report.period}`, M, 60);
      doc.fontSize(8).fillColor('#D1FAE5')
        .text(`Généré le ${new Date(report.generatedAt).toLocaleString('fr-FR')}`, M, 76);

      doc.y = 120;
      doc.fillColor(COLORS.dark);

      /** Titre de section */
      const section = (title) => {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.moveDown(0.6);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.primary).text(title.toUpperCase());
        doc.moveDown(0.2);
        rule(doc.y);
        doc.moveDown(0.4);
        doc.fillColor(COLORS.dark).fontSize(9).font('Helvetica');
      };

      /** Ligne label/valeur avec drill-down implicite */
      const kv = (label, value, opts = {}) => {
        const y = doc.y;
        doc.fontSize(9).font('Helvetica').fillColor(opts.muted ? COLORS.gray : COLORS.dark)
          .text(label, M + 6, y, { width: W * 0.62 });
        doc.font('Helvetica-Bold').fillColor(opts.color || COLORS.dark)
          .text(value, M + W * 0.66, y, { width: W * 0.34 - 6, align: 'right' });
        doc.y = y + 15;
      };

      // --- Indicateurs clés ---
      section('Indicateurs clés');
      const m = report.metrics;
      kv('Chiffre d’affaires HT', formatMoney(m.revenueHt));
      kv('Achats réceptionnés', formatMoney(m.purchasesReceived));
      kv('Stock d’ouverture (matières)', formatMoney(m.openingStock));
      kv('Stock de clôture (matières)', formatMoney(m.closingStock));
      kv('Consommation valorisée', formatMoney(m.consumption));
      kv(`Avaries non incluses (${m.lossesNotIncludedCount})`, formatMoney(m.lossesNotIncluded));
      if (m.staffMealsDeducted > 0) {
        kv('Repas du personnel (retirés du ratio)', `− ${formatMoney(m.staffMealsDeducted)}`);
      }
      kv('Coût matière retenu', formatMoney(m.retainedCost), { color: COLORS.primary });
      kv(`Ratio matière global`, `${m.ratioPct} %`, {
        color: m.targetReached ? COLORS.success : COLORS.danger,
      });
      kv('Objectif', `${m.objectivePct} %`);
      kv('Coût maximal autorisé', formatMoney(m.maxAllowedCost));
      kv(`Écart`, `${m.gapPoints > 0 ? '+' : ''}${m.gapPoints} pts`, {
        color: m.gapPoints > 0 ? COLORS.danger : COLORS.success,
      });
      if (m.overrunAmount > 0) {
        kv('Dépassement', formatMoney(m.overrunAmount), { color: COLORS.danger });
      }
      kv('Marge restante avant autres charges', formatMoney(m.marginBeforeOtherCharges));
      kv('Dépenses hors matières', formatMoney(m.otherExpenses));
      kv('Résultat de gestion ESTIMATIF', formatMoney(m.estimatedResult), { muted: true });

      // --- Comparaison ---
      section('Comparaison avec le mois précédent');
      const ev = report.comparison.evolution;
      kv(`CA HT ${report.comparison.periodB} → ${report.period}`,
        `${formatMoney(ev.revenueHt.previous)} → ${formatMoney(ev.revenueHt.current)} ` +
        `(${ev.revenueHt.deltaPct > 0 ? '+' : ''}${ev.revenueHt.deltaPct} %)`);
      kv('Ratio matière (évolution)',
        `${ev.ratioPct.previous} % → ${ev.ratioPct.current} % ` +
        `(${ev.ratioPct.deltaPoints > 0 ? '+' : ''}${ev.ratioPct.deltaPoints} pts)`);
      kv('Coût retenu (évolution)',
        `${formatMoney(ev.retainedCost.previous)} → ${formatMoney(ev.retainedCost.current)}`);

      // --- Consommations par cuisine ---
      section('Consommations par cuisine');
      for (const k of report.byKitchen) {
        kv(k.kitchen_name, formatMoney(k.consumed));
      }
      doc.fontSize(7.5).fillColor(COLORS.gray)
        .text('Les transferts entre cuisines sont neutres : ils ne modifient pas le coût global.', M + 6, doc.y, { width: W });
      doc.moveDown(0.4);

      // --- Transferts ---
      section('Transferts internes (clôture)');
      kv('Nombre de transferts validés', String(report.transfers.count));
      kv('Quantité totale transférée', String(report.transfers.totalQty));
      kv('Valeur totale transférée (sans impact coût)', formatMoney(report.transfers.totalValue));
      if (report.transfers.drafts > 0) {
        kv('Transferts en brouillon (non comptés)', String(report.transfers.drafts), { color: COLORS.danger });
      }

      // --- Pertes ---
      section('Avaries et pertes');
      kv('Valeur totale des pertes', formatMoney(report.losses.totalValue));
      kv('Dont déjà incluses dans le coût consommé', formatMoney(report.losses.includedValue));
      kv('Dont NON incluses (ajoutées au ratio)', formatMoney(report.losses.notIncludedValue), { color: COLORS.danger });
      doc.moveDown(0.4);
      if (report.losses.byType.length) {
        doc.fontSize(9).font('Helvetica-Bold').text('Répartition par type', M + 6);
        doc.moveDown(0.2);
        for (const t of report.losses.byType.slice(0, 8)) {
          kv(`  ${t.label} (${t.count})`, formatMoney(t.value));
        }
      }

      // --- Production / transformation ---
      section('Productions et rendements');
      const validProd = report.production.filter((x) => x.yield_pct !== null);
      if (validProd.length) {
        const avg = roundPct(validProd.reduce((a, x) => a + x.yield_pct, 0) / validProd.length);
        kv(`Productions validées (${report.production.length})`, `rendement moyen ${avg} %`);
      } else {
        kv('Aucune production validée sur la période', '—', { muted: true });
      }
      if (report.transformation.length) {
        const tf = report.transformation;
        const avgYield = roundPct(tf.reduce((a, x) => a + x.yield_pct, 0) / tf.length);
        const avgLoss = roundPct(tf.reduce((a, x) => a + x.loss_pct, 0) / tf.length);
        kv(`Transformations (${tf.length})`, `rendement ${avgYield} % · perte ${avgLoss} %`);
        const abnormal = tf.filter((x) => x.loss_type === 'anormale');
        if (abnormal.length) {
          kv('Dont pertes anormales', `${abnormal.length}`, { color: COLORS.danger });
        }
      }

      // --- Repas personnel ---
      section('Repas du personnel (hors ventes)');
      kv('Transferts reçus', formatMoney(report.staffMeals.transfersIn));
      kv('Achats directs', formatMoney(report.staffMeals.directPurchases));
      kv('Coût des repas consommés', formatMoney(report.staffMeals.mealsConsumed));
      kv('Pertes', formatMoney(report.staffMeals.losses));
      kv('Intégré au ratio matière ?', report.staffMeals.includedInRatio ? 'OUI' : 'NON (paramètre)');

      // --- Dépenses ---
      section('Dépenses hors matières');
      kv('Total', formatMoney(report.expenses.total.total));
      for (const c of report.expenses.byCategory.slice(0, 9)) {
        kv(`  ${labelize(c.category)}`, formatMoney(c.total));
      }

      // --- Ventes ---
      section('Ventes par catégorie');
      for (const c of report.sales.byCategory.slice(0, 10)) {
        kv(`${c.category}`, `${formatMoney(c.revenue_ht)} · marge ${formatMoney(c.margin)}`);
      }

      // --- Avertissements ---
      if (doc.y > doc.page.height - 190) doc.addPage();
      section('Avertissements');
      doc.fontSize(7.5).fillColor(COLORS.gray);
      for (const w of report.warnings) {
        doc.text(`• ${w}`, M + 6, doc.y, { width: W });
        doc.moveDown(0.25);
      }
      doc.moveDown(0.5);
      doc.fontSize(7).fillColor(COLORS.danger).text(DISCLAIMER, M + 6, doc.y, { width: W });

      // --- Pieds de page ---
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.fontSize(7).fillColor(COLORS.gray)
          .text(
            `${report.restaurant.name} · Rapport ${report.period} · page ${i + 1}/${range.count}`,
            M, doc.page.height - 30, { width: W, align: 'center' },
          );
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function labelize(code) {
  return String(code || '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/* ===========================================================================
 *  EXPORT EXCEL
 * ========================================================================= */

/**
 * Génère le classeur Excel multi-feuilles du rapport mensuel.
 * @param {string} period
 * @returns {Promise<Buffer>}
 */
export async function monthlyReportXlsx(period) {
  const report = monthlyReport(period);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Chef Cuisine Manager';
  wb.created = new Date();

  const headerStyle = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } },
    alignment: { vertical: 'middle' },
  };
  const money = '#,##0.000';
  const pct = '0.00" %"';

  /** Ajoute une feuille tabulaire. */
  const addSheet = (name, columns, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns;
    ws.getRow(1).eachCell((cell) => Object.assign(cell, headerStyle));
    rows.forEach((r) => ws.addRow(r));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  };

  // 1. Synthèse
  const m = report.metrics;
  const syn = wb.addWorksheet('Synthèse');
  syn.columns = [{ width: 46 }, { width: 20 }, { width: 20 }, { width: 20 }];
  syn.addRow(['RAPPORT MENSUEL', report.period]).font = { bold: true, size: 14 };
  syn.addRow([report.restaurant.name]);
  syn.addRow([]);
  syn.addRow(['Indicateur', 'Valeur', `Objectif/Seuil`, `Écart`]).eachCell((c) => Object.assign(c, headerStyle));
  const rows = [
    ['Chiffre d’affaires HT', m.revenueHt, '', ''],
    ['Achats réceptionnés', m.purchasesReceived, '', ''],
    ['Stock d’ouverture (matières)', m.openingStock, '', ''],
    ['Stock de clôture (matières)', m.closingStock, '', ''],
    ['Consommation valorisée', m.consumption, '', ''],
    ['Avaries non incluses', m.lossesNotIncluded, '', ''],
    ['Repas du personnel retirés', m.staffMealsDeducted, '', ''],
    ['Coût matière retenu', m.retainedCost, m.maxAllowedCost, -m.overrunAmount],
    ['Ratio matière (%)', m.ratioPct, m.objectivePct, m.gapPoints],
    ['Marge restante avant autres charges', m.marginBeforeOtherCharges, '', ''],
    ['Dépenses hors matières', m.otherExpenses, '', ''],
    ['Résultat de gestion ESTIMATIF', m.estimatedResult, '', ''],
  ];
  rows.forEach((r) => {
    const row = syn.addRow(r);
    row.getCell(2).numFmt = money;
    row.getCell(3).numFmt = money;
    row.getCell(4).numFmt = money;
  });
  // Formats spécifiques au ratio
  syn.getRow(11).getCell(2).numFmt = pct;
  syn.getRow(11).getCell(3).numFmt = pct;
  syn.getRow(11).getCell(4).numFmt = '0.00" pts"';
  syn.addRow([]);
  syn.addRow([DISCLAIMER]).font = { italic: true, size: 8, color: { argb: 'FFB91C1C' } };

  // 2. Achats (drill-down)
  addSheet('Achats',
    [
      { header: 'Date', key: 'd', width: 18 },
      { header: 'Produit', key: 'p', width: 30 },
      { header: 'Cuisine', key: 'k', width: 22 },
      { header: 'Qté', key: 'q', width: 12 },
      { header: 'Unité', key: 'u', width: 10 },
      { header: 'Coût unitaire', key: 'cu', width: 15, style: { numFmt: money } },
      { header: 'Total', key: 't', width: 15, style: { numFmt: money } },
      { header: 'Document', key: 'doc', width: 18 },
    ],
    report.drillDown.purchases.map((r) => ({
      d: r.occurred_at, p: r.product_name, k: r.kitchen_name, q: r.qty, u: r.unit,
      cu: r.unit_cost, t: r.total_cost, doc: r.document,
    })),
  );

  // 3. Avaries
  addSheet('Avaries',
    [
      { header: 'N°', key: 'n', width: 18 },
      { header: 'Date', key: 'd', width: 18 },
      { header: 'Produit', key: 'p', width: 30 },
      { header: 'Cuisine', key: 'k', width: 22 },
      { header: 'Qté', key: 'q', width: 10 },
      { header: 'Valeur', key: 'v', width: 15, style: { numFmt: money } },
      { header: 'Type', key: 't', width: 22 },
      { header: 'Déjà incluse', key: 'i', width: 14 },
      { header: 'Motif', key: 'r', width: 40 },
    ],
    report.losses.details.map((r) => ({
      n: r.number, d: r.occurred_at, p: r.product, k: r.kitchen, q: r.qty, v: r.total_cost,
      t: r.loss_type_label, i: r.already_in_consumption ? 'OUI' : 'NON', r: r.reason,
    })),
  );

  // 4. Transferts
  addSheet('Transferts',
    [
      { header: 'N°', key: 'n', width: 18 },
      { header: 'Date', key: 'd', width: 18 },
      { header: 'Produit', key: 'p', width: 28 },
      { header: 'Source', key: 's', width: 24 },
      { header: 'Destination', key: 'dd', width: 24 },
      { header: 'Qté', key: 'q', width: 10 },
      { header: 'Valeur', key: 'v', width: 14, style: { numFmt: money } },
      { header: 'Statut', key: 'st', width: 12 },
      { header: 'Motif', key: 'r', width: 32 },
    ],
    report.transfers.details.map((r) => ({
      n: r.number, d: r.occurred_at, p: r.product_name, s: r.source_name, dd: r.dest_name,
      q: r.qty, v: r.total_cost, st: r.status, r: r.reason,
    })),
  );

  // 5. Stock de clôture (drill-down)
  addSheet('Stock clôture',
    [
      { header: 'Code', key: 'c', width: 14 },
      { header: 'Produit', key: 'p', width: 32 },
      { header: 'Type', key: 't', width: 20 },
      { header: 'Qté', key: 'q', width: 12 },
      { header: 'Unité', key: 'u', width: 10 },
      { header: 'Coût unitaire', key: 'cu', width: 15, style: { numFmt: money } },
      { header: 'Valeur', key: 'v', width: 15, style: { numFmt: money } },
    ],
    report.drillDown.closingStock.map((r) => ({
      c: r.code, p: r.name, t: r.type, q: r.qty, u: r.unit, cu: r.unit_cost, v: r.value,
    })),
  );

  // 6. Dépenses
  addSheet('Dépenses',
    [{ header: 'Catégorie', key: 'c', width: 30 },
     { header: 'Montant', key: 'v', width: 16, style: { numFmt: money } },
     { header: 'Nombre', key: 'n', width: 12 }],
    report.expenses.byCategory.map((r) => ({ c: labelize(r.category), v: r.total, n: r.count })),
  );

  // 7. Ventes par plat
  addSheet('Ventes',
    [
      { header: 'Code', key: 'c', width: 14 },
      { header: 'Produit', key: 'p', width: 30 },
      { header: 'Catégorie', key: 'cat', width: 20 },
      { header: 'Qté vendue', key: 'q', width: 12 },
      { header: 'CA HT', key: 'r', width: 15, style: { numFmt: money } },
      { header: 'Coût', key: 'co', width: 14, style: { numFmt: money } },
      { header: 'Marge', key: 'mg', width: 14, style: { numFmt: money } },
      { header: 'Ratio %', key: 'ra', width: 12, style: { numFmt: pct } },
    ],
    report.sales.byProduct.map((r) => ({
      c: r.code, p: r.name, cat: r.category_name, q: r.qty, r: r.revenue_ht,
      co: r.cost, mg: r.margin, ra: r.ratio_pct,
    })),
  );

  // 8. Comparaison
  addSheet('Comparaison',
    [{ header: 'Indicateur', key: 'i', width: 34 },
     { header: report.comparison.periodB, key: 'b', width: 18, style: { numFmt: money } },
     { header: report.period, key: 'a', width: 18, style: { numFmt: money } },
     { header: 'Écart %', key: 'e', width: 14, style: { numFmt: pct } }],
    Object.entries(report.comparison.evolution).map(([k, v]) => ({
      i: labelize(k), b: v.previous, a: v.current,
      e: v.deltaPct !== undefined ? v.deltaPct : v.deltaPoints,
    })),
  );

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ===========================================================================
 *  EXPORT CSV
 * ========================================================================= */

/**
 * Export CSV générique (séparateur « ; », BOM ajouté par la route).
 * @param {string} period
 * @param {'movements'|'purchases'|'losses'|'transfers'|'stock'|'sales'|'expenses'} type
 */
export function csvExport(period, type = 'movements') {
  const p = requirePeriod(period);
  const { start, end } = periodBounds(p);

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  };
  const toCsv = (headers, rows) =>
    [headers.join(';'), ...rows.map((r) => r.map(escape).join(';'))].join('\r\n');

  switch (type) {
    case 'purchases': {
      const rows = explainPost('purchases', start, end).map((r) => [
        r.occurred_at, r.document || '', r.product_name, r.kitchen_name,
        r.qty, r.unit, r.unit_cost, r.total_cost,
      ]);
      return toCsv(['Date', 'Document', 'Produit', 'Cuisine', 'Quantité', 'Unité', 'Coût unitaire', 'Total'], rows);
    }
    case 'losses': {
      const rep = lossesReport(start, end);
      const rows = rep.details.map((r) => [
        r.number, r.occurred_at, r.product, r.kitchen, r.qty, r.unit,
        r.unit_cost, r.total_cost, r.loss_type_label,
        r.already_in_consumption ? 'OUI' : 'NON', r.reason || '',
      ]);
      return toCsv(
        ['N°', 'Date', 'Produit', 'Cuisine', 'Quantité', 'Unité', 'Coût unitaire', 'Valeur', 'Type', 'Déjà incluse', 'Motif'],
        rows,
      );
    }
    case 'transfers': {
      const tr = transfersClosing(p);
      const rows = tr.details.map((r) => [
        r.number, r.occurred_at, r.product_name, r.source_name, r.dest_name,
        r.qty, r.unit, r.unit_cost, r.total_cost, r.status, r.reason || '',
      ]);
      return toCsv(
        ['N°', 'Date', 'Produit', 'Source', 'Destination', 'Quantité', 'Unité', 'Coût unitaire', 'Valeur', 'Statut', 'Motif'],
        rows,
      );
    }
    case 'stock': {
      const rows = explainPost('closing', start, end).map((r) => [
        r.code, r.name, r.type, r.qty, r.unit, r.unit_cost, r.value,
      ]);
      return toCsv(['Code', 'Produit', 'Type', 'Quantité', 'Unité', 'Coût unitaire', 'Valeur'], rows);
    }
    case 'sales': {
      const rows = all(
        `SELECT s.number, s.occurred_at, s.subtotal_ht, s.discount, s.tax, s.total_ttc,
                s.payment_method, s.status
         FROM sales s WHERE date(s.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY s.occurred_at`,
        [start, end],
      ).map((r) => [r.number, r.occurred_at, r.subtotal_ht, r.discount, r.tax, r.total_ttc,
        r.payment_method, r.status]);
      return toCsv(['N°', 'Date', 'Sous-total HT', 'Remise', 'TVA', 'TTC', 'Paiement', 'Statut'], rows);
    }
    case 'expenses': {
      const rows = all(
        `SELECT number, expense_date, category, amount, payment_method, beneficiary, reference
         FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?) ORDER BY expense_date`,
        [start, end],
      ).map((r) => [r.number, r.expense_date, labelize(r.category), r.amount,
        r.payment_method, r.beneficiary || '', r.reference || '']);
      return toCsv(['N°', 'Date', 'Catégorie', 'Montant', 'Paiement', 'Bénéficiaire', 'Référence'], rows);
    }
    default: {
      const rows = all(
        `SELECT m.occurred_at, m.movement_type, m.direction, p.code, p.name, k.name AS kitchen,
                m.qty, m.unit, m.unit_cost, m.total_cost, m.reason
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         JOIN kitchens k ON k.id = m.kitchen_id
         WHERE date(m.occurred_at) BETWEEN date(?) AND date(?)
         ORDER BY m.occurred_at, m.id`,
        [start, end],
      ).map((r) => [r.occurred_at, r.movement_type, r.direction, r.code, r.name, r.kitchen,
        r.qty, r.unit, r.unit_cost, r.total_cost, r.reason || '']);
      return toCsv(
        ['Date', 'Type de mouvement', 'Sens', 'Code', 'Produit', 'Cuisine', 'Quantité',
          'Unité', 'Coût unitaire', 'Total', 'Motif'],
        rows,
      );
    }
  }
}
