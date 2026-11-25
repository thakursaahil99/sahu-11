import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Inbox, Loader2, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ─── Button ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-bg hover:bg-accent-deep shadow-[0_6px_20px_-8px_rgba(34,224,107,0.6)]',
  secondary: 'bg-raised text-text border border-line-strong hover:border-muted',
  ghost: 'text-muted hover:text-text hover:bg-raised',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANT[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray';
const TONE: Record<Tone, string> = {
  green: 'bg-accent/12 text-accent ring-accent/25',
  red: 'bg-danger/12 text-danger ring-danger/25',
  amber: 'bg-warning/12 text-warning ring-warning/25',
  blue: 'bg-info/12 text-info ring-info/25',
  gray: 'bg-muted/10 text-muted ring-muted/20',
};
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap', TONE[tone])}>{children}</span>;
}

/** Consistent colours for the many status enums. */
export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = /^(ACTIVE|SUCCESS|VERIFIED|COMPLETED|RESOLVED|OPEN_OK)$/.test(status)
    ? 'green'
    : /^(SUSPENDED|FAILED|REJECTED|CANCELLED|ABANDONED|DELETED)$/.test(status)
      ? 'red'
      : /^(PENDING|RESTRICTED|SELF_EXCLUDED|LOCKED|LIVE|AWAITING_USER|OPEN)$/.test(status)
        ? 'amber'
        : /^(UPCOMING)$/.test(status)
          ? 'blue'
          : 'gray';
  return <Badge tone={tone}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

// ─── Layout bits ────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-sm font-bold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 className="size-5 animate-spin text-accent" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Inbox className="size-8 text-faint" />
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      <CircleAlert className="size-4 shrink-0" />
      <span className="flex-1">{error instanceof Error ? error.message : 'Something went wrong'}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead className="border-b border-line bg-bg/40">
          <tr>
            {head.map((h) => (
              <th key={h} className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'warning' | 'danger' | 'info'; icon?: ReactNode }) {
  const ring = tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'info' ? 'text-info' : 'text-accent';
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
        <span className={ring}>{icon}</span>
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg-deep/80 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('card relative w-full shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-raised hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirm with a required reason (cancel, suspend, reject…). */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
    }
  }, [open]);
  const submit = async () => {
    if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="mb-4 text-sm text-muted">{description}</div>}
      <Field label="Reason (recorded in the audit log)" error={error}>
        <textarea className="input h-24 resize-none py-2" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

// ─── Toasts ─────────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  text: string;
}
const ToastCtx = createContext<(kind: ToastItem['kind'], text: string) => void>(() => undefined);
export const useToast = () => {
  const push = useContext(ToastCtx);
  return { success: (t: string) => push('success', t), error: (t: string) => push('error', t) };
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const id = useRef(0);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const t = { id: ++id.current, kind, text };
    setItems((s) => [...s, t]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="card pointer-events-auto flex items-center gap-2.5 px-4 py-3 text-sm shadow-xl">
            {t.kind === 'success' ? <CircleCheck className="size-4 text-accent" /> : <CircleAlert className="size-4 text-danger" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export const money = (n: number, currency: string = 'INR') =>
  currency === 'INR' ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : currency === 'DEMO' ? `${n.toLocaleString('en-IN')} DC` : n.toLocaleString('en-IN');
export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export function ago(d: string | Date) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
