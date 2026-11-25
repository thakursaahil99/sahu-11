import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, money, PageHeader, ReasonDialog, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useDebounced, usePaged } from '@/lib/hooks';

interface Withdrawal {
  id: string;
  amount: number;
  createdAt: string;
  user: { id: string; name: string; email: string | null; phone: string | null; kyc: { status: string; fullName: string; panMasked: string } | null };
}

export function WithdrawalsPage() {
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['/admin/withdrawals'], queryFn: () => api<Withdrawal[]>('/admin/withdrawals') });
  const [rejecting, setRejecting] = useState<Withdrawal | null>(null);
  const inv = { invalidate: ['/admin/withdrawals', '/admin/overview', '/admin/transactions'] };
  const approve = useAction((id: string) => api(`/admin/withdrawals/${id}/approve`, { method: 'POST' }), { success: 'Approved — marked as paid out', ...inv });
  const reject = useAction((v: { id: string; reason: string }) => api(`/admin/withdrawals/${v.id}/reject`, { method: 'POST', body: { reason: v.reason } }), { success: 'Rejected — amount returned to winnings', ...inv });
  const total = q.data?.reduce((s, w) => s + w.amount, 0) ?? 0;

  return (
    <>
      <PageHeader title="Withdrawals" subtitle={`Requests waiting for approval${q.data?.length ? ` · ${q.data.length} totalling ${money(total)}` : ''}. The amount is already on hold.`} />
      <Card padded={false}>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <ErrorBox error={q.error} />
          </div>
        ) : q.data.length === 0 ? (
          <Empty title="No pending withdrawals">Requests appear here once players ask to withdraw verified winnings.</Empty>
        ) : (
          <Table head={['Requested', 'Player', 'KYC', 'Amount', '']}>
            {q.data.map((w) => (
              <tr key={w.id}>
                <td className="td text-muted">{dateTime(w.createdAt)}</td>
                <td className="td">
                  <Link to={`/users/${w.user.id}`} className="font-semibold hover:text-accent">
                    {w.user.name}
                  </Link>
                  <div className="text-xs text-faint">{w.user.email ?? w.user.phone}</div>
                </td>
                <td className="td">{w.user.kyc ? <span className="text-sm">{w.user.kyc.fullName} · <span className="font-mono">{w.user.kyc.panMasked}</span></span> : <Badge tone="red">none</Badge>}</td>
                <td className="td text-lg font-extrabold tabular-nums">{money(w.amount)}</td>
                <td className="td text-right">
                  {can('withdrawals.approve') && w.user.id !== me?.id && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="danger" icon={<X className="size-3.5" />} onClick={() => setRejecting(w)}>
                        Reject
                      </Button>
                      <Button size="sm" icon={<Check className="size-3.5" />} loading={approve.isPending && approve.variables === w.id} onClick={() => approve.mutate(w.id)}>
                        Approve
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ReasonDialog
        open={!!rejecting}
        title={`Reject ${rejecting ? money(rejecting.amount) : ''} withdrawal`}
        description="The amount goes back to the player’s winnings and they’re notified with your reason."
        confirmLabel="Reject"
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => reject.mutateAsync({ id: rejecting!.id, reason })}
      />
    </>
  );
}

interface Tx {
  id: string;
  type: string;
  status: string;
  currency: string;
  amount: number;
  description: string;
  reference: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string | null; phone: string | null } | null;
}

const TYPES = ['DEPOSIT', 'WITHDRAWAL', 'CONTEST_ENTRY', 'CONTEST_WINNING', 'REFUND', 'BONUS', 'ADJUSTMENT'];

export function TransactionsPage() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q);
  const list = usePaged<Tx>('/admin/transactions', { type: type || undefined, status: status || undefined, q: term || undefined });

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every wallet movement. The ledger is append-only — corrections are new transactions." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Transaction id, gateway order id or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
          </div>
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="No transactions" />
        ) : (
          <Table head={['When', 'Player', 'Type', 'Description', 'Amount', 'Status']}>
            {list.items.map((t) => (
              <tr key={t.id}>
                <td className="td whitespace-nowrap text-muted">{dateTime(t.createdAt)}</td>
                <td className="td">
                  {t.user ? (
                    <Link to={`/users/${t.user.id}`} className="hover:text-accent">
                      {t.user.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="td text-xs">{t.type.replace('_', ' ')}</td>
                <td className="td">
                  {t.description}
                  {t.reference && <div className="font-mono text-[11px] text-faint">{t.reference}</div>}
                </td>
                <td className={`td font-semibold whitespace-nowrap tabular-nums ${t.amount > 0 ? 'text-accent' : ''}`}>
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
