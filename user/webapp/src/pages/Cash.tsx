import React from 'react';
import { Wallet, Plus, Lock, Unlock, ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRefs, useToast } from '@/lib/app-context';
import { formatMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field,
  FilterBar, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, today, STATUS_LABELS, statusTone } from '@/lib/utils';

const TYPE_LABELS: Record<string, string> = {
  encaissement: 'Encaissement',
  decaissement: 'Décaissement',
  remboursement: 'Remboursement',
  ajustement: 'Ajustement',
};

export default function CashPage() {
  const refs = useRefs();
  const { success, error: toastError } = useToast();
  const [date, setDate] = React.useState(today());
  const [tab, setTab] = React.useState<'day' | 'manual'>('day');
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);

  const { data, loading, error, reload } = useApi(() => api.get(`/cash${qs({ date })}`), [date]);
  const day = data?.day;

  const movements = day?.movements || [];

  const columns = [
    { key: 'occurred_at', header: 'Heure', render: (r: any) => <span className="text-xs">{formatDate(r.occurred_at, true)}</span> },
    {
      key: 'type',
      header: 'Type',
      render: (r: any) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          {r.type === 'encaissement' || (r.type === 'ajustement' && r.amount >= 0) ? (
            <ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5 text-red-600" />
          )}
          {TYPE_LABELS[r.type] || r.type}
        </span>
      ),
    },
    { key: 'description', header: 'Libellé', render: (r: any) => <span className="text-sm">{r.description || r.category || '—'}</span> },
    { key: 'reference', header: 'Réf.', render: (r: any) => <span className="font-mono text-[10px] text-slate-500">{r.reference || '—'}</span> },
    { key: 'payment_method', header: 'Mode', render: (r: any) => <span className="text-xs capitalize">{r.payment_method}</span> },
    {
      key: 'amount',
      header: 'Montant',
      align: 'right' as const,
      render: (r: any) => (
        <span className={cn('tabular font-semibold', r.type === 'encaissement' ? 'text-emerald-700' : 'text-red-600')}>
          {r.type === 'encaissement' ? '+' : '−'}{formatMoney(r.amount)}
        </span>
      ),
    },
  ];

  const theoretical = day?.balance ?? 0;
  const counted = day?.closing?.counted_balance;
  const variance = day?.closing?.variance;

  const close = async ({ countedBalance, justification }: { countedBalance: number; justification?: string }) => {
    try {
      await api.post('/cash/close', { date, countedBalance, justification });
      success('Caisse clôturée', `Écart : ${formatMoney(0)}`);
      setCloseOpen(false);
      reload();
    } catch (e: any) {
      toastError('Clôture impossible', e.message);
    }
  };

  const reopen = async (reason?: string) => {
    try {
      await api.post('/cash/reopen', { date, reason });
      success('Caisse réouverte');
      setReopenOpen(false);
      reload();
    } catch (e: any) {
      toastError('Réouverture impossible', e.message);
    }
  };

  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Caisse"
        description="Encaissements, décaissements, remboursements et clôture journalière avec écart justifié."
        actions={
          <>
            <Button variant="outline" onClick={() => setManualOpen(true)}><Plus className="h-4 w-4" /> Mouvement manuel</Button>
            {day?.closing && day.closing.status === 'cloturee' ? (
              <Button variant="secondary" onClick={() => setReopenOpen(true)}><Unlock className="h-4 w-4" /> Réouvrir</Button>
            ) : (
              <Button onClick={() => setCloseOpen(true)}><Lock className="h-4 w-4" /> Clôturer la caisse</Button>
            )}
          </>
        }
      />

      <Card>
        <FilterBar>
          <Field label="Journée" className="w-52">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="ml-auto flex items-end gap-6 pb-1">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Entrées</p>
              <p className="tabular text-base font-semibold text-emerald-700">{formatMoney(day?.inflow || 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Sorties</p>
              <p className="tabular text-base font-semibold text-red-600">{formatMoney(day?.outflow || 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Solde théorique</p>
              <p className="tabular text-base font-semibold text-primary">{formatMoney(theoretical)}</p>
            </div>
          </div>
        </FilterBar>

        {day?.closing && (
          <div className="border-b border-slate-100 p-4">
            <Alert
              tone={day.closing.status === 'cloturee' ? 'success' : 'warning'}
              title={`Clôture ${STATUS_LABELS[day.closing.status] || day.closing.status}`}
            >
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <span>Théorique : <strong className="tabular">{formatMoney(day.closing.theoretical_balance)}</strong></span>
                <span>Compté : <strong className="tabular">{formatMoney(day.closing.counted_balance)}</strong></span>
                <span>Écart : <strong className={cn('tabular', Math.abs(day.closing.variance) > 0.001 ? 'text-red-700' : 'text-emerald-700')}>
                  {formatMoney(day.closing.variance)}
                </strong></span>
              </div>
              {day.closing.justification && <p className="mt-1.5 italic">Justification : {day.closing.justification}</p>}
            </Alert>
          </div>
        )}

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={movements}
            empty={<EmptyState icon={Wallet} title="Aucun mouvement" description="Les ventes et dépenses créent automatiquement les mouvements de caisse." />}
          />
        )}
      </Card>

      <CloseCashModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        theoretical={theoretical}
        onSubmit={close}
      />
      <ReopenCashModal open={reopenOpen} onClose={() => setReopenOpen(false)} onSubmit={reopen} />
      <ManualMovementModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        methods={refs.paymentMethods}
        onSaved={() => { setManualOpen(false); reload(); }}
      />
    </div>
  );
}

