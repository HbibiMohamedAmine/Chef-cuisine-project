/**
 * Coquille applicative : navigation latérale, en-tête, routes.
 */
import React from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, Warehouse, Truck, ShoppingCart, ChefHat, Factory,
  ArrowLeftRight, Trash2, Receipt, Wallet, CreditCard, Users, Utensils,
  BarChart3, FileBarChart, Lock, Settings, ShieldCheck, Database, LogOut, Menu, X, Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, useToast } from '@/lib/app-context';
import { Alert, Button } from '@/components/ui';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import ProductsPage from '@/pages/Products';
import StockPage from '@/pages/Stock';
import SuppliersPage from '@/pages/Suppliers';
import PurchasesPage from '@/pages/Purchases';
import RecipesPage from '@/pages/Recipes';
import ProductionPage from '@/pages/Production';
import TransformationsPage from '@/pages/Transformations';
import TransfersPage from '@/pages/Transfers';
import LossesPage from '@/pages/Losses';
import SalesPage from '@/pages/Sales';
import CashPage from '@/pages/Cash';
import ExpensesPage from '@/pages/Expenses';
import EmployeesPage from '@/pages/Employees';
import PayrollPage from '@/pages/Payroll';
import StaffPage from '@/pages/Staff';
import AnalysesPage from '@/pages/Analyses';
import ReportsPage from '@/pages/Reports';
import ClosingPage from '@/pages/Closing';
import SettingsPage from '@/pages/Settings';
import AccountingNotesPage from '@/pages/AccountingNotes';
import BackupPage from '@/pages/Backup';
import AuditPage from '@/pages/Audit';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, group: 'Pilotage' },
  { to: '/analyses', label: 'Analyses & simulateur', icon: Calculator, group: 'Pilotage' },
  { to: '/rapports', label: 'Rapports', icon: FileBarChart, group: 'Pilotage' },
  { to: '/cloture', label: 'Clôture mensuelle', icon: Lock, group: 'Pilotage' },

  { to: '/produits', label: 'Produits', icon: Package, group: 'Stocks' },
  { to: '/stock', label: 'Stock & inventaires', icon: Warehouse, group: 'Stocks' },
  { to: '/recettes', label: 'Recettes', icon: ChefHat, group: 'Stocks' },

  { to: '/fournisseurs', label: 'Fournisseurs', icon: Truck, group: 'Achats' },
  { to: '/achats', label: 'Achats & réceptions', icon: ShoppingCart, group: 'Achats' },

  { to: '/production', label: 'Production', icon: Factory, group: 'Opérations' },
  { to: '/transformations', label: 'Transformations', icon: Package, group: 'Opérations' },
  { to: '/transferts', label: 'Transferts', icon: ArrowLeftRight, group: 'Opérations' },
  { to: '/avaries', label: 'Avaries & pertes', icon: Trash2, group: 'Opérations' },

  { to: '/ventes', label: 'Ventes', icon: Receipt, group: 'Commercial' },
  { to: '/caisse', label: 'Caisse', icon: Wallet, group: 'Commercial' },
  { to: '/depenses', label: 'Dépenses', icon: CreditCard, group: 'Commercial' },

  { to: '/personnel', label: 'Employés', icon: Users, group: 'Personnel' },
  { to: '/paie', label: 'Paie', icon: FileBarChart, group: 'Personnel' },
  { to: '/cuisine-personnel', label: 'Cuisine du personnel', icon: Utensils, group: 'Personnel' },

  { to: '/parametres', label: 'Paramètres', icon: Settings, group: 'Administration' },
  { to: '/parametres-comptables', label: 'Points à valider', icon: ShieldCheck, group: 'Administration' },
  { to: '/sauvegardes', label: 'Sauvegardes & intégrité', icon: Database, group: 'Administration' },
  { to: '/journal', label: 'Journal d’audit', icon: ShieldCheck, group: 'Administration' },
];

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = React.useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of NAV) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return [...map.entries()];
  }, []);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
            <ChefHat className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Chef Cuisine</p>
            <p className="text-[11px] text-slate-400">Manager · DT</p>
          </div>
          <button className="ml-auto rounded p-1 text-slate-400 hover:text-white lg:hidden" onClick={onClose} aria-label="Fermer le menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map(([group, items]) => (
            <div key={group} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onClose}
                      className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          <p className="text-[10px] leading-relaxed text-slate-500">
            Logiciel de gestion interne. Non certifié comptablement — à valider avec votre comptable.
          </p>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { username, logout } = useAuth();
  const { success } = useToast();
  const location = useLocation();
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Ouvrir le menu">
        <Menu className="h-5 w-5" />
      </button>
      <p className="truncate text-sm font-medium text-slate-700">{current?.label || 'Chef Cuisine Manager'}</p>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Hors ligne
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline">{username}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={async () => {
            await logout();
            success('Déconnexion', 'À bientôt.');
          }}
          title="Se déconnecter"
          aria-label="Se déconnecter"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

export default function App() {
  const { authenticated, loading, defaultPassword } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [bannerClosed, setBannerClosed] = React.useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Ouverture de la base locale…
        </div>
      </div>
    );
  }

  if (!authenticated) return <LoginPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-64">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
          {defaultPassword && !bannerClosed && (
            <Alert
              tone="warning"
              title="Mot de passe par défaut encore actif"
              className="mb-5"
              onClose={() => setBannerClosed(true)}
            >
              Vous utilisez le mot de passe initial. Rendez-vous dans{' '}
              <NavLink to="/parametres" className="font-semibold underline">Paramètres</NavLink>{' '}
              pour le remplacer.
            </Alert>
          )}

          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/produits" element={<ProductsPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/recettes" element={<RecipesPage />} />
            <Route path="/fournisseurs" element={<SuppliersPage />} />
            <Route path="/achats" element={<PurchasesPage />} />
            <Route path="/production" element={<ProductionPage />} />
            <Route path="/transformations" element={<TransformationsPage />} />
            <Route path="/transferts" element={<TransfersPage />} />
            <Route path="/avaries" element={<LossesPage />} />
            <Route path="/ventes" element={<SalesPage />} />
            <Route path="/caisse" element={<CashPage />} />
            <Route path="/depenses" element={<ExpensesPage />} />
            <Route path="/personnel" element={<EmployeesPage />} />
            <Route path="/paie" element={<PayrollPage />} />
            <Route path="/cuisine-personnel" element={<StaffPage />} />
            <Route path="/analyses" element={<AnalysesPage />} />
            <Route path="/rapports" element={<ReportsPage />} />
            <Route path="/cloture" element={<ClosingPage />} />
            <Route path="/parametres" element={<SettingsPage />} />
            <Route path="/parametres-comptables" element={<AccountingNotesPage />} />
            <Route path="/sauvegardes" element={<BackupPage />} />
            <Route path="/journal" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
