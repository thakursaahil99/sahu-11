import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdminLoginResult, AdminMe, AdminPermission, AdminSession } from '@dream11/shared';
import { Button, Field, Modal } from '@/components/ui';
import { adminMe, api, ApiError, onSessionChange, refresh, session, setReauthPrompt, setReauthToken } from './api';

interface AuthState {
  me: AdminMe | null;
  status: 'loading' | 'guest' | 'authed';
  login: (email: string, password: string) => Promise<{ challenge: string } | null>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  adopt: (s: AdminSession) => void;
  logout: () => Promise<void>;
  can: (p: AdminPermission) => boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const adopt = useCallback((s: AdminSession) => {
    session.set(s.tokens);
    setMe(s.me);
    setStatus('authed');
  }, []);

  const reload = useCallback(async () => {
    setMe(await adminMe());
  }, []);

  // Restore the tab's session on load.
  useEffect(() => {
    void (async () => {
      if (session.hasRefresh && (await refresh())) {
        try {
          setMe(await adminMe());
          return setStatus('authed');
        } catch {
          session.clear();
        }
      }
      setStatus('guest');
    })();
    return onSessionChange(() => {
      setMe(null);
      setStatus('guest');
    });
  }, []);

  const value: AuthState = {
    me,
    status,
    adopt,
    reload,
    login: async (email, password) => {
      const r = await api<AdminLoginResult>('/admin/auth/login', { method: 'POST', body: { email, password }, auth: false });
      if (r.mfaRequired) return { challenge: r.challenge };
      adopt(r);
      return null;
    },
    verifyMfa: async (challenge, code) => adopt(await api<AdminSession>('/admin/auth/mfa', { method: 'POST', body: { challenge, code }, auth: false })),
    logout: async () => {
      const rt = sessionStorage.getItem('d11.admin.refresh');
      if (rt) await api('/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false }).catch(() => undefined);
      session.clear();
    },
    can: (p) => !!me?.permissions.includes(p),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {status === 'authed' && me && <ReauthHost mfa={me.mfaEnabled} />}
    </Ctx.Provider>
  );
}

/** Answers the API client's step-up requests with a password / 2FA prompt. */
function ReauthHost({ mfa }: { mfa: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setReauthPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setValue('');
          setError(undefined);
          setOpen(true);
        }),
    );
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ reauthToken: string; expiresIn: number }>('/admin/auth/reauth', { method: 'POST', body: mfa ? { code: value.trim() } : { password: value } });
      setReauthToken(r.reauthToken, r.expiresIn);
      finish(true);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      title="Confirm it’s you"
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Confirm
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">This action is sensitive. {mfa ? 'Enter the 6-digit code from your authenticator app.' : 'Enter your password.'} You won’t be asked again for 5 minutes.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={mfa ? 'Authentication code' : 'Password'} error={error}>
          <input
            className="input"
            type={mfa ? 'text' : 'password'}
            inputMode={mfa ? 'numeric' : undefined}
            autoComplete={mfa ? 'one-time-code' : 'current-password'}
            maxLength={mfa ? 6 : 200}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </Field>
      </form>
    </Modal>
  );
}
