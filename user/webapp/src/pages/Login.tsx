import React from 'react';
import { ChefHat, Lock, User, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/app-context';
import { Button, Field, Input, Alert } from '@/components/ui';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = React.useState('chef');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <ChefHat className="h-7 w-7" />
          </span>
          <h1 className="text-xl font-semibold text-white">Chef Cuisine Manager</h1>
          <p className="mt-1 text-sm text-slate-400">Gestion intégrée de restaurant — dinar tunisien</p>
        </div>

        <form onSubmit={submit} className="rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Connexion</h2>
          <p className="mb-5 text-xs text-slate-500">Administrateur unique : le chef cuisinier.</p>

          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}

          <Field label="Identifiant" required className="mb-4">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-9"
                autoComplete="username"
                required
              />
            </div>
          </Field>

          <Field label="Mot de passe" required className="mb-5">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-10"
                autoComplete="current-password"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={show ? 'Masquer' : 'Afficher'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Se connecter
          </Button>

          <p className="mt-4 rounded-md bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
            Première utilisation : identifiant <span className="font-semibold">chef</span>, mot de passe{' '}
            <span className="font-semibold">chef1234</span>. Changez-le immédiatement dans Paramètres.
          </p>
        </form>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Fonctionne hors ligne · Données stockées localement sur cet ordinateur
        </p>
      </div>
    </div>
  );
}
