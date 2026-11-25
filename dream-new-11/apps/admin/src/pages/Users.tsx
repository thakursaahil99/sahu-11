import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, KeyRound, Search, ShieldOff, UserCheck, UserCog, UserX } from 'lucide-react';
import { ROLE_LABEL, STAFF_ROLES, stateName, type UserRole } from '@dream11/shared';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, Field, Modal, money, PageHeader, ReasonDialog, Spinner, StatusBadge, Table, ago } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, usePaged } from '@/lib/hooks';

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  kycStatus: string;
  entries: number;
  openFlags: number;
}

export function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const term = useDebounced(q);
  const list = usePaged<UserRow>('/admin/users', { q: term || undefined, status: status || undefined, role: role || undefined });

  return (
    <>
      <PageHeader title="Users" subtitle="Players and staff. Search by name, email, phone, id or referral code." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          </div>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['ACTIVE', 'RESTRICTED', 'SELF_EXCLUDED', 'SUSPENDED', 'DELETED'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">Everyone</option>
            <option value="USER">Players</option>
            <option value="STAFF">Staff</option>
          </select>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No users found" />
        ) : (
          <Table head={['User', 'Contact', 'Status', 'KYC', 'Entries', 'Joined', 'Last seen']}>
            {list.items.map((u) => (
              <tr key={u.id} className="transition hover:bg-raised/40">
                <td className="td">
                  <Link to={`/users/${u.id}`} className="font-semibold hover:text-accent">
                    {u.name}
                  </Link>
                  <div className="mt-0.5 flex gap-1.5">
                    {u.role !== 'USER' && <Badge tone="blue">{ROLE_LABEL[u.role]}</Badge>}
                    {u.openFlags > 0 && <Badge tone="red">{u.openFlags} flag{u.openFlags > 1 ? 's' : ''}</Badge>}
                  </div>
                </td>
                <td className="td text-muted">
                  <div>{u.email ?? '—'}</div>
                  <div className="text-xs text-faint">{u.phone ?? ''}</div>
                </td>
                <td className="td">
                  <StatusBadge status={u.status} />
                </td>
                <td className="td">
                  <StatusBadge status={u.kycStatus} />
                </td>
                <td className="td tabular-nums">{u.entries}</td>
                <td className="td text-muted">{dateTime(u.createdAt).split(',').slice(0, 2).join(',')}</td>
                <td className="td text-muted">{u.lastLoginAt ? ago(u.lastLoginAt) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        {list.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

interface UserDetail {
  user: UserRow & { dob: string; city: string | null; state: string | null; restrictionReason: string | null; mfaEnabled: boolean; referralCode: string; kyc: { status: string; fullName: string; panMasked: string; reviewNote: string | null } | null; playLimits: { excludedUntil: string | null } | null; _count: { teams: number; contestEntries: number; tickets: number } };
  balances: Record<'DEMO' | 'INR', { total: number; deposited: number; winnings: number; bonus: number }>;
  transactions: { id: string; type: string; status: string; currency: string; amount: number; description: string; createdAt: string }[];
  entries: { id: string; contest: string; match: string; status: string; points: number; rank: number | null; winnings: number; currency: string; createdAt: string }[];
  flags: { id: string; kind: string; status: string; createdAt: string }[];
  audit: { id: string; action: string; actorId: string | null; createdAt: string; ip: string | null }[];
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['/admin/users', id], queryFn: () => api<UserDetail>(`/admin/users/${id}`) });
  const [dialog, setDialog] = useState<'restrict' | 'suspend' | 'role' | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('USER');
  const inv = { invalidate: ['/admin/users'] };
  const restrict = useAction((reason: string) => api(`/admin/users/${id}/restrict`, { method: 'POST', body: { reason } }), { success: 'User restricted from play', ...inv });
  const suspend = useAction((reason: string) => api(`/admin/users/${id}/suspend`, { method: 'POST', body: { reason } }), { success: 'User suspended and signed out', ...inv });
  const unrestrict = useAction(() => api(`/admin/users/${id}/unrestrict`, { method: 'POST' }), { success: 'User re-activated', ...inv });
  const role = useAction(() => api(`/admin/users/${id}/role`, { method: 'POST', body: { role: newRole } }), { success: 'Role updated', ...inv });
  const resetMfa = useAction(() => api(`/admin/users/${id}/reset-mfa`, { method: 'POST' }), { success: '2FA reset — they’ll enrol again at next sign-in', ...inv });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const { user: u, balances, transactions, entries, flags, audit } = q.data;
  const self = u.id === me?.id;

  return (
    <>
      <Link to="/users" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Users
      </Link>
      <PageHeader
        title={u.name}
        subtitle={`${u.email ?? u.phone ?? ''} · joined ${dateTime(u.createdAt)}`}
        actions={
          !self &&
          u.status !== 'DELETED' && (
            <>
              {can('users.restrict') && u.status === 'ACTIVE' && (
                <Button variant="secondary" icon={<ShieldOff className="size-4" />} onClick={() => setDialog('restrict')}>
                  Restrict play
                </Button>
              )}
              {can('users.restrict') && (u.status === 'RESTRICTED' || u.status === 'SUSPENDED') && (
                <Button variant="secondary" icon={<UserCheck className="size-4" />} loading={unrestrict.isPending} onClick={() => unrestrict.mutate(undefined)}>
                  Re-activate
                </Button>
              )}
              {can('users.restrict') && u.status !== 'SUSPENDED' && (
                <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setDialog('suspend')}>
                  Suspend
                </Button>
              )}
              {can('users.roles') && (
                <Button
                  variant="secondary"
                  icon={<UserCog className="size-4" />}
                  onClick={() => {
                    setNewRole(u.role);
                    setDialog('role');
                  }}
                >
                  Role
                </Button>
              )}
              {can('users.roles') && u.mfaEnabled && (
                <Button variant="ghost" icon={<KeyRound className="size-4" />} loading={resetMfa.isPending} onClick={() => resetMfa.mutate(undefined)}>
                  Reset 2FA
                </Button>
              )}
            </>
          )
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <StatusBadge status={u.status} />
        <Badge tone="blue">{ROLE_LABEL[u.role]}</Badge>
        {u.restrictionReason && <Badge tone="amber">Reason: {u.restrictionReason}</Badge>}
        {u.playLimits?.excludedUntil && new Date(u.playLimits.excludedUntil) > new Date() && <Badge tone="amber">On a break until {dateTime(u.playLimits.excludedUntil)}</Badge>}
        {u.mfaEnabled && <Badge tone="green">2FA on</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-2.5 text-sm">
            {[
              ['Phone', u.phone ?? '—'],
              ['Email', u.email ?? '—'],
              ['Date of birth', u.dob?.slice(0, 10)],
              ['City', u.city ?? '—'],
              ['State', stateName(u.state) ?? 'Not declared'],
              ['Referral code', u.referralCode],
              ['Teams / entries', `${u._count.teams} / ${u._count.contestEntries}`],
              ['Support requests', String(u._count.tickets)],
              ['KYC', u.kyc ? `${u.kyc.status} · ${u.kyc.fullName} · ${u.kyc.panMasked}` : 'Not started'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Wallet" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {(['INR', 'DEMO'] as const).map((c) => (
              <div key={c} className="rounded-xl border border-line bg-bg/50 p-4">
                <p className="text-xs font-semibold text-muted uppercase">{c === 'INR' ? 'Real money' : 'Demo credits'}</p>
                <p className="mt-1 text-2xl font-extrabold">{money(balances[c].total, c)}</p>
                <p className="mt-1 text-xs text-faint">
                  Deposited {money(balances[c].deposited, c)} · Winnings {money(balances[c].winnings, c)} · Bonus {money(balances[c].bonus, c)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 -mx-5 -mb-5">
            {transactions.length === 0 ? (
              <Empty title="No transactions" />
            ) : (
              <Table head={['When', 'Type', 'Description', 'Amount', 'Status']}>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="td text-muted">{dateTime(t.createdAt)}</td>
                    <td className="td text-xs">{t.type.replace('_', ' ')}</td>
                    <td className="td">{t.description}</td>
                    <td className={`td font-semibold tabular-nums ${t.amount > 0 ? 'text-accent' : ''}`}>
                      {t.amount > 0 ? '+' : ''}
                      {money(t.amount, t.currency)}
                    </td>
                    <td className="td">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent contests" padded={false}>
          {entries.length === 0 ? (
            <Empty title="No contests yet" />
          ) : (
            <Table head={['Match', 'Contest', 'Pts', 'Rank', 'Won']}>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="td font-semibold">{e.match}</td>
                  <td className="td text-muted">{e.contest}</td>
                  <td className="td tabular-nums">{e.points}</td>
                  <td className="td tabular-nums">{e.rank ? `#${e.rank}` : '—'}</td>
                  <td className="td tabular-nums">{e.winnings ? money(e.winnings, e.currency) : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Activity & flags" padded={false}>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {flags.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <UserX className="size-4 text-danger" />
                <span className="flex-1">Risk flag: {f.kind.replace(/_/g, ' ').toLowerCase()}</span>
                <StatusBadge status={f.status} />
              </li>
            ))}
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <code className="flex-1 text-xs text-muted">{a.action}</code>
                <span className="text-xs text-faint">{ago(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'restrict'}
        title="Restrict from play"
        description="They can still sign in, view their account and withdraw, but can’t join contests, create teams or deposit. The reason is shown to them."
        confirmLabel="Restrict"
        onClose={() => setDialog(null)}
        onConfirm={(r) => restrict.mutateAsync(r)}
      />
      <ReasonDialog
        open={dialog === 'suspend'}
        title="Suspend account"
        description="Signs them out everywhere and blocks sign-in until re-activated. You’ll be asked to confirm it’s you."
        confirmLabel="Suspend"
        onClose={() => setDialog(null)}
        onConfirm={(r) => suspend.mutateAsync(r)}
      />
      <Modal
        open={dialog === 'role'}
        onClose={() => setDialog(null)}
        title="Change role"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={role.isPending} onClick={() => role.mutate(undefined, { onSuccess: () => setDialog(null) })}>
              Save role
            </Button>
          </>
        }
      >
        <Field label="Role" hint="Staff need an email and password. Their current sessions end so the new role applies at once.">
          <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
            {(['USER', ...STAFF_ROLES] as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
      </Modal>
    </>
  );
}
