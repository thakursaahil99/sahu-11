import { REAUTH_HEADER, type AdminMe, type ApiErrorBody } from '@dream11/shared';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get fields() {
    return this.body.fields ?? {};
  }
  get code() {
    return this.body.code;
  }
}

/**
 * Session storage: the refresh token lives in sessionStorage (this tab only, gone when it
 * closes); the access token stays in memory.
 */
const REFRESH_KEY = 'd11.admin.refresh';
let accessToken: string | null = null;
let reauth: { token: string; until: number } | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();
export const onSessionChange = (fn: Listener) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const emit = () => listeners.forEach((l) => l());

export const session = {
  get hasRefresh() {
    return !!sessionStorage.getItem(REFRESH_KEY);
  },
  set(tokens: { accessToken: string; refreshToken: string }) {
    accessToken = tokens.accessToken;
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    accessToken = null;
    reauth = null;
    sessionStorage.removeItem(REFRESH_KEY);
    emit();
  },
};

let refreshing: Promise<boolean> | null = null;
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = sessionStorage.getItem(REFRESH_KEY);
    if (!rt) return false;
    const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => null);
    if (!res?.ok) {
      if (res && res.status === 401) session.clear();
      return false;
    }
    const body = (await res.json()) as { tokens: { accessToken: string; refreshToken: string } };
    session.set(body.tokens);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Shown by the app when a sensitive action needs the user to confirm it's them. */
type ReauthPrompt = () => Promise<boolean>;
let promptReauth: ReauthPrompt = async () => false;
export const setReauthPrompt = (fn: ReauthPrompt) => {
  promptReauth = fn;
};
export const setReauthToken = (token: string, seconds: number) => {
  reauth = { token, until: Date.now() + (seconds - 20) * 1000 };
};

let onMfaRequired: () => void = () => undefined;
export const setMfaRequiredHandler = (fn: () => void) => {
  onMfaRequired = fn;
};

interface Options {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (reauth && reauth.until > Date.now()) headers[REAUTH_HEADER] = reauth.token;

  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, { statusCode: 0, error: 'Network', message: 'Can’t reach the server. Check your connection.' });
  }

  if (res.status === 401 && opts.auth !== false && !retried) {
    if (await refresh()) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, body ?? { statusCode: res.status, error: 'Error', message: 'Something went wrong' });
    if (err.code === 'REAUTH_REQUIRED' && !retried) {
      reauth = null;
      if (await promptReauth()) return api<T>(path, opts, true);
      throw new ApiError(403, { ...err.body, message: 'Cancelled — the action needs confirmation.' });
    }
    if (err.code === 'MFA_REQUIRED') onMfaRequired();
    if (res.status === 401 && opts.auth !== false) session.clear();
    throw err;
  }
  return body as T;
}

export const adminMe = () => api<AdminMe>('/admin/auth/me');

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
