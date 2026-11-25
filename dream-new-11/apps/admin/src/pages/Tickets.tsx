import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Headset, Send } from 'lucide-react';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, PageHeader, Spinner, StatusBadge, Table, ago, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, usePaged } from '@/lib/hooks';

interface TicketRow {
  id: string;
  reference: string;
  category: string;
  subject: string;
  status: string;
  lastMessageAt: string;
  lastMessage: string;
  lastFromStaff: boolean;
  user: { id: string; name: string; email: string | null; phone: string | null };
}

export function TicketsPage() {
  const [status, setStatus] = useState('');
  const list = usePaged<TicketRow>('/admin/tickets', { status: status || undefined });
  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Oldest waiting first. Replying notifies the player."
        actions={
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Needs action (open + awaiting user)</option>
            <option value="OPEN">Open</option>
            <option value="AWAITING_USER">Awaiting user</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        }
      />
      <Card padded={false}>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        ) : list.items.length === 0 ? (
          <Empty title="Inbox zero">No requests need attention.</Empty>
        ) : (
          <Table head={['Request', 'Player', 'Topic', 'Last message', 'Status']}>
            {list.items.map((t) => (
              <tr key={t.id} className="transition hover:bg-raised/40">
                <td className="td">
                  <Link to={`/tickets/${t.id}`} className="font-semibold hover:text-accent">
                    {t.subject}
                  </Link>
                  <div className="font-mono text-[11px] text-faint">{t.reference}</div>
                </td>
                <td className="td">{t.user.name}</td>
                <td className="td">
                  <Badge>{t.category.toLowerCase()}</Badge>
                </td>
                <td className="td max-w-xs">
                  <p className="truncate text-muted">
                    {t.lastFromStaff ? 'You: ' : ''}
                    {t.lastMessage}
                  </p>
                  <p className={cx('text-xs', !t.lastFromStaff && t.status === 'OPEN' && Date.now() - Date.parse(t.lastMessageAt) > 86_400_000 ? 'text-danger' : 'text-faint')}>{ago(t.lastMessageAt)}</p>
                </td>
                <td className="td">
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

interface TicketDetail {
  id: string;
  reference: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string | null; phone: string | null; status: string; createdAt: string };
  messages: { id: string; body: string; fromStaff: boolean; staffName: string | null; createdAt: string }[];
}

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['/admin/tickets', id], queryFn: () => api<TicketDetail>(`/admin/tickets/${id}`) });
  const [text, setText] = useState('');
  const [next, setNext] = useState<'AWAITING_USER' | 'RESOLVED' | 'CLOSED'>('AWAITING_USER');
  const reply = useAction(() => api(`/admin/tickets/${id}/reply`, { method: 'POST', body: { message: text.trim(), status: next } }), { success: 'Reply sent', invalidate: ['/admin/tickets', '/admin/overview'] });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data;

  return (
    <>
      <Link to="/tickets" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Support
      </Link>
      <PageHeader title={t.subject} subtitle={`${t.reference} · ${t.category.toLowerCase()} · opened ${dateTime(t.createdAt)}`} actions={<StatusBadge status={t.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="space-y-4">
              {t.messages.map((m) => (
                <div key={m.id} className={cx('flex', m.fromStaff ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[80%] rounded-2xl px-4 py-3', m.fromStaff ? 'rounded-br-sm bg-accent/15 ring-1 ring-accent/30' : 'rounded-bl-sm bg-raised')}>
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                      {m.fromStaff && <Headset className="size-3" />}
                      {m.fromStaff ? (m.staffName ?? 'Staff') : t.user.name} · {dateTime(m.createdAt)}
                    </p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {t.status !== 'CLOSED' && (
            <Card title="Reply">
              <textarea className="input h-32 resize-y py-2" placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  Then mark as
                  <select className="input h-9 w-auto" value={next} onChange={(e) => setNext(e.target.value as typeof next)}>
                    <option value="AWAITING_USER">Awaiting user</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </label>
                <Button icon={<Send className="size-4" />} loading={reply.isPending} disabled={!text.trim()} onClick={() => reply.mutate(undefined, { onSuccess: () => setText('') })}>
                  Send reply
                </Button>
              </div>
            </Card>
          )}
        </div>
        <Card title="Player">
          <p className="font-semibold">{t.user.name}</p>
          <p className="text-sm text-muted">{t.user.email ?? t.user.phone}</p>
          <div className="mt-2">
            <StatusBadge status={t.user.status} />
          </div>
          <p className="mt-3 text-xs text-faint">Member since {dateTime(t.user.createdAt)}</p>
          <Link to={`/users/${t.user.id}`} className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
            Open profile →
          </Link>
        </Card>
      </div>
    </>
  );
}
