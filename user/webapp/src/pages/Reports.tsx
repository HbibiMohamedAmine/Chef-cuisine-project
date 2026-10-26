import React from 'react';
import { FileBarChart, Download, FileText, Table2, Printer, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react';
import { api, qs, downloadFile } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState,
  Field, Input, Loading, PageHeader, Select, RatioGauge,
} from '@/components/ui';
import { cn, currentMonth, formatPeriod, formatDate, monthBounds } from '@/lib/utils';

export default function ReportsPage() {
  const { error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [csvType, setCsvType] = React.useState('movements');
  const [loadingExport, setLoadingExport] = React.useState<string | null>(null);
  const [openSection, setOpenSection] = React.useState<string | null>('metrics');

  const { data, loading, error, reload } = useApi(
    () => api.get<any>(`/reports/monthly/${period}`),
    [period],
  );

  const exportFile = async (kind: 'pdf' | 'xlsx' | 'csv') => {
    setLoadingExport(kind);
    try {
      if (kind === 'csv') {
        await downloadFile(`/reports/export/csv${qs({ period, type: csvType })}`, `${csvType}-${period}.csv`);
      } else {
        await downloadFile(`/reports/export/${kind}?period=${period}`, `rapport-${period}.${kind}`);
      }
    } catch (e: any) {
      toastError('Export impossible', e.message);
    } finally {
      setLoadingExport(null);
    }
  };

  const m = data?.metrics;

  return (
    <div>
      <PageHeader
        icon={FileBarChart}
        title="Rapports mensuels"
        description="Rapport global complet, comparaisons, exports PDF et tableur. Chaque montant est rattachable à ses opérations."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
            <Button variant="outline" size="sm" loading={loadingExport === 'csv'} onClick={() => exportFile('csv')}>
              <Table2 className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" loading={loadingExport === 'xlsx'} onClick={() => exportFile('xlsx')}>
              <Table2 className="h-4 w-4" /> Excel
            </Button>
            <Button size="sm" loading={loadingExport === 'pdf'} onClick={() => exportFile('pdf')}>
              <FileText className="h-4 w-4" /> PDF
            </Button>
          </>
        }
      />

      <Card className="mb-4 no-print">
        <CardBody className="flex flex-wrap items-end gap-4">
          <Field label="Période" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Field label="Contenu de l’export CSV" className="w-64">
            <Select value={csvType} onChange={(e) => setCsvType(e.target.value)}>
              <option value="movements">Tous les mouvements de stock</option>
              <option value="purchases">Achats réceptionnés</option>
              <option value="losses">Avaries</option>
              <option value="transfers">Transferts</option>
              <option value="stock">Stock de clôture</option>
              <option value="sales">Ventes</option>
              <option value="expenses">Dépenses</option>
            </Select>
          </Field>
          <Button variant="outline" className="mb-0.5" onClick={reload}>Actualiser</Button>
        </CardBody>
      </Card>

      {loading ? <Loading label="Construction du rapport…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data ? null : (
        <div className="space-y-4">
          {/* ---------- Synthèse ---------- */}
          <Card className="overflow-hidden">
            <div className="bg-primary px-6 py-5 text-white">
              <p className="text-xs uppercase tracking-wider text-emerald-100">Rapport mensuel</p>
              <h2 className="mt-1 text-xl font-semibold">{formatPeriod(period)}</h2>
              <p className="mt-0.5 text-sm text-emerald-100">
                {data.restaurant.name} · généré le {formatDate(data.generatedAt.slice(0, 10))}
              </p>
            </div>
            <CardBody>
              <RatioGauge ratio={m.ratioPct} objective={m.objectivePct} />
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <Kpi label="CA HT" value={formatMoney(m.revenueHt)} />
                <Kpi label="Coût matière retenu" value={formatMoney(m.retainedCost)} strong />
                <Kpi label="Ratio matière" value={formatPct(m.ratioPct)} tone={m.targetReached === false ? 'danger' : 'success'} strong />
                <Kpi label="Marge restante" value={formatMoney(m.marginBeforeOtherCharges)} />
              </dl>
            </CardBody>
          </Card>

          <Section
            id="metrics"
            title="Détail du calcul du coût matière"
            subtitle="Chaque ligne est rattachable aux opérations (drill-down)"
            open={openSection === 'metrics'}
            onToggle={() => setOpenSection(openSection === 'metrics' ? null : 'metrics')}
          >
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Élément</th>
                    <th className="text-right">Montant</th>
                    <th>Origine / justification</th>
                  </tr>
                </thead>
                <tbody>
                  <CalcRow label="Stock d’ouverture (matières)" value={m.openingStock} hint={`${m.openingStock ? data.drillDown.openingStock.length : 0} produit(s) valorisé(s)`} />
                  <CalcRow label="+ Achats réceptionnés" value={m.purchasesReceived} positive hint={`${m.purchasesCount} réception(s)`} />
                  <CalcRow label="− Retours fournisseurs" value={-m.returns} hint="sorties vers fournisseurs" />
                  <CalcRow label={`${m.adjustments >= 0 ? '+' : '−'} Ajustements justifiés`} value={m.adjustments} hint="inventaires et corrections tracées" />
                  <CalcRow label="− Stock de clôture (matières)" value={-m.closingStock} hint={`${data.drillDown.closingStock.length} produit(s)`} />
                  <CalcRow label="= Consommation valorisée" value={m.consumption} strong />
                  <CalcRow label="+ Avaries NON déjà incluses" value={m.lossesNotIncluded} positive hint={`${m.lossesNotIncludedCount} avarie(s)`} />
                  {m.staffMealsDeducted > 0 && (
                    <CalcRow label="− Repas du personnel (exclus du ratio)" value={-m.staffMealsDeducted} hint="paramètre actif" />
                  )}
                  <CalcRow label="= Coût matière retenu" value={m.retainedCost} strong highlight />
                  <CalcRow label="Coût maximal autorisé (CA × objectif)" value={m.maxAllowedCost} hint={`objectif ${m.objectivePct} %`} />
                  <CalcRow label="Dépassement" value={m.overrunAmount} tone={m.overrunAmount > 0 ? 'danger' : undefined} />
                </tbody>
              </table>
            </div>
            <Alert tone="info" className="mt-4" title="Règle anti-double comptage appliquée">
              Les produits fabriqués (semi-finis, plats) sont exclus du solde matière : leur coût a déjà
              été capturé lors de la sortie des ingrédients en production. Les transferts sont neutres.
            </Alert>
          </Section>

          <Section
            id="kitchens"
            title="Consommations par cuisine"
            open={openSection === 'kitchens'}
            onToggle={() => setOpenSection(openSection === 'kitchens' ? null : 'kitchens')}
          >
            <table className="table-base">
              <thead><tr><th>Cuisine</th><th className="text-right">Matières consommées</th><th className="text-right">Matières entrées</th><th className="text-right">Total sorties</th><th className="text-right">Total entrées</th></tr></thead>
              <tbody>
                {data.byKitchen.map((k: any) => (
                  <tr key={k.id}>
                    <td className="text-sm font-medium">{k.kitchen_name}</td>
                    <td className="tabular text-right text-xs">{formatMoney(k.consumed)}</td>
                    <td className="tabular text-right text-xs">{formatMoney(k.entered)}</td>
                    <td className="tabular text-right text-xs text-slate-500">{formatMoney(k.all_out)}</td>
                    <td className="tabular text-right text-xs text-slate-500">{formatMoney(k.all_in)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            id="transfers"
            title="Transferts internes"
            subtitle="Aucun impact sur le coût matière global"
            open={openSection === 'transfers'}
            onToggle={() => setOpenSection(openSection === 'transfers' ? null : 'transfers')}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Mini label="Transferts validés" value={String(data.transfers.count)} />
              <Mini label="Quantité totale" value={String(data.transfers.totalQty)} />
              <Mini label="Valeur transférée" value={formatMoney(data.transfers.totalValue)} />
              <Mini label="En brouillon" value={String(data.transfers.drafts)} tone={data.transfers.drafts ? 'warning' : 'neutral'} />
            </div>
            {data.transfers.byProduct.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead><tr><th>Produit</th><th className="text-right">Nombre</th><th className="text-right">Quantité</th><th className="text-right">Valeur</th></tr></thead>
                  <tbody>
                    {data.transfers.byProduct.map((p: any) => (
                      <tr key={p.product_id}>
                        <td className="text-sm">{p.product_name}</td>
                        <td className="tabular text-right text-xs">{p.count}</td>
                        <td className="tabular text-right text-xs">{p.qty} {p.unit}</td>
                        <td className="tabular text-right text-xs">{formatMoney(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-500">{data.transfers.note}</p>
          </Section>

          <Section
            id="losses"
            title="Avaries et pertes"
            open={openSection === 'losses'}
            onToggle={() => setOpenSection(openSection === 'losses' ? null : 'losses')}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Mini label="Total pertes" value={formatMoney(data.losses.totalValue)} tone="danger" />
              <Mini label="Déjà incluses" value={formatMoney(data.losses.includedValue)} />
              <Mini label="Ajoutées au ratio" value={formatMoney(data.losses.notIncludedValue)} tone={data.losses.notIncludedValue > 0 ? 'danger' : 'neutral'} />
              <Mini label="Déclarations" value={String(data.losses.count)} />
            </div>
            {data.losses.byType.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.losses.byType.map((t: any) => (
                  <div key={t.code} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                    <span className="text-xs text-slate-700">{t.label}</span>
                    <span className="tabular text-xs font-semibold text-red-600">{formatMoney(t.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            id="production"
            title="Productions, rendements et repas du personnel"
            open={openSection === 'production'}
            onToggle={() => setOpenSection(openSection === 'production' ? null : 'production')}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Productions</h4>
                {data.production.length === 0 ? (
                  <p className="rounded bg-slate-50 p-3 text-center text-xs text-slate-500">Aucune production.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="table-base">
                      <thead><tr><th>Produit</th><th className="text-right">Produit</th><th className="text-right">Théorique</th><th className="text-right">Rendement</th></tr></thead>
                      <tbody>
                        {data.production.map((p: any) => (
                          <tr key={p.id}>
                            <td className="text-xs">{p.product_name}</td>
                            <td className="tabular text-right text-xs">{p.qty_produced}</td>
                            <td className="tabular text-right text-xs text-slate-500">{p.qty_theoretical}</td>
                            <td className="tabular text-right text-xs">{p.yield_pct !== null ? `${p.yield_pct} %` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Repas du personnel</h4>
                <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
                  <Line label="Transferts reçus" value={formatMoney(data.staffMeals.transfersIn)} />
                  <Line label="Achats directs" value={formatMoney(data.staffMeals.directPurchases)} />
                  <Line label="Repas consommés" value={formatMoney(data.staffMeals.mealsConsumed)} bold />
                  <Line label="Pertes" value={formatMoney(data.staffMeals.losses)} />
                  <Line label="Intégré au ratio" value={data.staffMeals.includedInRatio ? 'Oui' : 'Non (paramètre)'} />
                </div>
              </div>
            </div>
          </Section>

          <Section
            id="expenses"
            title="Dépenses hors matières"
            open={openSection === 'expenses'}
            onToggle={() => setOpenSection(openSection === 'expenses' ? null : 'expenses')}
          >
            <table className="table-base">
              <thead><tr><th>Catégorie</th><th className="text-right">Montant</th><th className="text-right">Part</th></tr></thead>
              <tbody>
                {data.expenses.byCategory.map((c: any) => (
                  <tr key={c.category}>
                    <td className="text-sm">{labelize(c.category)}</td>
                    <td className="tabular text-right text-xs">{formatMoney(c.total)}</td>
                    <td className="tabular text-right text-xs text-slate-500">
                      {data.expenses.total.total > 0 ? ((c.total / data.expenses.total.total) * 100).toFixed(1) : 0} %
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="text-xs uppercase">Total</td>
                  <td className="tabular text-right text-sm">{formatMoney(data.expenses.total.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </Section>

          <Section
            id="comparison"
            title="Comparaison de périodes"
            open={openSection === 'comparison'}
            onToggle={() => setOpenSection(openSection === 'comparison' ? null : 'comparison')}
          >
            <table className="table-base">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th className="text-right">{formatPeriod(data.comparison.periodB.period)}</th>
                  <th className="text-right">{formatPeriod(data.comparison.periodA.period)}</th>
                  <th className="text-right">Évolution</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.comparison.evolution).map(([k, v]: [string, any]) => {
                  const isPct = k === 'ratioPct';
                  const delta = isPct ? v.deltaPoints : v.deltaPct;
                  return (
                    <tr key={k}>
                      <td className="text-sm">{LABELS[k] || k}</td>
                      <td className="tabular text-right text-xs text-slate-500">{isPct ? `${v.previous} %` : formatMoney(v.previous)}</td>
                      <td className="tabular text-right text-sm font-medium">{isPct ? `${v.current} %` : formatMoney(v.current)}</td>
                      <td className={cn('tabular text-right text-xs font-semibold', delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-700' : 'text-slate-400')}>
                        {delta > 0 ? '+' : ''}{delta}{isPct ? ' pts' : ' %'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-slate-500">
              Comparaison également disponible avec le même mois de l’année précédente
              ({formatPeriod(data.comparisonLastYear.periodA.period)} vs {formatPeriod(data.comparisonLastYear.periodB.period)}).
            </p>
          </Section>

          <Card>
            <CardBody>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-600">
                {data.warnings.map((w: string, i: number) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] font-medium text-red-700">
                {data.disclaimer}
              </p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function Section({
  id, title, subtitle, open, onToggle, children,
}: { id: string; title: string; subtitle?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-4">{children}</div>}
    </Card>
  );
}

function Kpi({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('tabular mt-0.5',
        strong ? 'text-base font-semibold' : 'text-sm font-medium',
        tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>
        {value}
      </dd>
    </div>
  );
}

function CalcRow({ label, value, positive, strong, highlight, hint, tone }: {
  label: string; value: number; positive?: boolean; strong?: boolean; highlight?: boolean;
  hint?: string; tone?: 'danger';
}) {
  return (
    <tr className={cn(highlight && 'bg-emerald-50/60')}>
      <td className={cn('text-sm', strong ? 'font-semibold text-slate-900' : 'text-slate-700')}>
        {label}
        {hint && <span className="ml-1.5 text-[10px] text-slate-400">({hint})</span>}
      </td>
      <td className={cn('tabular text-right',
        strong ? 'text-sm font-semibold' : 'text-sm',
        tone === 'danger' ? 'text-red-600' : value < 0 ? 'text-slate-600' : positive ? 'text-emerald-700' : 'text-slate-800')}>
        {formatMoney(value)}
      </td>
      <td />
    </tr>
  );
}

function Mini({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' | 'danger' }) {
  const tones = { neutral: 'text-slate-900', warning: 'text-amber-600', danger: 'text-red-600' };
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-sm font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('tabular text-xs', bold ? 'font-semibold text-slate-900' : 'text-slate-700')}>{value}</span>
    </div>
  );
}

const LABELS: Record<string, string> = {
  revenueHt: 'Chiffre d’affaires HT',
  purchases: 'Achats réceptionnés',
  consumption: 'Consommation valorisée',
  retainedCost: 'Coût matière retenu',
  ratioPct: 'Ratio matière',
  otherExpenses: 'Dépenses hors matières',
  estimatedResult: 'Résultat de gestion estimatif',
};

function labelize(code: string) {
  return String(code || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
