import React from 'react';
import { Receipt, Plus, Trash2, XCircle, TrendingUp } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney, saleLineTotals, roundMoney, vatBreakdown } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, today, monthBounds, currentMonth, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function SalesPage() {
  const { success, error: toastError } = useToast();
  const [tab, setTab] = React.useState<'sales' | 'analysis'>('sales');
  const [date, setDate] = React.useState(today());
  const [saleOpen, setSaleOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<number | null>(null);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/sales${qs({ from: date, to: date })}`),
    [date],
  );
  const rows = data || [];
  const period = date.slice(0, 7);
  const { start, end } = monthBounds(period);
  const analysis = useApi(() => api.get<any>(`/sales-analysis${qs({ from: start, to: end })}`), [period]);
  const recon = useApi(() => api.get<any>(`/sales-reconciliation${qs({ from: start, to: end })}`), [period]);

  const totalTtc = rows.filter((r) => r.status === 'valide').reduce((a, r) => a + Number(r.total_ttc || 0), 0);

  const columns = [
    { key: 'number', header: 'N°', width: '130px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'occurred_at', header: 'Heure', render: (r: any) => <span className="text-xs">{formatDate(r.occurred_at, true)}</span> },
    { key: 'items_count', header: 'Articles', align: 'right' as const },
    { key: 'subtotal_ht', header: 'HT', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.subtotal_ht)}</span> },
    { key: 'tax', header: 'TVA', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.tax)}</span> },
    { key: 'total_ttc', header: 'TTC', align: 'right' as const, render: (r: any) => <span className="tabular font-semibold">{formatMoney(r.total_ttc)}</span> },
    { key: 'payment_method', header: 'Paiement', render: (r: any) => <span className="text-xs capitalize">{r.payment_method}</span> },
    { key: 'status', header: 'Statut', render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title="Ventes"
        description="Ventes HT/TVA/TTC, remises et annulations. Les repas du personnel ne passent jamais par ce module."
        actions={<Button onClick={() => setSaleOpen(true)}><Plus className="h-4 w-4" /> Nouvelle vente</Button>}
      />

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'sales', label: 'Journal des ventes' },
              { key: 'analysis', label: 'Analyse & rapprochement' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>

        {tab === 'sales' ? (
          <>
            <FilterBar>
              <Field label="Journée" className="w-52">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <div className="ml-auto flex items-end gap-4 pb-1">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Total encaissé</p>
                  <p className="tabular text-base font-semibold text-primary">{formatMoney(totalTtc)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Ventes</p>
                  <p className="tabular text-base font-semibold text-slate-900">{rows.filter((r) => r.status === 'valide').length}</p>
                </div>
              </div>
            </FilterBar>

            {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
              <DataTable
                columns={columns}
                rows={rows}
                onRowClick={(r) => setDetailId(r.id)}
                empty={<EmptyState icon={Receipt} title="Aucune vente ce jour" description="Enregistrez votre première vente pour suivre le chiffre d’affaires." action={<Button onClick={() => setSaleOpen(true)}><Plus className="h-4 w-4" /> Nouvelle vente</Button>} />}
              />
            )}
          </>
        ) : (
          <AnalysisTab analysis={analysis} recon={recon} period={period} />
        )}
      </Card>

      <SaleModal open={saleOpen} onClose={() => setSaleOpen(false)} onSaved={() => { setSaleOpen(false); reload(); analysis.reload(); }} />
      {detailId && <SaleDetail id={detailId} onClose={() => setDetailId(null)} onChanged={() => { reload(); analysis.reload(); }} />}
    </div>
  );
}

function AnalysisTab({ analysis, recon, period }: { analysis: any; recon: any; period: string }) {
  if (analysis.loading) return <Loading />;
  const a = analysis.data;
  if (!a) return <EmptyState title="Aucune donnée" />;

  return (
    <div className="space-y-5 p-5">
      <Alert tone="info" title="Rapprochement ventes / sorties de stock">
        {recon.data?.note || 'Chargement…'}
      </Alert>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="CA HT du mois" value={formatMoney(a.byProduct.reduce((x: number, p: any) => x + p.revenue_ht, 0))} />
        <Stat label="Coût matière vendu" value={formatMoney(a.byProduct.reduce((x: number, p: any) => x + p.cost, 0))} />
        <Stat label="Marge brute" value={formatMoney(a.byProduct.reduce((x: number, p: any) => x + p.margin, 0))} tone="success" />
        <Stat label="Plats vendus" value={String(a.byProduct.length)} />
      </div>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Par catégorie</h4>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead><tr><th>Catégorie</th><th className="text-right">Quantité</th><th className="text-right">CA HT</th><th className="text-right">Coût</th><th className="text-right">Marge</th></tr></thead>
            <tbody>
              {a.byCategory.map((c: any) => (
                <tr key={c.category}>
                  <td className="text-sm font-medium">{c.category}</td>
                  <td className="tabular text-right text-xs">{c.qty}</td>
                  <td className="tabular text-right text-xs">{formatMoney(c.revenue_ht)}</td>
                  <td className="tabular text-right text-xs">{formatMoney(c.cost)}</td>
                  <td className="tabular text-right text-xs font-semibold text-emerald-700">{formatMoney(c.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Par plat</h4>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead><tr><th>Plat</th><th className="text-right">Qté</th><th className="text-right">CA HT</th><th className="text-right">Coût</th><th className="text-right">Marge</th><th className="text-right">Ratio</th></tr></thead>
            <tbody>
              {a.byProduct.map((p: any) => (
                <tr key={p.id}>
                  <td><p className="text-sm font-medium">{p.name}</p><p className="text-[10px] text-slate-400">{p.category_name || '—'}</p></td>
                  <td className="tabular text-right text-xs">{p.qty}</td>
                  <td className="tabular text-right text-xs">{formatMoney(p.revenue_ht)}</td>
                  <td className="tabular text-right text-xs">{formatMoney(p.cost)}</td>
                  <td className="tabular text-right text-xs font-semibold text-emerald-700">{formatMoney(p.margin)}</td>
                  <td className="tabular text-right text-xs">
                    <Badge tone={p.ratio_pct > 35 ? 'danger' : p.ratio_pct > 30 ? 'warning' : 'success'}>{p.ratio_pct} %</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>{value}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Nouvelle vente
 * ------------------------------------------------------------------------- */
function SaleModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [lines, setLines] = React.useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = React.useState('espece');
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then((list) => setProducts(list.filter((p) => p.is_sellable))).catch(() => {});
    setLines([]); setNotes(''); setPaymentMethod('espece');
  }, [open]);

  const addLine = () => setLines((l) => [...l, { productId: '', qty: '1', unitPriceHt: '', discountPct: '0', taxRate: '19' }]);

  const updateLine = (idx: number, patch: any) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      if (patch.productId) {
        const p = products.find((x) => x.id === Number(patch.productId));
        if (p) {
          next[idx].unitPriceHt = String(p.sell_price_ht || '');
          next[idx].taxRate = String(p.tax_rate ?? 19);
        }
      }
      return next;
    });
  };

  const totals = lines.reduce(
    (acc, l) => {
      const t = saleLineTotals(Number(l.qty) || 0, Number(l.unitPriceHt) || 0, Number(l.discountPct) || 0, Number(l.taxRate) || 0);
      return {
        ht: roundMoney(acc.ht + t.ht),
        tax: roundMoney(acc.tax + t.tax),
        ttc: roundMoney(acc.ttc + t.ttc),
      };
    },
    { ht: 0, tax: 0, ttc: 0 },
  );

  const submit = async () => {
    const valid = lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (!valid.length) { toastError('Aucun article', 'Ajoutez au moins un article.'); return; }
    setSubmitting(true);
    try {
      await api.post('/sales', {
        paymentMethod,
        notes: notes || null,
        items: valid.map((l) => ({
          productId: Number(l.productId),
          qty: Number(l.qty),
          unitPriceHt: Number(l.unitPriceHt) || 0,
          discountPct: Number(l.discountPct) || 0,
          taxRate: Number(l.taxRate) || 0,
        })),
      });
      success('Vente enregistrée', `${formatMoney(totals.ttc)} TTC`);
      onSaved();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle vente"
      description="Le stock des plats est décrémenté ; le coût matière n’est pas recompté (déjà capturé en production)."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={submitting}>Enregistrer la vente</Button>
        </>
      }
    >
      <div className="space-y-4">
        {products.length === 0 && (
          <Alert tone="warning" title="Aucun produit vendable">
            Activez « vendable » et renseignez un prix de vente HT sur vos fiches produits.
          </Alert>
        )}

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Articles</span>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
          </div>
          {lines.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">Aucun article.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => {
                const t = saleLineTotals(Number(l.qty) || 0, Number(l.unitPriceHt) || 0, Number(l.discountPct) || 0, Number(l.taxRate) || 0);
                return (
                  <div key={idx} className="grid items-center gap-2 p-3 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                      <Select value={l.productId} className="h-9 text-xs" onChange={(e) => updateLine(idx, { productId: e.target.value })}>
                        <option value="">Plat / produit…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                      </Select>
                    </div>
                    <div className="sm:col-span-1">
                      <Input type="number" step="1" min="0" className="h-9 text-right text-xs" placeholder="Qté"
                        value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Input type="number" step="0.001" min="0" className="h-9 text-right text-xs" placeholder="Prix HT"
                        value={l.unitPriceHt} onChange={(e) => updateLine(idx, { unitPriceHt: e.target.value })} />
                    </div>
                    <div className="sm:col-span-1">
                      <Input type="number" step="0.1" min="0" max="100" className="h-9 text-right text-xs" placeholder="Rem.%"
                        value={l.discountPct} onChange={(e) => updateLine(idx, { discountPct: e.target.value })} />
                    </div>
                    <div className="sm:col-span-1">
                      <Select value={l.taxRate} className="h-9 text-xs" onChange={(e) => updateLine(idx, { taxRate: e.target.value })}>
                        <option value="0">0%</option><option value="7">7%</option>
                        <option value="13">13%</option><option value="19">19%</option>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between sm:col-span-2">
                      <span className="tabular text-xs font-semibold">{formatMoney(t.ttc)}</span>
                      <Button variant="ghost" size="icon" onClick={() => setLines((x) => x.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mode de paiement">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="espece">Espèces</option>
              <option value="carte">Carte bancaire</option>
              <option value="cheque">Chèque</option>
              <option value="credit">Crédit (non encaissé)</option>
            </Select>
          </Field>
          <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Table, client…" /></Field>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total HT</span><span className="tabular">{formatMoney(totals.ht)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">TVA</span><span className="tabular">{formatMoney(totals.tax)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
                <span>Total TTC</span><span className="tabular text-primary">{formatMoney(totals.ttc)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SaleDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get<any>(`/sales/${id}`), [id]);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const cancel = async (reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/sales/${id}/cancel`, { reason });
      success('Vente annulée', 'Stock remis et remboursement enregistré.');
      setConfirmCancel(false); reload(); onChanged();
    } catch (e: any) { toastError('Annulation impossible', e.message); }
    finally { setBusy(false); }
  };

  if (loading || !data) return <Modal open onClose={onClose} title="Vente" size="lg"><Loading /></Modal>;

  return (
    <>
      <Modal
        open onClose={onClose}
        title={`Vente ${data.number}`}
        description={`${formatDate(data.occurred_at, true)} · ${data.payment_method} · ${STATUS_LABELS[data.status]}`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {data.status === 'valide' && <Button variant="danger" onClick={() => setConfirmCancel(true)}><XCircle className="h-4 w-4" /> Annuler la vente</Button>}
          </>
        }
      >
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="table-base">
              <thead><tr><th>Article</th><th className="text-right">Qté</th><th className="text-right">Prix HT</th><th className="text-right">Remise</th><th className="text-right">HT</th><th className="text-right">TVA</th><th className="text-right">TTC</th></tr></thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="text-sm">{i.product_name}</td>
                    <td className="tabular text-right text-xs">{i.qty}</td>
                    <td className="tabular text-right text-xs">{formatMoney(i.unit_price_ht)}</td>
                    <td className="tabular text-right text-xs">{i.discount_pct}%</td>
                    <td className="tabular text-right text-xs">{formatMoney(i.line_ht)}</td>
                    <td className="tabular text-right text-xs">{formatMoney(i.line_tax)}</td>
                    <td className="tabular text-right text-xs font-medium">{formatMoney(i.line_ttc)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={4} className="text-right text-xs uppercase">Total</td>
                  <td className="tabular text-right text-xs">{formatMoney(data.subtotal_ht - data.discount)}</td>
                  <td className="tabular text-right text-xs">{formatMoney(data.tax)}</td>
                  <td className="tabular text-right text-sm text-primary">{formatMoney(data.total_ttc)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {data.status === 'annule' && <Alert tone="danger" title="Vente annulée">Les sorties de stock ont été contre-écrites et le remboursement enregistré en caisse.</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} loading={busy}
        title="Annuler la vente ?"
        message="Le stock sera remis et un remboursement enregistré en caisse. La vente reste visible (annulée) — aucune suppression."
        confirmLabel="Annuler la vente" requireReason
      />
    </>
  );
}
