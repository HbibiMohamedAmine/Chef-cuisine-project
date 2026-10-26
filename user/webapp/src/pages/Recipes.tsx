import React from 'react';
import { ChefHat, Plus, Pencil, Trash2, RefreshCw, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useForm } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn } from '@/lib/utils';

export default function RecipesPage() {
  const { success, error: toastError } = useToast();
  const [search, setSearch] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any>(null);
  const [detail, setDetail] = React.useState<any>(null);
  const [recalcing, setRecalcing] = React.useState(false);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/recipes?search=${encodeURIComponent(search)}`),
    [search],
  );
  const rows = data || [];

  const recalc = async () => {
    setRecalcing(true);
    try {
      const res = await api.post<any>('/recipes/recalculate');
      success('Coûts recalculés', `${res.updated} recette(s) mise(s) à jour depuis les prix actuels.`);
      reload();
    } catch (e: any) {
      toastError('Recalcul impossible', e.message);
    } finally {
      setRecalcing(false);
    }
  };

  const columns = [
    { key: 'code', header: 'Code', width: '110px', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.code}</span> },
    {
      key: 'name',
      header: 'Recette',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.name}</p>
          <p className="text-xs text-slate-500">
            {r.output_product_name ? `${r.output_product_name} · ` : ''}{r.portions} portion(s)
          </p>
        </div>
      ),
    },
    { key: 'items_count', header: 'Ingréd.', align: 'right' as const },
    { key: 'total_cost', header: 'Coût total', align: 'right' as const, render: (r: any) => <span className="tabular">{formatMoney(r.total_cost)}</span> },
    { key: 'cost_per_portion', header: 'Coût / portion', align: 'right' as const, render: (r: any) => <span className="tabular font-medium">{formatMoney(r.cost_per_portion)}</span> },
    { key: 'selling_price_per_portion', header: 'Prix vente HT', align: 'right' as const, render: (r: any) => <span className="tabular">{formatMoney(r.selling_price_per_portion)}</span> },
    {
      key: 'ratio_pct',
      header: 'Ratio',
      align: 'right' as const,
      render: (r: any) => (
        <Badge tone={r.ratio_pct === 0 ? 'neutral' : r.ratio_pct > 35 ? 'danger' : r.ratio_pct > 30 ? 'warning' : 'success'}>
          {r.ratio_pct ? formatPct(r.ratio_pct) : '—'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '100px',
      render: (r: any) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" title="Modifier" onClick={() => { setEditing(r); setModalOpen(true); }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Archiver" onClick={async () => {
            if (!window.confirm(`Archiver la recette « ${r.name} » ?`)) return;
            try { await api.del(`/recipes/${r.id}`); reload(); } catch (e: any) { toastError('Archivage impossible', e.message); }
          }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={ChefHat}
        title="Recettes & coût de revient"
        description="Ingrédients, coût, marge théorique. Le coût est recalculé automatiquement dès qu’un prix d’achat change."
        actions={
          <>
            <Button variant="outline" onClick={recalc} loading={recalcing}>
              <RefreshCw className="h-4 w-4" /> Recalculer les coûts
            </Button>
            <Button onClick={() => { setEditing(null); setModalOpen(true); }}>
              <Plus className="h-4 w-4" /> Nouvelle recette
            </Button>
          </>
        }
      />

      <Alert tone="info" className="mb-4" title="Recalcul automatique">
        Le coût d’une recette est toujours calculé à partir du coût moyen pondéré actuel des ingrédients
        (mis à jour à chaque réception). Aucune valeur n’est figée.
      </Alert>

      <Card>
        <FilterBar>
          <Field label="Rechercher" className="w-72">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code ou nom de recette…" />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} recette(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetail(r)}
            empty={<EmptyState icon={ChefHat} title="Aucune recette" description="Créez une recette pour maîtriser votre coût matière plat par plat." action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Créer une recette</Button>} />}
          />
        )}
      </Card>

      <RecipeModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); reload(); }}
      />
      <RecipeDetail recipe={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function RecipeModal({ open, editing, onClose, onSaved }: { open: boolean; editing: any; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [products, setProducts] = React.useState<any[]>([]);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [portions, setPortions] = React.useState('1');
  const [outputProductId, setOutputProductId] = React.useState('');
  const [sellingPriceHt, setSellingPriceHt] = React.useState('');
  const [taxRate, setTaxRate] = React.useState('19');
  const [instructions, setInstructions] = React.useState('');
  const [lines, setLines] = React.useState<any[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/products').then(setProducts).catch(() => {});
    if (editing) {
      setLoadingDetail(true);
      api.get<any>(`/recipes/${editing.id}`).then((r) => {
        setCode(r.code); setName(r.name); setPortions(String(r.portions));
        setOutputProductId(r.output_product_id ? String(r.output_product_id) : '');
        setSellingPriceHt(String(r.selling_price_ht ?? ''));
        setTaxRate(String(r.tax_rate ?? 19));
        setInstructions(r.instructions || '');
        setLines(r.items.map((i: any) => ({
          productId: String(i.product_id), qty: String(i.qty), unit: i.unit,
        })));
        setLoadingDetail(false);
      }).catch(() => setLoadingDetail(false));
    } else {
      setCode(''); setName(''); setPortions('1'); setOutputProductId('');
      setSellingPriceHt(''); setTaxRate('19'); setInstructions(''); setLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const totalCost = lines.reduce((acc, l) => {
    const p = products.find((x) => x.id === Number(l.productId));
    return acc + (Number(l.qty) || 0) * (Number(p?.unit_cost) || 0);
  }, 0);
  const perPortion = Number(portions) > 0 ? totalCost / Number(portions) : 0;
  const price = Number(sellingPriceHt) || 0;
  const ratio = price > 0 ? (perPortion / price) * 100 : 0;

  const submit = async () => {
    if (!name.trim()) { toastError('Nom requis', 'Le nom de la recette est obligatoire.'); return; }
    const valid = lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (!valid.length) { toastError('Aucun ingrédient', 'Ajoutez au moins un ingrédient.'); return; }
    setSubmitting(true);
    try {
      const payload = {
        code: code || undefined,
        name,
        portions: Number(portions) || 1,
        outputProductId: outputProductId ? Number(outputProductId) : null,
        sellingPriceHt: price,
        taxRate: Number(taxRate) || 0,
        instructions: instructions || null,
        items: valid.map((l) => ({
          productId: Number(l.productId),
          qty: Number(l.qty),
          unit: l.unit || products.find((x) => x.id === Number(l.productId))?.unit,
        })),
      };
      if (editing) await api.put(`/recipes/${editing.id}`, payload);
      else await api.post('/recipes', payload);
      success(editing ? 'Recette mise à jour' : 'Recette créée', name);
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
      title={editing ? `Modifier « ${editing.name} »` : 'Nouvelle recette'}
      size="xl"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={submitting}>Enregistrer</Button></>}
    >
      {loadingDetail ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Code" hint="Généré si vide">
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono uppercase" disabled={Boolean(editing)} />
            </Field>
            <Field label="Nom de la recette" required className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Portions" required>
              <Input type="number" step="0.01" min="0.01" value={portions} onChange={(e) => setPortions(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Produit fini associé" hint="Utilisé pour la production et les ventes">
              <Select value={outputProductId} onChange={(e) => {
                setOutputProductId(e.target.value);
                const p = products.find((x) => x.id === Number(e.target.value));
                if (p?.sell_price_ht) setSellingPriceHt(String(p.sell_price_ht));
              }}>
                <option value="">Aucun</option>
                {products.filter((p) => ['fini', 'semi_fini'].includes(p.type)).map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Prix de vente HT / portion (DT)">
              <Input type="number" step="0.001" min="0" value={sellingPriceHt} onChange={(e) => setSellingPriceHt(e.target.value)} />
            </Field>
            <Field label="TVA (%)">
              <Select value={taxRate} onChange={(e) => setTaxRate(e.target.value)}>
                <option value="0">0 %</option><option value="7">7 %</option>
                <option value="13">13 %</option><option value="19">19 %</option>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Ingrédients</span>
              <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { productId: '', qty: '', unit: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">Aucun ingrédient.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {lines.map((l, idx) => {
                  const p = products.find((x) => x.id === Number(l.productId));
                  const cost = (Number(l.qty) || 0) * (Number(p?.unit_cost) || 0);
                  return (
                    <div key={idx} className="grid items-center gap-2 p-3 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <Select value={l.productId} className="h-9 text-xs" onChange={(e) => {
                          const next = [...lines];
                          const prod = products.find((x) => x.id === Number(e.target.value));
                          next[idx] = { ...l, productId: e.target.value, unit: prod?.unit || 'kg' };
                          setLines(next);
                        }}>
                          <option value="">Produit…</option>
                          {products.map((pp) => (
                            <option key={pp.id} value={pp.id}>{pp.code} — {pp.name} ({pp.unit})</option>
                          ))}
                        </Select>
                      </div>
                      <div className="sm:col-span-2">
                        <Input type="number" step="0.001" min="0" className="h-9 text-right text-xs" placeholder="Qté"
                          value={l.qty} onChange={(e) => { const n = [...lines]; n[idx] = { ...l, qty: e.target.value }; setLines(n); }} />
                      </div>
                      <div className="sm:col-span-1 text-center text-xs text-slate-500">{l.unit || '—'}</div>
                      <div className="sm:col-span-2 text-right text-xs text-slate-500">{formatMoney(p?.unit_cost || 0)}/{p?.unit || ''}</div>
                      <div className="flex items-center justify-between gap-1 sm:col-span-1">
                        <span className="tabular text-xs font-semibold">{formatMoney(cost)}</span>
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

          <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-4">
            <Summary label="Coût total" value={formatMoney(totalCost)} />
            <Summary label="Coût / portion" value={formatMoney(perPortion)} />
            <Summary label="Prix vente HT" value={price > 0 ? formatMoney(price) : '—'} />
            <Summary label="Ratio matière" value={ratio > 0 ? formatPct(ratio) : '—'} tone={ratio > 35 ? 'danger' : ratio > 30 ? 'warning' : 'success'} />
          </div>

          <Field label="Instructions de préparation">
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} placeholder="Étapes de préparation…" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-0.5 text-sm font-semibold',
        tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>
        {value}
      </p>
    </div>
  );
}

function RecipeDetail({ recipe, onClose }: { recipe: any; onClose: () => void }) {
  const { data, loading } = useApi(() => (recipe ? api.get(`/recipes/${recipe.id}`) : Promise.resolve(null)), [recipe?.id]);
  if (!recipe) return null;

  return (
    <Modal open onClose={onClose} title={recipe.name} description={recipe.code} size="lg">
      {loading || !data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Coût total" value={formatMoney(data.total_cost)} />
            <Summary label="Coût / portion" value={formatMoney(data.cost_per_portion)} />
            <Summary label="Marge / portion" value={formatMoney(data.margin_per_portion)} tone="success" />
            <Summary label="Ratio" value={data.ratio_pct ? formatPct(data.ratio_pct) : '—'} />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="table-base">
              <thead><tr><th>Ingrédient</th><th className="text-right">Quantité</th><th className="text-right">Coût unit.</th><th className="text-right">Coût ligne</th></tr></thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className="text-sm">{i.product_name}</td>
                    <td className="tabular text-right text-xs">{i.qty} {i.unit}</td>
                    <td className="tabular text-right text-xs">{formatMoney(i.unit_cost)}</td>
                    <td className="tabular text-right text-xs font-medium">{formatMoney(i.line_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.instructions && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Préparation</h4>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{data.instructions}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
