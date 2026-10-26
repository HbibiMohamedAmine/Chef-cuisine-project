import React from 'react';
import { Package, Plus, Search, Pencil, Archive, RotateCcw, History } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi, useDebounced, useForm } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, roundMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Textarea, Tabs,
} from '@/components/ui';
import { PRODUCT_TYPE_LABELS, formatDate, cn } from '@/lib/utils';

export default function ProductsPage() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState('');
  const debounced = useDebounced(search, 300);
  const [tab, setTab] = React.useState<'active' | 'archived'>('active');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any>(null);
  const [detail, setDetail] = React.useState<any>(null);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/products${qs({ search: debounced, type, includeDeleted: tab === 'archived' ? 1 : '' })}`),
    [debounced, type, tab],
  );

  const rows = (data || []).filter((p: any) =>
    tab === 'archived' ? Boolean(p.deleted_at) : !p.deleted_at,
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (p: any) => {
    setEditing(p);
    setModalOpen(true);
  };

  const archive = async (p: any) => {
    const reason = window.prompt(
      `Archiver « ${p.name} » ?\n\nLe produit ne sera pas supprimé : son historique est conservé.\nMotif (facultatif) :`,
      '',
    );
    if (reason === null) return;
    try {
      await api.del(`/products/${p.id}`, { reason });
      success('Produit archivé', p.name);
      reload();
    } catch (e: any) {
      toastError('Archivage impossible', e.message);
    }
  };

  const restore = async (p: any) => {
    try {
      await api.post(`/products/${p.id}/restore`);
      success('Produit réactivé', p.name);
      reload();
    } catch (e: any) {
      toastError('Réactivation impossible', e.message);
    }
  };

  const columns = [
    {
      key: 'code',
      header: 'Code',
      width: '110px',
      render: (r: any) => <span className="font-mono text-xs font-semibold text-slate-700">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'Produit',
      render: (r: any) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{r.name}</p>
          <p className="truncate text-xs text-slate-500">
            {r.category_name || 'Sans catégorie'}
            {r.supplier_name ? ` · ${r.supplier_name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (r: any) => (
        <Badge tone={r.type === 'fini' ? 'primary' : r.type === 'semi_fini' ? 'info' : 'neutral'}>
          {PRODUCT_TYPE_LABELS[r.type] || r.type}
        </Badge>
      ),
    },
    {
      key: 'stock_qty',
      header: 'Stock',
      align: 'right' as const,
      render: (r: any) => (
        <div>
          <span
            className={cn(
              'tabular text-sm font-medium',
              r.stock_qty <= 0 ? 'text-red-600' : r.stock_qty <= r.min_stock ? 'text-amber-600' : 'text-slate-800',
            )}
          >
            {r.stock_qty} {r.unit}
          </span>
          {r.min_stock > 0 && <p className="text-[10px] text-slate-400">min {r.min_stock}</p>}
        </div>
      ),
    },
    {
      key: 'unit_cost',
      header: 'Coût unitaire',
      align: 'right' as const,
      render: (r: any) => <span className="tabular">{formatMoney(r.unit_cost)}</span>,
    },
    {
      key: 'value',
      header: 'Valeur',
      align: 'right' as const,
      render: (r: any) => (
        <span className="tabular">{formatMoney((Number(r.stock_qty) || 0) * (Number(r.unit_cost) || 0))}</span>
      ),
    },
    {
      key: 'dlc',
      header: 'DLC / Lot',
      render: (r: any) =>
        r.dlc || r.lot_number ? (
          <div className="text-xs">
            {r.dlc && <p>{formatDate(r.dlc)}</p>}
            {r.lot_number && <p className="text-slate-400">Lot {r.lot_number}</p>}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '120px',
      render: (r: any) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {tab === 'archived' ? (
            <Button variant="ghost" size="icon" title="Réactiver" onClick={() => restore(r)}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="icon" title="Modifier" onClick={() => openEdit(r)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" title="Archiver" onClick={() => archive(r)}>
                <Archive className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Package}
        title="Produits"
        description="Fiches produits, coûts de référence, seuils de stock, DLC et lots. Le stock est calculé à partir des mouvements, jamais saisi directement."
        actions={
          <Button onClick={openCreate} disabled={tab === 'archived'}>
            <Plus className="h-4 w-4" /> Nouveau produit
          </Button>
        }
      />

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'active', label: 'Produits actifs' },
              { key: 'archived', label: 'Archivés' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>

        <FilterBar>
          <Field label="Rechercher" className="w-72">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, nom ou lot…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Type" className="w-56">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {refs.productTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <div className="ml-auto pb-2 text-xs text-slate-500">
            {rows.length} produit(s)
          </div>
        </FilterBar>

        {loading ? (
          <Loading />
        ) : error ? (
          <div className="p-4"><ErrorState message={error} onRetry={reload} /></div>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetail(r)}
            empty={
              <EmptyState
                icon={Package}
                title="Aucun produit"
                description="Créez votre première fiche produit pour démarrer le suivi des stocks."
                action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> Créer un produit</Button>}
              />
            }
          />
        )}
      </Card>

      <ProductModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        onSaved={() => {
          setModalOpen(false);
          reload();
        }}
      />

      <ProductDetail product={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Formulaire produit
 * ------------------------------------------------------------------------- */
function ProductModal({
  open, onClose, editing, onSaved,
}: { open: boolean; onClose: () => void; editing: any; onSaved: () => void }) {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const { values, set, reset, errors, setErrors, submitting, setSubmitting } = useForm({
    code: '',
    name: '',
    type: 'matiere_premiere',
    unit: 'kg',
    categoryId: '',
    supplierId: '',
    defaultKitchenId: '1',
    purchasePrice: '',
    unitCost: '',
    minStock: '',
    dlc: '',
    lotNumber: '',
    isSellable: false,
    sellPriceHt: '',
    taxRate: '19',
    notes: '',
    initialQty: '',
  });
  const [suppliers, setSuppliers] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/suppliers').then(setSuppliers).catch(() => {});
    if (editing) {
      reset({
        code: editing.code,
        name: editing.name,
        type: editing.type,
        unit: editing.unit,
        categoryId: editing.category_id ? String(editing.category_id) : '',
        supplierId: editing.supplier_id ? String(editing.supplier_id) : '',
        defaultKitchenId: editing.default_kitchen_id ? String(editing.default_kitchen_id) : '1',
        purchasePrice: String(editing.purchase_price ?? ''),
        unitCost: String(editing.unit_cost ?? ''),
        minStock: String(editing.min_stock ?? ''),
        dlc: editing.dlc || '',
        lotNumber: editing.lot_number || '',
        isSellable: Boolean(editing.is_sellable),
        sellPriceHt: String(editing.sell_price_ht ?? ''),
        taxRate: String(editing.tax_rate ?? 19),
        notes: editing.notes || '',
        initialQty: '',
      });
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!values.code.trim()) errs.code = 'Le code est obligatoire.';
    if (!values.name.trim()) errs.name = 'Le nom est obligatoire.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        code: values.code,
        name: values.name,
        type: values.type,
        unit: values.unit,
        categoryId: values.categoryId ? Number(values.categoryId) : null,
        supplierId: values.supplierId ? Number(values.supplierId) : null,
        defaultKitchenId: values.defaultKitchenId ? Number(values.defaultKitchenId) : null,
        purchasePrice: values.purchasePrice === '' ? 0 : Number(values.purchasePrice),
        unitCost: values.unitCost === '' ? Number(values.purchasePrice || 0) : Number(values.unitCost),
        minStock: values.minStock === '' ? 0 : Number(values.minStock),
        dlc: values.dlc || null,
        lotNumber: values.lotNumber || null,
        isSellable: values.isSellable,
        sellPriceHt: values.sellPriceHt === '' ? 0 : Number(values.sellPriceHt),
        taxRate: values.taxRate === '' ? 0 : Number(values.taxRate),
        notes: values.notes || null,
        ...(editing ? {} : { initialQty: values.initialQty === '' ? 0 : Number(values.initialQty) }),
      };
      if (editing) {
        await api.put(`/products/${editing.id}`, payload);
        success('Produit mis à jour', values.name);
      } else {
        await api.post('/products', payload);
        success('Produit créé', `${values.code} — ${values.name}`);
      }
      onSaved();
    } catch (err: any) {
      if (err.details) setErrors(err.details);
      toastError(editing ? 'Modification impossible' : 'Création impossible', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Modifier « ${editing.name} »` : 'Nouveau produit'}
      description={editing ? 'Le code produit ne peut pas être modifié (traçabilité).' : 'Le code doit être unique.'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={submitting}>
            {editing ? 'Enregistrer' : 'Créer le produit'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code produit" required error={errors.code}>
            <Input
              value={values.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="RIZ01"
              disabled={Boolean(editing)}
              className="font-mono uppercase"
              required
            />
          </Field>
          <Field label="Nom du produit" required error={errors.name} className="sm:col-span-2">
            <Input value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="Riz long grain" required />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" required>
            <Select value={values.type} onChange={(e) => set('type', e.target.value)}>
              {refs.productTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unité" required>
            <Select value={values.unit} onChange={(e) => set('unit', e.target.value)}>
              {refs.units.map((u) => (
                <option key={u.code} value={u.code}>{u.label} ({u.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Catégorie">
            <Select value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Sans catégorie</option>
              {refs.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prix d’achat (DT)" hint="Prix fournisseur de référence">
            <Input
              type="number" step="0.001" min="0"
              value={values.purchasePrice}
              onChange={(e) => set('purchasePrice', e.target.value)}
              placeholder="0.000"
            />
          </Field>
          <Field label="Coût unitaire retenu (DT)" hint="CMP calculé automatiquement ; valeur de départ si vide">
            <Input
              type="number" step="0.001" min="0"
              value={values.unitCost}
              onChange={(e) => set('unitCost', e.target.value)}
              placeholder={values.purchasePrice || '0.000'}
            />
          </Field>
          <Field label="Stock minimal" hint="Seuil d’alerte">
            <Input type="number" step="0.001" min="0" value={values.minStock} onChange={(e) => set('minStock', e.target.value)} placeholder="0" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fournisseur habituel">
            <Select value={values.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
              <option value="">Aucun</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Emplacement / cuisine">
            <Select value={values.defaultKitchenId} onChange={(e) => set('defaultKitchenId', e.target.value)}>
              {refs.kitchens.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date limite (DLC)">
            <Input type="date" value={values.dlc} onChange={(e) => set('dlc', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="N° de lot">
            <Input value={values.lotNumber} onChange={(e) => set('lotNumber', e.target.value)} placeholder="LOT-2026-01" />
          </Field>
          {!editing && (
            <Field label="Stock initial" hint="Sera enregistré comme mouvement « stock initial »">
              <Input type="number" step="0.001" min="0" value={values.initialQty} onChange={(e) => set('initialQty', e.target.value)} placeholder="0" />
            </Field>
          )}
          <Field label="Produit vendable ?" hint="Peut être ajouté à une vente">
            <label className="flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3">
              <input
                type="checkbox"
                checked={values.isSellable}
                onChange={(e) => set('isSellable', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span className="text-sm text-slate-700">Oui, vendable au comptoir</span>
            </label>
          </Field>
        </div>

        {values.isSellable && (
          <div className="grid gap-4 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <Field label="Prix de vente HT (DT)">
              <Input type="number" step="0.001" min="0" value={values.sellPriceHt} onChange={(e) => set('sellPriceHt', e.target.value)} />
            </Field>
            <Field label="Taux de TVA (%)">
              <Select value={values.taxRate} onChange={(e) => set('taxRate', e.target.value)}>
                {refs.vatRates.map((r) => (
                  <option key={r} value={r}>{r} %</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label="Notes">
          <Textarea value={values.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Informations complémentaires…" />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 *  Détail produit (avec historique des mouvements)
 * ------------------------------------------------------------------------- */
function ProductDetail({ product, onClose }: { product: any; onClose: () => void }) {
  const { data, loading } = useApi(
    () => (product ? api.get(`/products/${product.id}`) : Promise.resolve(null)),
    [product?.id],
  );

  if (!product) return null;

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title={product.name}
      description={`${product.code} · ${PRODUCT_TYPE_LABELS[product.type] || product.type}`}
      size="xl"
    >
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Stock total" value={`${data.stock_qty} ${data.unit}`} />
            <MiniStat label="Valeur" value={formatMoney((Number(data.stock_qty) || 0) * Number(data.unit_cost))} />
            <MiniStat label="Coût unitaire" value={formatMoney(data.unit_cost)} />
            <MiniStat label="Stock minimal" value={`${data.min_stock} ${data.unit}`} />
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Stock par cuisine
            </h4>
            <div className="grid gap-2 sm:grid-cols-3">
              {data.stock_by_kitchen.map((k: any) => (
                <div key={k.kitchen_id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-xs text-slate-600">{k.kitchen_name}</span>
                  <span className="tabular text-sm font-semibold text-slate-800">
                    {k.qty} {data.unit}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {data.usage && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
              Utilisé dans {data.usage.recipe_items} recette(s), {data.usage.purchase_items} ligne(s) d’achat,
              {' '}{data.usage.transfers} transfert(s) et {data.usage.losses} avarie(s).
            </div>
          )}

          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <History className="h-3.5 w-3.5" /> Derniers mouvements
            </h4>
            {data.movements.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                Aucun mouvement enregistré.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Cuisine</th>
                      <th className="text-right">Quantité</th>
                      <th className="text-right">Valeur</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movements.map((m: any) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap text-xs">{formatDate(m.occurred_at, true)}</td>
                        <td className="text-xs">{MOVEMENT_LABELS_FR[m.movement_type] || m.movement_type}</td>
                        <td className="text-xs">{m.kitchen_name}</td>
                        <td className={cn('tabular text-right text-xs font-medium', m.direction === 'in' ? 'text-emerald-700' : 'text-red-600')}>
                          {m.direction === 'in' ? '+' : '−'}{m.qty} {m.unit}
                        </td>
                        <td className="tabular text-right text-xs">{formatMoney(m.total_cost)}</td>
                        <td className="text-xs text-slate-500">{m.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Alert tone="info" title="Le stock n’est jamais saisi directement">
            Toute variation provient d’un mouvement (réception, production, transfert, avarie, vente, inventaire).
            Une correction se fait par un ajustement justifié ou une contre-écriture — jamais par suppression.
          </Alert>
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

const MOVEMENT_LABELS_FR: Record<string, string> = {
  initial: 'Stock initial',
  reception: 'Réception',
  retour_fournisseur: 'Retour fournisseur',
  production_entree: 'Entrée production',
  production_sortie: 'Sortie production',
  transformation_sortie: 'Sortie transformation',
  transformation_entree: 'Entrée transformation',
  transfert_sortie: 'Transfert (sortie)',
  transfert_entree: 'Transfert (entrée)',
  avarie: 'Avarie',
  vente_sortie: 'Sortie vente',
  ajustement_inventaire: 'Ajustement inventaire',
  ajustement_manuel: 'Ajustement manuel',
  contre_ecriture: 'Contre-écriture',
  consommation_repas: 'Repas personnel',
};
