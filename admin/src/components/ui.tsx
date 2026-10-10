import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react'
import {
  AlertCircle,
  Ban,
  Check,
  Clock,
  Copy,
  Image as ImageIcon,
  Info,
  Loader2,
  type LucideIcon,
  TriangleAlert,
  X,
} from 'lucide-react'

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/* ───────────── Button ───────────── */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
  size?: 'md' | 'sm'
  icon?: LucideIcon
  loading?: boolean
}

const buttonVariants = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  tertiary: 'text-primary hover:bg-primary-soft',
  destructive: 'bg-danger text-white hover:bg-danger-hover',
}

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  const Glyph = loading ? Loader2 : Icon
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        't-label-s inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm transition-colors',
        size === 'md' ? 'h-10 px-3.5' : 'h-8 px-2.5',
        buttonVariants[variant],
        'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-2 disabled:text-text-muted',
        className,
      )}
      {...rest}
    >
      {Glyph && <Glyph size={16} className={loading ? 'animate-spin' : undefined} aria-hidden />}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-60',
        className,
      )}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}

/* ───────────── Chips ───────────── */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary' | 'accent' | 'classic' | 'basic'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text-muted',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-text',
  classic: 'bg-classic-soft text-classic',
  basic: 'bg-basic-soft text-basic',
}

export function Chip({ tone = 'neutral', icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={cn('t-label-xs inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2', toneClass[tone])}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  )
}

/** Status is never colour-only: every state carries an icon and a label. */
const statusMap: Record<string, { tone: Tone; icon: LucideIcon; label: string }> = {
  queued: { tone: 'neutral', icon: Clock, label: 'Queued' },
  processing: { tone: 'info', icon: Loader2, label: 'Processing' },
  completed: { tone: 'success', icon: Check, label: 'Completed' },
  success: { tone: 'success', icon: Check, label: 'Success' },
  failed: { tone: 'danger', icon: X, label: 'Failed' },
  not_applicable: { tone: 'neutral', icon: Ban, label: 'Not applicable' },
  reserved: { tone: 'warning', icon: Clock, label: 'Reserved' },
  spent: { tone: 'accent', icon: Check, label: 'Spent' },
  refunded: { tone: 'success', icon: Check, label: 'Refunded' },
  active: { tone: 'success', icon: Check, label: 'Active' },
  inactive: { tone: 'neutral', icon: Ban, label: 'Inactive' },
  suspended: { tone: 'danger', icon: Ban, label: 'Suspended' },
  cancelled: { tone: 'neutral', icon: X, label: 'Cancelled' },
  expired: { tone: 'neutral', icon: Clock, label: 'Expired' },
  revoked: { tone: 'danger', icon: X, label: 'Revoked' },
  draft: { tone: 'neutral', icon: Clock, label: 'Draft' },
  published: { tone: 'success', icon: Check, label: 'Published' },
  disabled: { tone: 'danger', icon: Ban, label: 'Disabled' },
  enabled: { tone: 'success', icon: Check, label: 'Enabled' },
  missing: { tone: 'warning', icon: TriangleAlert, label: 'Missing' },
  generating: { tone: 'info', icon: Loader2, label: 'Generating' },
  ready: { tone: 'success', icon: Check, label: 'Ready' },
  estimated: { tone: 'info', icon: Info, label: 'Estimated' },
  unavailable: { tone: 'neutral', icon: Ban, label: 'Unavailable' },
}

export function StatusChip({ value, label }: { value: string; label?: string }) {
  const s = statusMap[value.toLowerCase()] ?? { tone: 'neutral' as Tone, icon: Info, label: value }
  return (
    <Chip tone={s.tone} icon={s.icon}>
      {label ?? s.label}
    </Chip>
  )
}

export function ModeChip({ mode }: { mode: 'classic' | 'basic' | 'advanced' }) {
  const tone: Tone = mode === 'advanced' ? 'primary' : mode
  return <Chip tone={tone}>{mode[0].toUpperCase() + mode.slice(1)}</Chip>
}

