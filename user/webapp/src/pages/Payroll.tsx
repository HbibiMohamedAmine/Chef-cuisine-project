import React from 'react';
import { Banknote, Calculator, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, downloadFile, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney, payrollCompute, formatPct } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { cn, currentMonth, formatPeriod, STATUS_LABELS, statusTone, formatDate } from '@/lib/utils';

export default function PayrollPage() {
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const [calcOpen, setCalcOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const { data, loading, error, reload } = useApi(() => api.get(`/payroll${qs({ period })}`), [period]);
  const { data: settingsData } = useApi(() => api.get('/settings'), []);

  const rows = data?.rows || [];
  const totals = data?.totals;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get<any>(`/payroll/export${qs({ period })}`);
      // Génération CSV côté client à partir des lignes normalisées
      const lines = res.lines || [];
      if (!lines.length) { toastError('Aucune donnée', 'Aucun bulletin sur cette période.'); return; }
      const headers = Object.keys(lines[0]);
      const escape = (v: any) => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[";\n]/.test(s) ? `"${s}"` : s;
      };
      const csv = [headers.join(';'), ...lines.map((l: any) => headers.map((h) => escape(l[h])).join(';'))].join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paie-${period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      success('Export généré', `${lines.length} bulletin(s)`);
    } catch (e: any) {
      toastError('Export impossible', e.message);
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { key: 'code', header: 'Matricule', width: '90px', render: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'last_name', header: 'Employé', render: (r: any) => <div><p className="font-medium text-slate-800">{r.first_name} {r.last_name}</p><p className="text-xs text-slate-500">{r.function || '—'}</p></div> },
    { key: 'base_salary', header: 'Base', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.base_salary)}</span> },
    { key: 'hours_overtime', header: 'H. sup.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{r.hours_overtime}</span> },
    { key: 'gross', header: 'Brut', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{formatMoney(r.gross)}</span> },
    { key: 'cnss_employee', header: 'CNSS sal.', align: 'right' as const, render: (r: any) => <span className="tabular text-xs text-red-600">−{formatMoney(r.cnss_employee)}</span> },
    { key: 'irpp', header: 'IRPP', align: 'right' as const, render: (r: any) => <span className="tabular text-xs text-red-600">−{formatMoney(r.irpp)}</span> },
    { key: 'net', header: 'Net à payer', align: 'right' as const, render: (r: any) => <span className="tabular font-semibold text-emerald-700">{formatMoney(r.net)}</span> },
    { key: 'status', header: 'Statut', render: (r: any) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] || r.status}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        icon={Banknote}
        title="Préparation de paie"
        description="Bulletins calculés à partir de taux paramétrables, présences et heures supplémentaires, puis exportés pour le comptable."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" /> Export comptable</Button>
            <Button onClick={() => setCalcOpen(true)}><Calculator className="h-4 w-4" /> Calculer un bulletin</Button>
          </>
        }
      />

      <Alert tone="warning" className="mb-4" title="Aucun taux légal n’est figé dans le logiciel">
        Les taux CNSS salarié/employeur, IRPP, heures légales et majorations proviennent de vos paramètres
        ({(settingsData?.settings?.payroll_cnss_employee_rate ?? '—')} % salarié,{' '}
        {(settingsData?.settings?.payroll_cnss_employer_rate ?? '—')} % employeur à titre indicatif).
        <strong> À valider avec votre comptable.</strong> Ce logiciel n’est pas un système de paie homologué.
      </Alert>

      {totals && (
        <div className="mb-4 grid gap-3 sm:grid-cols-5">
          <Tile label="Masse brute" value={formatMoney(totals.gross)} />
          <Tile label="CNSS salarié" value={formatMoney(totals.cnssEmployee)} tone="warning" />
          <Tile label="CNSS employeur" value={formatMoney(totals.cnssEmployer)} tone="warning" />
          <Tile label="Net à payer" value={formatMoney(totals.net)} tone="success" />
          <Tile label="Coût employeur" value={formatMoney(totals.employerCost)} />
        </div>
      )}

      <Card>
        <FilterBar>
          <Field label="Période" className="w-52">
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <span className="ml-auto pb-2 text-xs text-slate-500">{formatPeriod(period)} · {rows.length} bulletin(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <DataTable
            columns={columns}
            rows={rows}
            empty={<EmptyState icon={Banknote} title="Aucun bulletin" description="Calculez un bulletin à partir des présences du mois." action={<Button onClick={() => setCalcOpen(true)}><Calculator className="h-4 w-4" /> Calculer</Button>} />}
          />
        )}
      </Card>

      <CalcModal
        open={calcOpen}
        period={period}
        onClose={() => setCalcOpen(false)}
        onSaved={() => { setCalcOpen(false); reload(); }}
      />
    </div>
  );
}

