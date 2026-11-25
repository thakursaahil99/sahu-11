import { useState } from 'react';
import { Link } from 'react-router';
import { Radar } from 'lucide-react';
import { Button, Card, dateTime, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, StatusBadge, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, usePaged } from '@/lib/hooks';

interface Flag {
  id: string;
  kind: string;
  status: string;
  details: Record<string, unknown>;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string | null; phone: string | null; status: string };
}

const KIND: Record<string, { label: string; explain: (d: Record<string, unknown>) => string }> = {
  MULTI_ACCOUNT_IP: { label: 'Many accounts, one IP', explain: (d) => `${d.accounts} sign-ups from ${d.ip} in 7 days` },
  RAPID_DEPOSITS: { label: 'Rapid deposits', explain: (d) => `${d.depositsIn15Min} in 15 min · ${d.depositsThatDay} on ${d.day}` },
  QUICK_WITHDRAWAL: { label: 'Deposit → withdraw without playing', explain: (d) => `₹${d.amount} withdrawal within 24 h of a deposit` },
  PAN_REUSE: { label: 'PAN already on another account', explain: () => 'Tried to submit a PAN linked to a different account' },
};

export function RiskPage() {
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const list = usePaged<Flag>('/admin/risk', { status, type: kind || undefined });
  const [resolving, setResolving] = useState<{ flag: Flag; status: 'DISMISSED' | 'ACTIONED' } | null>(null);
  const [note, setNote] = useState('');
  const scan = useAction(() => api<Record<string, number>>('/admin/risk/scan', { method: 'POST' }), { invalidate: ['/admin/risk', '/admin/overview'], success: 'Scan complete' });
  const resolve = useAction((v: { id: string; status: string; note: string }) => api(`/admin/risk/${v.id}/resolve`, { method: 'POST', body: { status: v.status, note: v.note } }), {
    success: 'Flag resolved',
    invalidate: ['/admin/risk', '/admin/overview'],
  });

  return (
    <>
      <PageHeader
        title="Risk flags"
        subtitle="Signals for a human to review — nothing here punishes anyone automatically. Scans run every 30 minutes."
        actions={
          <Button variant="secondary" icon={<Radar className="size-4" />} loading={scan.isPending} onClick={() => scan.mutate(undefined)}>
            Scan now
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="OPEN">Open</option>
            <option value="ACTIONED">Actioned</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
          <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">All signals</option>
            {Object.entries(KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
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
          <Empty title="No flags">Nothing suspicious right now.</Empty>
        ) : (
          <Table head={['Raised', 'Player', 'Signal', 'Details', 'Status', '']}>
            {list.items.map((f) => (
              <tr key={f.id}>
                <td className="td whitespace-nowrap text-muted">{dateTime(f.createdAt)}</td>
                <td className="td">
                  <Link to={`/users/${f.user.id}`} className="font-semibold hover:text-accent">
                    {f.user.name}
                  </Link>
                  <div className="mt-0.5">
                    <StatusBadge status={f.user.status} />
                  </div>
                </td>
                <td className="td font-medium">{KIND[f.kind]?.label ?? f.kind}</td>
                <td className="td text-muted">
                  {KIND[f.kind]?.explain(f.details) ?? JSON.stringify(f.details)}
                  {f.note && <div className="mt-1 text-xs text-faint">Note: {f.note}</div>}
                </td>
                <td className="td">
                  <StatusBadge status={f.status} />
                </td>
                <td className="td text-right">
                  {f.status === 'OPEN' && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => (setNote(''), setResolving({ flag: f, status: 'DISMISSED' }))}>
                        Dismiss
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => (setNote(''), setResolving({ flag: f, status: 'ACTIONED' }))}>
                        Mark actioned
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal
        open={!!resolving}
        onClose={() => setResolving(null)}
        title={resolving?.status === 'DISMISSED' ? 'Dismiss flag' : 'Mark as actioned'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              loading={resolve.isPending}
              disabled={note.trim().length < 3}
              onClick={() => resolve.mutate({ id: resolving!.flag.id, status: resolving!.status, note: note.trim() }, { onSuccess: () => setResolving(null) })}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Note" hint={resolving?.status === 'ACTIONED' ? 'What did you do? (e.g. restricted the account, asked for documents)' : 'Why is this fine? (e.g. shared office network)'}>
          <textarea className="input h-24 resize-none py-2" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}
