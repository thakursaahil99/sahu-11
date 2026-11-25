import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, BadgeCheck, CalendarRange, Flag, LifeBuoy, Radio, Trophy, UserPlus, Users } from 'lucide-react';
import { Card, ErrorBox, money, PageHeader, Spinner, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Overview {
  users: number;
  newToday: number;
  liveMatches: number;
  upcomingMatches: number;
  openContests: number;
  pendingWithdrawals: { count: number; amount: number };
  pendingKyc: number;
  openTickets: number;
  openFlags: number;
  week: { deposits: number; withdrawals: number; entryFees: number; winningsInr: number; winningsDemo: number };
  signups: { day: string; count: number }[];
}

export function DashboardPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['/admin/overview'], queryFn: () => api<Overview>('/admin/overview'), refetchInterval: 30_000 });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;

  const queues = [
    { to: '/withdrawals', label: 'Withdrawals to approve', n: o.pendingWithdrawals.count, sub: money(o.pendingWithdrawals.amount), icon: Banknote, show: can('finance.view') },
    { to: '/kyc', label: 'KYC to review', n: o.pendingKyc, icon: BadgeCheck, show: can('kyc.review') },
    { to: '/tickets', label: 'Open support requests', n: o.openTickets, icon: LifeBuoy, show: can('support.reply') },
    { to: '/risk', label: 'Open risk flags', n: o.openFlags, icon: Flag, show: can('risk.review') },
  ].filter((x) => x.show);

  return (
    <>
      <PageHeader title={`Hello, ${me?.name.split(' ')[0]}`} subtitle="What’s happening on Dream New 11 right now" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Players" value={o.users.toLocaleString('en-IN')} sub={`+${o.newToday} in the last 24 h`} icon={<Users className="size-5" />} />
        <Stat label="Live matches" value={o.liveMatches} sub={`${o.upcomingMatches} upcoming`} tone="danger" icon={<Radio className="size-5" />} />
        <Stat label="Running contests" value={o.openContests} sub="open + locked" tone="info" icon={<Trophy className="size-5" />} />
        <Stat label="Deposits (7 days)" value={money(o.week.deposits)} sub={`Withdrawn ${money(o.week.withdrawals)}`} tone="warning" icon={<Banknote className="size-5" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="New players · last 14 days" className="lg:col-span-2">
          <SignupChart data={o.signups} />
        </Card>
        <Card title="Needs attention" padded={false}>
          <ul className="divide-y divide-line">
            {queues.map(({ to, label, n, sub, icon: Icon }) => (
              <li key={to}>
                <Link to={to} className="group flex items-center gap-3 px-5 py-4 transition hover:bg-raised/50">
                  <Icon className={n ? 'size-5 text-warning' : 'size-5 text-faint'} />
                  <span className="flex-1 text-sm">
                    {label}
                    {sub && n > 0 && <span className="block text-xs text-faint">{sub}</span>}
                  </span>
                  <span className={n ? 'rounded-full bg-warning/15 px-2.5 py-0.5 text-sm font-bold text-warning' : 'text-sm text-faint'}>{n}</span>
                  <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
            {can('matches.manage') && (
              <li>
                <Link to="/matches?status=LIVE" className="group flex items-center gap-3 px-5 py-4 transition hover:bg-raised/50">
                  <CalendarRange className="size-5 text-faint" />
                  <span className="flex-1 text-sm">Live match control</span>
                  <ArrowRight className="size-4 text-faint" />
                </Link>
              </li>
            )}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Entry fees (7 days)" value={money(o.week.entryFees)} icon={<Trophy className="size-5" />} />
        <Stat label="Cash winnings (7 days)" value={money(o.week.winningsInr)} icon={<Banknote className="size-5" />} />
        <Stat label="Demo winnings (7 days)" value={money(o.week.winningsDemo, 'DEMO')} sub="No cash value" tone="info" icon={<UserPlus className="size-5" />} />
      </div>
    </>
  );
}

function SignupChart({ data }: { data: { day: string; count: number }[] }) {
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), count: data.find((x) => x.day === key)?.count ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex h-48 items-end gap-2" role="img" aria-label={`Sign-ups per day: ${days.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
      {days.map((d) => (
        <div key={d.key} className="group flex flex-1 flex-col items-center gap-1.5">
          <span className="text-[10px] text-muted opacity-0 transition group-hover:opacity-100">{d.count}</span>
          <div className="w-full rounded-md bg-gradient-to-t from-accent-deep to-accent transition-all" style={{ height: `${Math.max(3, (d.count / max) * 140)}px`, opacity: d.count ? 1 : 0.25 }} />
          <span className="text-[9px] whitespace-nowrap text-faint">{d.label.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  );
}