/* ───────────── Layout primitives ───────────── */

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-surface p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="t-h4">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="t-h2">{title}</h1>
        {subtitle && <p className="t-body-s mt-1 text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

export function StatTile({ label, value, hint, hintTone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; hintTone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info' }) {
  const hintClass = { neutral: 'text-text-muted', success: 'text-success', danger: 'text-danger', warning: 'text-warning', info: 'text-info' }[hintTone]
  return (
    <div className="min-w-0 flex-1 rounded-md border border-border bg-surface p-5">
      <p className="t-body-s truncate text-text-muted">{label}</p>
      <p className="t-h2 mt-1.5 tabular-nums">{value}</p>
      {hint && <p className={cn('t-caption mt-1.5 font-medium', hintClass)}>{hint}</p>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-7 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            't-label-s -mb-px border-b-2 px-1 pb-2.5 pt-3',
            value === t.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────── Form fields ───────────── */

export function Field({ label, helper, error, children, htmlFor }: { label: string; helper?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="t-label-s">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="t-caption text-danger">
          {error}
        </p>
      ) : (
        helper && <p className="t-caption text-text-muted">{helper}</p>
      )}
    </div>
  )
}

const controlClass =
  't-body-s w-full rounded-sm border border-border bg-surface px-3 text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-surface-2 disabled:text-text-muted'

type WithField = { label: string; helper?: ReactNode; error?: ReactNode }

export function TextField({ label, helper, error, className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & WithField & { mono?: boolean }) {
  const id = useId()
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <input id={id} aria-invalid={!!error} className={cn(controlClass, 'h-10', mono && 'font-mono', !!error && 'border-danger', className)} {...rest} />
    </Field>
  )
}

export function TextArea({ label, helper, error, className, mono, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & WithField & { mono?: boolean }) {
  const id = useId()
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <textarea id={id} aria-invalid={!!error} rows={4} className={cn(controlClass, 'py-2.5', mono && 'font-mono', !!error && 'border-danger', className)} {...rest} />
    </Field>
  )
}

export function SelectField({ label, helper, error, options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & WithField & { options: Array<{ value: string; label: string }> }) {
  const id = useId()
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <select id={id} className={cn(controlClass, 'h-10 pr-8', className)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Unlabelled select for filter bars — pass an aria-label. */
export function InlineSelect({ options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select className={cn(controlClass, 'h-10 w-auto pr-8', className)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-border')}
    >
      <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-e1 transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}

export function SwitchRow({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-sm border border-border px-3.5 py-3">
      <div>
        <p className="t-label-s">{label}</p>
        {description && <p className="t-caption mt-0.5 text-text-muted">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}

/** Multi-select with an explicit "All" option (empty array = all). */
export function MultiSelectAll({ label, helper, options, value, onChange }: { label: string; helper?: string; options: Array<{ id: string; name: string }>; value: string[]; onChange: (next: string[]) => void }) {
  const all = value.length === 0
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  const pill = (active: boolean) =>
    cn('t-label-s h-8 rounded-full px-3.5', active ? 'bg-primary text-white' : 'bg-surface-2 text-text hover:bg-border')
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="t-label-s mb-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={all} className={pill(all)} onClick={() => onChange([])}>
          All
        </button>
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value.includes(o.id)} className={pill(value.includes(o.id))} onClick={() => toggle(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
      {helper && <p className="t-caption text-text-muted">{helper}</p>}
    </fieldset>
  )
}

/* ───────────── Data display ───────────── */

export function CodeValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="t-mono">{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${value}`} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </span>
  )
}

export function KeyValueList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-center gap-4">
          <dt className="t-body-s w-44 shrink-0 text-text-muted">{k}</dt>
          <dd className="t-body-s min-w-0 flex-1">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const alertTone = {
  info: { box: 'bg-info-soft', icon: 'text-info', Icon: Info },
  warning: { box: 'bg-warning-soft', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'bg-danger-soft', icon: 'text-danger', Icon: AlertCircle },
  success: { box: 'bg-success-soft', icon: 'text-success', Icon: Check },
}

export function InlineAlert({ tone = 'info', title, children }: { tone?: keyof typeof alertTone; title?: string; children: ReactNode }) {
  const t = alertTone[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2.5 rounded-sm p-3', t.box)}>
      <t.Icon size={18} className={cn('mt-px shrink-0', t.icon)} aria-hidden />
      <div className="t-body-s min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="t-label-s">{title}</p>
      {body && <p className="t-body-s text-text-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ───────────── Image placeholder ───────────── */

const gradients = [
  ['#FFB88C', '#DE6262'],
  ['#7F7FD5', '#91EAE4'],
  ['#F6D365', '#FDA085'],
  ['#84FAB0', '#8FD3F4'],
  ['#A18CD1', '#FBC2EB'],
  ['#30CFD0', '#330867'],
  ['#FF9A9E', '#FAD0C4'],
  ['#4FACFE', '#00F2FE'],
  ['#43E97B', '#38F9D7'],
  ['#FA709A', '#FEE140'],
  ['#667EEA', '#764BA2'],
  ['#F093FB', '#F5576C'],
]

/**
 * Stand-in for a catalog/result image. Pass `src` once real asset URLs exist;
 * `seed` only picks the placeholder gradient. `missing` renders the no-image state.
 */
export function Thumb({ seed = 0, src, alt = '', missing, className }: { seed?: number; src?: string; alt?: string; missing?: boolean; className?: string }) {
  if (src) return <img src={src} alt={alt} className={cn('rounded-md object-cover', className)} />
  if (missing)
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 rounded-md bg-surface-2 text-text-muted', className)}>
        <ImageIcon size={20} aria-hidden />
        <span className="t-caption">No image</span>
      </div>
    )
  const [a, b] = gradients[Math.abs(seed) % gradients.length]
  return <div role="img" aria-label={alt || 'Placeholder image'} className={cn('rounded-md', className)} style={{ background: `linear-gradient(150deg, ${a}, ${b})` }} />
}
