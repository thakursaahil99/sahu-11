import { useState } from 'react';
import { KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button, Field } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { login, verifyMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div className="card relative w-full max-w-sm p-8 shadow-2xl">
        <div className="mb-7 flex flex-col items-center text-center">
          <img src="/favicon.png" alt="" className="mb-4 size-14 rounded-2xl shadow-lg" />
          <h1 className="text-xl font-extrabold tracking-tight">
            DREAM <span className="text-accent">NEW 11</span> Admin
          </h1>
          <p className="mt-1 text-sm text-muted">{challenge ? 'Enter the code from your authenticator app' : 'Staff sign-in'}</p>
        </div>

        {!challenge ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await login(email, password);
                if (r) setChallenge(r.challenge);
              });
            }}
          >
            <Field label="Email">
              <div className="relative">
                <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <input className="input pl-9" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
            </Field>
            <Field label="Password">
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <input className="input pl-9" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button className="w-full" loading={busy} type="submit" icon={<KeyRound className="size-4" />}>
              Sign in
            </Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => verifyMfa(challenge, code));
            }}
          >
            <Field label="6-digit code">
              <input
                className="input text-center font-mono text-xl tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button className="w-full" loading={busy} type="submit" disabled={code.length !== 6} icon={<ShieldCheck className="size-4" />}>
              Verify
            </Button>
            <button type="button" className="w-full text-xs text-muted hover:text-text" onClick={() => setChallenge(null)}>
              Use a different account
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-[11px] text-faint">Access is logged. Unauthorised use is prohibited.</p>
      </div>
    </div>
  );
}
