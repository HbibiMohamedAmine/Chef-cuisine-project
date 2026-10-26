import React from 'react';
import { Utensils, Plus, ShoppingBasket, Download } from 'lucide-react';
import { api, qs, downloadFile } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, currentMonth, formatPeriod, formatDate } from '@/lib/utils';

export default function StaffPage() {
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [tab, setTab] = React.useState<'report' | 'stock'>('report');
  const [mealOpen, setMealOpen] = React.useState(false);
  const [purchaseOpen, setPurchaseOpen] = React.useState(false);

  const report = useApi(() => api.get<any>(`/staff/report/${period}`), [period]);
  const stock = useApi(() => api.get<any[]>('/staff/stock'), []);
  const r = report.data;

  const stockColumns = [
    { key: 'code', header: 'Code', width: '100px', render: (x: any) => <span className="font-mono text-xs">{x.code}</span> },
    { key: 'name', header: 'Produit', render: (x: any) => <span className="text-sm font-medium">{x.name}</span> },
    { key: 'qty', header: 'Quantité', align: 'right' as const, render: (x: any) => <span className="tabular">{formatQty(x.qty, x.unit)}</span> },
    { key: 'unit_cost', header: 'Coût unit.', align: 'right' as const, render: (x: any) => <span className="tabular text-xs">{formatMoney(x.unit_cost)}</span> },
    { key: 'value', header: 'Valeur', align: 'right' as const, render: (x: any) => <span className="tabular font-medium">{formatMoney(x.value)}</span> },
  ];

  return (
    <div>
      <PageHeader
        icon={Utensils}
        title="Cuisine du personnel"
        description="Stock séparé, repas consommés, rapports mensuels dédiés. Les repas du personnel ne sont pas des ventes."
        actions={
          <>
            <Button variant="outline" onClick={() => setPurchaseOpen(true)}><ShoppingBasket className="h-4 w-4" /> Achat direct</Button>
            <Button onClick={() => setMealOpen(true)}><Plus className="h-4 w-4" /> Consommation repas</Button>
          </>
        }
      />

      <Alert tone="info" className="mb-4" title="Traitement comptable distinct">
        Aucun repas du personnel n’apparaît dans le chiffre d’affaires : ce ne sont pas des ventes.
        Leur coût est suivi séparément. Son intégration au ratio matière est un <strong>paramètre</strong>{' '}
        (actuellement : {r ? (r.includedInRatio ? 'intégré au ratio' : 'exclu du ratio') : '…'}).
      </Alert>

      {r && (
        <div className="mb-4 grid gap-3 sm:grid-cols-5">
          <Tile label="Transferts reçus" value={formatMoney(r.transfersIn)} />
          <Tile label="Achats directs" value={formatMoney(r.directPurchases)} />
          <Tile label="Coût repas consommés" value={formatMoney(r.mealsConsumed)} tone="warning" />
          <Tile label="Pertes" value={formatMoney(r.losses)} tone="danger" />
          <Tile label="Stock actuel" value={formatMoney(r.stockValue)} tone="success" />
        </div>
      )}

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'report', label: 'Rapport mensuel' },
              { key: 'stock', label: 'Stock de la cuisine' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>

        {tab === 'report' ? (
          <>
            <FilterBar>
              <Field label="Période" className="w-52">
                <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </Field>
              <span className="ml-auto pb-2 text-xs text-slate-500">
                {formatPeriod(period)} · {r?.mealsMovementCount || 0} consommation(s) repas
              </span>
            </FilterBar>

            {report.loading ? <Loading /> : !r ? <EmptyState title="Aucune donnée" /> : (
              <div className="space-y-5 p-5">
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Produits consommés pour les repas
                  </h4>
                  {r.byProduct.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                      Aucune consommation de repas enregistrée ce mois.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="table-base">
                        <thead><tr><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Valeur</th></tr></thead>
                        <tbody>
                          {r.byProduct.map((p: any) => (
                            <tr key={p.id}>
                              <td className="text-sm">{p.name}</td>
                              <td className="tabular text-right text-xs">{formatQty(p.qty, p.unit)}</td>
                              <td className="tabular text-right text-xs font-medium">{formatMoney(p.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 font-semibold">
                            <td colSpan={2} className="text-right text-xs uppercase">Total repas</td>
                            <td className="tabular text-right text-sm text-amber-700">{formatMoney(r.mealsConsumed)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mouvements détaillés
                  </h4>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="table-base">
                      <thead><tr><th>Date</th><th>Type</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Valeur</th></tr></thead>
                      <tbody>
                        {r.details.map((d: any) => (
                          <tr key={d.id}>
                            <td className="text-xs">{formatDate(d.occurred_at)}</td>
                            <td className="text-xs">{MOVEMENT_FR[d.type] || d.type}</td>
                            <td className="text-xs">{d.product}</td>
                            <td className={cn('tabular text-right text-xs', d.direction === 'in' ? 'text-emerald-700' : 'text-red-600')}>
                              {d.direction === 'in' ? '+' : '−'}{d.qty} {d.unit}
                            </td>
                            <td className="tabular text-right text-xs">{formatMoney(d.value)}</td>
                          </tr>
                        ))}
                        {r.details.length === 0 && (
                          <tr><td colSpan={5} className="py-6 text-center text-xs text-slate-500">Aucun mouvement.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <p className="rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">{r.note}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {stock.loading ? <Loading /> : (
              <DataTable
                columns={stockColumns}
                rows={stock.data || []}
                empty={<EmptyState icon={Utensils} title="Stock vide" description="Transférez ou achetez des produits pour la cuisine du personnel." action={<Button onClick={() => setPurchaseOpen(true)}><ShoppingBasket className="h-4 w-4" /> Achat direct</Button>} />}
              />
            )}
          </>
        )}
      </Card>

      <MealModal open={mealOpen} onClose={() => setMealOpen(false)} onSaved={() => { setMealOpen(false); report.reload(); stock.reload(); }} />
      <StaffPurchaseModal open={purchaseOpen} onClose={() => setPurchaseOpen(false)} onSaved={() => { setPurchaseOpen(false); report.reload(); stock.reload(); }} />
    </div>
  );
}

const MOVEMENT_FR: Record<string, string> = {
  transfert_entree: 'Transfert reçu',
  transfert_sortie: 'Transfert sorti',
  reception: 'Achat direct',
  consommation_repas: 'Repas consommé',
  avarie: 'Avarie',
  ajustement_inventaire: 'Ajustement',
  ajustement_manuel: 'Ajustement manuel',
  contre_ecriture: 'Contre-écriture',
};

function Tile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const tones = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-600', danger: 'text-red-600' };
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

function MealModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [stockList, setStockList] = React.useState<any[]>([]);
  const [meals, setMeals] = React.useState('1');
  const [notes, setNotes] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/staff/stock').then(setStockList).catch(() => {});
    setLines([]); setMeals('1'); setNotes('');
  }, [open]);

  const total = lines.reduce((a, l) => {
    const p = stockList.find((x) => x.id === Number(l.productId));
    return a + (Number(l.qty) || 0) * Number(p?.unit_cost || 0);
  }, 0);

  const submit = async () => {
    const valid = lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (!valid.length) { toastError('Aucun produit', 'Ajoutez au moins un produit consommé.'); return; }
    setBusy(true);
    try {
      await api.post('/staff/meals', {
        meals: Number(meals) || 1,
        occurredAt,
        notes: notes || null,
        items: valid.map((l) => ({ productId: Number(l.productId), qty: Number(l.qty) })),
      });
      success('Repas enregistré', `${formatMoney(total)} — hors ventes`);
      onSaved();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Consommation de repas du personnel"
      description="Sortie de stock de la cuisine du personnel. Aucune vente n’est créée."
      size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={busy}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre de repas" required>
            <Input type="number" step="1" min="1" value={meals} onChange={(e) => setMeals(e.target.value)} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
          <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
            <p className="text-[10px] uppercase tracking-wide text-amber-700">Coût total</p>
            <p className="tabular mt-0.5 text-sm font-semibold text-amber-900">{formatMoney(total)}</p>
            <p className="text-[10px] text-amber-700">{formatMoney(Number(meals) > 0 ? total / Number(meals) : 0)} / repas</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Produits consommés</span>
            <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { productId: '', qty: '' }])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="p-5 text-center text-xs text-slate-500">
              {stockList.length === 0
                ? 'Le stock de la cuisine du personnel est vide : enregistrez un transfert ou un achat direct.'
                : 'Aucun produit sélectionné.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2 p-3">
                  <Select value={l.productId} className="h-9 flex-1 text-xs" onChange={(e) => {
                    const n = [...lines]; n[idx] = { ...l, productId: e.target.value }; setLines(n);
                  }}>
                    <option value="">Produit…</option>
                    {stockList.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.qty} {p.unit})</option>)}
                  </Select>
                  <Input type="number" step="0.001" min="0" className="h-9 w-24 text-right text-xs" placeholder="Qté"
                    value={l.qty} onChange={(e) => { const n = [...lines]; n[idx] = { ...l, qty: e.target.value }; setLines(n); }} />
                  <Button variant="ghost" size="icon" onClick={() => setLines((x) => x.filter((_, i) => i !== idx))}>✕</Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function StaffPurchaseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [unitCost, setUnitCost] = React.useState('');
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    setProductId(''); setQty(''); setUnitCost('');
  }, [open]);

  const submit = async () => {
    if (!productId || !(Number(qty) > 0)) { toastError('Champs requis', 'Produit et quantité obligatoires.'); return; }
    setBusy(true);
    try {
      await api.post('/staff/purchase', {
        productId: Number(productId), qty: Number(qty),
        unitCost: unitCost === '' ? undefined : Number(unitCost),
        date,
      });
      success('Achat direct enregistré', 'Entrée en stock de la cuisine du personnel.');
      onSaved();
    } catch (e: any) { toastError('Enregistrement impossible', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Achat direct — cuisine du personnel" size="sm"
      description="Entrée en stock immédiate. Ce n’est pas une consommation."
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={busy}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <Field label="Produit" required>
          <Select value={productId} onChange={(e) => {
            setProductId(e.target.value);
            const p = products.find((x) => x.id === Number(e.target.value));
            if (p) setUnitCost(String(p.unit_cost || ''));
          }}>
            <option value="">— Sélectionner —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantité" required><Input type="number" step="0.001" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Coût unitaire (DT)"><Input type="number" step="0.001" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
        </div>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
