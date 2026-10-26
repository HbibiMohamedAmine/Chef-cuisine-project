import React from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, TrendingDown, Wallet, ShoppingCart, Package,
  AlertTriangle, Percent, Target, ArrowLeftRight, Factory, Clock, CalendarClock,
  Utensils, Receipt, CreditCard,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatMoney, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState,
  ErrorState, Loading, PageHeader, RatioGauge, StatCard,
} from '@/components/ui';
import { cn, formatDate, formatPeriod, MOVEMENT_LABELS } from '@/lib/utils';

const PIE_COLORS = ['#166534', '#15803D', '#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#EF4444', '#78716C'];

export default function DashboardPage() {
  const { data, loading, error, reload } = useApi(() => api.get('/dashboard'), []);

  if (loading) return <Loading label="Calcul du tableau de bord…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { dashboard: d, alerts } = data;
  const m = d.month;
  const t = d.today;

  const criticalCount = alerts.filter((a: any) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a: any) => a.severity === 'warning').length;

  const salesTrend = (d.salesTrend || []).map((s: any) => ({
    day: s.day.slice(5),
    label: s.day,
    CA: Number(s.revenue_ht) || 0,
  }));

  const expenseData = (d.expenseBreakdown || []).map((e: any) => ({
    name: labelize(e.category),
    value: Number(e.total) || 0,
  }));

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Tableau de bord"
        description={`Situation du ${formatDate(d.date)} · période ${formatPeriod(d.period)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload}>
              Actualiser
            </Button>
            <Button size="sm" asChild={false}>
              <Link to="/ventes" className="inline-flex items-center gap-1.5">
                <Receipt className="h-4 w-4" /> Enregistrer une vente
              </Link>
            </Button>
          </>
        }
      />

      {/* ---------- Alertes ---------- */}
      {alerts.length > 0 && (
        <section className="mb-5 space-y-2" aria-label="Alertes">
          {criticalCount > 0 && (
            <Alert tone="danger" title={`${criticalCount} alerte(s) critique(s) à traiter`}>
              <ul className="mt-1 space-y-1">
                {alerts.filter((a: any) => a.severity === 'critical').map((a: any) => (
                  <li key={a.code}>
                    <Link to={a.link || '/'} className="font-medium underline underline-offset-2">
                      {a.title}
                    </Link>
                    <span className="text-xs"> — {a.detail}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {alerts.filter((a: any) => a.severity !== 'critical').map((a: any) => (
            <Alert
              key={a.code}
              tone={a.severity === 'warning' ? 'warning' : 'info'}
              title={a.title}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs">{a.detail}</span>
                <Link to={a.link || '/'} className="shrink-0 text-xs font-semibold underline underline-offset-2">
                  Voir
                </Link>
              </div>
            </Alert>
          ))}
        </section>
      )}

      {/* ---------- Indicateurs du mois ---------- */}
      <section className="mb-5" aria-label="Indicateurs du mois">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="CA HT du mois"
            value={formatMoney(m.revenueHt)}
            sub={`${m.salesCount} vente(s) · TTC ${formatMoney(m.revenueTtc)}`}
            tone="primary"
            icon={TrendingUp}
          />
          <StatCard
            label="Coût matière retenu"
            value={formatMoney(m.retainedCost)}
            sub={`Consommation ${formatMoney(m.consumption)}`}
            tone="neutral"
            icon={Package}
          />
          <StatCard
            label="Ratio matière"
            value={formatPct(m.ratioPct)}
            sub={`Objectif ${m.objectivePct} % · écart ${m.gapPoints > 0 ? '+' : ''}${m.gapPoints} pts`}
            tone={m.targetReached === false ? 'danger' : 'success'}
            icon={Percent}
          />
          <StatCard
            label="Marge avant autres charges"
            value={formatMoney(m.marginBeforeOtherCharges)}
            sub="Hors charges fixes et impôts"
            tone="neutral"
            icon={Wallet}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------- Ratio & objectif ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Objectif matière — {formatPeriod(d.period)}</CardTitle>
            <Badge tone={m.targetReached === false ? 'danger' : m.targetReached ? 'success' : 'neutral'}>
              {m.targetReached === null ? 'Non interprétable' : m.targetReached ? 'Objectif atteint' : 'Objectif dépassé'}
            </Badge>
          </CardHeader>
          <CardBody>
            <RatioGauge ratio={m.ratioPct} objective={m.objectivePct} />

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Metric label="Coût maximal autorisé" value={formatMoney(m.maxAllowedCost)} />
              <Metric
                label="Dépassement"
                value={m.overrunAmount > 0 ? formatMoney(m.overrunAmount) : '—'}
                danger={m.overrunAmount > 0}
              />
              <Metric label="Achats réceptionnés" value={formatMoney(m.purchasesReceived)} />
              <Metric label="Avaries non incluses" value={formatMoney(m.lossesNotIncluded)} />
              <Metric label="Stock d’ouverture" value={formatMoney(m.openingStock)} />
              <Metric label="Stock de clôture" value={formatMoney(m.closingStock)} />
              <Metric label="Dépenses hors matières" value={formatMoney(m.otherExpenses)} />
              <Metric
                label="Résultat de gestion estimatif"
                value={formatMoney(m.estimatedResult)}
                hint="Indicateur de gestion, pas un bénéfice net"
              />
            </dl>

            <p className="mt-4 rounded-md bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
              La marge restante et le résultat de gestion ne constituent pas un bénéfice net : les charges
              sociales, fiscales et financières ne sont pas déduites.
            </p>
          </CardBody>
        </Card>

        {/* ---------- Aujourd'hui ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Aujourd’hui</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3.5">
            <Row label="CA HT" value={formatMoney(t.revenueHt)} strong />
            <Row label="Ventes" value={`${t.salesCount}`} />
            <Row label="Coût matière" value={formatMoney(t.retainedCost)} />
            <Row
              label="Ratio du jour"
              value={t.revenueHt > 0 ? formatPct(t.ratioPct) : '—'}
              tone={t.revenueHt > 0 ? (t.ratioPct > t.objectivePct ? 'danger' : 'success') : undefined}
            />
            <div className="border-t border-slate-100 pt-3">
              <Row label="Valeur du stock total" value={formatMoney(d.stockTotalValue)} strong />
              <Row label="dont matières" value={formatMoney(d.stockMaterialsValue)} muted />
            </div>
          </CardBody>
        </Card>

        {/* ---------- Tendance des ventes ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chiffre d’affaires HT — 7 derniers jours</CardTitle>
          </CardHeader>
          <CardBody>
            {salesTrend.length === 0 ? (
              <EmptyState title="Aucune vente enregistrée" description="Les ventes des 7 derniers jours apparaîtront ici." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={salesTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v) => `${Math.round(v)}`}
                  />
                  <Tooltip
                    formatter={(v: any) => [formatMoney(v), 'CA HT']}
                    labelFormatter={(_l, p: any) => formatDate(p?.[0]?.payload?.label)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }}
                  />
                  <Bar dataKey="CA" fill="#166534" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* ---------- Dépenses ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Dépenses hors matières</CardTitle>
          </CardHeader>
          <CardBody>
            {expenseData.length === 0 ? (
              <EmptyState title="Aucune dépense" description="Enregistrez vos charges fixes et variables." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={expenseData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={72} paddingAngle={2}>
                    {expenseData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any) => formatMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* ---------- Ruptures ---------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Ruptures & stocks bas</CardTitle>
            <Badge tone={d.lowStock.length ? 'warning' : 'success'}>{d.lowStock.length}</Badge>
          </CardHeader>
          <CardBody className="max-h-64 overflow-y-auto p-0">
            {d.lowStock.length === 0 ? (
              <EmptyState title="Stocks corrects" description="Aucun produit sous son seuil minimal." icon={Package} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.lowStock.map((p: any) => (
                  <li key={`${p.id}-${p.qty}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        Seuil {p.min_stock} {p.unit}
                      </p>
                    </div>
                    <Badge tone={p.qty <= 0 ? 'danger' : 'warning'}>
                      {p.qty <= 0 ? 'Rupture' : `${p.qty} ${p.unit}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ---------- Péremptions ---------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Proches de la péremption</CardTitle>
            <Badge tone={d.expiring.length ? 'warning' : 'success'}>{d.expiring.length}</Badge>
          </CardHeader>
          <CardBody className="max-h-64 overflow-y-auto p-0">
            {d.expiring.length === 0 ? (
              <EmptyState title="Aucune alerte" description={`Aucun produit n’expire sous ${d.expiryDays} jours.`} icon={CalendarClock} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.expiring.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-500">DLC {formatDate(p.dlc)}</p>
                    </div>
                    <Badge tone={p.days_left < 0 ? 'danger' : p.days_left <= 2 ? 'warning' : 'neutral'}>
                      {p.days_left < 0 ? 'Périmé' : `J-${p.days_left}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ---------- Opérations en attente ---------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Opérations en attente</CardTitle>
            <Badge tone={d.pendingTotal ? 'warning' : 'success'}>{d.pendingTotal}</Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            <PendingRow to="/transferts" icon={ArrowLeftRight} label="Transferts en brouillon" count={d.pending.transfersDraft} extra={formatMoney(d.pending.transfersDraftValue)} />
            <PendingRow to="/avaries" icon={Trash2Icon} label="Avaries en brouillon" count={d.pending.lossesDraft} />
            <PendingRow to="/production" icon={Factory} label="Productions en brouillon" count={d.pending.productionsDraft} />
            <PendingRow to="/stock" icon={Package} label="Inventaires en brouillon" count={d.pending.stockCountsDraft} />
            <PendingRow to="/achats" icon={ShoppingCart} label="Achats à réceptionner" count={d.pending.purchasesPending} />
            <PendingRow to="/paie" icon={CreditCard} label="Bulletins de paie en brouillon" count={d.pending.payrollDraft} />
          </CardBody>
        </Card>

        {/* ---------- Transferts & rendements ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Activité du mois</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3.5">
            <Row
              label="Transferts validés"
              value={`${d.transfersMonth.count} · ${formatMoney(d.transfersMonth.value)}`}
            />
            <Row
              label="Rendement moyen (transformations)"
              value={d.yieldsMonth.count ? `${d.yieldsMonth.avgYield} %` : '—'}
              tone={d.yieldsMonth.count && d.yieldsMonth.avgYield < 70 ? 'warning' : undefined}
            />
            <Row
              label="Perte moyenne (transformations)"
              value={d.yieldsMonth.count ? `${d.yieldsMonth.avgLoss} %` : '—'}
            />
            <Row label="Transformations" value={`${d.yieldsMonth.count}`} />
            <div className="border-t border-slate-100 pt-3">
              <Link to="/analyses" className="text-xs font-semibold text-primary hover:underline">
                Analyser le dépassement en détail →
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

function Trash2Icon(props: { className?: string }) {
  return <Utensils {...props} />;
}

function Metric({ label, value, danger, hint }: { label: string; value: string; danger?: boolean; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-sm font-semibold', danger ? 'text-red-600' : 'text-slate-900')}>
        {value}
      </dd>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Row({
  label, value, strong, muted, tone,
}: { label: string; value: string; strong?: boolean; muted?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-xs', muted ? 'text-slate-400' : 'text-slate-500')}>{label}</span>
      <span
        className={cn(
          'tabular text-sm',
          strong ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
          tone === 'danger' && 'text-red-600',
          tone === 'success' && 'text-emerald-700',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function PendingRow({
  to, icon: Icon, label, count, extra,
}: { to: string; icon: React.ComponentType<{ className?: string }>; label: string; count: number; extra?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-slate-50',
        count === 0 && 'opacity-50',
      )}
    >
      <Icon className={cn('h-4 w-4', count > 0 ? 'text-amber-600' : 'text-slate-400')} />
      <span className="min-w-0 flex-1 truncate text-slate-700">{label}</span>
      {extra && <span className="tabular text-[11px] text-slate-400">{extra}</span>}
      <Badge tone={count > 0 ? 'warning' : 'neutral'}>{count}</Badge>
    </Link>
  );
}

function labelize(code: string) {
  return String(code || '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
