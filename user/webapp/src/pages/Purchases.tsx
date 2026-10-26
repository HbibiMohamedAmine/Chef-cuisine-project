import React from 'react';
import { ShoppingCart, Plus, PackageCheck, Trash2, Wallet, ChevronRight } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi, useForm } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, roundMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, formatDate, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function PurchasesPage() {
  const { error: toastError } = useToast();
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [receiveId, setReceiveId] = React.useState<number | null>(null);
  const [detailId, setDetailId] = React.useState<number | null>(null);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/purchases${qs({ status, search })}`),
    [status, search],
  );
  const rows = data || [];

  const cancel = async (p: any) => {
    const reason = window.prompt(`Annuler l’achat ${p.number} ?\nMotif obligatoire :`);
    if (!reason) return;
    try {
      await api.post(`/purchases/${p.id}/cancel`, { reason });
      reload();
    } catch (e: any) {
      toastError('Annulation impossible', e.message);
    }
  };

  const columns = [
    { key: 'number', header: 'N°', width: '130px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    {
      key: 'supplier_name',
      header: 'Fournisseur',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.supplier_name}</p>
          <p className="text-xs text-slate-500">{r.invoice_number ? `Facture ${r.invoice_number}` : 'Sans facture'}</p>
        </div>
      ),
    },
    { key: 'order_date', header: 'Commandé le', render: (r: any) => <span className="text-xs">{formatDate(r.order_date)}</span> },
    { key: 'received_date', header: 'Reçu le', render: (r: any) => <span className="text-xs">{r.received_date ? formatDate(r.received_date) : '—'}</span> },
    { key: 'items_count', header: 'Lignes', align: 'right' as const },
    { key: 'total', header: 'Total', align: 'right' as const, render: (r: any) => <span className="tabular font-semibold">{formatMoney(r.total)}</span> },
    {
      key: 'payment_status',
      header: 'Paiement',
      render: (r: any) => (
        <div>
          <Badge tone={statusTone(r.payment_status)}>{STATUS_LABELS[r.payment_status] || r.payment_status}</Badge>
          {Number(r.paid_amount) > 0 && <p className="mt-0.5 text-[10px] text-slate-500">payé {formatMoney(r.paid_amount)}</p>}
        </div>
      ),
    },
    { key: 'status', header: 'Statut', render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '140px',
      render: (r: any) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {['brouillon', 'commandee', 'partielle'].includes(r.status) && (
            <Button variant="success" size="sm" onClick={() => setReceiveId(r.id)}>
              <PackageCheck className="h-3.5 w-3.5" /> Réceptionner
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setDetailId(r.id)} title="Détail">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={ShoppingCart}
        title="Achats & réceptions"
        description="Commandes fournisseurs, réceptions et factures. Seule une réception validée entre en stock — un achat n’est jamais une consommation."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvel achat</Button>}
      />

      <Alert tone="info" className="mb-4" title="Règle comptable appliquée">
        Un achat commandé ne modifie pas le stock. La réception crée les mouvements d’entrée et met à jour
        le coût moyen pondéré. La consommation est calculée à la clôture, jamais à la facture.
      </Alert>

      <Card>
        <FilterBar>
          <Field label="Statut" className="w-52">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous</option>
              <option value="brouillon">Brouillon</option>
              <option value="commandee">Commandée</option>
              <option value="partielle">Partielle</option>
              <option value="receptionnee">Réceptionnée</option>
              <option value="annulee">Annulée</option>
            </Select>
          </Field>
          <Field label="Rechercher" className="w-64">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="N°, facture, fournisseur…" />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} achat(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetailId(r.id)}
            empty={<EmptyState icon={ShoppingCart} title="Aucun achat" description="Créez une commande puis réceptionnez-la pour alimenter le stock." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvel achat</Button>} />}
          />
        )}
      </Card>

      <PurchaseModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload(); }} />
      {receiveId && <ReceiveModal id={receiveId} onClose={() => setReceiveId(null)} onDone={() => { setReceiveId(null); reload(); }} />}
      {detailId && <PurchaseDetail id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Création d'achat
 * ------------------------------------------------------------------------- */
function PurchaseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [suppliers, setSuppliers] = React.useState<any[]>([]);
  const [products, setProducts] = React.useState<any[]>([]);
  const [supplierId, setSupplierId] = React.useState('');
  const [orderDate, setOrderDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [taxRate, setTaxRate] = React.useState('0');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<any[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/suppliers').then(setSuppliers).catch(() => {});
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    setLines([]);
    setSupplierId('');
    setInvoiceNumber('');
    setNotes('');
  }, [open]);

  const addLine = () => setLines((l) => [...l, { productId: '', qtyOrdered: '1', unitPrice: '', discountPct: '0', lotNumber: '', dlc: '' }]);

  const updateLine = (idx: number, patch: any) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      if (patch.productId) {
        const p = products.find((x) => x.id === Number(patch.productId));
        if (p && !next[idx].unitPrice) next[idx].unitPrice = String(p.purchase_price || p.unit_cost || '');
      }
      return next;
    });
  };

  const total = lines.reduce((acc, l) => {
    const gross = (Number(l.qtyOrdered) || 0) * (Number(l.unitPrice) || 0);
    return acc + gross * (1 - (Number(l.discountPct) || 0) / 100);
  }, 0);
  const tax = (total * (Number(taxRate) || 0)) / 100;

  const submit = async (status: 'brouillon' | 'commandee') => {
    if (!supplierId) { toastError('Fournisseur requis', 'Sélectionnez un fournisseur.'); return; }
    if (!lines.length) { toastError('Aucune ligne', 'Ajoutez au moins un produit.'); return; }
    const invalid = lines.find((l) => !l.productId || !(Number(l.qtyOrdered) > 0));
    if (invalid) { toastError('Ligne incomplète', 'Chaque ligne doit avoir un produit et une quantité > 0.'); return; }

    setSubmitting(true);
    try {
      await api.post('/purchases', {
        supplierId: Number(supplierId),
        orderDate,
        status,
        invoiceNumber: invoiceNumber || null,
        taxRate: Number(taxRate) || 0,
        notes: notes || null,
        items: lines.map((l) => ({
          productId: Number(l.productId),
          qtyOrdered: Number(l.qtyOrdered),
          unitPrice: Number(l.unitPrice) || 0,
          discountPct: Number(l.discountPct) || 0,
          lotNumber: l.lotNumber || null,
          dlc: l.dlc || null,
        })),
      });
      success('Achat créé', 'Réceptionnez-le pour alimenter le stock.');
      onSaved();
    } catch (e: any) {
      toastError('Création impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvel achat"
      description="Un achat ne modifie pas le stock tant qu’il n’est pas réceptionné."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="secondary" onClick={() => submit('brouillon')} loading={submitting}>Enregistrer en brouillon</Button>
          <Button onClick={() => submit('commandee')} loading={submitting}>Enregistrer la commande</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Fournisseur" required className="sm:col-span-2">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Date de commande" required>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field label="N° facture"><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Lignes de commande</span>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
          </div>
          {lines.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">Aucune ligne. Ajoutez un produit.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <div key={idx} className="grid gap-2 p-3 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <Select value={l.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })} className="h-9 text-xs">
                      <option value="">Produit…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Input type="number" step="0.001" min="0" className="h-9 text-xs" placeholder="Qté"
                      value={l.qtyOrdered} onChange={(e) => updateLine(idx, { qtyOrdered: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Input type="number" step="0.001" min="0" className="h-9 text-xs" placeholder="Prix unit."
                      value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} />
                  </div>
                  <div className="sm:col-span-1">
                    <Input type="number" step="0.1" min="0" max="100" className="h-9 text-xs" placeholder="Rem.%"
                      value={l.discountPct} onChange={(e) => updateLine(idx, { discountPct: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Input type="date" className="h-9 text-xs" value={l.dlc} onChange={(e) => updateLine(idx, { dlc: e.target.value })} title="DLC" />
                  </div>
                  <div className="flex items-center justify-between gap-1 sm:col-span-1">
                    <span className="tabular text-xs font-medium">
                      {formatMoney((Number(l.qtyOrdered) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100))}
                    </span>
                    <Button variant="ghost" size="icon" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} title="Supprimer">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Field label="TVA sur l’achat (%)" hint="Facultatif — dépend de votre régime">
              <Select value={taxRate} onChange={(e) => setTaxRate(e.target.value)}>
                <option value="0">0 %</option><option value="7">7 %</option>
                <option value="13">13 %</option><option value="19">19 %</option>
              </Select>
            </Field>
            <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Sous-total HT</span><span className="tabular font-medium">{formatMoney(total)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">TVA</span><span className="tabular">{formatMoney(tax)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold">
                <span>Total TTC</span><span className="tabular text-primary">{formatMoney(roundMoney(total + tax))}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 *  Réception
 * ------------------------------------------------------------------------- */
function ReceiveModal({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const { success, error: toastError } = useToast();
  const refs = useRefs();
  const { data, loading } = useApi(() => api.get<any>(`/purchases/${id}`), [id]);
  const [items, setItems] = React.useState<any[]>([]);
  const [kitchenId, setKitchenId] = React.useState('1');
  const [receivedDate, setReceivedDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [paidAmount, setPaidAmount] = React.useState('0');
  const [paymentMethod, setPaymentMethod] = React.useState('espece');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (data?.items) {
      setItems(data.items.map((i: any) => ({
        id: i.id, product_id: i.product_id, product_name: i.product_name,
        qty_ordered: i.qty_ordered, qty_received: String(i.qty_ordered),
        unit: i.unit, unit_price: String(i.unit_price), lot_number: i.lot_number || '', dlc: i.dlc || '',
      })));
      setInvoiceNumber(data.invoice_number || '');
    }
  }, [data]);

  const receivedValue = items.reduce(
    (acc, i) => acc + (Number(i.qty_received) || 0) * (Number(i.unit_price) || 0),
    0,
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/purchases/${id}/receive`, {
        kitchenId: Number(kitchenId),
        receivedDate,
        invoiceNumber: invoiceNumber || null,
        paidAmount: Number(paidAmount) || 0,
        paymentMethod,
        items: items.map((i) => ({
          id: i.id,
          qtyReceived: Number(i.qty_received) || 0,
          unitPrice: Number(i.unit_price) || 0,
          lotNumber: i.lot_number || null,
          dlc: i.dlc || null,
        })),
      });
      success('Réception validée', 'Le stock a été mis à jour.');
      onDone();
    } catch (e: any) {
      toastError('Réception impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Réceptionner l’achat"
      description="Ajustez les quantités réellement reçues : elles seules entrent en stock."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="success" onClick={submit} loading={submitting}>
            <PackageCheck className="h-4 w-4" /> Valider la réception
          </Button>
        </>
      }
    >
      {loading || !data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Fournisseur" className="sm:col-span-2">
              <Input value={data.supplier_name} disabled />
            </Field>
            <Field label="Cuisine de réception" required>
              <Select value={kitchenId} onChange={(e) => setKitchenId(e.target.value)}>
                {refs.kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Select>
            </Field>
            <Field label="Date de réception" required>
              <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            </Field>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Produit</th><th className="text-right">Commandé</th>
                  <th className="text-right w-28">Reçu</th><th className="text-right w-28">Prix unit.</th>
                  <th className="w-32">Lot</th><th className="w-36">DLC</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id}>
                    <td className="text-sm font-medium">{i.product_name}</td>
                    <td className="tabular text-right text-xs text-slate-500">{i.qty_ordered} {i.unit}</td>
                    <td>
                      <Input type="number" step="0.001" min="0" className="h-8 text-right text-xs" value={i.qty_received}
                        onChange={(e) => { const n = [...items]; n[idx] = { ...i, qty_received: e.target.value }; setItems(n); }} />
                    </td>
                    <td>
                      <Input type="number" step="0.001" min="0" className="h-8 text-right text-xs" value={i.unit_price}
                        onChange={(e) => { const n = [...items]; n[idx] = { ...i, unit_price: e.target.value }; setItems(n); }} />
                    </td>
                    <td><Input className="h-8 text-xs" value={i.lot_number} onChange={(e) => { const n = [...items]; n[idx] = { ...i, lot_number: e.target.value }; setItems(n); }} /></td>
                    <td><Input type="date" className="h-8 text-xs" value={i.dlc} onChange={(e) => { const n = [...items]; n[idx] = { ...i, dlc: e.target.value }; setItems(n); }} /></td>
                    <td className="tabular text-right text-xs font-medium">{formatMoney((Number(i.qty_received) || 0) * (Number(i.unit_price) || 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={6} className="text-right text-xs uppercase text-slate-600">Valeur entrée en stock</td>
                  <td className="tabular text-right text-sm text-primary">{formatMoney(receivedValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="N° facture fournisseur"><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
            <Field label="Montant payé maintenant (DT)" hint="0 si à crédit">
              <Input type="number" step="0.001" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
            </Field>
            <Field label="Mode de paiement">
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {refs.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </Select>
            </Field>
          </div>

          <Alert tone="warning" title="Coût moyen pondéré recalculé">
            Chaque entrée recalcule le coût unitaire du produit. Les recettes utilisant ce produit seront
            automatiquement revalorisées.
          </Alert>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 *  Détail achat
 * ------------------------------------------------------------------------- */
function PurchaseDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get(`/purchases/${id}`), [id]);
  const [payOpen, setPayOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('espece');

  if (loading || !data) return <Modal open onClose={onClose} title="Achat" size="lg"><Loading /></Modal>;

  const remaining = roundMoney(Number(data.total) - Number(data.paid_amount));

  const pay = async () => {
    try {
      await api.post(`/purchases/${id}/pay`, { amount: Number(amount), paymentMethod: method });
      success('Paiement enregistré');
      setPayOpen(false);
      setAmount('');
      reload();
      onChanged();
    } catch (e: any) {
      toastError('Paiement impossible', e.message);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Achat ${data.number}`}
        description={`${data.supplier_name} · ${formatDate(data.order_date)}`}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {remaining > 0 && data.status !== 'annulee' && (
              <Button onClick={() => { setPayOpen(true); setAmount(String(remaining)); }}>
                <Wallet className="h-4 w-4" /> Enregistrer un paiement
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Total" value={formatMoney(data.total)} />
            <Mini label="Payé" value={formatMoney(data.paid_amount)} />
            <Mini label="Reste" value={formatMoney(remaining)} tone={remaining > 0 ? 'warning' : 'success'} />
            <Mini label="Statut" value={STATUS_LABELS[data.status] || data.status} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead><tr><th>Produit</th><th className="text-right">Commandé</th><th className="text-right">Reçu</th><th className="text-right">Prix unit.</th><th className="text-right">Total</th><th>Lot / DLC</th></tr></thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="text-sm">{i.product_name}</td>
                    <td className="tabular text-right text-xs">{i.qty_ordered} {i.unit}</td>
                    <td className={cn('tabular text-right text-xs font-medium', i.qty_received < i.qty_ordered ? 'text-amber-600' : 'text-emerald-700')}>
                      {i.qty_received}
                    </td>
                    <td className="tabular text-right text-xs">{formatMoney(i.unit_price)}</td>
                    <td className="tabular text-right text-xs">{formatMoney(i.line_total)}</td>
                    <td className="text-xs text-slate-500">{i.lot_number || '—'}{i.dlc ? ` · ${formatDate(i.dlc)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.status === 'receptionnee' && (
            <Alert tone="success" title="Réception validée">
              Les quantités reçues sont en stock depuis le {formatDate(data.received_date)}.
              Toute correction passe par un retour fournisseur ou un ajustement justifié.
            </Alert>
          )}
        </div>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Enregistrer un paiement"
        size="sm"
        footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Annuler</Button><Button onClick={pay}>Enregistrer</Button></>}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Reste à payer : <span className="font-semibold">{formatMoney(remaining)}</span></p>
          <Field label="Montant (DT)" required>
            <Input type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Mode de paiement">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="espece">Espèces</option>
              <option value="cheque">Chèque</option>
              <option value="virement">Virement</option>
              <option value="carte">Carte</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'success' }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-sm font-semibold', tone === 'warning' ? 'text-amber-700' : tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>{value}</p>
    </div>
  );
}
