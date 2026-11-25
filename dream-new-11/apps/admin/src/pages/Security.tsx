import { useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { ROLE_LABEL, type AdminSession } from '@dream11/shared';
import { Badge, Button, Card, Field, PageHeader, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function SecurityPage() {
  const { me, adopt } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ secret: string; otpauthUrl: string }>('/admin/auth/mfa/setup', { method: 'POST' });
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 220, color: { dark: '#0A1128', light: '#FFFFFF' } }) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  const enable = async () => {
    setBusy(true);
    setError(undefined);
    try {
      adopt(await api<AdminSession>('/admin/auth/mfa/enable', { method: 'POST', body: { code } }));
      setSetup(null);
      toast.success('Two-factor authentication is on');
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Security" subtitle="Your staff account and two-factor authentication" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Name</dt>
              <dd className="font-semibold">{me.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Email</dt>
              <dd>{me.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge tone="blue">{ROLE_LABEL[me.role]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="mb-2 text-muted">Permissions</dt>
              <dd className="flex flex-wrap gap-1.5">
                {me.permissions.map((p) => (
                  <Badge key={p}>{p}</Badge>
                ))}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Two-factor authentication">
          {me.mfaEnabled ? (
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-6 text-accent" />
              <div className="text-sm">
                <p className="font-semibold">On</p>
                <p className="mt-1 text-muted">Sign-ins and sensitive actions ask for a code from your authenticator app. Lost your phone? Ask a super admin to reset it.</p>
              </div>
            </div>
          ) : !setup ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-6 text-warning" />
                <p className="text-sm text-muted">
                  Protect payouts, user data and scoring with a second step at sign-in. Works with Google Authenticator, Microsoft Authenticator, Authy or 1Password.
                  {me.mfaRequired && <span className="mt-2 block font-semibold text-warning">Required for staff — set it up to keep using the panel.</span>}
                </p>
              </div>
              <Button loading={busy} onClick={() => void start()} icon={<Smartphone className="size-4" />}>
                Set up 2FA
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <ol className="space-y-1 text-sm text-muted">
                <li>1. Scan this QR code in your authenticator app.</li>
                <li>2. Enter the 6-digit code it shows.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-5">
                <img src={setup.qr} alt="2FA QR code" className="size-44 rounded-xl bg-white p-1" />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="text-muted">Can’t scan? Enter this key:</p>
                  <code className="mt-1 block font-mono text-sm break-all text-text select-all">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                </div>
              </div>
              <Field label="Code" error={error}>
                <input className="input font-mono tracking-[0.4em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Button loading={busy} disabled={code.length !== 6} onClick={() => void enable()} icon={<CheckCircle2 className="size-4" />}>
                Turn on 2FA
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
