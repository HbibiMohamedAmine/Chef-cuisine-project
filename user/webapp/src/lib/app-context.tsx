/**
 * Contexte d'authentification + contexte de notifications.
 * L'état de session est vérifié au démarrage auprès du serveur (cookie HttpOnly).
 */
import React from 'react';
import { api, setUnauthorizedHandler } from '@/lib/api';
import { Alert } from '@/components/ui';

/* ---------------------------------------------------------------------------
 *  Authentification
 * ------------------------------------------------------------------------- */
interface AuthState {
  authenticated: boolean;
  username: string | null;
  defaultPassword: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState({
    authenticated: false,
    username: null as string | null,
    defaultPassword: false,
    loading: true,
  });

  const refresh = React.useCallback(async () => {
    try {
      const res = await api.get<{ authenticated: boolean; username?: string; defaultPassword?: boolean }>(
        '/auth/session',
      );
      setState({
        authenticated: Boolean(res.authenticated),
        username: res.username || null,
        defaultPassword: Boolean(res.defaultPassword),
        loading: false,
      });
    } catch {
      setState({ authenticated: false, username: null, defaultPassword: false, loading: false });
    }
  }, []);

  React.useEffect(() => {
    refresh();
    // Une 401 en cours d'utilisation renvoie vers l'écran de connexion
    setUnauthorizedHandler(() => {
      setState((s) => ({ ...s, authenticated: false, username: null }));
    });
  }, [refresh]);

  const login = React.useCallback(async (username: string, password: string) => {
    const res = await api.post<{ username: string; defaultPassword: boolean }>('/auth/login', {
      username,
      password,
    });
    setState({
      authenticated: true,
      username: res.username,
      defaultPassword: Boolean(res.defaultPassword),
      loading: false,
    });
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setState({ authenticated: false, username: null, defaultPassword: false, loading: false });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}

/* ---------------------------------------------------------------------------
 *  Notifications (toasts)
 * ------------------------------------------------------------------------- */
type Toast = { id: number; tone: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string };

interface ToastState {
  notify: (tone: Toast['tone'], title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

const ToastContext = React.createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const remove = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const notify = React.useCallback((tone: Toast['tone'], title: string, message?: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, tone, title, message }]);
    setTimeout(() => remove(id), tone === 'error' ? 8000 : 4500);
  }, []);

  const value = React.useMemo<ToastState>(
    () => ({
      notify,
      success: (title, message) => notify('success', title, message),
      error: (title, message) => notify('error', title, message),
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto animate-fade-in">
            <Alert
              tone={t.tone === 'error' ? 'danger' : t.tone}
              title={t.title}
              onClose={() => remove(t.id)}
            >
              {t.message && <p className="text-xs">{t.message}</p>}
            </Alert>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans ToastProvider');
  return ctx;
}

/* ---------------------------------------------------------------------------
 *  Référentiels (cuisines, unités, catégories…) chargés une fois
 * ------------------------------------------------------------------------- */
export interface Referentials {
  kitchens: Array<{ id: number; code: string; name: string; kind: string }>;
  units: Array<{ code: string; label: string; family: string }>;
  categories: Array<{ id: number; name: string }>;
  lossTypes: Array<{ code: string; label: string }>;
  productTypes: Array<{ value: string; label: string }>;
  expenseCategories: Array<{ code: string; label: string }>;
  paymentMethods: Array<{ code: string; label: string }>;
  vatRates: number[];
}

const RefContext = React.createContext<Referentials | null>(null);

export function ReferentialsProvider({ children }: { children: React.ReactNode }) {
  const [refs, setRefs] = React.useState<Referentials | null>(null);
  const { authenticated, loading } = useAuth();

  React.useEffect(() => {
    if (loading || !authenticated) {
      setRefs(null);
      return;
    }

    let cancelled = false;
    api
      .get<Referentials>('/referentials')
      .then((r) => {
        if (!cancelled) setRefs(r);
      })
      .catch(() => {
        /* l'écran de connexion gère déjà les erreurs */
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, loading]);

  if (!refs) return <>{children}</>;
  return <RefContext.Provider value={refs}>{children}</RefContext.Provider>;
}

export function useRefs(): Referentials {
  const ctx = React.useContext(RefContext);
  if (!ctx) {
    return {
      kitchens: [], units: [], categories: [], lossTypes: [],
      productTypes: [], expenseCategories: [], paymentMethods: [], vatRates: [],
    };
  }
  return ctx;
}
