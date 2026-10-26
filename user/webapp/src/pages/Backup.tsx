import React from 'react';
import {
  Database, HardDriveDownload, ShieldCheck, AlertTriangle, RotateCcw, CheckCircle2,
  XCircle, Clock, FileDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useToast } from '@/lib/app-context';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, ConfirmDialog, DataTable,
  EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader,
} from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

export default function BackupPage() {
  const { success, error: toastError } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [verifyFile, setVerifyFile] = React.useState<string | null>(null);
  const [restoreFile, setRestoreFile] = React.useState<string | null>(null);

  const { data, loading, error, reload } = useApi(() => api.get<any>('/backups'), []);

  const createBackup = async () => {
    setCreating(true);
    try {
      const res = await api.post<any>('/backups', { notes: 'Sauvegarde manuelle depuis l’interface' });
      success('Sauvegarde créée', `${res.fileName} — ${(res.size / 1024).toFixed(1)} Ko`);
      reload();
    } catch (e: any) {
      toastError('Sauvegarde impossible', e.message);
    } finally {
      setCreating(false);
    }
  };

  const backups = data?.backups || [];
  const integrity = data?.integrity;

  const columns = [
    {
      key: 'fileName',
      header: 'Fichier',
      render: (r: any) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-medium text-slate-800">{r.fileName}</p>
          <p className="text-[10px] text-slate-400">
            {r.sha256 ? `SHA-256 ${r.sha256.slice(0, 16)}…` : 'empreinte inconnue'}
          </p>
        </div>
      ),
    },
    { key: 'kind', header: 'Type', render: (r: any) => <Badge tone={r.kind === 'auto' ? 'info' : r.kind === 'pre_restauration' ? 'warning' : 'neutral'}>{r.kind}</Badge> },
    { key: 'createdAt', header: 'Créée le', render: (r: any) => <span className="text-xs">{formatDate(String(r.createdAt).replace('T', ' '), true)}</span> },
    { key: 'size', header: 'Taille', align: 'right' as const, render: (r: any) => <span className="tabular text-xs">{(r.size / 1024).toFixed(0)} Ko</span> },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '230px',
      render: (r: any) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setVerifyFile(r.fileName)}>
            <ShieldCheck className="h-3.5 w-3.5" /> Vérifier
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRestoreFile(r.fileName)}>
            <RotateCcw className="h-3.5 w-3.5" /> Restaurer
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        icon={Database}
        title="Sauvegardes & intégrité"
        description="Export fichier, vérification d’intégrité et restauration sécurisée avec sauvegarde préalable automatique."
        actions={
          <Button onClick={createBackup} loading={creating}>
            <HardDriveDownload className="h-4 w-4" /> Créer une sauvegarde
          </Button>
        }
      />

      {/* ---------- État d'intégrité ---------- */}
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : integrity && (
        <>
          <Card className="mb-4">
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Vérification d’intégrité de la base</CardTitle>
              <Badge tone={integrity.ok ? 'success' : 'danger'}>
                {integrity.ok ? <><CheckCircle2 className="mr-1 h-3 w-3" /> Saine</> : <><XCircle className="mr-1 h-3 w-3" /> Anomalies</>}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Contrôle SQLite" value={integrity.integrity === 'ok' ? 'OK' : integrity.integrity} />
                <Mini label="Taille de la base" value={`${(integrity.databaseSize / 1024 / 1024).toFixed(2)} Mo`} />
                <Mini label="Tables" value={String(Object.keys(integrity.tableCounts || {}).length)} />
                <Mini label="Dernière vérif." value={formatDate(integrity.checkedAt, true)} />
              </div>

              {integrity.problems.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-red-900">
                    <XCircle className="h-4 w-4" /> Problèmes détectés
                  </p>
                  <ul className="mt-1 space-y-0.5 pl-5 text-xs text-red-800">
                    {integrity.problems.map((p: string, i: number) => <li key={i} className="list-disc">{p}</li>)}
                  </ul>
                </div>
              )}

              {integrity.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4" /> Points d’attention
                  </p>
                  <ul className="mt-1 space-y-0.5 pl-5 text-xs text-amber-800">
                    {integrity.warnings.map((w: string, i: number) => <li key={i} className="list-disc">{w}</li>)}
                  </ul>
                </div>
              )}

              {integrity.ok && integrity.warnings.length === 0 && (
                <Alert tone="success" title="Base cohérente">
                  L’intégrité structurelle est vérifiée, les clés étrangères sont respectées, aucun stock
                  négatif et aucun mouvement orphelin ne sont détectés.
                </Alert>
              )}

              {integrity.lastBackup && (
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Dernière sauvegarde : {formatDate(integrity.lastBackup.created_at, true)}
                  {integrity.lastBackup.kind === 'auto' ? ' (automatique)' : ''}
                </p>
              )}
            </CardBody>
          </Card>

          {/* ---------- Liste des sauvegardes ---------- */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Sauvegardes disponibles ({backups.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={reload}>Rafraîchir</Button>
            </CardHeader>
            <DataTable
              columns={columns}
              rows={backups}
              rowKey="fileName"
              empty={
                <EmptyState
                  icon={Database}
                  title="Aucune sauvegarde"
                  description="Créez une sauvegarde régulière et conservez-la sur un support externe (clé USB, disque réseau)."
                  action={<Button onClick={createBackup} loading={creating}><HardDriveDownload className="h-4 w-4" /> Créer</Button>}
                />
              }
            />
          </Card>

          <Alert tone="warning" className="mt-4" title="Conservez une copie hors de l’ordinateur">
            Les sauvegardes sont enregistrées dans le dossier local <code className="rounded bg-white/60 px-1">backups/</code> de
            l’application. En cas de panne matérielle, elles seraient perdues avec le disque : copiez-les
            régulièrement sur un support externe.
          </Alert>
        </>
      )}

      {verifyFile && <VerifyModal fileName={verifyFile} onClose={() => setVerifyFile(null)} />}
      {restoreFile && (
        <RestoreModal
          fileName={restoreFile}
          onClose={() => setRestoreFile(null)}
          onDone={() => { setRestoreFile(null); reload(); }}
        />
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function VerifyModal({ fileName, onClose }: { fileName: string; onClose: () => void }) {
  const { data, loading } = useApi(() => api.get<any>(`/backups/${encodeURIComponent(fileName)}/verify`), [fileName]);

  return (
    <Modal open onClose={onClose} title="Vérification de la sauvegarde" description={fileName} size="md" footer={<Button variant="outline" onClick={onClose}>Fermer</Button>}>
      {loading ? <Loading label="Lecture et contrôle du fichier…" /> : data && (
        <div className="space-y-4">
          <Alert tone={data.ok ? 'success' : 'danger'} title={data.ok ? 'Sauvegarde valide' : 'Sauvegarde non conforme'}>
            {data.ok
              ? 'Empreinte conforme, intégrité SQLite vérifiée, clés étrangères respectées. La restauration est possible.'
              : data.problems.join(' ')}
          </Alert>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-[10px] uppercase text-slate-500">Intégrité SQLite</dt><dd className="font-medium">{data.integrity || '—'}</dd></div>
            <div><dt className="text-[10px] uppercase text-slate-500">SHA-256</dt><dd className="truncate font-mono text-xs">{data.sha256?.slice(0, 24)}…</dd></div>
          </dl>

          {data.counts && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Contenu</p>
              <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-3">
                {Object.entries(data.counts).map(([t, c]) => (
                  <div key={t} className="flex justify-between gap-2 text-[11px]">
                    <span className="truncate text-slate-500">{t}</span>
                    <span className="tabular font-medium text-slate-800">{String(c)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function RestoreModal({ fileName, onClose, onDone }: { fileName: string; onClose: () => void; onDone: () => void }) {
  const { success, error: toastError } = useToast();
  const [confirmText, setConfirmText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      const res = await api.post<any>('/backups/restore', { fileName, confirmText });
      success('Base restaurée', `Sauvegarde de sécurité créée : ${res.safetyBackup}`);
      onDone();
    } catch (e: any) {
      toastError('Restauration impossible', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Restaurer une sauvegarde"
      description={fileName}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="danger" onClick={restore} loading={busy} disabled={confirmText !== 'RESTAURER'}>
            Restaurer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="danger" title="Opération destructive">
          La base actuelle sera remplacée par la sauvegarde choisie. Une sauvegarde de sécurité
          (<strong>pre_restauration</strong>) est automatiquement créée avant l’opération.
        </Alert>
        <p className="text-sm text-slate-600">
          Toutes les données saisies après la date de cette sauvegarde seront perdues. Fermez les autres
          fenêtres de l’application avant de continuer.
        </p>
        <Field label="Saisissez RESTAURER pour confirmer" required>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTAURER" />
        </Field>
      </div>
    </Modal>
  );
}