function Tile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const tones = { neutral: 'text-slate-900', success: 'text-emerald-700', warning: 'text-amber-600' };
  return (
    <div className="card-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('tabular mt-1 text-base font-semibold', tones[tone])}>{value}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Calcul d'un bulletin
 * ------------------------------------------------------------------------- */
function CalcModal({ open, period, onClose, onSaved }: { open: boolean; period: string; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [employees, setEmployees] = React.useState<any[]>([]);
  const [employeeId, setEmployeeId] = React.useState('');
  const [overrides, setOverrides] = React.useState<any>({});
  const [computed, setComputed] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api.get<any[]>('/employees').then(setEmployees).catch(() => {});
    setEmployeeId(''); setOverrides({}); setComputed(null);
  }, [open]);

  const compute = async () => {
    if (!employeeId) { toastError('Employé requis', 'Sélectionnez un employé.'); return; }
    try {
      const res = await api.get<any>(`/payroll/compute${qs({
        employeeId, period,
        ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== '' && v !== undefined)),
      })}`);
      setComputed(res);
    } catch (e: any) {
      toastError('Calcul impossible', e.message);
    }
  };

  const save = async (validateNow: boolean) => {
    if (!employeeId) return;
    setBusy(true);
    try {
      await api.post('/payroll', {
        employeeId: Number(employeeId),
        period,
        ...overrides,
        status: validateNow ? 'valide' : 'brouillon',
      });
      success(validateNow ? 'Bulletin validé' : 'Bulletin enregistré', `${formatPeriod(period)}`);
      onSaved();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Calcul de paie — ${formatPeriod(period)}`}
      description="Les valeurs proposées viennent des présences du mois et des taux paramétrés."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="secondary" onClick={compute}>Aperçu du calcul</Button>
          <Button onClick={() => save(false)} loading={busy} disabled={!computed}>Enregistrer (brouillon)</Button>
          <Button variant="success" onClick={() => save(true)} loading={busy} disabled={!computed}>
            <CheckCircle2 className="h-4 w-4" /> Valider
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Employé" required>
          <Select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setComputed(null); }}>
            <option value="">— Sélectionner —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.code} — {e.first_name} {e.last_name}</option>)}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Heures normales" hint="Vide = présences du mois">
            <Input type="number" step="0.5" min="0" value={overrides.hoursNormal ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, hoursNormal: e.target.value }))} />
          </Field>
          <Field label="Heures supplémentaires">
            <Input type="number" step="0.5" min="0" value={overrides.hoursOvertime ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, hoursOvertime: e.target.value }))} />
          </Field>
          <Field label="Primes (DT)">
            <Input type="number" step="0.001" min="0" value={overrides.primes ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, primes: e.target.value }))} />
          </Field>
          <Field label="Avances à déduire (DT)">
            <Input type="number" step="0.001" min="0" value={overrides.advances ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, advances: e.target.value }))} />
          </Field>
          <Field label="Autres retenues (DT)">
            <Input type="number" step="0.001" min="0" value={overrides.retenues ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, retenues: e.target.value }))} />
          </Field>
          <Field label="Taux IRPP (%)" hint="Vide = paramètre global">
            <Input type="number" step="0.01" min="0" max="100" value={overrides.irppRate ?? ''} onChange={(e) => setOverrides((o: any) => ({ ...o, irppRate: e.target.value }))} />
          </Field>
        </div>

        {computed && (
          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Aperçu — {computed.employee.name}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
              <Line label="Salaire de base" value={formatMoney(computed.baseSalary)} />
              <Line label="Taux horaire" value={formatMoney(computed.hourlyRate)} />
              <Line label="Heures sup." value={`${computed.hoursOvertime} h`} />
              <Line label="Montant heures sup." value={formatMoney(computed.overtimeAmount)} />
              <Line label="Primes" value={formatMoney(computed.primes)} />
              <Line label="Brut" value={formatMoney(computed.gross)} strong />
              <Line label="CNSS salarié" value={`− ${formatMoney(computed.cnssEmployee)}`} danger />
              <Line label="IRPP" value={`− ${formatMoney(computed.irpp)}`} danger />
              <Line label="Avances / retenues" value={`− ${formatMoney(computed.advances + computed.retenues)}`} danger />
              <Line label="Net à payer" value={formatMoney(computed.net)} strong success />
              <Line label="CNSS employeur" value={formatMoney(computed.cnssEmployer)} />
              <Line label="Coût employeur" value={formatMoney(computed.totalEmployerCost)} strong />
            </dl>
          </div>
        )}

        <Alert tone="info" title="Rappel">
          Ces montants sont préparatoires. Vérifiez les taux, le barème IRPP et les conventions collectives
          avec votre comptable avant tout versement.
        </Alert>
      </div>
    </Modal>
  );
}

function Line({ label, value, strong, danger, success }: { label: string; value: string; strong?: boolean; danger?: boolean; success?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-sm',
        strong ? 'font-semibold' : 'font-medium',
        danger ? 'text-red-600' : success ? 'text-emerald-700' : 'text-slate-800')}>
        {value}
      </dd>
    </div>
  );
}
