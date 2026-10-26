import React from 'react';
import {
  Calculator, Target, AlertTriangle, TrendingUp, TrendingDown, Percent, Package,
  ArrowRight, Lightbulb, RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import {
  simulateMaterialCost, formatMoney, formatPct, roundMoney,
} from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState,
  Field, Input, Loading, PageHeader, RatioGauge, Tabs,
} from '@/components/ui';
import { cn, currentMonth, monthBounds, formatPeriod } from '@/lib/utils';

export default function AnalysesPage() {
  const [tab, setTab] = React.useState<'simulator' | 'overrun' | 'compare'>('simulator');

  return (
    <div>
      <PageHeader
        icon={Calculator}
        title="Analyses & simulateur"
        description="Simulateur de coût matière, analyse détaillée des dépassements et comparaison de périodes."
      />

      <Tabs
        tabs={[
          { key: 'simulator', label: 'Simulateur de coût matière' },
          { key: 'overrun', label: 'Analyse du dépassement' },
          { key: 'compare', label: 'Comparaison de périodes' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as any)}
      />

      <div className="mt-5">
        {tab === 'simulator' && <SimulatorTab />}
        {tab === 'overrun' && <OverrunTab />}
        {tab === 'compare' && <CompareTab />}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  SIMULATEUR
 * ========================================================================= */
function SimulatorTab() {
  const { data: settingsData } = useApi(() => api.get('/settings'), []);
  const [revenueHt, setRevenueHt] = React.useState('100000');
  const [consumption, setConsumption] = React.useState('24000');
  const [losses, setLosses] = React.useState('4000');
  const [objective, setObjective] = React.useState('30');

  React.useEffect(() => {
    const o = settingsData?.settings?.objective_ratio;
    if (o !== undefined) setObjective(String(o));
  }, [settingsData]);

  // ⚠️ Calcul effectué par la couche partagée (source unique de vérité)
  const result = React.useMemo(
    () => simulateMaterialCost({
      revenueHt: Number(revenueHt) || 0,
      consumption: Number(consumption) || 0,
      lossesNotIncluded: Number(losses) || 0,
      objectivePct: Number(objective) || 30,
    }),
    [revenueHt, consumption, losses, objective],
  );

  const loadMonth = async () => {
    const period = currentMonth();
    const { start, end } = monthBounds(period);
    const m = await api.get<any>(`/analytics/period${qs({ from: start, to: end })}`);
    setRevenueHt(String(m.revenueHt));
    setConsumption(String(m.consumption));
    setLosses(String(m.lossesNotIncluded));
    setObjective(String(m.objectivePct));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Paramètres de simulation</CardTitle>
          <Badge tone="info">simulation indicative</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Chiffre d’affaires HT (DT)">
            <Input type="number" step="0.001" min="0" value={revenueHt} onChange={(e) => setRevenueHt(e.target.value)} />
          </Field>
          <Field label="Coût matière consommée (DT)">
            <Input type="number" step="0.001" min="0" value={consumption} onChange={(e) => setConsumption(e.target.value)} />
          </Field>
          <Field label="Avaries non déjà comptabilisées (DT)">
            <Input type="number" step="0.001" min="0" value={losses} onChange={(e) => setLosses(e.target.value)} />
          </Field>
          <Field
            label={`Objectif de ratio matière : ${objective} %`}
            hint="Réglable de 15 % à 45 % — valeur par défaut 30 %"
          >
            <input
              type="range"
              min={15}
              max={45}
              step={0.5}
              value={Number(objective) || 30}
              onChange={(e) => setObjective(e.target.value)}
              className="mt-2 w-full accent-emerald-700"
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>15 %</span><span>30 %</span><span>45 %</span>
            </div>
          </Field>
          <Button variant="outline" className="w-full" onClick={loadMonth}>
            <RefreshCw className="h-4 w-4" /> Charger les chiffres du mois
          </Button>
        </CardBody>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Résultat de la simulation</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className={cn(
            'rounded-lg p-4 ring-1 ring-inset',
            result.targetReached ? 'bg-emerald-50 ring-emerald-200' : 'bg-red-50 ring-red-200',
          )}>
            <div className="flex items-start gap-3">
              {result.targetReached ? (
                <Target className="h-5 w-5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
              )}
              <div>
                <p className={cn('text-sm font-semibold', result.targetReached ? 'text-emerald-900' : 'text-red-900')}>
                  {result.targetReached ? 'Objectif atteint' : 'Objectif dépassé'}
                </p>
                <p className="mt-0.5 text-xs">{result.message}</p>
              </div>
            </div>
          </div>

          <RatioGauge ratio={result.ratioPct} objective={result.objectivePct} />

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <Metric label="CA HT" value={formatMoney(result.revenueHt)} />
            <Metric label="Consommation" value={formatMoney(result.consumption)} />
            <Metric label="Avaries non incluses" value={formatMoney(result.lossesNotIncluded)} />
            <Metric label="Coût matière retenu" value={formatMoney(result.retainedCost)} strong />
            <Metric label="Coût maximal autorisé" value={formatMoney(result.maxAllowedCost)} />
            <Metric
              label="Dépassement"
              value={result.overrunAmount > 0 ? formatMoney(result.overrunAmount) : '—'}
              tone={result.overrunAmount > 0 ? 'danger' : undefined}
            />
            <Metric
              label="Écart en points"
              value={`${result.gapPoints > 0 ? '+' : ''}${result.gapPoints} pts`}
              tone={result.gapPoints > 0 ? 'danger' : 'success'}
            />
            <Metric label="Marge restante" value={formatMoney(result.marginBeforeOtherCharges)} />
            <Metric label="Ratio" value={formatPct(result.ratioPct)} strong tone={result.ratioPct > result.objectivePct ? 'danger' : 'success'} />
          </dl>

          <p className="rounded-md bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            Libellé imposé : <strong>simulation indicative</strong>. La marge restante n’est pas un bénéfice net :
            les autres charges, impôts et cotisations ne sont pas déduits ici.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Metric({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-sm',
        strong ? 'font-semibold' : 'font-medium',
        tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>
        {value}
      </dd>
    </div>
  );
}

/* ===========================================================================
 *  ANALYSE DU DÉPASSEMENT
 * ========================================================================= */
function OverrunTab() {
  const [period, setPeriod] = React.useState(currentMonth());
  const { start, end } = monthBounds(period);
  const { data, loading, error, reload } = useApi(
    () => api.get<any>(`/analytics/overrun${qs({ from: start, to: end })}`),
    [period],
  );

  if (loading) return <Loading label="Analyse des coûts…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Période analysée" className="sm:col-span-2 lg:col-span-1">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <div className="lg:col-span-3 text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Situation</p>
            <p className={cn('text-sm font-semibold', data.hasOverrun ? 'text-red-600' : 'text-emerald-700')}>
              {data.revenueHt <= 0
                ? 'Non interprétable (aucun CA)'
                : data.hasOverrun
                  ? `${formatPct(data.ratioPct)} contre un objectif de ${data.objectivePct} % — dépassement de ${formatMoney(data.excessAmount)}`
                  : `${formatPct(data.ratioPct)} — objectif de ${data.objectivePct} % respecté`}
            </p>
          </div>
        </CardBody>
      </Card>

      {data.actions?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" /> Actions prioritaires</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            {data.actions.map((a: any, i: number) => (
              <div key={i} className={cn('rounded-lg border-l-4 bg-slate-50 p-3',
                a.priority === 'high' ? 'border-red-500' : a.priority === 'medium' ? 'border-amber-400' : 'border-emerald-500')}>
                <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                <p className="mt-0.5 text-xs text-slate-600">{a.detail}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Produits les plus coûteux</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.topCostProducts.length === 0 ? (
              <EmptyState title="Aucune donnée" icon={Package} />
            ) : (
              <table className="table-base">
                <thead><tr><th>Produit</th><th className="text-right">Consommé</th><th className="text-right">Acheté</th></tr></thead>
                <tbody>
                  {data.topCostProducts.map((p: any) => (
                    <tr key={p.id}>
                      <td><p className="text-sm font-medium">{p.name}</p><p className="font-mono text-[10px] text-slate-400">{p.code}</p></td>
                      <td className="tabular text-right text-xs">{formatMoney(p.consumed_value)}</td>
                      <td className="tabular text-right text-xs text-slate-500">{formatMoney(p.purchased_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Avaries les plus coûteuses</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.topLosses.length === 0 ? (
              <EmptyState title="Aucune avarie" description="Bonne maîtrise des pertes sur la période." />
            ) : (
              <table className="table-base">
                <thead><tr><th>Produit</th><th>Motif</th><th className="text-right">Valeur</th><th>Comptage</th></tr></thead>
                <tbody>
                  {data.topLosses.map((l: any) => (
                    <tr key={l.id}>
                      <td className="text-sm">{l.product_name}</td>
                      <td className="text-xs text-slate-500">{l.loss_type}</td>
                      <td className="tabular text-right text-xs font-semibold text-red-600">{formatMoney(l.total_cost)}</td>
                      <td className="text-[10px]">
                        <Badge tone={l.already_in_consumption ? 'neutral' : 'danger'}>
                          {l.already_in_consumption ? 'incluse' : 'ajoutée'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Écarts de rendement</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.yieldIssues.length === 0 ? (
              <EmptyState title="Aucun écart anormal" description="Les rendements respectent les seuils définis." />
            ) : (
              <table className="table-base">
                <thead><tr><th>Produit</th><th className="text-right">Rendement</th><th className="text-right">Perte</th></tr></thead>
                <tbody>
                  {data.yieldIssues.map((y: any) => (
                    <tr key={y.id}>
                      <td className="text-sm">{y.product_name}</td>
                      <td className="tabular text-right text-xs">{formatPct(y.yield_pct)}</td>
                      <td className="tabular text-right text-xs font-semibold text-red-600">{formatPct(y.loss_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Variations de prix d’achat</CardTitle></CardHeader>
          <CardBody className="p-0">
            {data.priceVariations.length === 0 ? (
              <EmptyState title="Prix stables" description="Aucune variation supérieure à 5 % ce mois." />
            ) : (
              <table className="table-base">
                <thead><tr><th>Produit</th><th className="text-right">CMP actuel</th><th className="text-right">Prix période</th><th className="text-right">Écart</th></tr></thead>
                <tbody>
                  {data.priceVariations.map((v: any) => (
                    <tr key={v.id}>
                      <td className="text-sm">{v.name}</td>
                      <td className="tabular text-right text-xs">{formatMoney(v.current_cost)}</td>
                      <td className="tabular text-right text-xs">{formatMoney(v.period_avg_cost)}</td>
                      <td className={cn('tabular text-right text-xs font-semibold', v.delta_pct > 0 ? 'text-red-600' : 'text-emerald-700')}>
                        {v.delta_pct > 0 ? '+' : ''}{v.delta_pct} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Mouvements de stock à contrôler</CardTitle></CardHeader>
        <CardBody className="p-0">
          {data.movementsToCheck.length === 0 ? (
            <EmptyState title="Aucun mouvement suspect" />
          ) : (
            <table className="table-base">
              <thead><tr><th>Date</th><th>Type</th><th>Produit</th><th className="text-right">Valeur</th><th>Motif</th></tr></thead>
              <tbody>
                {data.movementsToCheck.map((m: any) => (
                  <tr key={m.id}>
                    <td className="text-xs">{m.occurred_at?.slice(0, 10)}</td>
                    <td className="text-xs">{m.movement_type}</td>
                    <td className="text-xs">{m.product_name}</td>
                    <td className="tabular text-right text-xs">{formatMoney(m.total_cost)}</td>
                    <td className="text-xs text-slate-500">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Alert tone="info" title="Comment lire cette analyse">
        Ces éléments aident à décider : produits à renégocier, pertes à réduire, rendements à corriger,
        mouvements à vérifier. Chaque montant est justifié par des opérations identifiables (drill-down disponible
        dans les rapports).
      </Alert>
    </div>
  );
}

/* ===========================================================================
 *  COMPARAISON
 * =========================================================================== */
function CompareTab() {
  const [periodA, setPeriodA] = React.useState(currentMonth());
  const [periodB, setPeriodB] = React.useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, loading, error, reload } = useApi(
    () => api.get<any>(`/analytics/compare${qs({ periodA, periodB })}`),
    [periodA, periodB],
  );

  const lastYear = React.useMemo(() => {
    const [y, m] = periodA.split('-');
    return `${Number(y) - 1}-${m}`;
  }, [periodA]);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Période analysée">
            <Input type="month" value={periodA} onChange={(e) => setPeriodA(e.target.value)} />
          </Field>
          <Field label="Période de comparaison">
            <Input type="month" value={periodB} onChange={(e) => setPeriodB(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              const d = new Date();
              d.setMonth(d.getMonth() - 1);
              setPeriodB(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }}>Mois précédent</Button>
            <Button variant="outline" size="sm" onClick={() => setPeriodB(lastYear)}>Même mois N-1</Button>
          </div>
        </CardBody>
      </Card>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data && (
        <Card>
          <CardHeader>
            <CardTitle>
              {formatPeriod(data.periodA.period)} comparé à {formatPeriod(data.periodB.period)}
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th className="text-right">{formatPeriod(data.periodB.period)}</th>
                  <th className="text-right">{formatPeriod(data.periodA.period)}</th>
                  <th className="text-right">Évolution</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.evolution).map(([key, v]: [string, any]) => {
                  const isPct = key === 'ratioPct';
                  const delta = isPct ? v.deltaPoints : v.deltaPct;
                  // Pour le ratio, une hausse est défavorable ; sinon une hausse du CA est favorable
                  const unfavourable = isPct ? delta > 0 : key === 'otherExpenses' || key === 'retainedCost' || key === 'consumption' || key === 'purchases' ? delta > 0 : delta < 0;
                  return (
                    <tr key={key}>
                      <td className="text-sm font-medium text-slate-700">{LABELS[key] || key}</td>
                      <td className="tabular text-right text-xs text-slate-500">
                        {isPct ? `${v.previous} %` : formatMoney(v.previous)}
                      </td>
                      <td className="tabular text-right text-sm font-semibold">
                        {isPct ? `${v.current} %` : formatMoney(v.current)}
                      </td>
                      <td className="text-right">
                        <span className={cn('inline-flex items-center gap-1 tabular text-xs font-medium',
                          Math.abs(delta) < 0.01 ? 'text-slate-400' : unfavourable ? 'text-red-600' : 'text-emerald-700')}>
                          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                          {delta > 0 ? '+' : ''}{delta}{isPct ? ' pts' : ' %'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
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
