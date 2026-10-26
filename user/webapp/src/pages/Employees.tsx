import React from 'react';
import { Users, Plus, Pencil, Archive, CalendarDays } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import { formatMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar,
  Input, Loading, Modal, PageHeader, Select, Tabs, Textarea,
} from '@/components/ui';
import { cn, formatDate, currentMonth, STATUS_LABELS, statusTone } from '@/lib/utils';

export default function EmployeesPage() {
  const { success, error: toastError } = useToast();
  const [tab, setTab] = React.useState<'employees' | 'attendance'>('employees');
  const [search, setSearch] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any>(null);
  const [detail, setDetail] = React.useState<any>(null);

  const { data, loading, error, reload } = useApi(
    () => api.get<any[]>(`/employees${qs({ search })}`),
    [search],
  );
  const rows = data || [];

  const archive = async (e: any) => {
    if (!window.confirm(`Archiver l’employé « ${e.first_name} ${e.last_name} » ?`)) return;
    try {
      await api.del(`/employees/${e.id}`);
      success('Employé archivé', 'Historique conservé.');
      reload();
    } catch (err: any) {
      toastError('Archivage impossible', err.message);
    }
  };

  const columns = [
    { key: 'code', header: 'Matricule', width: '100px', render: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
    {
      key: 'last_name',
      header: 'Employé',
      render: (r: any) => (
        <div>
          <p className="font-medium text-slate-800">{r.first_name} {r.last_name}</p>
          <p className="text-xs text-slate-500">{r.function || 'Fonction non renseignée'}</p>
        </div>
      ),
    },
    { key: 'hire_date', header: 'Embauche', render: (r: any) => <span className="text-xs">{r.hire_date ? formatDate(r.hire_date) : '—'}</span> },
    { key: 'contract_type', header: 'Contrat', render: (r: any) => <span className="text-xs">{r.contract_type || '—'}</span> },
    { key: 'base_salary', header: 'Salaire de base', align: 'right' as const, render: (r: any) => <span className="tabular">{formatMoney(r.base_salary)}</span> },
    { key: 'phone', header: 'Téléphone', render: (r: any) => <span className="text-xs">{r.phone || '—'}</span> },
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
        icon={Users}
        title="Personnel"
        description="Fiches employés, présences, heures supplémentaires, congés. Les taux de paie sont paramétrables."
        actions={tab === 'employees' ? <Button onClick={() => { setEditing(null); setModalOpen(true); }}><Plus className="h-4 w-4" /> Nouvel employé</Button> : undefined}
      />

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            tabs={[
              { key: 'employees', label: 'Employés' },
              { key: 'attendance', label: 'Feuille de présence' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as any)}
          />
        </div>

        {tab === 'employees' ? (
          <>
            <FilterBar>
              <Field label="Rechercher" className="w-72">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, matricule, fonction…" />
              </Field>
              <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} employé(s)</span>
            </FilterBar>

            {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
              <DataTable
                columns={columns}
                rows={rows}
                onRowClick={(r) => setDetail(r)}
                empty={<EmptyState icon={Users} title="Aucun employé" description="Créez les fiches de votre équipe pour suivre présences et paie." action={<Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Créer</Button>} />}
              />
            )}
          </>
        ) : (
          <AttendanceView employees={rows} />
        )}
      </Card>

      <EmployeeModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); reload(); }}
      />
      <EmployeeDetail employee={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Formulaire employé
 * ------------------------------------------------------------------------- */
function EmployeeModal({ open, editing, onClose, onSaved }: { open: boolean; editing: any; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [values, setValues] = React.useState<any>({});

  React.useEffect(() => {
    if (!open) return;
    setValues(editing ? {
      code: editing.code, firstName: editing.first_name, lastName: editing.last_name,
      function: editing.function || '', hireDate: editing.hire_date || '', endDate: editing.end_date || '',
      baseSalary: String(editing.base_salary ?? 0), contractType: editing.contract_type || 'CDI',
      phone: editing.phone || '', cin: editing.cin || '', cnssNumber: editing.cnss_number || '',
      notes: editing.notes || '',
    } : {
      code: '', firstName: '', lastName: '', function: '', hireDate: '', endDate: '',
      baseSalary: '0', contractType: 'CDI', phone: '', cin: '', cnssNumber: '', notes: '',
    });
  }, [open, editing]);

  const set = (k: string, v: any) => setValues((s: any) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!values.firstName?.trim() || !values.lastName?.trim()) {
      toastError('Champs requis', 'Prénom et nom sont obligatoires.');
      return;
    }
    setBusy(true);
    try {
      const payload = { ...values, baseSalary: Number(values.baseSalary) || 0, code: values.code || undefined };
      if (editing) await api.put(`/employees/${editing.id}`, payload);
      else await api.post('/employees', payload);
      success(editing ? 'Employé mis à jour' : 'Employé créé', `${values.firstName} ${values.lastName}`);
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
      title={editing ? 'Modifier l’employé' : 'Nouvel employé'}
      size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={busy}>Enregistrer</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Matricule" hint="Généré si vide">
            <Input value={values.code || ''} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono uppercase" disabled={Boolean(editing)} />
          </Field>
          <Field label="Prénom" required>
            <Input value={values.firstName || ''} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Nom" required>
            <Input value={values.lastName || ''} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fonction"><Input value={values.function || ''} onChange={(e) => set('function', e.target.value)} placeholder="Cuisinier, plongeur…" /></Field>
          <Field label="Type de contrat">
            <Select value={values.contractType || 'CDI'} onChange={(e) => set('contractType', e.target.value)}>
              <option value="CDI">CDI</option>
              <option value="CDD">CDD</option>
              <option value="SIVP">SIVP</option>
              <option value="Saisonnier">Saisonnier</option>
              <option value="Extra">Extra</option>
            </Select>
          </Field>
          <Field label="Salaire de base (DT)"><Input type="number" step="0.001" min="0" value={values.baseSalary || ''} onChange={(e) => set('baseSalary', e.target.value)} /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date d’embauche"><Input type="date" value={values.hireDate || ''} onChange={(e) => set('hireDate', e.target.value)} /></Field>
          <Field label="Date de sortie"><Input type="date" value={values.endDate || ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
          <Field label="Téléphone"><Input value={values.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CIN"><Input value={values.cin || ''} onChange={(e) => set('cin', e.target.value)} /></Field>
          <Field label="N° CNSS"><Input value={values.cnssNumber || ''} onChange={(e) => set('cnssNumber', e.target.value)} /></Field>
        </div>

        <Field label="Notes"><Textarea value={values.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>

        <Alert tone="info" title="Taux de cotisation non figés">
          Les taux CNSS et IRPP sont des <strong>paramètres modifiables</strong> (écran Paie / Paramètres).
          Aucune valeur légale n’est codée en dur : validez-les avec votre comptable.
        </Alert>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 *  Feuille de présence
 * ------------------------------------------------------------------------- */
function AttendanceView({ employees }: { employees: any[] }) {
  const { success, error: toastError } = useToast();
  const [period, setPeriod] = React.useState(currentMonth());
  const { data, loading, reload } = useApi(() => api.get<any[]>(`/attendance?period=${period}`), [period]);

  const [employeeId, setEmployeeId] = React.useState('');
  const [attDate, setAttDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = React.useState('present');
  const [hoursNormal, setHoursNormal] = React.useState('8');
  const [hoursOvertime, setHoursOvertime] = React.useState('0');
  const [lateMinutes, setLateMinutes] = React.useState('0');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!employeeId) { toastError('Employé requis', 'Sélectionnez un employé.'); return; }
    setBusy(true);
    try {
      await api.post('/attendance', {
        employeeId: Number(employeeId), attDate, status,
        hoursNormal: Number(hoursNormal) || 0,
        hoursOvertime: Number(hoursOvertime) || 0,
        lateMinutes: Number(lateMinutes) || 0,
      });
      success('Présence enregistrée', `${attDate}`);
      reload();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = data || [];

  return (
    <div>
      <div className="grid gap-4 border-b border-slate-100 p-4 lg:grid-cols-6">
        <Field label="Employé" required className="lg:col-span-2">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </Select>
        </Field>
        <Field label="Date" required>
          <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} />
        </Field>
        <Field label="Statut">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="present">Présent</option>
            <option value="absent">Absent</option>
            <option value="retard">Retard</option>
            <option value="conge">Congé</option>
            <option value="maladie">Maladie</option>
            <option value="ferie">Férié</option>
          </Select>
        </Field>
        <Field label="Heures normales">
          <Input type="number" step="0.5" min="0" value={hoursNormal} onChange={(e) => setHoursNormal(e.target.value)} />
        </Field>
        <Field label="Heures sup.">
          <Input type="number" step="0.5" min="0" value={hoursOvertime} onChange={(e) => setHoursOvertime(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <Field label="Mois affiché" className="w-52">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Button onClick={submit} loading={busy}><CalendarDays className="h-4 w-4" /> Enregistrer la présence</Button>
      </div>

      {loading ? <Loading /> : (
        <div className="max-h-[26rem] overflow-y-auto border-t border-slate-100">
          <table className="table-base">
            <thead><tr><th>Date</th><th>Employé</th><th>Statut</th><th className="text-right">H. normales</th><th className="text-right">H. sup.</th><th className="text-right">Retard</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="text-xs">{formatDate(r.att_date)}</td>
                  <td className="text-sm">{r.first_name} {r.last_name}</td>
                  <td><Badge tone={r.status === 'absent' ? 'danger' : r.status === 'retard' ? 'warning' : r.status === 'present' ? 'success' : 'info'}>
                    {STATUS_LABELS[r.status] || r.status}
                  </Badge></td>
                  <td className="tabular text-right text-xs">{r.hours_normal}</td>
                  <td className="tabular text-right text-xs">{r.hours_overtime}</td>
                  <td className="tabular text-right text-xs">{r.late_minutes} min</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-500">Aucune présence enregistrée pour ce mois.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Fiche employé
 * --------------------------------------------------------------------------- */
function EmployeeDetail({ employee, onClose }: { employee: any; onClose: () => void }) {
  const { data, loading } = useApi(
    () => (employee ? api.get(`/employees/${employee.id}`) : Promise.resolve(null)),
    [employee?.id],
  );
  if (!employee) return null;

  return (
    <Modal open onClose={onClose} title={`${employee.first_name} ${employee.last_name}`} description={`${employee.code} · ${employee.function || '—'}`} size="lg">
      {loading || !data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Salaire de base" value={formatMoney(data.base_salary)} />
            <Mini label="Contrat" value={data.contract_type || '—'} />
            <Mini label="Embauche" value={data.hire_date ? formatDate(data.hire_date) : '—'} />
            <Mini label="CIN" value={data.cin || '—'} />
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Dernières présences</h4>
            {data.attendance.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">Aucune présence enregistrée.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead><tr><th>Date</th><th>Statut</th><th className="text-right">H. normales</th><th className="text-right">H. sup.</th></tr></thead>
                  <tbody>
                    {data.attendance.map((a: any) => (
                      <tr key={a.id}>
                        <td className="text-xs">{formatDate(a.att_date)}</td>
                        <td><Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status] || a.status}</Badge></td>
                        <td className="tabular text-right text-xs">{a.hours_normal}</td>
                        <td className="tabular text-right text-xs">{a.hours_overtime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bulletins de paie</h4>
            {data.payroll.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">Aucun bulletin.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead><tr><th>Période</th><th className="text-right">Brut</th><th className="text-right">Net</th><th>Statut</th></tr></thead>
                  <tbody>
                    {data.payroll.map((p: any) => (
                      <tr key={p.id}>
                        <td className="text-xs">{p.period}</td>
                        <td className="tabular text-right text-xs">{formatMoney(p.gross)}</td>
                        <td className="tabular text-right text-xs font-semibold">{formatMoney(p.net)}</td>
                        <td><Badge tone={statusTone(p.status)}>{STATUS_LABELS[p.status] || p.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
