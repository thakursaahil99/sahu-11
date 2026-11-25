import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Megaphone, Send } from 'lucide-react';
import { announcementSchema } from '@dream11/shared';
import { Badge, Button, Card, dateTime, Empty, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';

interface Announcement {
  id: string;
  title: string;
  body: string;
  url: string | null;
  audience: string;
  promotional: boolean;
  recipients: number;
  createdBy: string;
  createdAt: string;
}

export function AnnouncementsPage() {
  const q = useQuery({ queryKey: ['/admin/announcements'], queryFn: () => api<Announcement[]>('/admin/announcements') });
  const [f, setF] = useState({ title: '', body: '', url: '', audience: 'ALL' as 'ALL' | 'ACTIVE_30D', promotional: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useAction((body: unknown) => api<Announcement>('/admin/announcements', { method: 'POST', body }), { invalidate: ['/admin/announcements'] });

  const submit = () => {
    const p = announcementSchema.safeParse(f);
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    send.mutate(p.data, {
      onSuccess: () => setF({ title: '', body: '', url: '', audience: 'ALL', promotional: false }),
      onError: (e) => e instanceof ApiError && setErrors(e.fields),
    });
  };

  return (
    <>
      <PageHeader title="Announcements" subtitle="Sends to every player’s notification centre and, where allowed, as a push notification." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="New announcement" className="lg:col-span-2">
          <div className="space-y-4">
            <Field label="Title" error={errors.title}>
              <input className="input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Message" error={errors.body} hint={`${f.body.length}/240`}>
              <textarea className="input h-24 resize-none py-2" maxLength={240} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            </Field>
            <Field label="Opens (optional)" error={errors.url} hint="An in-app path, e.g. /home or /match/<id>">
              <input className="input font-mono" placeholder="/home" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
            </Field>
            <Field label="Audience">
              <select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as typeof f.audience })}>
                <option value="ALL">All players</option>
                <option value="ACTIVE_30D">Active in the last 30 days</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[#22e06b]" checked={f.promotional} onChange={(e) => setF({ ...f, promotional: e.target.checked })} />
              <span>
                Promotional
                <span className="block text-xs text-faint">Pushed only to players who opted in to offers; never sent to players on a break or restricted.</span>
              </span>
            </label>

            {(f.title || f.body) && (
              <div className="rounded-xl border border-line bg-bg p-3">
                <p className="mb-2 text-[10px] font-bold tracking-widest text-faint uppercase">Preview</p>
                <div className="flex gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-warning/15">
                    <Megaphone className="size-4 text-warning" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{f.title || 'Title'}</p>
                    <p className="text-xs text-muted">{f.body || 'Message'}</p>
                  </div>
                </div>
              </div>
            )}
            <Button className="w-full" icon={<Send className="size-4" />} loading={send.isPending} onClick={submit}>
              Send announcement
            </Button>
            {send.data && <p className="text-center text-sm text-accent">Sent to {send.data.recipients.toLocaleString('en-IN')} players</p>}
          </div>
        </Card>
        <Card title="Sent" className="lg:col-span-3" padded={false}>
          {q.isPending ? (
            <Spinner />
          ) : q.isError ? (
            <div className="p-4">
              <ErrorBox error={q.error} />
            </div>
          ) : q.data.length === 0 ? (
            <Empty title="Nothing sent yet" />
          ) : (
            <ul className="divide-y divide-line">
              {q.data.map((a) => (
                <li key={a.id} className="flex gap-3 px-5 py-4">
                  <Bell className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{a.title}</p>
                      {a.promotional && <Badge tone="amber">promo</Badge>}
                      <Badge>{a.audience === 'ALL' ? 'all players' : 'active 30d'}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{a.body}</p>
                    <p className="mt-1 text-xs text-faint">
                      {dateTime(a.createdAt)} · {a.createdBy} · {a.recipients.toLocaleString('en-IN')} recipients{a.url ? ` · opens ${a.url}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
