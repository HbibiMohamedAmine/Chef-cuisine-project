/**
 * Client API — enveloppe fetch typée avec gestion homogène des erreurs.
 * Toutes les erreurs serveur arrivent sous la forme { message, code, details }.
 */

export class ApiError extends Error {
  constructor(message: string, public code: string = 'ERROR', public status = 400, public details: any = null) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: any, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });

  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message || 'Session expirée.', data.code || 'UNAUTHORIZED', 401);
  }

  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      data = { message: `Erreur ${res.status}` };
    }
    throw new ApiError(data.message || `Erreur ${res.status}`, data.code || 'ERROR', res.status, data.details);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: any) => request<T>('POST', path, body),
  put: <T = any>(path: string, body?: any) => request<T>('PUT', path, body),
  del: <T = any>(path: string, body?: any) => request<T>('DELETE', path, body),
};

/** Construit une query string à partir d'un objet (ignore null/undefined/''). */
export function qs(params: Record<string, any>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** Télécharge un fichier généré côté serveur (PDF / XLSX / CSV). */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    let msg = 'Téléchargement impossible.';
    try {
      msg = (await res.json()).message || msg;
    } catch { /* ignore */ }
    throw new ApiError(msg, 'DOWNLOAD_ERROR', res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
