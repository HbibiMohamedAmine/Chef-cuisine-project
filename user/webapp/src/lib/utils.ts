/**
 * Utilitaires d'affichage et d'état local de l'interface.
 * ⚠️ AUCUNE formule métier ici : les calculs viennent de @shared/formulas.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date du jour au format YYYY-MM-DD (fuseau local). */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mois courant YYYY-MM. */
export function currentMonth(): string {
  return today().slice(0, 7);
}

/** Bornes d'un mois YYYY-MM. */
export function monthBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/** Formate une date SQLite en français lisible. */
export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '—';
  const iso = String(value).replace(' ', 'T');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!withTime) return date;
  return `${date} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Formate une période YYYY-MM en « octobre 2026 ». */
export function formatPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return period || '—';
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Libellés lisibles des types de produits. */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  matiere_premiere: 'Matière première',
  semi_fini: 'Semi-fini',
  fini: 'Plat / produit fini',
  ingredient_repas: 'Ingrédient repas personnel',
  consommable: 'Consommable',
  perdu: 'Produit perdu / périmé',
};

/** Libellés lisibles des types de mouvements de stock. */
export const MOVEMENT_LABELS: Record<string, string> = {
  initial: 'Stock initial',
  reception: 'Réception d’achat',
  retour_fournisseur: 'Retour fournisseur',
  production_entree: 'Entrée production',
  production_sortie: 'Sortie production (ingrédients)',
  transformation_sortie: 'Sortie transformation',
  transformation_entree: 'Entrée transformation',
  transfert_sortie: 'Transfert — sortie',
  transfert_entree: 'Transfert — entrée',
  avarie: 'Avarie',
  vente_sortie: 'Sortie vente',
  ajustement_inventaire: 'Ajustement d’inventaire',
  ajustement_manuel: 'Ajustement manuel',
  contre_ecriture: 'Contre-écriture',
  consommation_repas: 'Consommation repas personnel',
};

/** Couleur sémantique d'un statut. */
export function statusTone(status?: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'valide':
    case 'receptionnee':
    case 'payee':
    case 'cloture':
    case 'cloturee':
      return 'success';
    case 'brouillon':
    case 'commandee':
    case 'partielle':
    case 'impayee':
      return 'warning';
    case 'annule':
    case 'annulee':
    case 'reouvert':
    case 'reouverte':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  annule: 'Annulé',
  commandee: 'Commandée',
  partielle: 'Partielle',
  receptionnee: 'Réceptionnée',
  annulee: 'Annulée',
  impayee: 'Impayée',
  payee: 'Payée',
  cloture: 'Clôturée',
  reouvert: 'Réouverte',
  cloturee: 'Clôturée',
  reouverte: 'Réouverte',
  presente: 'Présent',
  absent: 'Absent',
  retard: 'Retard',
  conge: 'Congé',
  ferie: 'Férié',
  maladie: 'Maladie',
  exporte: 'Exporté',
};

/** Taille de page par défaut des tableaux. */
export const PAGE_SIZE = 25;
