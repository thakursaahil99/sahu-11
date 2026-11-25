import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { fantasyRulesSchema, type FantasyRules, type ScoringRules, type Slab } from '@dream11/shared';
import { Button, Card, dateTime, ErrorBox, Field, PageHeader, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';

// ─── Scoring ────────────────────────────────────────────────────────────────

interface ScoringRow {
  id: string;
  sport: { key: string; name: string };
  format: string;
  rules: ScoringRules;
  updatedAt: string;
}

const SCALARS: { key: keyof ScoringRules; label: string; group: string }[] = [
  { key: 'playing', label: 'In the playing XI', group: 'General' },
  { key: 'run', label: 'Per run', group: 'Batting' },
  { key: 'boundaryBonus', label: 'Boundary bonus', group: 'Batting' },
  { key: 'sixBonus', label: 'Six bonus', group: 'Batting' },
  { key: 'duck', label: 'Duck (BAT/WK/AR)', group: 'Batting' },
  { key: 'wicket', label: 'Per wicket', group: 'Bowling' },
  { key: 'lbwBowledBonus', label: 'LBW / bowled bonus', group: 'Bowling' },
  { key: 'maiden', label: 'Maiden over', group: 'Bowling' },
  { key: 'catch', label: 'Catch', group: 'Fielding' },
  { key: 'threeCatchBonus', label: '3-catch bonus', group: 'Fielding' },
  { key: 'stumping', label: 'Stumping', group: 'Fielding' },
  { key: 'runOutDirect', label: 'Run-out (direct)', group: 'Fielding' },
  { key: 'runOutIndirect', label: 'Run-out (assist)', group: 'Fielding' },
];

export function ScoringPage() {
  const q = useQuery({ queryKey: ['/admin/config/scoring'], queryFn: () => api<ScoringRow[]>('/admin/config/scoring') });
  const [selected, setSelected] = useState<string>();
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const row = q.data.find((r) => r.id === selected) ?? q.data.find((r) => r.format === 'T20') ?? q.data[0];
  const order = ['T20', 'T10', 'ODI'];
  const tabs = [...q.data].sort((a, b) => a.sport.key.localeCompare(b.sport.key) || order.indexOf(a.format) - order.indexOf(b.format));
  return (
    <>
      <PageHeader title="Scoring rules" subtitle="Points per event for each format. Changes apply from the next live update; use “Recompute points” on a match to re-score it now." />
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${row?.id === r.id ? 'border-accent bg-accent/12 text-accent' : 'border-line text-muted hover:text-text'}`}
          >
            {r.sport.name} · {r.format}
          </button>
        ))}
      </div>
      {row && <ScoringEditor key={row.id} row={row} />}
    </>
  );
}

function ScoringEditor({ row }: { row: ScoringRow }) {
  const [r, setR] = useState<ScoringRules>(row.rules);
  const [error, setError] = useState<string>();
  const save = useAction((rules: ScoringRules) => api(`/admin/config/scoring/${row.id}`, { method: 'PUT', body: rules }), { success: `${row.format} scoring saved`, invalidate: ['/admin/config/scoring'] });
  const dirty = JSON.stringify(r) !== JSON.stringify(row.rules);
  const num = (v: string) => (v === '' || v === '-' ? 0 : Number(v));
  const groups = [...new Set(SCALARS.map((s) => s.group))];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <div className="grid grid-cols-2 gap-3">
              {SCALARS.filter((s) => s.group === g).map((s) => (
                <Field key={s.key} label={s.label}>
                  <input className="input tabular-nums" type="number" value={r[s.key] as number} onChange={(e) => setR({ ...r, [s.key]: num(e.target.value) })} />
                </Field>
              ))}
            </div>
          </Card>
        ))}
        <Card title="Milestones (highest reached counts)">
          <PointsMap label="Runs" value={r.battingMilestones} onChange={(v) => setR({ ...r, battingMilestones: v })} />
          <div className="mt-4">
            <PointsMap label="Wickets" value={r.wicketHauls} onChange={(v) => setR({ ...r, wicketHauls: v })} />
          </div>
        </Card>
        <Card title="Economy rate (bowlers)">
          <Slabs minBalls={r.economy.minBalls} slabs={r.economy.slabs} unit="runs/over" onChange={(economy) => setR({ ...r, economy })} />
        </Card>
        <Card title="Strike rate (batters, not bowlers)">
          <Slabs minBalls={r.strikeRate.minBalls} slabs={r.strikeRate.slabs} unit="per 100 balls" onChange={(strikeRate) => setR({ ...r, strikeRate })} />
        </Card>
      </div>
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-raised/95 px-5 py-3 shadow-xl backdrop-blur">
        <span className="text-xs text-faint">Last saved {dateTime(row.updatedAt)}</span>
        <div className="flex items-center gap-2">
          {error && <span className="text-sm text-danger">{error}</span>}
          <Button variant="ghost" disabled={!dirty} icon={<Undo2 className="size-4" />} onClick={() => setR(row.rules)}>
            Discard
          </Button>
          <Button
            disabled={!dirty}
            loading={save.isPending}
            icon={<Save className="size-4" />}
            onClick={() => {
              setError(undefined);
              save.mutate(r, { onError: (e) => e instanceof ApiError && setError(Object.values(e.fields)[0] ?? e.message) });
            }}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function PointsMap({ label, value, onChange }: { label: string; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const entries = Object.entries(value).sort((a, b) => Number(a[0]) - Number(b[0]));
  const update = (list: [string, number][]) => onChange(Object.fromEntries(list.filter(([k]) => /^\d+$/.test(k))));
  return (
    <div>
      <p className="label">{label}</p>
      <div className="space-y-2">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input w-24" type="number" value={k} aria-label={`${label} threshold`} onChange={(e) => update(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
            <span className="text-xs text-faint">→</span>
            <input className="input w-24" type="number" value={v} aria-label={`${label} points`} onChange={(e) => update(entries.map((x, j) => (j === i ? [x[0], Number(e.target.value)] : x)))} />
            <span className="text-xs text-faint">pts</span>
            <button className="rounded-lg p-2 text-faint hover:text-danger" onClick={() => update(entries.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => update([...entries, [String(Number(entries.at(-1)?.[0] ?? 0) + 1), 0]])}>
          Add
        </Button>
      </div>
    </div>
  );
}

function Slabs({ minBalls, slabs, unit, onChange }: { minBalls: number; slabs: Slab[]; unit: string; onChange: (v: { minBalls: number; slabs: Slab[] }) => void }) {
  const set = (i: number, patch: Partial<Slab>) => onChange({ minBalls, slabs: slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const opt = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div>
      <Field label="Applies after (balls)">
        <input className="input w-28" type="number" min={0} value={minBalls} onChange={(e) => onChange({ minBalls: Number(e.target.value), slabs })} />
      </Field>
      <p className="label mt-4">Bands ({unit}) — leave a bound empty for open-ended</p>
      <div className="space-y-2">
        {slabs.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input w-20" type="number" placeholder="min" value={s.min ?? ''} aria-label="From" onChange={(e) => set(i, { min: opt(e.target.value) })} />
            <span className="text-faint">–</span>
            <input className="input w-20" type="number" placeholder="max" value={s.max ?? ''} aria-label="To" onChange={(e) => set(i, { max: opt(e.target.value) })} />
            <span className="text-xs text-faint">→</span>
            <input className="input w-20" type="number" value={s.points} aria-label="Points" onChange={(e) => set(i, { points: Number(e.target.value) })} />
            <button className="rounded-lg p-2 text-faint hover:text-danger" onClick={() => onChange({ minBalls, slabs: slabs.filter((_, j) => j !== i) })} aria-label="Remove band">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ minBalls, slabs: [...slabs, { points: 0 }] })}>
          Add band
        </Button>
      </div>
    </div>
  );
}

// ─── Team rules ─────────────────────────────────────────────────────────────

export function TeamRulesPage() {
  const q = useQuery({ queryKey: ['/admin/config/fantasy'], queryFn: () => api<{ sport: { id: string; key: string; name: string; enabled: boolean }; rules: FantasyRules }[]>('/admin/config/fantasy') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader title="Team rules" subtitle="How fantasy teams are built. Saved teams aren’t re-validated; new and edited teams follow the new rules." />
      <div className="space-y-6">
        {q.data.map((s) => (
          <TeamRulesEditor key={s.sport.id} sport={s.sport} rules={s.rules} />
        ))}
      </div>
    </>
  );
}

function TeamRulesEditor({ sport, rules }: { sport: { id: string; name: string; enabled: boolean }; rules: FantasyRules }) {
  const [r, setR] = useState(rules);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setR(rules), [rules]);
  const save = useAction((v: FantasyRules) => api(`/admin/config/fantasy/${sport.id}`, { method: 'PUT', body: v }), { success: `${sport.name} team rules saved`, invalidate: ['/admin/config/fantasy'] });
  const dirty = JSON.stringify(r) !== JSON.stringify(rules);
  const n = (v: string) => Number(v);

  const submit = () => {
    const p = fantasyRulesSchema.safeParse(r);
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    setErrors({});
    save.mutate(r);
  };

  return (
    <Card
      title={`${sport.name}${sport.enabled ? '' : ' (coming soon)'}`}
      actions={
        <Button size="sm" disabled={!dirty} loading={save.isPending} icon={<Save className="size-3.5" />} onClick={submit}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Team size" error={errors.teamSize}>
          <input className="input" type="number" value={r.teamSize} onChange={(e) => setR({ ...r, teamSize: n(e.target.value) })} />
        </Field>
        <Field label="Credits" error={errors.maxCredits}>
          <input className="input" type="number" step={0.5} value={r.maxCredits} onChange={(e) => setR({ ...r, maxCredits: n(e.target.value) })} />
        </Field>
        <Field label="Max from one side" error={errors.maxPerTeam}>
          <input className="input" type="number" value={r.maxPerTeam} onChange={(e) => setR({ ...r, maxPerTeam: n(e.target.value) })} />
        </Field>
        <Field label="Teams per match" error={errors.maxTeamsPerMatch}>
          <input className="input" type="number" value={r.maxTeamsPerMatch} onChange={(e) => setR({ ...r, maxTeamsPerMatch: n(e.target.value) })} />
        </Field>
        <Field label="Captain ×" error={errors.captainMultiplier}>
          <input className="input" type="number" step={0.25} value={r.captainMultiplier} onChange={(e) => setR({ ...r, captainMultiplier: n(e.target.value) })} />
        </Field>
        <Field label="Vice-captain ×" error={errors.viceCaptainMultiplier}>
          <input className="input" type="number" step={0.25} value={r.viceCaptainMultiplier} onChange={(e) => setR({ ...r, viceCaptainMultiplier: n(e.target.value) })} />
        </Field>
      </div>
      <p className="label mt-5">Players per role (min – max)</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {(['WK', 'BAT', 'AR', 'BOWL'] as const).map((role) => (
          <div key={role} className="flex items-center gap-2 rounded-xl border border-line bg-bg/50 px-3 py-2">
            <span className="w-12 text-sm font-bold">{role}</span>
            <input className="input h-8" type="number" aria-label={`${role} min`} value={r.roleLimits[role].min} onChange={(e) => setR({ ...r, roleLimits: { ...r.roleLimits, [role]: { ...r.roleLimits[role], min: n(e.target.value) } } })} />
            <span className="text-faint">–</span>
            <input className="input h-8" type="number" aria-label={`${role} max`} value={r.roleLimits[role].max} onChange={(e) => setR({ ...r, roleLimits: { ...r.roleLimits, [role]: { ...r.roleLimits[role], max: n(e.target.value) } } })} />
          </div>
        ))}
      </div>
      {Object.entries(errors)
        .filter(([k]) => k.startsWith('roleLimits') || k === '_')
        .map(([k, v]) => (
          <p key={k} className="mt-2 text-sm text-danger">
            {v}
          </p>
        ))}
    </Card>
  );
}
