import React from 'react';
import { Lock, Unlock, CheckCircle2, AlertTriangle, FileText, ShieldAlert } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, ConfirmDialog, DataTable,
  EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, currentMonth, formatPeriod, formatDate, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function ClosingPage() {
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const closings = useApi(() => api.get<any[]>('/closings'), []);
  const checks = useApi(() => api.get<any>(`/closings/${period}/checks`), [period]);
  const detail = useApi(
    () => api.get<any>(`/closings/${period}`).catch(() => null),
    [period],
  );
  const preview = useApi(() => api.get<any>(`/analytics/month/${period}`), [period]);

  const existing = detail.data;
  const isClosed = existing?.status === 'cloture';

  const close = async () => {
    setBusy(true);
    try {
      await api.post(`/closings/${period}/close`, {});
      success('Période clôturée', `${formatPeriod(period)} est désormais figée.`);
      setConfirmClose(false);
      checks.reload(); detail.reload(); closings.reload();
    } catch (e: any) {
      toastError('Clôture impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/closings/${period}/reopen`, { reason });
      success('Période réouverte', 'Opération journalisée.');
      setReopenOpen(false);
      checks.reload(); detail.reload(); closings.reload();
    } catch (e: any) {
      toastError('Réouverture impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  const c = checks.data;
  const m = preview.data;

  return (
    <div>
      <PageHeader
        icon={Lock}
        title="Clôture mensuelle"
        description="Vérification des opérations en attente, figeage des stocks, calcul des indicateurs et conservation du détail."
        actions={
          isClosed ? (
            <Button variant="secondary" onClick={() => setReopenOpen(true)}>
              <Unlock className="h-4 w-4" /> Réouvrir la période
            </Button>
          ) : (
            <Button onClick={() => setConfirmClose(true)} disabled={!c?.canClose}>
              <Lock className="h-4 w-4" /> Clôturer {formatPeriod(period)}
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-4">
          <Field label="Période" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <div className="flex items-center gap-2 pb-1">
            {isClosed ? (
              <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Clôturée le {formatDate(existing.closed_at)}</Badge>
            ) : existing?.status === 'reouvert' ? (
              <Badge tone="danger">Réouverte — {existing.reopen_reason}</Badge>
            ) : (
              <Badge tone="warning">Non clôturée</Badge>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ---------- Contrôles préalables ---------- */}
      {checks.loading ? <Loading /> : c && (
        <>
          <Card className="mb-4">
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Contrôles préalables</CardTitle>
              <Badge tone={c.canClose ? 'success' : 'danger'}>
                {c.canClose ? 'Prêt pour la clôture' : `${c.blocking.length} point(s) bloquant(s)`}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              {c.blocking.length === 0 && c.warnings.length === 0 && (
                <Alert tone="success" title="Aucun point bloquant">
                  Toutes les opérations sont validées. Vous pouvez clôturer la période.
                </Alert>
              )}

              {c.blocking.map((b: any) => (
                <div key={b.code} className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="flex items-start gap-2 text-sm font-semibold text-red-900">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {b.message}
                  </p>
                  {b.items?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-6 text-xs text-red-800">
                      {b.items.slice(0, 5).map((i: any) => (
                        <li key={i.id}>
                          {i.number || i.id}{i.qty !== undefined ? ` — ${i.qty}` : ''}
                          {i.cost !== undefined ? ` (${formatMoney(i.cost)})` : ''}
                        </li>
                      ))}
                      {b.items.length > 5 && <li>… et {b.items.length - 5} autre(s)</li>}
                    </ul>
                  )}
                </div>
              ))}

              {c.warnings.map((w: any) => (
                <div key={w.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* ---------- Aperçu des indicateurs ---------- */}
          {m && (
            <Card className="mb-4">
              <CardHeader><CardTitle>Aperçu des indicateurs de clôture</CardTitle></CardHeader>
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Mini label="CA HT" value={formatMoney(m.revenueHt)} />
                  <Mini label="Achats réceptionnés" value={formatMoney(m.purchasesReceived)} />
                  <Mini label="Stock d’ouverture" value={formatMoney(m.openingStock)} />
                  <Mini label="Stock de clôture" value={formatMoney(m.closingStock)} />
                  <Mini label="Consommation valorisée" value={formatMoney(m.consumption)} />
                  <Mini label="Avaries non incluses" value={formatMoney(m.lossesNotIncluded)} />
                  <Mini label="Coût matière retenu" value={formatMoney(m.retainedCost)} strong />
                  <Mini
                    label="Ratio matière"
                    value={formatPct(m.ratioPct)}
                    tone={m.targetReached === false ? 'danger' : 'success'}
                    strong
                  />
                </dl>
                <p className="mt-4 rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-500">
                  Ces chiffres seront figés au moment de la clôture et conservés avec le détail complet
                  des opérations dans un instantané inaltérable.
                </p>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* ---------- Historique des clôtures ---------- */}
      <Card>
        <CardHeader><CardTitle>Historique des clôtures</CardTitle></CardHeader>
        {closings.loading ? <Loading /> : (
          <DataTable
            columns={[
              { key: 'period', header: 'Période', render: (r: any) => <span className="font-medium">{formatPeriod(r.period)}</span> },
              { key: 'status', header: 'Statut', render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge> },
              { key: 'revenue_ht', header: 'CA HT', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.revenue_ht)}</span> },
              { key: 'retained_cost', header: 'Coût retenu', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.retained_cost)}</span> },
              {
                key: 'ratio_pct',
                header: 'Ratio',
                align: 'right' as const,
                render: (r: any) => <Badge tone={r.ratio_pct > r.objective_pct ? 'danger' : 'success'}>{formatPct(r.ratio_pct)}</Badge>,
              },
              { key: 'closed_at', header: 'Clôturée le', render: (r: any) => <span className="text-xs">{formatDate(r.closed_at, true)}</span> },
              { key: 'log_count', header: 'Journal', align: 'right' as const, render: (r: any) => <span className="text-xs">{r.log_count}</span> },
              {
                key: 'actions',
                header: '',
                align: 'right' as const,
                render: (r: any) => (
                  <Button variant="ghost" size="sm" onClick={() => setPeriod(r.period)}>Voir</Button>
                ),
              },
            ]}
            rows={closings.data || []}
            empty={<EmptyState icon={Lock} title="Aucune clôture" description="Clôturez un mois pour figer vos indicateurs et générer les rapports." />}
          />
        )}
      </Card>

      {/* ---------- Journal d'une clôture ---------- */}
      {existing && existing.logs?.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Journal de la période {formatPeriod(period)}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2">
              {existing.logs.map((l: any) => (
                <li key={l.id} className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                  <Badge tone={l.action === 'cloture' ? 'success' : 'danger'}>
                    {l.action === 'cloture' ? 'Clôture' : 'Réouverture'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">{formatDate(l.performed_at, true)}</p>
                    <p className="mt-0.5 text-sm text-slate-700">{l.reason || '—'}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={close}
        loading={busy}
        title={`Clôturer ${formatPeriod(period)} ?`}
        message="Les stocks seront figés et les indicateurs calculés. Toute modification ultérieure exigera une réouverture motivée et journalisée."
        confirmLabel="Clôturer la période"
      />

      {reopenOpen && (
        <ReopenModal
          period={period}
          onClose={() => setReopenOpen(false)}
          onSubmit={reopen}
          busy={busy}
        />
      )}
    </div>
  );
}

function ReopenModal({
  period, onClose, onSubmit, busy,
}: { period: string; onClose: () => void; onSubmit: (reason: string) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = React.useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Réouvrir ${formatPeriod(period)}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => onSubmit(reason)}>
            Réouvrir la période
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="danger" title="Opération sensible journalisée">
          La réouverture est enregistrée dans le journal d’audit avec votre motif et l’empreinte des
          indicateurs clôturés. Elle ne modifie pas silencieusement la période.
        </Alert>
        <Field label="Motif de réouverture" required hint="5 caractères minimum">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Correction d’une avarie omise, erreur de saisie de ventes…" />
        </Field>
      </div>
    </Modal>
  );
}

function Mini({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('tabular mt-0.5',
        strong ? 'text-sm font-semibold' : 'text-sm',
        tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-700' : 'text-slate-900')}>
        {value}
      </dd>
    </div>
  );
}
