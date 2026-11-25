import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, TriangleAlert, X } from 'lucide-react';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, PageHeader, ReasonDialog, Spinner, StatusBadge, Table } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAction } from '@/lib/hooks';

interface KycRow {
  userId: string;
  status: string;
  fullName: string;
  panMasked: string;
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  panSharedWithOtherAccount: boolean;
  user: { id: string; name: string; email: string | null; phone: string | null; dob: string; createdAt: string };
}

export function KycPage() {
  const [status, setStatus] = useState('PENDING');
  const q = useQuery({ queryKey: ['/admin/kyc', status], queryFn: () => api<KycRow[]>(`/admin/kyc${qs({ status })}`) });
  const [rejecting, setRejecting] = useState<KycRow | null>(null);
  const review = useAction((v: { userId: string; approve: boolean; note?: string }) => api(`/admin/kyc/${v.userId}/review`, { method: 'POST', body: { approve: v.approve, note: v.note } }), {
    success: 'KYC reviewed — the user has been notified',
    invalidate: ['/admin/kyc', '/admin/overview'],
  });

  return (
    <>
      <PageHeader
        title="KYC review"
        subtitle="Match the name on the PAN with the account. A PAN used on another account is a strong multi-account signal."
        actions={
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        }
      />
      <Card padded={false}>
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <ErrorBox error={q.error} />
          </div>
        ) : q.data.length === 0 ? (
          <Empty title={status === 'PENDING' ? 'Queue is empty' : 'Nothing here'}>New submissions appear here.</Empty>
        ) : (
          <Table head={['Account', 'Name on PAN', 'PAN', 'Submitted', 'Status', '']}>
            {q.data.map((k) => (
              <tr key={k.userId}>
                <td className="td">
                  <Link to={`/users/${k.userId}`} className="font-semibold hover:text-accent">
                    {k.user.name}
                  </Link>
                  <div className="text-xs text-faint">
                    {k.user.email ?? k.user.phone} · DOB {k.user.dob.slice(0, 10)}
                  </div>
                </td>
                <td className="td">
                  {k.fullName}
                  {k.fullName.toLowerCase() !== k.user.name.toLowerCase() && (
                    <div className="mt-0.5">
                      <Badge tone="amber">differs from account name</Badge>
                    </div>
                  )}
                </td>
                <td className="td font-mono">
                  {k.panMasked}
                  {k.panSharedWithOtherAccount && (
                    <div className="mt-0.5">
                      <Badge tone="red">
                        <TriangleAlert className="size-3" /> on another account
                      </Badge>
                    </div>
                  )}
                </td>
                <td className="td text-muted">{dateTime(k.submittedAt)}</td>
                <td className="td">
                  <StatusBadge status={k.status} />
                  {k.reviewNote && <div className="mt-0.5 text-xs text-faint">{k.reviewNote}</div>}
                </td>
                <td className="td text-right">
                  {k.status === 'PENDING' && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="danger" icon={<X className="size-3.5" />} onClick={() => setRejecting(k)}>
                        Reject
                      </Button>
                      <Button size="sm" icon={<Check className="size-3.5" />} loading={review.isPending && review.variables?.userId === k.userId} onClick={() => review.mutate({ userId: k.userId, approve: true })}>
                        Verify
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
        title="Reject KYC"
        description="The user sees this note and can resubmit. Be specific, e.g. “Name doesn’t match the PAN”."
        confirmLabel="Reject"
        onClose={() => setRejecting(null)}
        onConfirm={(note) => review.mutateAsync({ userId: rejecting!.userId, approve: false, note })}
      />
    </>
  );
}
