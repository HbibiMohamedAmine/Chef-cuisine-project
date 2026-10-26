/**
 * Bibliothèque de composants UI (style shadcn/ui, sans dépendance externe).
 * Accessibilité clavier, cohérence visuelle, écrans d'ordinateur.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { X, ChevronLeft, ChevronRight, Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

/* ---------------------------------------------------------------------------
 *  Button
 * ------------------------------------------------------------------------- */
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-sm hover:bg-primary/90 focus-visible:ring-primary/40',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:ring-slate-300',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-300',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-300',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-300',
};

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50',
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* ---------------------------------------------------------------------------
 *  Card
 * ------------------------------------------------------------------------- */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-slate-100 px-5 py-4', className)} {...props}>{children}</div>;
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-slate-900', className)} {...props}>{children}</h3>;
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props}>{children}</div>;
}

/* ---------------------------------------------------------------------------
 *  Champs de formulaire
 * ------------------------------------------------------------------------- */
export function Field({
  label, required, hint, error, children, className,
}: {
  label: string; required?: boolean; hint?: string; error?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className="label-base">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn('input-base tabular', invalid && 'border-red-400 focus:border-red-500 focus:ring-red-200', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn('input-base cursor-pointer pr-8', invalid && 'border-red-400', className)}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={3}
      className={cn('w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
        'placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/** Champ quantité avec unité accolée. */
export function QtyInput({
  value, onChange, unit, ...props
}: { value: string; onChange: (v: string) => void; unit?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="relative">
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="pr-14" {...props} />
      {unit && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
          {unit}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Badge / statut
 * ------------------------------------------------------------------------- */
export function Badge({
  tone = 'neutral', children, className,
}: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'; children: React.ReactNode; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-red-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    primary: 'bg-emerald-600 text-white ring-emerald-600',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 *  Alertes
 * ------------------------------------------------------------------------- */
export function Alert({
  tone = 'info', title, children, onClose, className,
}: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children?: React.ReactNode; onClose?: () => void; className?: string }) {
  const tones = {
    info: { wrap: 'bg-sky-50 border-sky-200 text-sky-900', Icon: Info, icon: 'text-sky-600' },
    success: { wrap: 'bg-emerald-50 border-emerald-200 text-emerald-900', Icon: CheckCircle2, icon: 'text-emerald-600' },
    warning: { wrap: 'bg-amber-50 border-amber-200 text-amber-900', Icon: AlertTriangle, icon: 'text-amber-600' },
    danger: { wrap: 'bg-red-50 border-red-200 text-red-900', Icon: AlertTriangle, icon: 'text-red-600' },
  }[tone];

  return (
    <div className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', tones.wrap, className)} role="alert">
      <tones.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tones.icon)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1', 'text-sm leading-relaxed')}>{children}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} className="shrink-0 rounded p-1 hover:bg-black/5" aria-label="Fermer">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Modal
 * ------------------------------------------------------------------------- */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn('animate-fade-in w-full rounded-xl bg-white shadow-2xl', widths[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Boîte de confirmation destructive. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', requireReason = false, loading,
}: {
  open: boolean; onClose: () => void; onConfirm: (reason?: string) => void; title: string;
  message: string; confirmLabel?: string; requireReason?: boolean; loading?: boolean;
}) {
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={loading} disabled={requireReason && !reason.trim()} onClick={() => onConfirm(reason)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
      {requireReason && (
        <Field label="Motif (obligatoire)" required className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Expliquez la raison de cette opération…" />
        </Field>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 *  En-tête de page
 * ------------------------------------------------------------------------- */
export function PageHeader({
  title, description, actions, icon: Icon,
}: { title: string; description?: string; actions?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------------------
 *  États vides / chargement
 * ------------------------------------------------------------------------- */
export function EmptyState({
  title, description, action, icon: Icon,
}: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="danger" title="Une erreur est survenue">
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </Alert>
  );
}

/* ---------------------------------------------------------------------------
 *  Carte statistique
 * ------------------------------------------------------------------------- */
export function StatCard({
  label, value, sub, tone = 'neutral', icon: Icon, hint,
}: {
  label: string; value: string | number; sub?: string; hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const tones = {
    neutral: 'text-slate-900',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    primary: 'text-primary',
  };
  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className={cn('h-4 w-4', tones[tone])} />}
      </div>
      <p className={cn('tabular mt-2 text-xl font-semibold tracking-tight', tones[tone])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Tableau triable + filtrable + paginé
 * ------------------------------------------------------------------------- */
export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  width?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns, rows, rowKey = 'id', empty, onRowClick, pageSize = 25, footer, initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey?: string;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  footer?: React.ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort || null);
  const [page, setPage] = React.useState(0);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const getVal = col.sortValue || ((r: T) => r[col.key]);
    return [...rows].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va === vb) return 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sort.dir === 'asc' ? va - vb : vb - va;
      }
      const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'fr', { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  React.useEffect(() => {
    setPage(0);
  }, [rows.length]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    'cursor-pointer select-none hover:text-slate-700',
                  )}
                  onClick={() => toggleSort(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sort?.key === c.key && (
                      <span className="text-[10px] text-primary">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={row[rowKey] ?? i}
                onClick={() => onRowClick?.(row)}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      c.align === 'right' && 'tabular text-right',
                      c.align === 'center' && 'text-center',
                      c.className,
                    )}
                  >
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {sorted.length > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} sur {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Page précédente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 tabular">{safePage + 1} / {totalPages}</span>
            <Button variant="ghost" size="icon" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} aria-label="Page suivante">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Barre de filtre
 * ------------------------------------------------------------------------- */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3', className)}>{children}</div>;
}

/* ---------------------------------------------------------------------------
 *  Onglets
 * ------------------------------------------------------------------------- */
export function Tabs({
  tabs, active, onChange,
}: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            '-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
            active === t.key
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  Barre de progression (ratio vs objectif)
 * ------------------------------------------------------------------------- */
export function RatioGauge({ ratio, objective }: { ratio: number; objective: number }) {
  const max = Math.max(50, objective * 1.6, ratio * 1.1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const over = ratio > objective;

  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full rounded-full transition-all', over ? 'bg-red-500' : 'bg-emerald-500')}
          style={{ width: pct(ratio) }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: pct(objective) }} title={`Objectif ${objective} %`} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
        <span className="tabular">0 %</span>
        <span className={cn('tabular font-semibold', over ? 'text-red-600' : 'text-emerald-700')}>
          {ratio.toFixed(2)} % {over ? '▲' : '▼'} objectif {objective} %
        </span>
        <span className="tabular">{Math.round(max)} %</span>
      </div>
    </div>
  );
}
