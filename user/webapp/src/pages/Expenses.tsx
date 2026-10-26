import React from 'react';
import { CreditCard, Plus, Trash2, Info } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney, estimatedOperatingResult } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, formatDate, monthBounds, currentMonth } from '@/lib/utils';

export default function ExpensesPage() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [category, setCategory] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<any>(null);
  const { start, end } = monthBounds(period);

  const { data, loading, error, reload } = useApi(
    () => api.get<any>(`/expenses${qs({ from: start, to: end, category })}`),
    [period, category],
  );

  const rows = data?.rows || [];
  const total = data?.total?.total || 0;
  const byCategory = data?.byCategory || [];

  const monthMetrics = useApi(() => api.get<any>(`/analytics/month/${period}`), [period]);
  const m = monthMetrics.data;

  const del = async () => {
    if (!toDelete) return;
    try {
      await api.del(`/expenses/${toDelete.id}`);
      success('Dépense annulée', 'Historique conservé.');
      setToDelete(null);
      reload();
      monthMetrics.reload();
    } catch (e: any) {
      toastError('Annulation impossible', e.message);
    }
  };

  const columns = [
    { key: 'number', header: 'N°', width: '120px', render: (r: any) => <span className="font-mono text-xs">{r.number}</span> },
    { key: 'expense_date', header: 'Date', render: (r: any) => <span className="text-xs">{formatDate(r.expense_date)}</span> },
    {
      key: 'category',
      header: 'Catégorie',
      render: (r: any) => (
        <span className="text-sm font-medium">
          {refs.expenseCategories.find((c) => c.code === r.category)?.label || labelize(r.category)}
        </span>
      ),
    },
    { key: 'beneficiary', header: 'Bénéficiaire', render: (r: any) => <span className="text-xs">{r.beneficiary || '—'}</span> },
    { key: 'payment_method', header: 'Paiement', render: (r: any) => <span className="text-xs capitalize">{r.payment_method}</span> },
    { key: 'reference', header: 'Réf.', render: (r: any) => <span className="font-mono text-[10px] text-slate-500">{r.reference || '—'}</span> },
    { key: 'amount', header: 'Montant', align: 'right' as const, render: (r: any) => <span className="tabular font-semibold">{formatMoney(r.amount)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '60px',
      render: (r: any) => (
        <Button variant="ghost" size="icon" title="Annuler la dépense" onClick={(e) => { e.stopPropagation(); setToDelete(r); }}>
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={CreditCard}
        title="Dépenses hors matières"
        description="Loyer, énergie, transport, entretien… Affichées séparément du coût matière."
        actions={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Nouvelle dépense</Button>}
      />

      <Alert tone="warning" className="mb-4" title="Marge ≠ bénéfice net">
        Le coût matière et les autres charges sont présentés séparément. Le « résultat de gestion » est
        une estimation : il exclut les obligations fiscales et sociales définitives.
      </Alert>

      {m && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Tile label="CA HT du mois" value={formatMoney(m.revenueHt)} />
          <Tile label="Coût matière retenu" value={formatMoney(m.retainedCost)} />
          <Tile label="Autres charges" value={formatMoney(m.otherExpenses)} tone="warning" />
          <Tile
            label="Résultat de gestion estimatif"
            value={formatMoney(m.estimatedResult)}
            tone={m.estimatedResult >= 0 ? 'success' : 'danger'}
            hint="Hors impôts et charges sociales définitives"
          />
        </div>
      )}

      <Card>
        <FilterBar>
          <Field label="Mois" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Field label="Catégorie" className="w-56">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Toutes</option>
              {refs.expenseCategories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
          </Field>
          <div className="ml-auto pb-1 text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Total période</p>
            <p className="tabular text-base font-semibold text-slate-900">{formatMoney(total)}</p>
          </div>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            empty={<EmptyState icon={CreditCard} title="Aucune dépense" description="Enregistrez vos charges fixes (loyer, eau, gaz…) et variables." action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Nouvelle dépense</Button>} />}
          />
        )}
      </Card>

      {byCategory.length > 0 && (
        <Card className="mt-4">
          <div className="border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Répartition par catégorie</h3>
          </div>
          <div className="space-y-2 p-4">
            {byCategory.map((c: any) => {
              const pct = total > 0 ? (c.total / total) * 100 : 0;
              return (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700">{refs.expenseCategories.find((x) => x.code === c.category)?.label || labelize(c.category)}</span>
                    <span className="tabular font-medium">{formatMoney(c.total)} · {pct.toFixed(1)} %</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ExpenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        methods={refs.paymentMethods}
        categories={refs.expenseCategories}
        onSaved={() => { setModalOpen(false); reload(); monthMetrics.reload(); }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={del}
        title="Annuler cette dépense ?"
        message="La dépense sera marquée annulée et un mouvement de caisse inverse sera créé. L’historique est conservé."
        confirmLabel="Annuler la dépense"
      />
    </div>
  );
}

function Tile({ label, value, tone = 'neutral', hint }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' | 'danger'; hint?: string }) {
  const tones = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-600', danger: 'text-red-600' };
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function ExpenseModal({
  open, onClose, methods, categories, onSaved,
}: { open: boolean; onClose: () => void; methods: any[]; categories: any[]; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [category, setCategory] = React.useState('loyer');
  const [amount, setAmount] = React.useState('');
  const [expenseDate, setExpenseDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = React.useState('espece');
  const [beneficiary, setBeneficiary] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) { setAmount(''); setBeneficiary(''); setReference(''); setNotes(''); setCategory('loyer'); }
  }, [open]);

  const submit = async () => {
    if (!(Number(amount) > 0)) { toastError('Montant invalide', 'Saisissez un montant supérieur à zéro.'); return; }
    setBusy(true);
    try {
      await api.post('/expenses', {
        category, amount: Number(amount), expenseDate, paymentMethod,
        beneficiary: beneficiary || null, reference: reference || null, notes: notes || null,
      });
      success('Dépense enregistrée', formatMoney(amount));
      onSaved();
    } catch (e: any) { toastError('Enregistrement impossible', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Nouvelle dépense" size="md"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={busy}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Catégorie" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Montant (DT)" required>
            <Input type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Mode de paiement" hint="« Crédit » = non payé immédiatement">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {methods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bénéficiaire"><Input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} /></Field>
          <Field label="Référence (facture, quittance)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>

        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>

        {paymentMethod !== 'credit' && (
          <div className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-xs text-sky-800 ring-1 ring-inset ring-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Un décaissement de caisse sera automatiquement enregistré pour ce montant.
          </div>
        )}
      </div>
    </Modal>
  );
}

function labelize(code: string) {
  return String(code || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