function CloseCashModal({
  open, onClose, theoretical, onSubmit,
}: { open: boolean; onClose: () => void; theoretical: number; onSubmit: (v: { countedBalance: number; justification?: string }) => Promise<void> }) {
  const [counted, setCounted] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) { setCounted(theoretical.toFixed(3)); setJustification(''); }
  }, [open, theoretical]);

  const variance = (Number(counted) || 0) - theoretical;
  const needsJustification = Math.abs(variance) > 0.001;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clôture de caisse"
      description="Comparez le solde théorique au comptage physique. Tout écart doit être justifié."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            loading={busy}
            disabled={needsJustification && !justification.trim()}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ countedBalance: Number(counted) || 0, justification }); } finally { setBusy(false); }
            }}
          >
            Clôturer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Solde théorique</span>
            <span className="tabular font-semibold">{formatMoney(theoretical)}</span>
          </div>
        </div>

        <Field label="Montant compté (DT)" required>
          <Input type="number" step="0.001" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>

        <div className={cn('flex items-center justify-between rounded-lg p-3 text-sm ring-1 ring-inset',
          Math.abs(variance) < 0.001 ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200')}>
          <span className="inline-flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" /> Écart</span>
          <span className="tabular font-semibold">{formatMoney(variance)}</span>
        </div>

        {needsJustification && (
          <Field label="Justification de l’écart" required>
            <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Erreur de rendu de monnaie, dépense non saisie…" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ReopenCashModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Modal
      open={open} onClose={onClose} title="Réouvrir la caisse" size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={async () => {
            setBusy(true); try { await onSubmit(reason); } finally { setBusy(false); }
          }}>Réouvrir</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert tone="warning" title="Opération journalisée">
          La réouverture est tracée dans le journal d’audit avec votre motif.
        </Alert>
        <Field label="Motif de réouverture" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dépense oubliée, correction d’un encaissement…" />
        </Field>
      </div>
    </Modal>
  );
}

function ManualMovementModal({
  open, onClose, methods, onSaved,
}: { open: boolean; onClose: () => void; methods: any[]; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [type, setType] = React.useState('encaissement');
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('espece');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (open) { setAmount(''); setDescription(''); } }, [open]);

  const submit = async () => {
    if (!(Number(amount) > 0)) { toastError('Montant invalide', 'Saisissez un montant supérieur à zéro.'); return; }
    setBusy(true);
    try {
      await api.post('/cash', { type, amount: Number(amount), paymentMethod: method, description, category: 'manuel' });
      success('Mouvement enregistré', `${formatMoney(amount)}`);
      onSaved();
    } catch (e: any) { toastError('Enregistrement impossible', e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Mouvement de caisse manuel" size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={busy}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="encaissement">Encaissement (entrée)</option>
            <option value="decaissement">Décaissement (sortie)</option>
            <option value="remboursement">Remboursement</option>
            <option value="ajustement">Ajustement</option>
          </Select>
        </Field>
        <Field label="Montant (DT)" required>
          <Input type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Mode de paiement">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Libellé">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
