import React from 'react';
import { Warehouse, Plus, ClipboardList, AlertTriangle, CalendarClock, ArrowRight, Check } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, ConfirmDialog, DataTable,
  EmptyState, ErrorState, Field, FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, PRODUCT_TYPE_LABELS, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function StockPage() {
  const [tab, setTab] = React.useState<'stock' | 'counts'>('stock');

  return (
    <div>
      <PageHeader
        icon={Warehouse}
        title="Stock & inventaires"
        description="Stock théorique dérivé des mouvements, inventaires physiques distincts, alertes de rupture et de péremption."
      />

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'stock', label: 'État du stock' },
              { key: 'counts', label: 'Inventaires physiques' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>
        {tab === 'stock' ? <StockView /> : <CountsView />}
      </Card>
    </div>
  );
}

/* ===========================================================================
 *  ÉTAT DU STOCK
 * ========================================================================= */
function StockView() {
  const refs = useRefs();
  const [kitchenId, setKitchenId] = React.useState('');
  const [type, setType] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [onlyAlerts, setOnlyAlerts] = React.useState(false);

  const { data, loading, error, reload } = useApi(
    () => api.get(qs({ kitchenId, type, search, onlyAlerts: onlyAlerts ? 1 : '' }) ? `/stock${qs({ kitchenId, type, search, onlyAlerts: onlyAlerts ? 1 : '' })}` : '/stock'),
    [kitchenId, type, search, onlyAlerts],
  );

  const rows = data?.rows || [];
  const alerts = data?.alerts;

  const columns = [
    { key: 'code', header: 'Code', width: '100px', render: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
    {
      key: 'name',
      header: 'Produit',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.name}</p>
          <p className="text-xs text-slate-500">{r.category_name || '—'}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (r: any) => <span className="text-xs">{PRODUCT_TYPE_LABELS[r.type] || r.type}</span> },
    { key: 'kitchen_name', header: 'Cuisine', render: (r: any) => <span className="text-xs">{r.kitchen_name || 'Non localisé'}</span> },
    {
      key: 'qty',
      header: 'Quantité',
      align: 'right' as const,
      render: (r: any) => (
        <span className={cn('tabular font-semibold', r.stock_status === 'rupture' ? 'text-red-600' : r.stock_status === 'bas' ? 'text-amber-600' : 'text-slate-800')}>
          {formatQty(r.qty, r.unit)}
        </span>
      ),
    },
    { key: 'min_stock', header: 'Min.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs text-slate-500">{r.min_stock}</span> },
    { key: 'unit_cost', header: 'Coût unit.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.unit_cost)}</span> },
    { key: 'value', header: 'Valeur', align: 'right' as const, render: (r: any) => <span className="tabular font-medium">{formatMoney(r.value)}</span> },
    {
      key: 'stock_status',
      header: 'Statut',
      render: (r: any) => (
        <Badge tone={r.stock_status === 'rupture' ? 'danger' : r.stock_status === 'bas' ? 'warning' : 'success'}>
          {r.stock_status === 'rupture' ? 'Rupture' : r.stock_status === 'bas' ? 'Sous le seuil' : 'OK'}
        </Badge>
      ),
    },
    {
      key: 'dlc',
      header: 'DLC',
      render: (r: any) => (r.dlc ? <span className="text-xs">{formatDate(r.dlc)}</span> : <span className="text-slate-300">—</span>),
    },
  ];

  return (
    <>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
        <SummaryTile label="Valeur totale du stock" value={formatMoney(data?.totalValue || 0)} tone="primary" />
        <SummaryTile label="Ruptures" value={String(alerts?.lowStock?.filter((p: any) => p.qty <= 0).length || 0)} tone="danger" icon={AlertTriangle} />
        <SummaryTile label="Sous le seuil" value={String(alerts?.lowStock?.filter((p: any) => p.qty > 0).length || 0)} tone="warning" />
        <SummaryTile label={`Péremption < ${alerts?.expiryDays ?? 5} j`} value={String((alerts?.expiring?.length || 0) + (alerts?.expired?.length || 0))} tone="warning" icon={CalendarClock} />
      </div>

      <FilterBar>
        <Field label="Cuisine" className="w-52">
          <Select value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
            <option value="">Toutes les cuisines</option>
            {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        </Field>
        <Field label="Type" className="w-52">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous les types</option>
            {refs.productTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Rechercher" className="w-60">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code ou nom…" />
        </Field>
        <label className="flex h-10 items-center gap-2 pb-0.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyAlerts}
            onChange={(e) => setOnlyAlerts(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary"
          />
          Alertes uniquement
        </label>
        <Button variant="outline" size="sm" className="ml-auto mb-0.5" onClick={reload}>Actualiser</Button>
      </FilterBar>

      {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          empty={<EmptyState icon={Warehouse} title="Aucun stock" description="Réceptionnez un achat ou créez un produit avec un stock initial." />}
        />
      )}

      {alerts?.expired?.length > 0 && (
        <div className="border-t border-slate-100 p-4">
          <Alert tone="danger" title={`${alerts.expired.length} produit(s) périmé(s) en stock`}>
            Enregistrez une avarie pour assainir le stock :{' '}
            {alerts.expired.map((p: any) => p.name).join(', ')}.
          </Alert>
        </div>
      )}
    </>
  );
}

function SummaryTile({
  label, value, tone, icon: Icon,
}: { label: string; value: string; tone: 'primary' | 'danger' | 'warning'; icon?: React.ComponentType<{ className?: string }> }) {
  const tones = { primary: 'text-primary', danger: 'text-red-600', warning: 'text-amber-600' };
  return (
    <div className="flex items-start justify-between rounded-lg border border-slate-200 p-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
      </div>
      {Icon && <Icon className={cn('h-4 w-4', tones[tone])} />}
    </div>
  );
}

/* ===========================================================================
 *  INVENTAIRES PHYSIQUES
 * ========================================================================= */
function CountsView() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const { data, loading, error, reload } = useApi(() => api.get<any[]>('/stock-counts'), []);

  const rows = data || [];

  const columns = [
    { key: 'number', header: 'N°', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'count_date', header: 'Date', render: (r: any) => formatDate(r.count_date) },
    { key: 'kitchen_name', header: 'Cuisine' },
    { key: 'items_count', header: 'Lignes', align: 'right' as const },
    {
      key: 'total_variance_value',
      header: 'Écart valorisé',
      align: 'right' as const,
      render: (r: any) => (
        <span className={cn('tabular font-medium', Number(r.total_variance_value) < 0 ? 'text-red-600' : Number(r.total_variance_value) > 0 ? 'text-emerald-700' : 'text-slate-500')}>
          {formatMoney(r.total_variance_value)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (r: any) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>
          Ouvrir <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <>
      <FilterBar>
        <p className="pb-2 text-xs text-slate-500">
          L’inventaire physique compare le stock théorique (mouvements) au comptage réel.
          Chaque écart doit être justifié pour être validé.
        </p>
        <Button className="ml-auto mb-0.5" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Nouvel inventaire
        </Button>
      </FilterBar>

      {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(r) => setDetailId(r.id)}
          empty={<EmptyState icon={ClipboardList} title="Aucun inventaire" description="Créez un inventaire pour figer les quantités théoriques et saisir le comptage." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvel inventaire</Button>} />}
        />
      )}

      <CreateCountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        kitchens={refs.kitchens}
        onCreated={(id) => {
          setCreateOpen(false);
          reload();
          setDetailId(id);
        }}
      />

      {detailId && (
        <CountDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

function CreateCountModal({
  open, onClose, kitchens, onCreated,
}: { open: boolean; onClose: () => void; kitchens: any[]; onCreated: (id: number) => void }) {
  const { error: toastError } = useToast();
  const [kitchenId, setKitchenId] = React.useState('1');
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => { if (open) setKitchenId('1'); }, [open]);

  const submit = async () => {
    setLoading(true);
    try {
      const res = await api.post<any>('/stock-counts', {
        kitchenId: Number(kitchenId),
        countDate: date,
        notes,
      });
      onCreated(res.id);
    } catch (e: any) {
      toastError('Création impossible', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvel inventaire physique"
      description="Les quantités théoriques sont figées à la création. Les écarts devront être justifiés."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={loading}>Créer</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Cuisine" required>
          <Select value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
            {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        </Field>
        <Field label="Date du comptage" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Conditions du comptage…" />
        </Field>
      </div>
    </Modal>
  );
}

function CountDetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get<any>(`/stock-counts/${id}`), [id]);
  const [items, setItems] = React.useState<any[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [confirmValidate, setConfirmValidate] = React.useState(false);

  React.useEffect(() => {
    if (data?.items) setItems(data.items.map((i: any) => ({ ...i, physical_qty: String(i.physical_qty), justification: i.justification || '' })));
  }, [data]);

  const isDraft = data?.status === 'brouillon';

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/stock-counts/${id}`, {
        items: items.map((i) => ({
          id: i.id,
          physicalQty: i.physical_qty === '' ? 0 : Number(i.physical_qty),
          justification: i.justification,
        })),
      });
      success('Inventaire enregistré');
      reload();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setSaving(true);
    try {
      await save();
      await api.post(`/stock-counts/${id}/validate`);
      success('Inventaire validé', 'Les ajustements justifiés ont été enregistrés.');
      setConfirmValidate(false);
      reload();
      onChanged();
    } catch (e: any) {
      toastError('Validation impossible', e.message);
    } finally {
      setSaving(false);
    }
  };

  const variance = items.reduce((acc, i) => {
    const v = (Number(i.physical_qty) || 0) - Number(i.theoretical_qty);
    return acc + v * Number(i.unit_cost);
  }, 0);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={data ? `Inventaire ${data.number}` : 'Inventaire'}
        description={data ? `${data.kitchen_name} · ${formatDate(data.count_date)} · ${STATUS_LABELS[data.status]}` : ''}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {isDraft && <Button variant="secondary" onClick={save} loading={saving}>Enregistrer le comptage</Button>}
            {isDraft && <Button onClick={() => setConfirmValidate(true)} disabled={saving}>Valider l’inventaire</Button>}
          </>
        }
      >
        {loading || !data ? <Loading /> : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5">
              <span className="text-xs font-medium text-slate-600">Écart valorisé total</span>
              <span className={cn('tabular text-sm font-semibold', variance < 0 ? 'text-red-600' : variance > 0 ? 'text-emerald-700' : 'text-slate-700')}>
                {formatMoney(variance)}
              </span>
            </div>

            <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="text-right">Théorique</th>
                    <th className="text-right w-28">Physique</th>
                    <th className="text-right">Écart</th>
                    <th className="w-64">Justification</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const v = (Number(it.physical_qty) || 0) - Number(it.theoretical_qty);
                    return (
                      <tr key={it.id}>
                        <td>
                          <p className="text-sm font-medium text-slate-800">{it.name}</p>
                          <p className="font-mono text-[10px] text-slate-400">{it.code}</p>
                        </td>
                        <td className="tabular text-right text-xs">{it.theoretical_qty} {it.unit}</td>
                        <td className="text-right">
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={it.physical_qty}
                            disabled={!isDraft}
                            onChange={(e) => {
                              const next = [...items];
                              next[idx] = { ...it, physical_qty: e.target.value };
                              setItems(next);
                            }}
                            className="h-8 text-right text-xs"
                          />
                        </td>
                        <td className={cn('tabular text-right text-xs font-semibold', Math.abs(v) < 0.0001 ? 'text-slate-400' : v > 0 ? 'text-emerald-700' : 'text-red-600')}>
                          {v > 0 ? '+' : ''}{v.toFixed(3)}
                        </td>
                        <td>
                          <Input
                            value={it.justification}
                            disabled={!isDraft}
                            placeholder={Math.abs(v) < 0.0001 ? '—' : 'Motif obligatoire'}
                            onChange={(e) => {
                              const next = [...items];
                              next[idx] = { ...it, justification: e.target.value };
                              setItems(next);
                            }}
                            className="h-8 text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isDraft && (
              <Alert tone="warning" title="Validation = écriture en stock">
                Chaque écart non nul doit être justifié. La validation crée des mouvements d’ajustement
                tracés (aucune écriture directe, aucune suppression possible).
              </Alert>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmValidate}
        onClose={() => setConfirmValidate(false)}
        onConfirm={validate}
        loading={saving}
        title="Valider l’inventaire ?"
        message="Les écarts justifiés seront enregistrés comme ajustements de stock. Cette opération est définitive (correction ultérieure par un nouvel inventaire)."
        confirmLabel="Valider et ajuster"
      />
    </>
  );
}
