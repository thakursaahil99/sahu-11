import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, ListOrdered, Plus, Trash2 } from 'lucide-react';
import { adminContestSchema, breakupTotal, type PrizeTier } from '@dream11/shared';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, Field, Modal, money, PageHeader, ReasonDialog, Spinner, StatusBadge, Table } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { useAction, usePaged } from '@/lib/hooks';
import { TeamChip } from './Matches';

interface ContestRow {
  id: string;
  name: string;
  type: string;
  status: string;
  currency: string;
  entryFee: number;
  prizePool: number;
  totalSpots: number;
  filledSpots: number;
  guaranteed: boolean;
  inviteCode: string | null;
  cancelReason: string | null;
  match: { id: string; startTime: string; status: string; homeTeam: { id: string; name: string; shortName: string; color: string }; awayTeam: { id: string; name: string; shortName: string; color: string } };
}

export function ContestsPage() {
  const [status, setStatus] = useState('OPEN');
  const [type, setType] = useState('');
  const list = usePaged<ContestRow>('/admin/contests', { status: status || undefined, type: type || undefined });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<ContestRow | null>(null);
  const [results, setResults] = useState<string | null>(null);
  const cancel = useAction((v: { id: string; reason: string }) => api(`/admin/contests/${v.id}/cancel`, { method: 'POST', body: { reason: v.reason } }), {
    success: 'Contest cancelled — entries refunded',
    invalidate: ['/admin/contests', '/admin/matches'],
  });

  return (
    <>
      <PageHeader
        title="Contests"
        subtitle="Create contests for upcoming matches; cancel with automatic refunds. Settlement after the match is automatic."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New contest
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {['FREE', 'PRACTICE', 'PRIVATE', 'PUBLIC'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No contests" />
        ) : (
          <Table head={['Contest', 'Match', 'Entry', 'Prize pool', 'Spots', 'Status', '']}>
            {list.items.map((c) => (
              <tr key={c.id}>
                <td className="td">
                  <span className="font-semibold">{c.name}</span>
                  <div className="mt-0.5 flex gap-1">
                    <Badge>{c.type.toLowerCase()}</Badge>
                    {c.guaranteed && <Badge tone="green">guaranteed</Badge>}
                    {c.inviteCode && <Badge tone="blue">{c.inviteCode}</Badge>}
                  </div>
                </td>
                <td className="td whitespace-nowrap">
                  <TeamChip t={c.match.homeTeam} /> <span className="text-faint">v</span> <TeamChip t={c.match.awayTeam} />
                  <div className="text-xs text-faint">{dateTime(c.match.startTime)}</div>
                </td>
                <td className="td">{c.entryFee ? money(c.entryFee, c.currency) : 'Free'}</td>
                <td className="td">{c.prizePool ? money(c.prizePool, c.currency) : '—'}</td>
                <td className="td tabular-nums">
                  {c.filledSpots}/{c.totalSpots}
                </td>
                <td className="td">
                  <StatusBadge status={c.status} />
                  {c.cancelReason && <div className="max-w-40 truncate text-xs text-faint">{c.cancelReason}</div>}
                </td>
                <td className="td text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" icon={<ListOrdered className="size-3.5" />} onClick={() => setResults(c.id)}>
                      Standings
                    </Button>
                    {(c.status === 'OPEN' || c.status === 'LOCKED') && (
                      <Button size="sm" variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setCancelling(c)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
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
      <CreateContestModal open={creating} onClose={() => setCreating(false)} />
      <ReasonDialog
        open={!!cancelling}
        title={`Cancel “${cancelling?.name}”`}
        description={`${cancelling?.filledSpots ?? 0} entries will be refunded and notified.`}
        confirmLabel="Cancel contest"
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancel.mutateAsync({ id: cancelling!.id, reason })}
      />
      <ContestResultsModal id={results} onClose={() => setResults(null)} />
    </>
  );
}

interface UpcomingMatch {
  id: string;
  startTime: string;
  homeTeam: ContestRow['match']['homeTeam'];
  awayTeam: ContestRow['match']['awayTeam'];
}

function CreateContestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const matches = useQuery({ queryKey: ['/admin/matches', 'upcoming-for-create'], queryFn: () => api<{ items: UpcomingMatch[] }>(`/admin/matches${qs({ status: 'UPCOMING', limit: 50 })}`), enabled: open });
  const [form, setForm] = useState({ matchId: '', name: '', type: 'FREE' as 'FREE' | 'PRACTICE' | 'PUBLIC', entryFee: 0, prizePool: 1000, totalSpots: 100, maxEntriesPerUser: 1, guaranteed: true });
  const [tiers, setTiers] = useState<PrizeTier[]>([
    { fromRank: 1, toRank: 1, amount: 500 },
    { fromRank: 2, toRank: 5, amount: 125 },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction((body: unknown) => api('/admin/contests', { method: 'POST', body }), { success: 'Contest created', invalidate: ['/admin/contests', '/admin/matches'] });
  const total = useMemo(() => breakupTotal(tiers), [tiers]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const practice = form.type === 'PRACTICE';

  const submit = () => {
    const body = { ...form, prizePool: practice ? 0 : form.prizePool, prizeBreakup: practice ? [] : tiers };
    const parsed = adminContestSchema.safeParse(body);
    if (!parsed.success) {
      return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? '_'), i.message])));
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: onClose,
      onError: (e) => e instanceof ApiError && setErrors(e.fields),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New contest"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            Create contest
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Match" error={errors.matchId}>
          <select className="input" value={form.matchId} onChange={(e) => set('matchId', e.target.value)}>
            <option value="">Choose an upcoming match…</option>
            {matches.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeam.shortName} vs {m.awayTeam.shortName} · {dateTime(m.startTime)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" error={errors.name}>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Weekend Mega" />
        </Field>
        <Field label="Type" error={errors.type} hint="Paid (public) contests only work when real-money play is enabled.">
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value as typeof form.type)}>
            <option value="FREE">Free (demo-credit prizes in demo mode)</option>
            <option value="PRACTICE">Practice (no prizes)</option>
            <option value="PUBLIC">Paid</option>
          </select>
        </Field>
        <Field label="Entry fee (₹)" error={errors.entryFee}>
          <input className="input" type="number" min={0} value={form.entryFee} disabled={form.type !== 'PUBLIC'} onChange={(e) => set('entryFee', Number(e.target.value))} />
        </Field>
        <Field label="Spots" error={errors.totalSpots}>
          <input className="input" type="number" min={2} value={form.totalSpots} onChange={(e) => set('totalSpots', Number(e.target.value))} />
        </Field>
        <Field label="Max teams per user" error={errors.maxEntriesPerUser}>
          <input className="input" type="number" min={1} max={20} value={form.maxEntriesPerUser} onChange={(e) => set('maxEntriesPerUser', Number(e.target.value))} />
        </Field>
        {!practice && (
          <Field label="Prize pool" error={errors.prizePool}>
            <input className="input" type="number" min={0} value={form.prizePool} onChange={(e) => set('prizePool', Number(e.target.value))} />
          </Field>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-[#22e06b]" checked={form.guaranteed} onChange={(e) => set('guaranteed', e.target.checked)} />
          Guaranteed (runs even if not full)
        </label>
      </div>

      {!practice && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Prize breakup</span>
            <span className={`text-xs ${total > form.prizePool ? 'text-danger' : 'text-muted'}`}>
              Pays {total.toLocaleString('en-IN')} of {form.prizePool.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-14 text-xs text-faint">Ranks</span>
                <input className="input w-20" type="number" min={1} value={t.fromRank} aria-label="From rank" onChange={(e) => setTiers((s) => s.map((x, j) => (j === i ? { ...x, fromRank: Number(e.target.value) } : x)))} />
                <span className="text-faint">–</span>
                <input className="input w-20" type="number" min={1} value={t.toRank} aria-label="To rank" onChange={(e) => setTiers((s) => s.map((x, j) => (j === i ? { ...x, toRank: Number(e.target.value) } : x)))} />
                <span className="ml-2 text-xs text-faint">each</span>
                <input className="input w-28" type="number" min={0} value={t.amount} aria-label="Prize each" onChange={(e) => setTiers((s) => s.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                <button className="rounded-lg p-2 text-faint hover:bg-raised hover:text-danger" onClick={() => setTiers((s) => s.filter((_, j) => j !== i))} aria-label="Remove tier">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            icon={<Plus className="size-3.5" />}
            onClick={() => setTiers((s) => [...s, { fromRank: (s.at(-1)?.toRank ?? 0) + 1, toRank: (s.at(-1)?.toRank ?? 0) + 1, amount: 0 }])}
          >
            Add tier
          </Button>
          {errors.prizeBreakup && <p className="mt-2 text-sm text-danger">{errors.prizeBreakup}</p>}
        </div>
      )}
      {errors._ && <p className="mt-3 text-sm text-danger">{errors._}</p>}
    </Modal>
  );
}

interface Results {
  contest: { name: string; status: string; currency: string; settledAt: string | null; prizePool: number };
  paidOut: number;
  entries: { id: string; rank: number | null; points: number; winnings: number; team: string; user: { id: string; name: string } }[];
}

export function ContestResultsModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['/admin/contests', id, 'results'], queryFn: () => api<Results>(`/admin/contests/${id}/results`), enabled: !!id });
  return (
    <Modal open={!!id} onClose={onClose} title={q.data ? `Standings · ${q.data.contest.name}` : 'Standings'} wide>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <StatusBadge status={q.data.contest.status} />
            {q.data.contest.settledAt && <span className="text-muted">Settled {dateTime(q.data.contest.settledAt)}</span>}
            <span className="text-muted">
              Paid out {money(q.data.paidOut, q.data.contest.currency)} of {money(q.data.contest.prizePool, q.data.contest.currency)}
            </span>
          </div>
          {q.data.entries.length === 0 ? (
            <Empty title="No entries" />
          ) : (
            <div className="-mx-5 -mb-5">
              <Table head={['Rank', 'Player', 'Team', 'Points', 'Winnings']}>
                {q.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="td font-bold tabular-nums">{e.rank ? `#${e.rank}` : '—'}</td>
                    <td className="td">{e.user.name}</td>
                    <td className="td">{e.team}</td>
                    <td className="td tabular-nums">{e.points}</td>
                    <td className="td tabular-nums">{e.winnings ? money(e.winnings, q.data.contest.currency) : '—'}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
