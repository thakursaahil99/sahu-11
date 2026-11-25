import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Button, Card, Empty, ErrorBox, PageHeader, Spinner, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useDebounced, usePaged } from '@/lib/hooks';
import { TeamChip } from './Matches';

interface PlayerRow {
  id: string;
  name: string;
  role: 'WK' | 'BAT' | 'AR' | 'BOWL';
  credits: number;
  country: string | null;
  team: { id: string; name: string; shortName: string; color: string } | null;
}

export function PlayersPage() {
  const [q, setQ] = useState('');
  const term = useDebounced(q);
  const list = usePaged<PlayerRow>('/admin/players', { q: term || undefined, limit: '50' });

  return (
    <>
      <PageHeader title="Players" subtitle="Fantasy credits and roles. Changes apply to new teams — saved teams keep the prices they were built with." />
      <Card padded={false}>
        <div className="border-b border-line p-4">
          <div className="relative max-w-md">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Player or team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
          </div>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No players" />
        ) : (
          <Table head={['Player', 'Team', 'Role', 'Credits', '']}>
            {list.items.map((p) => (
              <PlayerEditRow key={p.id} p={p} />
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

function PlayerEditRow({ p }: { p: PlayerRow }) {
  const [role, setRole] = useState(p.role);
  const [credits, setCredits] = useState(p.credits);
  const dirty = role !== p.role || credits !== p.credits;
  const save = useAction(() => api(`/admin/players/${p.id}`, { method: 'PUT', body: { role, credits } }), { success: `${p.name} updated`, invalidate: ['/admin/players'] });
  return (
    <tr>
      <td className="td font-semibold">
        {p.name}
        {p.country && <div className="text-xs font-normal text-faint">{p.country}</div>}
      </td>
      <td className="td">{p.team ? <TeamChip t={p.team} /> : '—'}</td>
      <td className="td">
        <select className="input h-8 w-24" value={role} onChange={(e) => setRole(e.target.value as PlayerRow['role'])} aria-label={`${p.name} role`}>
          {['WK', 'BAT', 'AR', 'BOWL'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </td>
      <td className="td">
        <input className="input h-8 w-24" type="number" step={0.5} min={4} max={12} value={credits} onChange={(e) => setCredits(Number(e.target.value))} aria-label={`${p.name} credits`} />
      </td>
      <td className="td text-right">
        {dirty && (
          <Button size="sm" icon={<Check className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}
