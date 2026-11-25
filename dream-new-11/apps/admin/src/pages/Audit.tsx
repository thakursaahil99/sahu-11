import { useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { ROLE_LABEL, type UserRole } from '@dream11/shared';
import { Button, Card, dateTime, Empty, ErrorBox, PageHeader, Spinner, Table } from '@/components/ui';
import { useDebounced, usePaged } from '@/lib/hooks';

interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: UserRole } | null;
}

const PREFIXES = ['', 'admin.', 'auth.', 'wallet.', 'kyc.', 'contest.', 'support.', 'risk.', 'play.', 'user.'];

export function AuditPage() {
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q);
  const list = usePaged<AuditRow>('/admin/audit', { action: action || undefined, q: term || undefined });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of sign-ins, money movements and every admin action." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <select className="input w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
            {PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p ? `${p}*` : 'All actions'}
              </option>
            ))}
          </select>
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Entity id, actor id or IP" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
          </div>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No entries" />
        ) : (
          <Table head={['When', 'Who', 'Action', 'Target', 'IP']}>
            {list.items.map((a) => (
              <tr key={a.id} className="cursor-pointer align-top transition hover:bg-raised/40" onClick={() => setOpen(open === a.id ? null : a.id)}>
                <td className="td whitespace-nowrap text-muted">{dateTime(a.createdAt)}</td>
                <td className="td">
                  {a.actor ? (
                    <Link to={`/users/${a.actor.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent">
                      {a.actor.name}
                      {a.actor.role !== 'USER' && <span className="ml-1 text-xs text-faint">({ROLE_LABEL[a.actor.role]})</span>}
                    </Link>
                  ) : (
                    <span className="text-faint">system</span>
                  )}
                </td>
                <td className="td">
                  <code className={`text-xs ${a.action.startsWith('admin.') ? 'text-warning' : a.action.includes('failed') ? 'text-danger' : 'text-text'}`}>{a.action}</code>
                  {open === a.id && a.metadata != null && <pre className="mt-2 max-w-xl overflow-x-auto rounded-lg bg-bg p-3 text-[11px] text-muted">{JSON.stringify(a.metadata, null, 2)}</pre>}
                </td>
                <td className="td text-xs text-muted">{a.entityType ? `${a.entityType} · ${a.entityId?.slice(-8)}` : '—'}</td>
                <td className="td font-mono text-xs text-faint">{a.ip ?? '—'}</td>
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
