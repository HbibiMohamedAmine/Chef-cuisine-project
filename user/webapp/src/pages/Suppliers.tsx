import React from 'react';
import { Truck, Plus, Pencil, Archive, Phone, Mail, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useDebounced, useForm } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Textarea,
} from '@/components/ui';
import { formatDate, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function SuppliersPage() {
  const { success, error: toastError } = useToast();
  const [search, setSearch] = React.useState('');
  const debounced = useDebounced(search, 300);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any>(null);
  const [detail, setDetail] = React.useState<any>(null);

  const { data, loading, error, reload } = useApi(() => api.get<any[]>(`/suppliers?search=${encodeURIComponent(debounced)}`), [debounced]);
  const rows = data || [];

  const archive = async (s: any) => {
    if (!window.confirm(`Archiver le fournisseur « ${s.name} » ?`)) return;
    try {
      await api.del(`/suppliers/${s.id}`);
      success('Fournisseur archivé', s.name);
      reload();
    } catch (e: any) {
      toastError('Archivage impossible', e.message);
    }
  };

  const columns = [
    { key: 'code', header: 'Code', width: '90px', render: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
    {
      key: 'name',
      header: 'Fournisseur',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.name}</p>
          <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
            {r.contact_name && <span>{r.contact_name}</span>}
            {r.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
            {r.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.email}</span>}
          </div>
        </div>
      ),
    },
    { key: 'purchases_count', header: 'Achats', align: 'right' as const },
    {
      key: 'total_purchased',
      header: 'Total acheté',
      align: 'right' as const,
      render: (r: any) => <span className="tabular">{formatMoney(r.total_purchased || 0)}</span>,
    },
    {
      key: 'outstanding',
      header: 'Reste à payer',
      align: 'right' as const,
      render: (r: any) => (
        <span className={`tabular font-medium ${Number(r.outstanding) > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
          {formatMoney(r.outstanding || 0)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '110px',
      render: (r: any) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" title="Modifier" onClick={() => { setEditing(r); setModalOpen(true); }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Archiver" onClick={() => archive(r)}>
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Truck}
        title="Fournisseurs"
        description="Fiches fournisseurs, historique des achats, encours et comparaison des prix par produit."
        actions={
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4" /> Nouveau fournisseur
          </Button>
        }
      />

      <Card>
        <FilterBar>
          <Field label="Rechercher" className="w-72">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, code, contact…" />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} fournisseur(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => setDetail(r)}
            empty={<EmptyState icon={Truck} title="Aucun fournisseur" description="Créez vos fournisseurs pour enregistrer les achats et comparer les prix." action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Créer</Button>} />}
          />
        )}
      </Card>

      <SupplierModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); reload(); }}
      />

      <SupplierDetail supplier={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function SupplierModal({ open, editing, onClose, onSaved }: { open: boolean; editing: any; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const { values, set, reset, errors, setErrors, submitting, setSubmitting } = useForm({
    code: '', name: '', contactName: '', phone: '', email: '', address: '', taxId: '', paymentTerms: '', notes: '',
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      reset({
        code: editing.code, name: editing.name, contactName: editing.contact_name || '',
        phone: editing.phone || '', email: editing.email || '', address: editing.address || '',
        taxId: editing.tax_id || '', paymentTerms: editing.payment_terms || '', notes: editing.notes || '',
      });
    } else reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setErrors({ name: 'Le nom est obligatoire.' });
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/suppliers/${editing.id}`, values);
        success('Fournisseur mis à jour');
      } else {
        await api.post('/suppliers', values);
        success('Fournisseur créé', values.name);
      }
      onSaved();
    } catch (err: any) {
      toastError('Enregistrement impossible', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Modifier ${editing.name}` : 'Nouveau fournisseur'}
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={submitting}>Enregistrer</Button></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" hint="Généré si vide">
            <Input value={values.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono uppercase" disabled={Boolean(editing)} />
          </Field>
          <Field label="Nom" required error={errors.name} className="sm:col-span-2">
            <Input value={values.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact"><Input value={values.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
          <Field label="Téléphone"><Input value={values.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="E-mail"><Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Matricule fiscal"><Input value={values.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><Input value={values.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Conditions de paiement"><Input value={values.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="Comptant, 30 jours…" /></Field>
          <Field label="Notes"><Input value={values.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function SupplierDetail({ supplier, onClose }: { supplier: any; onClose: () => void }) {
  const { data, loading } = useApi(() => (supplier ? api.get(`/suppliers/${supplier.id}`) : Promise.resolve(null)), [supplier?.id]);
  if (!supplier) return null;

  return (
    <Modal open onClose={onClose} title={supplier.name} description={`${supplier.code} · ${supplier.phone || 'sans téléphone'}`} size="xl">
      {loading || !data ? <Loading /> : (
        <div className="space-y-5">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Comparaison des prix d’achat</h4>
            {data.priceHistory.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">Aucun achat réceptionné.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead><tr><th>Produit</th><th className="text-right">Min.</th><th className="text-right">Moyen</th><th className="text-right">Max.</th><th className="text-right">Achats</th><th>Dernier</th></tr></thead>
                  <tbody>
                    {data.priceHistory.map((p: any) => (
                      <tr key={p.product_id}>
                        <td className="text-sm">{p.product_name} <span className="text-xs text-slate-400">/{p.unit}</span></td>
                        <td className="tabular text-right text-xs text-emerald-700">{formatMoney(p.min_price)}</td>
                        <td className="tabular text-right text-xs font-semibold">{formatMoney(p.avg_price)}</td>
                        <td className="tabular text-right text-xs text-red-600">{formatMoney(p.max_price)}</td>
                        <td className="tabular text-right text-xs">{p.occurrences}</td>
                        <td className="text-xs">{formatDate(p.last_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Historique des achats</h4>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead><tr><th>N°</th><th>Date</th><th className="text-right">Total</th><th>Paiement</th><th>Statut</th></tr></thead>
                <tbody>
                  {data.purchases.map((p: any) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.number}</td>
                      <td className="text-xs">{formatDate(p.order_date)}</td>
                      <td className="tabular text-right text-xs">{formatMoney(p.total)}</td>
                      <td><Badge tone={statusTone(p.payment_status)}>{STATUS_LABELS[p.payment_status] || p.payment_status}</Badge></td>
                      <td><Badge tone={statusTone(p.status)}>{STATUS_LABELS[p.status] || p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Alert tone="info" title="Achat ≠ consommation">
            Une réception augmente le stock. La consommation n’est calculée qu’à la clôture, par différence
            entre stock d’ouverture, achats et stock de clôture.
          </Alert>
        </div>
      )}
    </Modal>
  );
}
