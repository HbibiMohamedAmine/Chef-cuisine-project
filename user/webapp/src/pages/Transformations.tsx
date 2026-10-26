import React from 'react';
import { Scissors, Plus, AlertTriangle } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty, formatPct, yieldPct, lossPct, avgPortionWeight, transformationUnitCost } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, formatDate, monthBounds, currentMonth } from '@/lib/utils';

export default function TransformationsPage() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [modalOpen, setModalOpen] = React.useState(false);
  const { start, end } = monthBounds(period);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/transformations${qs({ from: start, to: end })}`),
    [period],
  );
  const rows = data || [];

  // Statistiques de rendement
  const stats = React.useMemo(() => {
    const valid = rows.filter((r) => r.status === 'valide');
    if (!valid.length) return null;
    return {
      count: valid.length,
      avgYield: valid.reduce((a, r) => a + Number(r.yield_pct || 0), 0) / valid.length,
      avgLoss: valid.reduce((a, r) => a + Number(r.loss_pct || 0), 0) / valid.length,
      abnormal: valid.filter((r) => r.loss_type === 'anormale').length,
      totalLossValue: valid.reduce(
        (a, r) => a + (Number(r.initial_cost) * (Number(r.loss_pct) || 0)) / 100,
        0,
      ),
    };
  }, [rows]);

  const columns = [
    { key: 'number', header: 'N°', width: '130px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'occurred_at', header: 'Date', render: (r: any) => <span className="text-xs">{formatDate(r.occurred_at)}</span> },
    {
      key: 'source_product_name',
      header: 'Produit',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.source_product_name}</p>
          {r.target_product_name && <p className="text-xs text-slate-500">→ {r.target_product_name}</p>}
        </div>
      ),
    },
    { key: 'initial_weight', header: 'Initial', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatQty(r.initial_weight)}</span> },
    { key: 'final_weight', header: 'Utilisable', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatQty(r.final_weight)}</span> },
    {
      key: 'yield_pct',
      header: 'Rendement',
      align: 'right' as const,
      render: (r: any) => (
        <Badge tone={r.yield_pct >= 80 ? 'success' : r.yield_pct >= 65 ? 'warning' : 'danger'}>
          {formatPct(r.yield_pct)}
        </Badge>
      ),
    },
    {
      key: 'loss_pct',
      header: 'Perte',
      align: 'right' as const,
      render: (r: any) => (
        <span className={cn('tabular text-sm', r.loss_type === 'anormale' ? 'font-semibold text-red-600' : 'text-slate-600')}>
          {formatPct(r.loss_pct)}
        </span>
      ),
    },
    { key: 'avg_portion_weight', header: 'Poids/portion', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatQty(r.avg_portion_weight)}</span> },
    {
      key: 'cost_per_portion',
      header: 'Coût/portion',
      align: 'right' as const,
      render: (r: any) => (
        <span className="tabular font-medium">{formatMoney(Number(r.initial_cost) / (Number(r.portions) || 1))}</span>
      ),
    },
    {
      key: 'loss_type',
      header: 'Qualification',
      render: (r: any) => (
        <Badge tone={r.loss_type === 'anormale' ? 'danger' : 'success'}>
          {r.loss_type === 'anormale' ? 'Anormale' : 'Normale'}
        </Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Scissors}
        title="Transformations & rendements"
        description="Parage, épluchage, découpe : poids initial, poids utilisable, perte, coût final par portion."
        actions={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Nouvelle transformation</Button>}
      />

      <Alert tone="info" className="mb-4" title="Formules appliquées">
        Rendement = (poids final ÷ poids initial) × 100 · Perte = ((initial − final) ÷ initial) × 100 ·
        Poids moyen/portion = poids final ÷ portions. Une perte au-delà du seuil paramétré est qualifiée
        d’anormale et exige un motif.
      </Alert>

      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatTile label="Transformations" value={String(stats.count)} />
          <StatTile label="Rendement moyen" value={formatPct(stats.avgYield)} tone={stats.avgYield >= 80 ? 'success' : 'warning'} />
          <StatTile label="Perte moyenne" value={formatPct(stats.avgLoss)} tone={stats.avgLoss > 20 ? 'danger' : 'neutral'} />
          <StatTile
            label="Pertes anormales"
            value={`${stats.abnormal} · ${formatMoney(stats.totalLossValue)}`}
            tone={stats.abnormal > 0 ? 'danger' : 'success'}
          />
        </div>
      )}

      <Card>
        <FilterBar>
          <Field label="Mois" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} transformation(s)</span>
        </FilterBar>
        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            empty={<EmptyState icon={Scissors} title="Aucune transformation" description="Enregistrez une transformation pour suivre vos rendements et coûts réels." action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Nouvelle transformation</Button>} />}
          />
        )}
      </Card>

      <TransformationModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); reload(); }} />
    </div>
  );
}

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const tones = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-600', danger: 'text-red-600' };
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

function TransformationModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [kitchenId, setKitchenId] = React.useState('1');
  const [sourceProductId, setSourceProductId] = React.useState('');
  const [targetProductId, setTargetProductId] = React.useState('');
  const [initialWeight, setInitialWeight] = React.useState('');
  const [finalWeight, setFinalWeight] = React.useState('');
  const [portions, setPortions] = React.useState('1');
  const [reason, setReason] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    setSourceProductId(''); setTargetProductId(''); setInitialWeight('');
    setFinalWeight(''); setPortions('1'); setReason('');
  }, [open]);

  const source = products.find((p) => p.id === Number(sourceProductId));
  const iw = Number(initialWeight) || 0;
  const fw = Number(finalWeight) || 0;
  const computedYield = yieldPct(fw, iw);
  const computedLoss = lossPct(iw, fw);
  const initialCost = iw * Number(source?.unit_cost || 0);
  const finalUnitCost = transformationUnitCost(initialCost, fw);
  const costPerPortion = Number(portions) > 0 ? initialCost / Number(portions) : 0;
  const abnormal = computedLoss > 15;

  const submit = async () => {
    if (!sourceProductId) { toastError('Produit requis', 'Sélectionnez le produit à transformer.'); return; }
    if (iw <= 0) { toastError('Poids initial requis', 'Saisissez le poids initial.'); return; }
    if (fw < 0 || fw > iw) { toastError('Poids final invalide', 'Le poids utilisable ne peut pas dépasser le poids initial.'); return; }
    if (abnormal && !reason.trim()) { toastError('Motif obligatoire', 'Une perte anormale doit être justifiée.'); return; }

    setSubmitting(true);
    try {
      await api.post('/transformations', {
        kitchenId: Number(kitchenId),
        sourceProductId: Number(sourceProductId),
        targetProductId: targetProductId ? Number(targetProductId) : null,
        initialWeight: iw,
        finalWeight: fw,
        portions: Number(portions) || 1,
        lossThresholdPct: 15,
        reason: reason || null,
        occurredAt,
      });
      success('Transformation enregistrée', `Rendement ${formatPct(computedYield)}, perte ${formatPct(computedLoss)}`);
      onSaved();
    } catch (e: any) {
      toastError('Transformation impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle transformation"
      description="La perte est déjà incluse dans le coût final : elle ne sera pas comptée deux fois."
      size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={submitting}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cuisine" required>
            <Select value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
              {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Produit initial" required hint={source ? `Stock : ${source.stock_qty} ${source.unit} · ${formatMoney(source.unit_cost)}/${source.unit}` : undefined}>
            <Select value={sourceProductId} onChange={(e) => setSourceProductId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.unit})</option>)}
            </Select>
          </Field>
          <Field label="Produit transformé" hint="Optionnel : crée une entrée en stock">
            <Select value={targetProductId} onChange={(e) => setTargetProductId(e.target.value)}>
              <option value="">Aucun (sortie simple)</option>
              {products.filter((p) => ['semi_fini', 'fini', 'matiere_premiere'].includes(p.type)).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Poids initial" required hint={source ? `en ${source.unit}` : undefined}>
            <Input type="number" step="0.001" min="0" value={initialWeight} onChange={(e) => setInitialWeight(e.target.value)} />
          </Field>
          <Field label="Poids final utilisable" required>
            <Input type="number" step="0.001" min="0" value={finalWeight} onChange={(e) => setFinalWeight(e.target.value)} />
          </Field>
          <Field label="Nombre de portions">
            <Input type="number" step="0.01" min="0.01" value={portions} onChange={(e) => setPortions(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Result label="Rendement" value={`${formatPct(computedYield)}`} tone={computedYield >= 80 ? 'success' : computedYield >= 65 ? 'warning' : 'danger'} />
          <Result label="Taux de perte" value={`${formatPct(computedLoss)}`} tone={abnormal ? 'danger' : 'success'} />
          <Result label="Poids moyen / portion" value={formatQty(avgPortionWeight(fw, Number(portions)))} />
          <Result label="Coût final / portion" value={formatMoney(costPerPortion)} />
        </div>

        <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
          <Result label="Coût initial matière" value={formatMoney(initialCost)} />
          <Result label="Coût unitaire final" value={formatMoney(finalUnitCost)} />
          <Result label="Perte valorisée" value={formatMoney((iw - fw) * Number(source?.unit_cost || 0))} tone={abnormal ? 'danger' : 'neutral'} />
        </div>

        {abnormal && (
          <Alert tone="warning" title={`Perte anormale (${formatPct(computedLoss)} > 15 %)`}>
            Un motif est obligatoire pour tracer cette perte inhabituelle.
          </Alert>
        )}

        <Field label="Motif / observation" required={abnormal}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Parage, épluchage, défaut de qualité…" />
        </Field>
      </div>
    </Modal>
  );
}

function Result({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const tones = { success: 'text-emerald-700', warning: 'text-amber-600', danger: 'text-red-600', neutral: 'text-slate-900' };
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-0.5 text-sm font-semibold', tones[tone || 'neutral'])}>{value}</p>
    </div>
  );
}
