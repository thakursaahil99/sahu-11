import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  BadgeCheck,
  Banknote,
  CalendarRange,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Receipt,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sigma,
  Trophy,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { ROLE_LABEL, type AdminPermission } from '@dream11/shared';
import { useAuth } from '@/lib/auth';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  perm: AdminPermission;
}
const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' }] },
  {
    title: 'People',
    items: [
      { to: '/users', label: 'Users', icon: Users, perm: 'users.view' },
      { to: '/kyc', label: 'KYC review', icon: BadgeCheck, perm: 'kyc.review' },
      { to: '/tickets', label: 'Support', icon: LifeBuoy, perm: 'support.reply' },
      { to: '/risk', label: 'Risk flags', icon: Flag, perm: 'risk.review' },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/withdrawals', label: 'Withdrawals', icon: Banknote, perm: 'finance.view' },
      { to: '/transactions', label: 'Transactions', icon: Receipt, perm: 'finance.view' },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/matches', label: 'Matches', icon: CalendarRange, perm: 'matches.manage' },
      { to: '/contests', label: 'Contests', icon: Trophy, perm: 'contests.manage' },
      { to: '/players', label: 'Players', icon: UserRound, perm: 'players.manage' },
      { to: '/scoring', label: 'Scoring rules', icon: Sigma, perm: 'scoring.edit' },
      { to: '/team-rules', label: 'Team rules', icon: Settings2, perm: 'fantasy.edit' },
      { to: '/announcements', label: 'Announcements', icon: Megaphone, perm: 'announcements.send' },
    ],
  },
  { title: 'Compliance', items: [{ to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.view' }] },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  if (!me) return null;

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {SECTIONS.map((s) => {
        const items = s.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={s.title}>
            <p className="mb-1.5 px-3 text-[10px] font-bold tracking-widest text-faint uppercase">{s.title}</p>
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-raised hover:text-text')
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full w-64 flex-col border-r border-line bg-bg">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/favicon.png" alt="" className="size-8 rounded-lg" />
        <div>
          <p className="text-sm font-extrabold tracking-tight">
            DREAM <span className="text-accent">NEW 11</span>
          </p>
          <p className="text-[10px] font-semibold tracking-widest text-faint uppercase">Admin</p>
        </div>
      </div>
      {nav}
      <div className="border-t border-line p-3">
        <NavLink
          to="/security"
          onClick={() => setOpen(false)}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition', isActive ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text')}
        >
          <ShieldCheck className={cx('size-4', me.mfaEnabled ? 'text-accent' : 'text-warning')} />
          <span className="flex-1 truncate">
            <span className="block truncate font-semibold text-text">{me.name}</span>
            <span className="block text-xs text-faint">
              {ROLE_LABEL[me.role]} · {me.mfaEnabled ? '2FA on' : '2FA off'}
            </span>
          </span>
        </NavLink>
        <button onClick={() => void logout().then(() => navigate('/', { replace: true }))} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-danger">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-bg-deep/80" onClick={() => setOpen(false)} />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg-deep/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu" className="rounded-lg p-1.5 hover:bg-raised">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="text-sm font-bold">Admin</span>
        </div>
        {!me.mfaEnabled && me.mfaRequired && loc.pathname !== '/security' && (
          <div className="border-b border-warning/30 bg-warning/10 px-6 py-2.5 text-sm text-warning">Two-factor authentication is required. Set it up under Security to continue.</div>
        )}
        <div key={loc.pathname} className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
