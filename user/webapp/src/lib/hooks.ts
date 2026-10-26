/**
 * Hooks de récupération de données (chargement, erreur, rechargement).
 * Aucune logique métier : les calculs restent côté services.
 */
import React from 'react';
import { api, ApiError } from '@/lib/api';

interface Result<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Charge une ressource API et expose {data, loading, error, reload}.
 * @param fetcher fonction renvoyant une promesse
 * @param deps dépendances déclenchant un rechargement
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: any[] = []): Result<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((e: ApiError) => {
        if (!cancelled) setError(e.message || 'Erreur de chargement.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

/** État d'un formulaire : valeurs + erreurs + soumission. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = React.useState<T>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const set = React.useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  }, []);

  const reset = React.useCallback((next?: Partial<T>) => {
    setValues({ ...initial, ...(next || {}) } as T);
    setErrors({});
  }, [initial]);

  return { values, setValues, set, errors, setErrors, submitting, setSubmitting, reset };
}

/** Validation locale minimale d'un formulaire (les règles métier restent serveur). */
export function requireFields(values: Record<string, any>, fields: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label] of Object.entries(fields)) {
    const v = values[key];
    if (v === '' || v === null || v === undefined) errors[key] = `${label} est obligatoire.`;
  }
  return errors;
}

/** Debounce simple pour les champs de recherche. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
