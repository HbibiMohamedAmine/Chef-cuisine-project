import React from 'react';
import { ShieldCheck, Search, Filter } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import {
  Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, FilterBar, Input,
  Loading, PageHeader, Select,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  validate: 'Validation',
  cancel: 'Annulation',
  delete: 'Archivage',
  login: 'Connexion',
  logout: 'Déconnexion',
  settings: 'Paramètres',
  close: 'Clôture',
  reopen: 'Réouverture',
  backup: 'Sauvegarde',
  restore: 'Restauration',
};

const ENTITY_LABELS: Record<string, string> = {
  product: 'Produit',
  product_category: 'Catégorie',
  supplier: 'Fournisseur',
  purchase: 'Achat',
  purchase_return: 'Retour fournisseur',
  stock_count: 'Inventaire',
  stock_adjustment: 'Ajustement stock',
  recipe: 'Recette',
  production: 'Production',
  transformation: 'Transformation',
  transfer: 'Transfert',
  loss: 'Avarie',
  sale: 'Vente',
  expense: 'Dépense',
  cash_movement: 'Mouvement caisse',
  cash_closing: 'Clôture caisse',
  employee: 'Employé',
  attendance: 'Présence',
  payroll: 'Bulletin de paie',
  staff_meal: 'Repas personnel',
  staff_purchase: 'Achat personnel',
  monthly_closing: 'Clôture mensuelle',
  settings: 'Paramètres',
  auth: 'Authentification',
  backup: 'Sauvegarde',
  loss_type: 'Motif d’avarie',
};

export default function AuditPage() {
  const [entity, setEntity] = React.useState('');
  const [action, setAction] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(0);
  const limit = 50;

  const { data, loading, error, reload } = useApi(
    () => api.get<any>(`/audit${qs({ entity, action, from, to, limit, offset: page * limit })}`),
    [entity, action, from, to, page],
  );

  const rows = data?.rows || [];
  const total = data?.total || 0;

  const columns = [
    { key: 'occurred_at', header: 'Horodatage', width: '160px', render: (r: any) => <span className="whitespace-nowrap text-xs">{formatDate(r.occurred_at, true)}</span> },
    {
      key: 'action',
      header: 'Action',
      render: (r: any) => (
        <Badge tone={r.action === 'delete' || r.action === 'cancel' || r.action === 'reopen' ? 'danger'
          : r.action === 'validate' || r.action === 'close' ? 'success'
            : r.action === 'settings' || r.action === 'restore' ? 'warning' : 'neutral'}>
          {ACTION_LABELS[r.action] || r.action}
        </Badge>
      ),
    },
    { key: 'entity', header: 'Domaine', render: (r: any) => <span className="text-sm">{ENTITY_LABELS[r.entity] || r.entity}</span> },
    { key: 'entity_id', header: 'Réf.', width: '70px', render: (r: any) => <span className="font-mono text-[10px] text-slate-500">{r.entity_id || '—'}</span> },
    { key: 'summary', header: 'Détail', render: (r: any) => <span className="text-xs text-slate-600">{r.summary || '—'}</span> },
    { key: 'actor', header: 'Auteur', width: '80px', render: (r: any) => <span className="text-xs">{r.actor}</span> },
    {
      key: 'severity',
      header: 'Gravité',
      width: '90px',
      render: (r: any) => (
        <Badge tone={r.severity === 'critical' ? 'danger' : r.severity === 'warning' ? 'warning' : 'neutral'}>
          {r.severity}
        </Badge>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <PageHeader
        icon={ShieldCheck}
        title="Journal d’audit"
        description="Trace immuable des opérations sensibles : validations, annulations, clôtures, réouvertures, paramètres et connexions."
      />

      <Card>
        <FilterBar>
          <Field label="Domaine" className="w-48">
            <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }}>
              <option value="">Tous</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Action" className="w-44">
            <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
              <option value="">Toutes</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Du" className="w-40">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          </Field>
          <Field label="Au" className="w-40">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </Field>
          <Button variant="outline" size="sm" className="mb-0.5" onClick={reload}>Actualiser</Button>
          <span className="ml-auto pb-2 text-xs text-slate-500">{total} entrée(s)</span>
        </FilterBar>

        {loading ? <Loading /> : error ? <div className="p-4"><ErrorState message={error} onRetry={reload} /></div> : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              pageSize={limit}
              empty={<EmptyState icon={ShieldCheck} title="Aucune entrée" description="Le journal se remplit automatiquement dès la première opération sensible." />}
            />
            {total > limit && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                <span>Page {page + 1} sur {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-600">
        Le journal d’audit est en <strong>ajout seul</strong> : aucune entrée ne peut être modifiée ni
        supprimée depuis l’application. Il constitue la preuve des opérations sensibles (validations,
        annulations par contre-écriture, clôtures et réouvertures motivées).
      </p>
    </div>
  );
}
