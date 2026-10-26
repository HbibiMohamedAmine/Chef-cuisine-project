import React from 'react';
import { Factory, Plus, CheckCircle2, XCircle, Trash2, ChevronRight } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, formatQty, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, formatDate, monthBounds, currentMonth, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function ProductionPage() {
  const [period, setPeriod] = React.useState(currentMonth());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const { start, end } = monthBounds(period);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/productions${qs({ from: start, to: end })}`),
    [period],
  );
  const rows = data || [];

  const columns = [
    { key: 'number', header: 'N°', width: '130px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'produced_at', header: 'Date', render: (r: any) => <span className="text-xs">{formatDate(r.produced_at, true)}</span> },
    {
      key: 'product_name',
      header: 'Produit fabriqué',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.product_name}</p>
          <p className="text-xs text-slate-500">{r.recipe_name || 'Hors recette'}</p>
        </div>
      ),
    },
    {
      key: 'qty_produced',
      header: 'Quantité',
      align: 'right' as const,
      render: (r: any) => <span className="tabular">{formatQty(r.qty_produced, r.unit)}</span>,
    },
    { key: 'total_cost', header: 'Coût total', align: 'right' as const, render: (r: any) => <span className="tabular">{formatMoney(r.total_cost)}</span> },
    { key: 'unit_cost', header: 'Coût unit.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.unit_cost)}</span> },
    {
      key: 'status',
      header: 'Statut',
      render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '120px',
      render: (r: any) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>
          Ouvrir <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Factory}
        title="Production — cuisine centrale"
        description="Consommation des matières, entrée du produit fabriqué, pertes. Validation atomique : soit tout passe, soit rien."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvelle production</Button>}
      />

      <Alert tone="info" className="mb-4" title="Pas de double comptage">
        Les ingrédients sortent du stock à la validation (leur coût est ainsi capturé une seule fois).
        Le produit fabriqué entre à son coût de production. On ne compte jamais « ingrédients + produit fini ».
      </Alert>

      <Card>
        <FilterBar>
          <Field label="Mois" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} production(s)</span>
        </FilterBar>
        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetailId(r.id)}
            empty={<EmptyState icon={Factory} title="Aucune production" description="Enregistrez une production pour transformer vos matières premières." action={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Nouvelle production</Button>} />}
          />
        )}
      </Card>

      <ProductionModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(id) => { setCreateOpen(false); reload(); setDetailId(id); }} />
      {detailId && <ProductionDetail id={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </div>
  );
}

function ProductionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [recipes, setRecipes] = React.useState<any[]>([]);
  const [products, setProducts] = React.useState<any[]>([]);
  const [recipeId, setRecipeId] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [qtyTheoretical, setQtyTheoretical] = React.useState('');
  const [qtyProduced, setQtyProduced] = React.useState('');
  const [portions, setPortions] = React.useState('1');
  const [lossQty, setLossQty] = React.useState('0');
  const [lossIncluded, setLossIncluded] = React.useState(true);
  const [comment, setComment] = React.useState('');
  const [lines, setLines] = React.useState<any[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/recipes').then(setRecipes).catch(() => {});
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    setRecipeId(''); setProductId(''); setQtyTheoretical(''); setQtyProduced('');
    setPortions('1'); setLossQty('0'); setLossIncluded(true); setComment(''); setLines([]);
  }, [open]);

  const applyRecipe = async (id: string) => {
    setRecipeId(id);
    if (!id) { setLines([]); return; }
    const r = await api.get<any>(`/recipes/${id}`);
    setProductId(r.output_product_id ? String(r.output_product_id) : '');
    setPortions(String(r.portions));
    setQtyTheoretical(String(r.portions));
    setLines(r.items.map((i: any) => ({
      productId: String(i.product_id),
      qtyTheoretical: String(i.qty),
      qtyActual: String(i.qty),
      unit: i.unit,
      unitCost: i.unit_cost,
      name: i.product_name,
    })));
  };

  const totalCost = lines.reduce((a, l) => a + (Number(l.qtyActual) || 0) * (Number(l.unitCost) || 0), 0);
  const unitCost = Number(qtyProduced) > 0 ? totalCost / Number(qtyProduced) : 0;

  const submit = async (validateNow: boolean) => {
    if (!productId) { toastError('Produit fabriqué requis', 'Sélectionnez le produit obtenu.'); return; }
    if (lines.length === 0) { toastError('Aucun ingrédient', 'Sélectionnez une recette ou ajoutez des ingrédients.'); return; }
    setSubmitting(true);
    try {
      const res = await api.post<any>('/productions', {
        kitchenId: 1,
        recipeId: recipeId ? Number(recipeId) : null,
        productId: Number(productId),
        qtyTheoretical: Number(qtyTheoretical) || 0,
        qtyProduced: Number(qtyProduced) || 0,
        portions: Number(portions) || 1,
        lossQty: Number(lossQty) || 0,
        lossIncluded,
        comment: comment || null,
        items: lines.map((l) => ({
          productId: Number(l.productId),
          qtyTheoretical: Number(l.qtyTheoretical) || 0,
          qtyActual: Number(l.qtyActual) || 0,
          unit: l.unit,
        })),
      });
      if (validateNow) {
        await api.post(`/productions/${res.id}/validate`);
        success('Production validée', 'Matières sorties, produit fini entré en stock.');
      } else {
        success('Production enregistrée en brouillon', 'Aucun mouvement de stock effectué.');
      }
      onSaved(res.id);
    } catch (e: any) {
      toastError('Production impossible', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle production"
      description="Cuisine centrale uniquement. Le brouillon ne touche pas au stock."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="secondary" onClick={() => submit(false)} loading={submitting}>Enregistrer en brouillon</Button>
          <Button onClick={() => submit(true)} loading={submitting}><CheckCircle2 className="h-4 w-4" /> Créer et valider</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Recette" hint="Pré-remplit les ingrédients">
            <Select value={recipeId} onChange={(e) => applyRecipe(e.target.value)}>
              <option value="">Sans recette</option>
              {recipes.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </Select>
          </Field>
          <Field label="Produit fabriqué" required>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {products.filter((p) => ['semi_fini', 'fini', 'ingredient_repas'].includes(p.type)).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Portions obtenues">
            <Input type="number" step="0.01" min="0.01" value={portions} onChange={(e) => setPortions(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantité théorique attendue">
            <Input type="number" step="0.001" min="0" value={qtyTheoretical} onChange={(e) => setQtyTheoretical(e.target.value)} />
          </Field>
          <Field label="Quantité réellement produite" required>
            <Input type="number" step="0.001" min="0" value={qtyProduced} onChange={(e) => setQtyProduced(e.target.value)} />
          </Field>
          <Field label="Dont pertes (quantité)">
            <Input type="number" step="0.001" min="0" value={lossQty} onChange={(e) => setLossQty(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Matières consommées</span>
            <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { productId: '', qtyTheoretical: '0', qtyActual: '', unit: 'kg', unitCost: 0, name: '' }])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">Sélectionnez une recette ou ajoutez des matières.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <div key={idx} className="grid items-center gap-2 p-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Select value={l.productId} className="h-9 text-xs" onChange={(e) => {
                      const p = products.find((x) => x.id === Number(e.target.value));
                      const n = [...lines];
                      n[idx] = { ...l, productId: e.target.value, unit: p?.unit || 'kg', unitCost: p?.unit_cost || 0, name: p?.name || '' };
                      setLines(n);
                    }}>
                      <option value="">Matière…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Input type="number" step="0.001" min="0" className="h-9 text-right text-xs" placeholder="Théorique"
                      value={l.qtyTheoretical} onChange={(e) => { const n = [...lines]; n[idx] = { ...l, qtyTheoretical: e.target.value }; setLines(n); }} />
                  </div>
                  <div className="sm:col-span-2">
                    <Input type="number" step="0.001" min="0" className="h-9 text-right text-xs" placeholder="Réelle"
                      value={l.qtyActual} onChange={(e) => { const n = [...lines]; n[idx] = { ...l, qtyActual: e.target.value }; setLines(n); }} />
                  </div>
                  <div className="sm:col-span-1 text-center text-xs text-slate-500">{l.unit}</div>
                  <div className="sm:col-span-1 text-right text-xs text-slate-500">{formatMoney(l.unitCost)}</div>
                  <div className="flex items-center justify-between sm:col-span-1">
                    <span className="tabular text-xs font-semibold">{formatMoney((Number(l.qtyActual) || 0) * (Number(l.unitCost) || 0))}</span>
                    <Button variant="ghost" size="icon" onClick={() => setLines((x) => x.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <input type="checkbox" checked={lossIncluded} onChange={(e) => setLossIncluded(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary" />
          <span>
            <span className="font-medium text-slate-800">Les pertes sont déjà incluses dans le coût du produit fabriqué</span>
            <span className="block text-xs text-slate-500">
              Coché : la perte est absorbée par le coût de production (pas de double comptage).
              Décoché : une avarie séparée sera créée, à ajouter au coût matière retenu.
            </span>
          </span>
        </label>

        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-3">
          <Summary label="Coût total matières" value={formatMoney(totalCost)} />
          <Summary label="Coût unitaire produit" value={unitCost > 0 ? formatMoney(unitCost) : '—'} />
          <Summary
            label="Rendement"
            value={Number(qtyTheoretical) > 0 ? `${formatPct((Number(qtyProduced) / Number(qtyTheoretical)) * 100)}` : '—'}
          />
        </div>

        <Field label="Commentaire">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Observations sur la production…" />
        </Field>
      </div>
    </Modal>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ProductionDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const { data, loading, reload } = useApi(() => api.get<any>(`/productions/${id}`), [id]);
  const [confirmValidate, setConfirmValidate] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const validate = async () => {
    setBusy(true);
    try {
      await api.post(`/productions/${id}/validate`);
      success('Production validée', 'Mouvements de stock enregistrés.');
      setConfirmValidate(false); reload(); onChanged();
    } catch (e: any) { toastError('Validation impossible', e.message); }
    finally { setBusy(false); }
  };

  const cancel = async (reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/productions/${id}/cancel`, { reason });
      success('Production annulée'); setConfirmCancel(false); reload(); onChanged();
    } catch (e: any) { toastError('Annulation impossible', e.message); }
    finally { setBusy(false); }
  };

  if (loading || !data) return <Modal open onClose={onClose} title="Production" size="lg"><Loading /></Modal>;

  return (
    <>
      <Modal
        open onClose={onClose}
        title={`Production ${data.number}`}
        description={`${data.product_name} · ${formatDate(data.produced_at, true)} · ${STATUS_LABELS[data.status]}`}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
            {data.status === 'brouillon' && (
              <>
                <Button variant="danger" onClick={() => setConfirmCancel(true)}><XCircle className="h-4 w-4" /> Annuler</Button>
                <Button variant="success" onClick={() => setConfirmValidate(true)}><CheckCircle2 className="h-4 w-4" /> Valider</Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Quantité produite" value={formatQty(data.qty_produced, data.unit)} />
            <Mini label="Coût total" value={formatMoney(data.total_cost)} />
            <Mini label="Coût unitaire" value={formatMoney(data.unit_cost)} />
            <Mini label="Pertes" value={`${data.loss_qty} ${data.unit}`} />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="table-base">
              <thead><tr><th>Matière</th><th className="text-right">Théorique</th><th className="text-right">Réelle</th><th className="text-right">Écart</th><th className="text-right">Coût</th></tr></thead>
              <tbody>
                {data.items.map((i: any) => {
                  const variance = Number(i.qty_actual) - Number(i.qty_theoretical);
                  return (
                    <tr key={i.id}>
                      <td className="text-sm">{i.product_name}</td>
                      <td className="tabular text-right text-xs">{i.qty_theoretical} {i.unit}</td>
                      <td className="tabular text-right text-xs">{i.qty_actual} {i.unit}</td>
                      <td className={cn('tabular text-right text-xs', Math.abs(variance) < 0.001 ? 'text-slate-400' : variance > 0 ? 'text-red-600' : 'text-emerald-700')}>
                        {variance > 0 ? '+' : ''}{variance.toFixed(3)}
                      </td>
                      <td className="tabular text-right text-xs font-medium">{formatMoney(i.total_cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.movements?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mouvements générés</h4>
              <ul className="space-y-1">
                {data.movements.map((m: any) => (
                  <li key={m.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-xs">
                    <span>{m.direction === 'in' ? '↓ Entrée' : '↑ Sortie'} · {m.product_name}</span>
                    <span className="tabular">{m.qty} {m.unit} — {formatMoney(m.total_cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.comment && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{data.comment}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmValidate} onClose={() => setConfirmValidate(false)} onConfirm={validate} loading={busy}
        title="Valider la production ?"
        message="Les matières seront sorties du stock et le produit fabriqué entré à son coût de production. Opération atomique et définitive."
        confirmLabel="Valider"
      />
      <ConfirmDialog
        open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} loading={busy}
        title="Annuler la production ?" message="Le brouillon sera marqué annulé. Aucun stock n’a été touché."
        confirmLabel="Annuler la production" requireReason
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
