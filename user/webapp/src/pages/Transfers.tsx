import React from 'react';
import { ArrowLeftRight, Plus, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, monthBounds, currentMonth, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function TransfersPage() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [tab, setTab] = React.useState<'all' | 'brouillon' | 'valide'>('all');
  const [period, setPeriod] = React.useState(currentMonth());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const { start, end } = monthBounds(period);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/transfers${qs({ from: start, to: end, status: tab === 'all' ? '' : tab })}`),
    [period, tab],
  );
  const rows = data || [];

  const validated = rows.filter((r) => r.status === 'valide');
  const drafts = rows.filter((r) => r.status === 'brouillon');

  const columns = [
    { key: 'number', header: 'N°', width: '130px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'occurred_at', header: 'Date', render: (r: any) => <span className="text-xs">{formatDate(r.occurred_at)}</span> },
    { key: 'product_name', header: 'Produit', render: (r: any) => <span className="text-sm font-medium">{r.product_name}</span> },
    {
      key: 'route',
      header: 'Trajet',
      render: (r: any) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          {r.source_name} <ArrowRight className="h-3 w-3 text-slate-400" /> {r.dest_name}
        </span>
      ),
    },
    { key: 'qty', header: 'Quantité', align: 'right' as const, render: (r: any) => <span className="tabular">{formatQty(r.qty, r.unit)}</span> },
    { key: 'unit_cost', header: 'Coût unit.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.unit_cost)}</span> },
    { key: 'total_cost', header: 'Valeur', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.total_cost)}</span> },
    {
      key: 'status',
      header: 'Statut',
      render: (r: any) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge>
          {r.force_negative === 1 && <Badge tone="danger">Forcé</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '110px',
      render: (r: any) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>
          Ouvrir
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={ArrowLeftRight}
        title="Transferts internes"
        description="Déplacements entre cuisines. Un transfert n’est ni un achat ni une consommation : il ne crée aucun coût."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouveau transfert</Button>}
      />

      <Alert tone="info" className="mb-4" title="Règle anti-double comptage">
        Le coût unitaire est identique à la source et à la destination. Les deux cuisines appartenant au
        même périmètre, le coût matière global reste strictement inchangé.
      </Alert>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label="Transferts validés" value={String(validated.length)} tone="success" />
        <Tile label="Valeur transférée" value={formatMoney(validated.reduce((a, r) => a + Number(r.total_cost || 0), 0))} />
        <Tile label="En brouillon" value={String(drafts.length)} tone={drafts.length ? 'warning' : 'neutral'} />
        <Tile label="Annulés" value={String(rows.filter((r) => r.status === 'annule').length)} />
      </div>

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'all', label: 'Tous' },
              { key: 'brouillon', label: 'Brouillons', badge: drafts.length },
              { key: 'valide', label: 'Validés' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>
        <FilterBar>
          <Field label="Mois" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} transfert(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetailId(r.id)}
            empty={<EmptyState icon={ArrowLeftRight} title="Aucun transfert" description="Créez un transfert pour déplacer du stock entre les cuisines." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouveau transfert</Button>} />}
          />
        )}
      </Card>

      <TransferModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(id) => { setCreateOpen(false); reload(); setDetailId(id); }} />
      {detailId && <TransferDetail id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </div>
  );
}

function Tile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const tones = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-600' };
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

function TransferModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [sourceKitchenId, setSourceKitchenId] = React.useState('1');
  const [destKitchenId, setDestKitchenId] = React.useState('3');
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [force, setForce] = React.useState(false);
  const [forceJustification, setForceJustification] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    setProductId(''); setQty(''); setReason(''); setForce(false); setForceJustification('');
  }, [open]);

  const product = products.find((p) => p.id === Number(productId));
  const totalCost = (Number(qty) || 0) * Number(product?.unit_cost || 0);
  const sameKitchen = sourceKitchenId === destKitchenId;

  const submit = async (validateNow: boolean) => {
    if (!productId) { toastError('Produit requis', 'Sélectionnez un produit.'); return; }
    if (sameKitchen) { toastError('Cuisines identiques', 'Source et destination doivent différer.'); return; }
    if (!(Number(qty) > 0)) { toastError('Quantité invalide', 'La quantité doit être supérieure à zéro.'); return; }

    setSubmitting(true);
    try {
      const res = await api.post<any>('/transfers', {
        sourceKitchenId: Number(sourceKitchenId),
        destKitchenId: Number(destKitchenId),
        productId: Number(productId),
        qty: Number(qty),
        reason: reason || null,
        occurredAt,
        forceNegative: force,
        forceJustification: force ? forceJustification : null,
      });
      if (validateNow) {
        await api.post(`/transfers/${res.id}/validate`, { forceNegative: force, forceJustification });
        success('Transfert validé', 'Stocks des deux cuisines mis à jour.');
      } else {
        success('Transfert enregistré en brouillon', 'Aucun stock modifié.');
      }
      onSaved(res.id);
    } catch (e: any) {
      toastError('Transfert impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau transfert"
      description="Brouillon puis validation, ou validation immédiate (atomique)."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="secondary" onClick={() => submit(false)} loading={submitting}>Brouillon</Button>
          <Button onClick={() => submit(true)} loading={submitting}><CheckCircle2 className="h-4 w-4" /> Créer et valider</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cuisine source" required>
            <Select value={sourceKitchenId} onChange={(e) => setSourceKitchenId(e.target.value)}>
              {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </Field>
          <Field label="Cuisine destination" required>
            <Select value={destKitchenId} onChange={(e) => setDestKitchenId(e.target.value)}>
              {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </Select>
          </Field>
        </div>

        {sameKitchen && <Alert tone="danger">La source et la destination doivent être différentes.</Alert>}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Produit" required className="sm:col-span-2">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name} ({p.stock_qty} {p.unit})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantité" required hint={product ? `unité : ${product.unit}` : undefined}>
            <Input type="number" step="0.001" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Coût unitaire retenu</span>
            <span className="tabular font-medium">{formatMoney(product?.unit_cost || 0)}</span>
          </div>
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-slate-500">Valeur transférée</span>
            <span className="tabular font-semibold text-slate-900">{formatMoney(totalCost)}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Cette valeur n’ajoute aucun coût : elle est identique des deux côtés.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
          <Field label="Motif">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Repas du personnel, mise en place…" />
          </Field>
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600" />
          <span>
            <span className="font-medium text-amber-900">Autoriser un dépassement de stock (ajustement explicite)</span>
            <span className="block text-xs text-amber-800">
              Utilisable uniquement si le stock source est insuffisant. Une justification écrite est obligatoire
              et l’opération sera signalée comme « forcée ».
            </span>
          </span>
        </label>

        {force && (
          <Field label="Justification du dépassement" required>
            <Textarea value={forceJustification} onChange={(e) => setForceJustification(e.target.value)} placeholder="Expliquez pourquoi le transfert dépasse le stock disponible…" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get<any>(`/transfers/${id}`), [id]);
  const [confirmValidate, setConfirmValidate] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [forceMode, setForceMode] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);

  const validate = async (opts?: { forceNegative?: boolean; forceJustification?: string }) => {
    setBusy(true);
    try {
      await api.post(`/transfers/${id}/validate`, opts || {});
      success('Transfert validé', 'Stock source débité, destination créditée.');
      setConfirmValidate(false);
      reload();
      onChanged();
    } catch (e: any) {
      // Stock insuffisant : proposer le mode forcé
      if (e.details?.available !== undefined) {
        setForceMode(e.details);
        setConfirmValidate(false);
      }
      toastError('Validation impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/transfers/${id}/cancel`, { reason });
      success('Transfert annulé', 'Contre-écritures enregistrées si le transfert était validé.');
      setConfirmCancel(false);
      reload();
      onChanged();
    } catch (e: any) {
      toastError('Annulation impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) return <Modal open onClose={onClose} title="Transfert" size="lg"><Loading /></Modal>;

  return (
    <>
      <Modal
        open onClose={onClose}
        title={`Transfert ${data.number}`}
        description={`${data.source_name} → ${data.dest_name} · ${formatDate(data.occurred_at)}`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {data.status !== 'annule' && (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}><XCircle className="h-4 w-4" /> Annuler le transfert</Button>
            )}
            {data.status === 'brouillon' && (
              <Button variant="success" onClick={() => setConfirmValidate(true)}><CheckCircle2 className="h-4 w-4" /> Valider</Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Produit" value={data.product_name} />
            <Mini label="Quantité" value={formatQty(data.qty, data.unit)} />
            <Mini label="Coût unitaire" value={formatMoney(data.unit_cost)} />
            <Mini label="Valeur" value={formatMoney(data.total_cost)} />
          </div>

          <div className="flex items-center justify-center gap-4 rounded-lg bg-slate-50 py-4">
            <div className="text-center">
              <p className="text-[10px] uppercase text-slate-500">Source</p>
              <p className="text-sm font-semibold text-slate-800">{data.source_name}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-primary" />
            <div className="text-center">
              <p className="text-[10px] uppercase text-slate-500">Destination</p>
              <p className="text-sm font-semibold text-slate-800">{data.dest_name}</p>
            </div>
          </div>

          {data.reason && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="font-medium">Motif :</span> {data.reason}</p>}

          {data.force_negative === 1 && (
            <Alert tone="warning" title="Transfert forcé (stock insuffisant)">
              {data.force_justification}
            </Alert>
          )}

          {data.status === 'annule' && (
            <Alert tone="danger" title="Transfert annulé">
              Motif : {data.cancel_reason || '—'}
            </Alert>
          )}

          {data.movements?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mouvements générés</h4>
              <ul className="space-y-1">
                {data.movements.map((m: any) => (
                  <li key={m.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-xs">
                    <span>{m.direction === 'in' ? '↓' : '↑'} {m.kitchen_name}</span>
                    <span className="tabular">{m.qty} {m.unit} — {formatMoney(m.total_cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmValidate} onClose={() => setConfirmValidate(false)} onConfirm={() => validate()} loading={busy}
        title="Valider le transfert ?"
        message={`${data.qty} ${data.unit} de ${data.product_name} seront déplacés de ${data.source_name} vers ${data.dest_name}. Opération atomique : les deux stocks sont mis à jour ensemble.`}
        confirmLabel="Valider"
      />

      <ConfirmDialog
        open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} loading={busy}
        title="Annuler le transfert ?"
        message={data.status === 'valide'
          ? 'Le transfert est validé : des contre-écritures seront enregistrées (aucune suppression). Le motif est obligatoire.'
          : 'Le brouillon sera marqué annulé. Aucun stock n’a été touché.'}
        confirmLabel="Annuler le transfert" requireReason
      />

      {forceMode && (
        <ForceValidateModal
          data={data}
          details={forceMode}
          onClose={() => setForceMode(null)}
          onConfirm={async (justification) => {
            await validate({ forceNegative: true, forceJustification: justification });
            setForceMode(null);
          }}
        />
      )}
    </>
  );
}

function ForceValidateModal({
  data, details, onClose, onConfirm,
}: { data: any; details: any; onClose: () => void; onConfirm: (justification: string) => Promise<void> }) {
  const [justification, setJustification] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  return (
    <Modal
      open onClose={onClose}
      title="Stock insuffisant — ajustement explicite requis"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={!justification.trim()} onClick={async () => {
            setBusy(true);
            try { await onConfirm(justification); } finally { setBusy(false); }
          }}>
            Forcer et valider
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="danger" title="Stock source insuffisant">
          Disponible : <strong>{details.available} {details.productUnit}</strong> ·
          Demandé : <strong>{data.qty} {details.productUnit}</strong>
        </Alert>
        <p className="text-sm text-slate-600">
          Le stock de la cuisine source deviendra négatif. Cette opération sera explicitement tracée comme
          « forcée » dans le journal d’audit.
        </p>
        <Field label="Justification (obligatoire)" required>
          <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Inventaire non saisi, erreur de réception précédente…" />
        </Field>
      </div>
    </Modal>
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
