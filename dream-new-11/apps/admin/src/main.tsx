import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminPermission } from '@dream11/shared';
import { Layout } from '@/components/Layout';
import { Empty, Spinner, ToastProvider } from '@/components/ui';
import { ApiError, setMfaRequiredHandler } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AnnouncementsPage } from '@/pages/Announcements';
import { AuditPage } from '@/pages/Audit';
import { ContestsPage } from '@/pages/Contests';
import { DashboardPage } from '@/pages/Dashboard';
import { KycPage } from '@/pages/Kyc';
import { LoginPage } from '@/pages/Login';
import { MatchDetailPage, MatchesPage } from '@/pages/Matches';
import { PlayersPage } from '@/pages/Players';
import { RiskPage } from '@/pages/Risk';
import { ScoringPage, TeamRulesPage } from '@/pages/Rules';
import { SecurityPage } from '@/pages/Security';
import { TicketDetailPage, TicketsPage } from '@/pages/Tickets';
import { TransactionsPage, WithdrawalsPage } from '@/pages/Money';
import { UserDetailPage, UsersPage } from '@/pages/Users';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500) },
  },
});

function Guard({ perm, children }: { perm: AdminPermission; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? children : <Empty title="No access">Your role doesn’t include this area.</Empty>;
}

function Routed() {
  const { status, me } = useAuth();
  const navigate = useNavigate();
  useEffect(() => setMfaRequiredHandler(() => navigate('/security')), [navigate]);

  if (status === 'loading') return <Spinner label="Restoring your session…" />;
  if (status === 'guest' || !me) return <LoginPage />;
  const g = (perm: AdminPermission, el: React.ReactNode) => <Guard perm={perm}>{el}</Guard>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={g('dashboard.view', <DashboardPage />)} />
        <Route path="users" element={g('users.view', <UsersPage />)} />
        <Route path="users/:id" element={g('users.view', <UserDetailPage />)} />
        <Route path="kyc" element={g('kyc.review', <KycPage />)} />
        <Route path="tickets" element={g('support.reply', <TicketsPage />)} />
        <Route path="tickets/:id" element={g('support.reply', <TicketDetailPage />)} />
        <Route path="risk" element={g('risk.review', <RiskPage />)} />
        <Route path="withdrawals" element={g('finance.view', <WithdrawalsPage />)} />
        <Route path="transactions" element={g('finance.view', <TransactionsPage />)} />
        <Route path="matches" element={g('matches.manage', <MatchesPage />)} />
        <Route path="matches/:id" element={g('matches.manage', <MatchDetailPage />)} />
        <Route path="contests" element={g('contests.manage', <ContestsPage />)} />
        <Route path="players" element={g('players.manage', <PlayersPage />)} />
        <Route path="scoring" element={g('scoring.edit', <ScoringPage />)} />
        <Route path="team-rules" element={g('fantasy.edit', <TeamRulesPage />)} />
        <Route path="announcements" element={g('announcements.send', <AnnouncementsPage />)} />
        <Route path="audit" element={g('audit.view', <AuditPage />)} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
