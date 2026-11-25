import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, RefreshCw, RotateCw, Search } from 'lucide-react';
import { Button, Card, dateTime, Empty, ErrorBox, money, PageHeader, ReasonDialog, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, usePaged } from '@/lib/hooks';
import { ContestResultsModal } from './Contests';

interface Team {
  id: string;
  name: string;
  shortName: string;
  color: string;
}
interface MatchRow {
  id: string;
  format: string;
  venue: string;
  startTime: string;
  status: string;
  statusNote: string | null;
  homeTeam: Team;
  awayTeam: Team;
  series: { name: string };
  _count: { contests: number; userTeams: number };
}

export function TeamChip({ t }: { t: Team }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <span className="size-2.5 rounded-full" style={{ background: t.color }} />
      {t.shortName}
    </span>
  );
}

export function MatchesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'UPCOMING';
  const [q, setQ] = useState('');
  const term = useDebounced(q);
  const list = usePaged<MatchRow>('/admin/matches', { status, q: term || undefined });
  const { can } = useAuth();
  const sync = useAction(() => api<{ fixtures: number; squads: number; durationMs: number }>('/admin/matches/sync', { method: 'POST' }), { success: 'Sports data synced', invalidate: ['/admin/matches'] });

  return (
    <>
      <PageHeader
        title="Matches"
        subtitle="Fixtures from the sports data provider, with contest and team counts."
        actions={
          can('sports.sync') && (
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>
              Sync fixtures now
            </Button>
          )
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="flex rounded-xl border border-line bg-bg p-1">
            {['UPCOMING', 'LIVE', 'COMPLETED', 'ABANDONED'].map((s) => (
              <button
                key={s}
                onClick={() => setParams({ status: s })}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${status === s ? 'bg-accent text-bg' : 'text-muted hover:text-text'}`}
              >
                {s.toLowerCase()}
              </button>
            ))}
          </div>
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Team or series" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" />
          </div>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No matches" />
        ) : (
          <Table head={['Match', 'Series', 'Start', 'Status', 'Contests', 'Teams']}>
            {list.items.map((m) => (
              <tr key={m.id} className="transition hover:bg-raised/40">
                <td className="td">
                  <Link to={`/matches/${m.id}`} className="hover:text-accent">
                    <TeamChip t={m.homeTeam} /> <span className="text-faint">vs</span> <TeamChip t={m.awayTeam} />
                  </Link>
                  <div className="text-xs text-faint">
                    {m.format} · {m.venue}
                  </div>
                </td>
                <td className="td text-muted">{m.series.name}</td>
                <td className="td whitespace-nowrap text-muted">{dateTime(m.startTime)}</td>
                <td className="td">
                  <StatusBadge status={m.status} />
                </td>
                <td className="td tabular-nums">{m._count.contests}</td>
                <td className="td tabular-nums">{m._count.userTeams}</td>
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

interface MatchDetail extends MatchRow {
  lineupsAnnounced: boolean;
  liveState: { summary: unknown; updatedAt: string; final: boolean } | null;
  contests: { id: string; name: string; type: string; status: string; currency: string; entryFee: number; prizePool: number; totalSpots: number; filledSpots: number; cancelReason: string | null }[];
}

export function MatchDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['/admin/matches', id], queryFn: () => api<MatchDetail>(`/admin/matches/${id}`) });
  const [abandoning, setAbandoning] = useState(false);
  const [results, setResults] = useState<string | null>(null);
  const inv = { invalidate: ['/admin/matches', '/admin/contests'] };
  const recompute = useAction(() => api(`/admin/matches/${id}/recompute`, { method: 'POST' }), { success: 'Points recomputed', ...inv });
  const abandon = useAction((reason: string) => api<{ contestsCancelled: number }>(`/admin/matches/${id}/abandon`, { method: 'POST', body: { reason } }), { success: 'Match abandoned — contests cancelled and refunded', ...inv });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const over = m.status === 'COMPLETED' || m.status === 'ABANDONED';

  return (
    <>
      <Link to="/matches" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Matches
      </Link>
      <PageHeader
        title={`${m.homeTeam.name} vs ${m.awayTeam.name}`}
        subtitle={`${m.series.name} · ${m.format} · ${m.venue} · ${dateTime(m.startTime)}`}
        actions={
          <>
            {m.status !== 'UPCOMING' && (
              <Button variant="secondary" icon={<RotateCw className="size-4" />} loading={recompute.isPending} onClick={() => recompute.mutate(undefined)}>
                Recompute points
              </Button>
            )}
            {!over && (
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setAbandoning(true)}>
                Abandon match
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={m.status} />
        {m.statusNote && <span className="text-sm text-muted">{m.statusNote}</span>}
        {m.liveState && <span className="text-xs text-faint">Last score update {dateTime(m.liveState.updatedAt)}</span>}
      </div>
      <Card title={`Contests (${m.contests.length})`} padded={false}>
        {m.contests.length === 0 ? (
          <Empty title="No contests" />
        ) : (
          <Table head={['Contest', 'Type', 'Entry', 'Prize pool', 'Spots', 'Status', '']}>
            {m.contests.map((c) => (
              <tr key={c.id}>
                <td className="td font-semibold">{c.name}</td>
                <td className="td text-xs">{c.type}</td>
                <td className="td">{c.entryFee ? money(c.entryFee, c.currency) : 'Free'}</td>
                <td className="td">{c.prizePool ? money(c.prizePool, c.currency) : '—'}</td>
                <td className="td tabular-nums">
                  {c.filledSpots}/{c.totalSpots}
                </td>
                <td className="td">
                  <StatusBadge status={c.status} />
                  {c.cancelReason && <div className="text-xs text-faint">{c.cancelReason}</div>}
                </td>
                <td className="td text-right">
                  <Button size="sm" variant="ghost" onClick={() => setResults(c.id)}>
                    Standings
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ReasonDialog
        open={abandoning}
        title="Abandon match"
        description="Every open or running contest is cancelled and all entry fees are refunded. Players are notified. This can’t be undone."
        confirmLabel="Abandon match"
        onClose={() => setAbandoning(false)}
        onConfirm={(r) => abandon.mutateAsync(r)}
      />
      <ContestResultsModal id={results} onClose={() => setResults(null)} />
    </>
  );
}
