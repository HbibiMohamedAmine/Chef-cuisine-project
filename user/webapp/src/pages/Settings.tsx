import React from 'react';
import { Settings as SettingsIcon, Save, KeyRound, Tags, Plus, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth, useToast } from '@/lib/app-context';
import { formatMoney } from '@shared/formulas';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState,
  Field, Input, Loading, Modal, PageHeader, Select, Tabs,
} from '@/components/ui';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const [tab, setTab] = React.useState<'general' | 'objectives' | 'referentials' | 'security'>('general');

  return (
    <div>
      <PageHeader
        icon={SettingsIcon}
        title="Paramètres"
        description="Objectif matière, seuils d’alerte, valorisation, TVA, unités, sauvegardes et sécurité."
      />

      <Tabs
        tabs={[
          { key: 'general', label: 'Général & entreprise' },
          { key: 'objectives', label: 'Objectif & alertes' },
          { key: 'referentials', label: 'Référentiels' },
          { key: 'security', label: 'Sécurité' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as any)}
      />

      <div className="mt-5">
        {tab === 'general' && <GeneralTab />}
        {tab === 'objectives' && <ObjectivesTab />}
        {tab === 'referentials' && <ReferentialsTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  ONGLET GÉNÉRAL
 * ========================================================================= */
function GeneralTab() {
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi(() => api.get<any>('/settings'), []);
  const [values, setValues] = React.useState<any>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (data?.settings) {
      setValues({
        restaurant_name: data.settings.restaurant_name || '',
        restaurant_address: data.settings.restaurant_address || '',
        restaurant_tax_id: data.settings.restaurant_tax_id || '',
        vat_default_rate: String(data.settings.vat_default_rate ?? 19),
        valuation_method: data.settings.valuation_method || 'cmp',
        auto_backup_enabled: Boolean(data.settings.auto_backup_enabled),
        auto_backup_hour: String(data.settings.auto_backup_hour ?? 22),
        auto_backup_retention_days: String(data.settings.auto_backup_retention_days ?? 30),
      });
    }
  }, [data]);

  const set = (k: string, v: any) => setValues((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', {
        ...values,
        auto_backup_hour: Number(values.auto_backup_hour),
        auto_backup_retention_days: Number(values.auto_backup_retention_days),
        vat_default_rate: Number(values.vat_default_rate),
      });
      success('Paramètres enregistrés');
      reload();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Identité de l’établissement</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom du restaurant">
              <Input value={values.restaurant_name || ''} onChange={(e) => set('restaurant_name', e.target.value)} />
            </Field>
            <Field label="Matricule fiscal">
              <Input value={values.restaurant_tax_id || ''} onChange={(e) => set('restaurant_tax_id', e.target.value)} />
            </Field>
          </div>
          <Field label="Adresse">
            <Input value={values.restaurant_address || ''} onChange={(e) => set('restaurant_address', e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Comptabilité & valorisation</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <Alert tone="warning" title="Choix à valider avec votre comptable">
            La méthode de valorisation et le taux de TVA par défaut influencent tous vos calculs de coût
            et de marge. Vérifiez-les avec votre comptable avant de figer vos premiers mois.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Méthode de valorisation des stocks"
              hint="Coût moyen pondéré par défaut ; FIFO en option"
            >
              <Select value={values.valuation_method || 'cmp'} onChange={(e) => set('valuation_method', e.target.value)}>
                <option value="cmp">Coût moyen pondéré (CMP)</option>
                <option value="fifo">FIFO (premier entré, premier sorti)</option>
              </Select>
            </Field>
            <Field label="Taux de TVA par défaut (%)">
              <Select value={values.vat_default_rate || '19'} onChange={(e) => set('vat_default_rate', e.target.value)}>
                <option value="0">0 %</option>
                <option value="7">7 %</option>
                <option value="13">13 %</option>
                <option value="19">19 %</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sauvegardes automatiques</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={Boolean(values.auto_backup_enabled)}
              onChange={(e) => set('auto_backup_enabled', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary"
            />
            <span>
              <span className="text-sm font-medium text-slate-800">Activer la sauvegarde automatique quotidienne</span>
              <span className="block text-xs text-slate-500">
                La sauvegarde est déclenchée à la première ouverture de l’application après l’heure choisie.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Heure de sauvegarde (0-23)">
              <Input type="number" min="0" max="23" value={values.auto_backup_hour || ''} onChange={(e) => set('auto_backup_hour', e.target.value)} />
            </Field>
            <Field label="Conservation (jours)">
              <Input type="number" min="1" value={values.auto_backup_retention_days || ''} onChange={(e) => set('auto_backup_retention_days', e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={busy}><Save className="h-4 w-4" /> Enregistrer les paramètres</Button>
      </div>
    </div>
  );
}

/* ===========================================================================
 *  ONGLET OBJECTIF & ALERTES
 * =========================================================================== */
function ObjectivesTab() {
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi(() => api.get<any>('/settings'), []);
  const [values, setValues] = React.useState<any>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (data?.settings) {
      setValues({
        objective_ratio: String(data.settings.objective_ratio ?? 30),
        objective_min: String(data.settings.objective_min ?? 15),
        objective_max: String(data.settings.objective_max ?? 45),
        alert_overrun_enabled: Boolean(data.settings.alert_overrun_enabled),
        alert_stock_enabled: Boolean(data.settings.alert_stock_enabled),
        alert_expiry_days: String(data.settings.alert_expiry_days ?? 5),
        alert_abnormal_loss_pct: String(data.settings.alert_abnormal_loss_pct ?? 15),
        alert_inventory_gap_pct: String(data.settings.alert_inventory_gap_pct ?? 2),
        alert_gap_value_dt: String(data.settings.alert_gap_value_dt ?? 5),
        staff_meals_in_ratio: Boolean(data.settings.staff_meals_in_ratio),
        loss_default_in_consumption: Boolean(data.settings.loss_default_in_consumption),
      });
    }
  }, [data]);

  const set = (k: string, v: any) => setValues((s: any) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', {
        ...values,
        objective_ratio: Number(values.objective_ratio),
        objective_min: Number(values.objective_min),
        objective_max: Number(values.objective_max),
        alert_expiry_days: Number(values.alert_expiry_days),
        alert_abnormal_loss_pct: Number(values.alert_abnormal_loss_pct),
        alert_inventory_gap_pct: Number(values.alert_inventory_gap_pct),
        alert_gap_value_dt: Number(values.alert_gap_value_dt),
      });
      success('Paramètres enregistrés');
      reload();
    } catch (e: any) {
      toastError('Enregistrement impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const objective = Number(values.objective_ratio) || 30;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Objectif de ratio matière</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-emerald-800">Objectif actuel</span>
              <span className="tabular text-3xl font-semibold text-emerald-900">{objective} %</span>
            </div>
            <input
              type="range"
              min={Number(values.objective_min) || 15}
              max={Number(values.objective_max) || 45}
              step={0.5}
              value={objective}
              onChange={(e) => set('objective_ratio', e.target.value)}
              className="mt-3 w-full accent-emerald-700"
            />
            <div className="mt-1 flex justify-between text-[10px] text-emerald-700">
              <span>{values.objective_min} %</span>
              <span>30 % (défaut)</span>
              <span>{values.objective_max} %</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Borne basse (%)" hint="Limite de réglage du simulateur">
              <Input type="number" min="1" max="100" value={values.objective_min || ''} onChange={(e) => set('objective_min', e.target.value)} />
            </Field>
            <Field label="Borne haute (%)">
              <Input type="number" min="1" max="100" value={values.objective_max || ''} onChange={(e) => set('objective_max', e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Seuils d’alerte</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="space-y-2.5">
            <Toggle
              label="Alerte de dépassement de l’objectif"
              hint="Signale un ratio matière supérieur à l’objectif"
              checked={Boolean(values.alert_overrun_enabled)}
              onChange={(v) => set('alert_overrun_enabled', v)}
            />
            <Toggle
              label="Alerte de stock insuffisant"
              hint="Ruptures et produits sous le seuil minimal"
              checked={Boolean(values.alert_stock_enabled)}
              onChange={(v) => set('alert_stock_enabled', v)}
            />
          </div>

          <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <Field label="Alerte péremption (jours avant DLC)">
              <Input type="number" min="0" max="365" value={values.alert_expiry_days || ''} onChange={(e) => set('alert_expiry_days', e.target.value)} />
            </Field>
            <Field label="Seuil de perte anormale (%)" hint="Au-delà, la transformation est signalée">
              <Input type="number" min="0" max="100" value={values.alert_abnormal_loss_pct || ''} onChange={(e) => set('alert_abnormal_loss_pct', e.target.value)} />
            </Field>
            <Field label="Seuil écart inventaire (%)">
              <Input type="number" min="0" max="100" value={values.alert_inventory_gap_pct || ''} onChange={(e) => set('alert_inventory_gap_pct', e.target.value)} />
            </Field>
            <Field label="Seuil écart inventaire (DT)">
              <Input type="number" min="0" step="0.001" value={values.alert_gap_value_dt || ''} onChange={(e) => set('alert_gap_value_dt', e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Règles comptables paramétrables</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <Alert tone="warning" title="À valider avec votre comptable">
            Ces deux règles changent le calcul du ratio matière. Elles ne sont pas des vérités comptables
            universelles : elles doivent être confirmées par votre comptable.
          </Alert>

          <Toggle
            label="Intégrer les repas du personnel au ratio matière"
            hint={
              values.staff_meals_in_ratio
                ? 'Les repas du personnel restent imputés au coût matière global.'
                : 'Les repas du personnel sont retirés du coût matière (recommandé par défaut) : ils ne sont pas des ventes.'
            }
            checked={Boolean(values.staff_meals_in_ratio)}
            onChange={(v) => set('staff_meals_in_ratio', v)}
          />

          <Toggle
            label="Valeur par défaut : « avarie déjà incluse dans le coût consommé »"
            hint="Pré-cochage du formulaire d’avarie. Évite le double comptage des pertes."
            checked={Boolean(values.loss_default_in_consumption)}
            onChange={(v) => set('loss_default_in_consumption', v)}
          />
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={busy}><Save className="h-4 w-4" /> Enregistrer</Button>
      </div>
    </div>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/* ===========================================================================
 *  ONGLET RÉFÉRENTIELS
 * =========================================================================== */
function ReferentialsTab() {
  const { success, error: toastError } = useToast();
  const { data, loading, error, reload } = useApi(() => api.get<any>('/referentials'), []);
  const [newCategory, setNewCategory] = React.useState('');
  const [newLossType, setNewLossType] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    setBusy(true);
    try {
      await api.post('/categories', { name: newCategory });
      success('Catégorie ajoutée', newCategory);
      setNewCategory('');
      reload();
    } catch (e: any) {
      toastError('Ajout impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  const addLossType = async () => {
    if (!newLossType.trim()) return;
    setBusy(true);
    try {
      await api.post('/loss-types', { label: newLossType });
      success('Motif ajouté', newLossType);
      setNewLossType('');
      reload();
    } catch (e: any) {
      toastError('Ajout impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Cuisines</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-2 text-xs text-slate-500">
            Trois cuisines structurent les stocks : chacune a ses mouvements et ses rapports.
          </p>
          <ul className="space-y-1.5">
            {data.kitchens.map((k: any) => (
              <li key={k.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-800">{k.name}</span>
                <Badge tone={k.kind === 'centrale' ? 'primary' : k.kind === 'personnel' ? 'warning' : 'info'}>
                  {k.kind}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Unités de mesure</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-1.5">
            {data.units.map((u: any) => (
              <div key={u.code} className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5">
                <span className="text-sm text-slate-700">{u.label}</span>
                <span className="font-mono text-xs text-slate-400">{u.code}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Les conversions (kg ↔ g, L ↔ ml) sont automatiques dans les recettes.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Catégories de produits</CardTitle></CardHeader>
        <CardBody>
          <div className="mb-3 flex gap-2">
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nouvelle catégorie…" />
            <Button onClick={addCategory} loading={busy} disabled={!newCategory.trim()}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.categories.map((c: any) => (
              <Badge key={c.id} tone="neutral">{c.name}</Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Types d’avarie</CardTitle></CardHeader>
        <CardBody>
          <div className="mb-3 flex gap-2">
            <Input value={newLossType} onChange={(e) => setNewLossType(e.target.value)} placeholder="Nouveau motif…" />
            <Button onClick={addLossType} loading={busy} disabled={!newLossType.trim()}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.lossTypes.map((t: any) => (
              <Badge key={t.code} tone="neutral">{t.label}</Badge>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ===========================================================================
 *  ONGLET SÉCURITÉ
 * ========================================================================= */
function SecurityTab() {
  const { success, error: toastError } = useToast();
  const { refresh } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [oldPassword, setOldPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (newPassword !== confirm) { toastError('Mots de passe différents', 'La confirmation ne correspond pas.'); return; }
    if (newPassword.length < 8) { toastError('Mot de passe trop court', '8 caractères minimum, avec lettres et chiffres.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/password', { oldPassword, newPassword });
      success('Mot de passe modifié', 'Vous allez être déconnecté.');
      setOpen(false);
      setOldPassword(''); setNewPassword(''); setConfirm('');
      await refresh();
    } catch (e: any) {
      toastError('Modification impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Mot de passe administrateur</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">
            Un seul utilisateur : le chef cuisinier. Le mot de passe est stocké sous forme de
            <strong> hash scrypt</strong> — il n’est jamais conservé en clair, ni journalisé.
          </p>
          <Button onClick={() => setOpen(true)}><KeyRound className="h-4 w-4" /> Changer le mot de passe</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bonnes pratiques</CardTitle></CardHeader>
        <CardBody>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              Utilisez un mot de passe de 8 caractères minimum mêlant lettres et chiffres.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              Verrouillez la session en fermant l’application lorsque vous quittez le poste.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              Effectuez une sauvegarde régulière (écran Sauvegardes) et conservez-la sur un support externe.</li>
            <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              Le journal d’audit conserve l’historique des opérations sensibles : ne le purgez pas.</li>
          </ul>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Changer le mot de passe"
        size="sm"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={submit} loading={busy}>Modifier</Button></>}
      >
        <div className="space-y-4">
          <Field label="Mot de passe actuel" required>
            <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="Nouveau mot de passe" required hint="8 caractères minimum">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Field label="Confirmer le nouveau mot de passe" required>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Alert tone="warning">Toutes les sessions actives seront fermées après la modification.</Alert>
        </div>
      </Modal>
    </div>
  );
}
