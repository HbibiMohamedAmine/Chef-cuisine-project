import React from 'react';
import { Trash2, Plus, CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, monthBounds, currentMonth, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function LossesPage() {
  const { success, error: toastError } = useToast();
  const [tab, setTab] = React.useState<'all' | 'brouillon' | 'valide'>('all');
  const [period, setPeriod] = React.useState(currentMonth());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<any>(null);
  const { start, end } = monthBounds(period);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/losses${qs({ from: start, to: end, status: tab === 'all' ? '' : tab })}`),
    [period, tab],
  );

  const report = useApi(
    () => api.get<any>(`/losses-report${qs({ from: start, to: end })}`),
    [period],
  );

  const rows = data || [];
  const rep = report.data;

  const columns = [
    { key: 'number', header: 'N°', width: '120px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'occurred_at', header: 'Date', render: (r: any) => <span className="text-xs">{formatDate(r.occurred_at)}</span> },
    {
      key: 'product_name',
      header: 'Produit',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.product_name}</p>
          <p className="text-xs text-slate-500">{r.kitchen_name}</p>
        </div>
      ),
    },
    { key: 'qty', header: 'Quantité', align: 'right' as const, render: (r: any) => <span className="tabular text-sm">{formatQty(r.qty, r.unit)}</span> },
    { key: 'total_cost', header: 'Valeur', align: 'right' as const, render: (r: any) => <span className="tabular font-medium text-red-600">{formatMoney(r.total_cost)}</span> },
    { key: 'loss_type_label', header: 'Type', render: (r: any) => <span className="text-xs">{r.loss_type_label || r.loss_type}</span> },
    {
      key: 'already_in_consumption',
      header: 'Comptage',
      render: (r: any) => (
        <Badge tone={r.already_in_consumption === 1 ? 'neutral' : 'danger'}>
          {r.already_in_consumption === 1 ? 'Déjà incluse' : 'À ajouter'}
        </Badge>
      ),
    },
    { key: 'status', header: 'Statut', render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '100px',
      render: (r: any) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>
          Ouvrir
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Trash2}
        title="Avaries & pertes"
        description="Pertes tracées et jamais masquées. L’indicateur « déjà incluse » empêche le double comptage dans le ratio."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Déclarer une avarie</Button>}
      />

      <Alert tone="info" className="mb-4" title="Règle anti-double comptage">
        Une avarie validée réduit le stock — elle est donc déjà incluse dans la consommation valorisée.
        Elle n’est jamais rajoutée au coût retenu. Le drapeau « à ajouter » est réservé aux pertes
        qui n’ont pas réduit le stock de matières.
      </Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label="Valeur totale (validée)" value={formatMoney(rep?.totalValue || 0)} tone="danger" />
        <Tile label="Déjà incluses" value={formatMoney(rep?.includedValue || 0)} />
        <Tile label="Non incluses (ajoutées)" value={formatMoney(rep?.notIncludedValue || 0)} tone={rep?.notIncludedValue > 0 ? 'danger' : 'neutral'} />
        <Tile label="Nombre d’avaries" value={String(rep?.count || 0)} />
      </div>

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'all', label: 'Toutes' },
              { key: 'brouillon', label: 'En attente', badge: rows.filter((r) => r.status === 'brouillon').length },
              { key: 'valide', label: 'Validées' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>
        <FilterBar>
          <Field label="Mois" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} avarie(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetail(r)}
            empty={<EmptyState icon={Trash2} title="Aucune avarie" description="Déclarez les produits périmés, détériorés ou perdus pour les tracer." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Déclarer</Button>} />}
          />
        )}
      </Card>

      {rep?.byType?.length > 0 && (
        <Card className="mt-4">
          <div className="border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Répartition par type</h3>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {rep.byType.map((t: any) => (
              <div key={t.code} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-700">{t.label}</p>
                <p className="tabular mt-1 text-sm font-semibold text-red-600">{formatMoney(t.value)}</p>
                <p className="text-[10px] text-slate-500">{t.count} déclaration(s) · {t.qty} unités</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <LossModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload(); report.reload(); }} />
      {detail && <LossDetail loss={detail} onClose={() => setDetail(null)} onChanged={() => { reload(); report.reload(); }} />}
    </div>
  );
}

function Tile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tone === 'danger' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
    </div>
  );
}

function LossModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [kitchenId, setKitchenId] = React.useState('1');
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [lossType, setLossType] = React.useState('perime');
  const [reason, setReason] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [alreadyIncluded, setAlreadyIncluded] = React.useState(true);
  const [validateNow, setValidateNow] = React.useState(true);
  const [occurredAt, setOccurredAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    api.get<any>('/settings').then((s) => {
      const v = s.settings?.loss_default_in_consumption;
      if (v !== undefined) setAlreadyIncluded(Boolean(v));
    }).catch(() => {});
    setProductId(''); setQty(''); setReason(''); setComment(''); setValidateNow(true);
  }, [open]);

  const product = products.find((p) => p.id === Number(productId));
  const value = (Number(qty) || 0) * Number(product?.unit_cost || 0);

  const submit = async () => {
    if (!productId) { toastError('Produit requis', 'Sélectionnez le produit concerné.'); return; }
    if (!(Number(qty) > 0)) { toastError('Quantité invalide', 'La quantité doit être supérieure à zéro.'); return; }
    if (lossType === 'autre' && !reason.trim()) { toastError('Motif requis', 'Précisez le motif réel.'); return; }

    setSubmitting(true);
    try {
      await api.post('/losses', {
        kitchenId: Number(kitchenId),
        productId: Number(productId),
        qty: Number(qty),
        lossType,
        reason: reason || null,
        comment: comment || null,
        occurredAt,
        alreadyInConsumption: alreadyIncluded,
        validate: validateNow,
      });
      success(
        validateNow ? 'Avarie validée' : 'Avarie enregistrée',
        validateNow ? 'Le stock a été réduit.' : 'En attente de validation.',
      );
      onSaved();
    } catch (e: any) {
      toastError('Déclaration impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Déclarer une avarie"
      description="Une avarie validée réduit le stock et apparaît au rapport des pertes."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={submitting}>
            {validateNow ? 'Déclarer et valider' : 'Enregistrer en brouillon'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cuisine" required>
            <Select value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
              {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </Field>
          <Field label="Produit" required className="sm:col-span-2">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantité perdue" required hint={product ? `stock : ${product.stock_qty} ${product.unit}` : undefined}>
            <Input type="number" step="0.001" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Type d’avarie" required>
            <Select value={lossType} onChange={(e) => setLossType(e.target.value)}>
              {refs.lossTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg bg-red-50 p-3 text-sm ring-1 ring-inset ring-red-200">
          <span className="text-red-800">Valeur de la perte</span>
          <span className="tabular float-right font-semibold text-red-700">{formatMoney(value)}</span>
        </div>

        <Field label={lossType === 'autre' ? 'Motif (obligatoire pour « Autre »)' : 'Motif'} required={lossType === 'autre'}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Produit périmé retrouvé en chambre froide…" />
        </Field>

        <Field label="Commentaire">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Circonstances, responsable, action corrective…" />
        </Field>

        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <input type="checkbox" checked={alreadyIncluded} onChange={(e) => setAlreadyIncluded(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary" />
          <span>
            <span className="font-medium text-slate-800">Déjà incluse dans le coût consommé</span>
            <span className="block text-xs text-slate-500">
              Coché (recommandé) : la sortie de stock est déjà capturée dans le solde matière, donc la perte
              ne sera PAS ajoutée une seconde fois au ratio. Décochez uniquement si la perte n’a pas réduit le
              stock (cas rare) : elle sera alors ajoutée explicitement.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={validateNow} onChange={(e) => setValidateNow(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-primary" />
          <span className="text-slate-700">Valider immédiatement (réduit le stock)</span>
        </label>
      </div>
    </Modal>
  );
}

function LossDetail({ loss, onClose, onChanged }: { loss: any; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get(`/losses/${loss.id}`), [loss.id]);
  const [confirmValidate, setConfirmValidate] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const validate = async () => {
    setBusy(true);
    try {
      await api.post(`/losses/${loss.id}/validate`);
      success('Avarie validée'); setConfirmValidate(false); reload(); onChanged();
    } catch (e: any) { toastError('Validation impossible', e.message); }
    finally { setBusy(false); }
  };

  const cancel = async (reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/losses/${loss.id}/cancel`, { reason });
      success('Avarie annulée'); setConfirmCancel(false); reload(); onChanged();
    } catch (e: any) { toastError('Annulation impossible', e.message); }
    finally { setBusy(false); }
  };

  if (loading || !data) return <Modal open onClose={onClose} title="Avarie" size="md"><Loading /></Modal>;

  return (
    <>
      <Modal
        open onClose={onClose}
        title={`Avarie ${data.number}`}
        description={`${data.product_name} · ${data.kitchen_name} · ${formatDate(data.occurred_at)}`}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {data.status !== 'annule' && <Button variant="danger" onClick={() => setConfirmCancel(true)}><XCircle className="h-4 w-4" /> Annuler</Button>}
            {data.status === 'brouillon' && <Button variant="success" onClick={() => setConfirmValidate(true)}><CheckCircle2 className="h-4 w-4" /> Valider</Button>}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Mini label="Quantité" value={formatQty(data.qty, data.unit)} />
            <Mini label="Valeur" value={formatMoney(data.total_cost)} />
            <Mini label="Type" value={data.loss_type_label || data.loss_type} />
            <Mini label="Statut" value={STATUS_LABELS[data.status] || data.status} />
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="flex items-center justify-between">
              <span className="text-slate-600">Traitement comptable</span>
              <Badge tone={data.already_in_consumption === 1 ? 'neutral' : 'danger'}>
                {data.already_in_consumption === 1 ? 'Déjà incluse — non recomptée' : 'À ajouter au coût retenu'}
              </Badge>
            </p>
          </div>

          {data.reason && <p className="text-sm"><span className="font-medium text-slate-600">Motif :</span> {data.reason}</p>}
          {data.comment && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{data.comment}</p>}

          {data.status === 'annule' && <Alert tone="danger" title="Avarie annulée">Contre-écriture enregistrée, historique conservé.</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmValidate} onClose={() => setConfirmValidate(false)} onConfirm={validate} loading={busy}
        title="Valider l’avarie ?"
        message={`${data.qty} ${data.unit} de ${data.product_name} seront retirés du stock. La perte apparaîtra au rapport.`}
        confirmLabel="Valider"
      />
      <ConfirmDialog
        open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} loading={busy}
        title="Annuler l’avarie ?"
        message="Si l’avarie est validée, une contre-écriture remettra la quantité en stock. Le motif est obligatoire."
        confirmLabel="Annuler l’avarie" requireReason
      />
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
