import { type ReactNode, useEffect } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  AlertCircle,
  Camera,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Info,
  Lock,
  type LucideIcon,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { Button, cn, Thumb } from './ui'
import { type Mode, modes } from '../data/customer'

/* ───────────── Brand + header ───────────── */

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-sm text-white', dark ? 'bg-stage-primary' : 'bg-primary')}>
        <Camera size={16} aria-hidden />
      </span>
      <span className={cn('font-display text-lg font-bold', dark ? 'text-stage-text' : 'text-text')}>NXBooth</span>
    </span>
  )
}

/** Credits pill — Plenty / Low / Zero (Figma: CreditsPill). */
export function CreditsPill({ credits }: { credits: number }) {
  const tone = credits === 0 ? 'bg-surface-2 text-text-muted' : credits === 1 ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-text'
  const label = credits === 0 ? '0 credits' : credits === 1 ? '1 credit left' : `${credits} AI credits`
  return (
    <span className={cn('t-label-s inline-flex h-8 items-center gap-1.5 rounded-full px-3', tone)}>
      <Zap size={16} aria-hidden />
      {label}
    </span>
  )
}

export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <span aria-hidden className="t-label-xs inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" style={{ width: size, height: size }}>
      {initials}
    </span>
  )
}

export function CustomerHeader({
  credits,
  signedIn,
  centered,
  minimal,
}: {
  credits?: number
  signedIn?: boolean
  centered?: boolean
  minimal?: boolean
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className={cn('mx-auto flex h-14 w-full max-w-6xl items-center px-4 md:px-8', centered ? 'justify-center' : 'justify-between')}>
        <Link to="/app" aria-label="NXBooth home">
          <Logo />
        </Link>
        {!centered && (
          <>
            {!minimal && (
              <nav aria-label="Main" className="ml-8 mr-auto hidden gap-6 md:flex">
                {[
                  ['/app', 'Create'],
                  ['/app/account/creations', 'My Creations'],
                ].map(([to, label]) => (
                  <NavLink key={to} to={to} end={to === '/app'} className={({ isActive }) => cn('t-label-s', isActive ? 'text-primary' : 'text-text-muted hover:text-text')}>
                    {label}
                  </NavLink>
                ))}
              </nav>
            )}
            <div className="flex items-center gap-2">
              {credits !== undefined && <CreditsPill credits={credits} />}
              {signedIn ? (
                <Link to="/app/account/creations" aria-label="Account">
                  <Avatar initials="AR" />
                </Link>
              ) : (
                !minimal && (
                  <Link to="/app/signin" className="t-label-s inline-flex h-10 items-center rounded-sm px-3.5 text-primary hover:bg-primary-soft">
                    Sign in
                  </Link>
                )
              )}
            </div>
          </>
        )}
      </div>
    </header>
  )
}

export function Page({ children, narrow, className }: { children: ReactNode; narrow?: boolean; className?: string }) {
  return <main className={cn('mx-auto w-full px-4 pb-32 pt-4 md:px-8 md:pt-8', narrow ? 'max-w-xl' : 'max-w-6xl', className)}>{children}</main>
}

/** Sticky bottom CTA on mobile; inline on desktop (Figma: "CTA moves inline"). */
export function StickyCta({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface p-4 md:static md:border-0 md:bg-transparent md:p-0 md:pt-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-stretch gap-2 md:items-end md:px-0">
        {note && <p className="t-caption text-center text-text-muted md:text-right">{note}</p>}
        {children}
      </div>
    </div>
  )
}

export function BigButton({
  children,
  icon: Icon,
  variant = 'primary',
  ...rest
}: { children: ReactNode; icon?: LucideIcon; variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button variant={variant} icon={Icon} className="!h-12 w-full !rounded-md px-5 !text-base md:w-auto md:min-w-48" {...rest}>
      {children}
    </Button>
  )
}

/* ───────────── Stepper ───────────── */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? 'complete' : i === current ? 'current' : 'upcoming'
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                't-label-xs flex h-7 w-7 items-center justify-center rounded-full',
                state === 'upcoming' ? 'bg-surface-2 text-text-muted' : 'bg-primary text-white',
              )}
            >
              {state === 'complete' ? <Check size={14} aria-hidden /> : i + 1}
            </span>
            <span className={cn('t-label-s', state === 'current' ? 'text-text' : 'text-text-muted')}>{label}</span>
            {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-5 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}

export function ModeBadge({ mode }: { mode: Mode }) {
  const tone = { classic: 'bg-classic-soft text-classic', basic: 'bg-basic-soft text-basic', advanced: 'bg-primary-soft text-primary' }[mode]
  return <span className={cn('t-label-xs inline-flex h-6 items-center rounded-full px-2', tone)}>{modes[mode].name}</span>
}

/* ───────────── Mode card ───────────── */

const modeTile: Record<Mode, { bg: string; fg: string; icon: LucideIcon }> = {
  classic: { bg: 'bg-classic-soft', fg: 'text-classic', icon: ImageIcon },
  basic: { bg: 'bg-basic-soft', fg: 'text-basic', icon: Camera },
  advanced: { bg: 'bg-primary-soft', fg: 'text-primary', icon: Zap },
}

export function ModeCard({ mode, disabledNote, onClick, to }: { mode: Mode; disabledNote?: string; onClick?: () => void; to?: string }) {
  const m = modes[mode]
  const tile = modeTile[mode]
  const Glyph = tile.icon
  const disabled = Boolean(disabledNote)
  const body = (
    <>
      <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-md', tile.bg, tile.fg)}>
        <Glyph size={28} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="t-h4">{m.name}</span>
          <span className={cn('t-label-xs inline-flex h-6 items-center rounded-full px-2', m.free ? 'bg-success-soft text-success' : 'bg-accent-soft text-text')}>{m.price}</span>
        </span>
        <span className="t-body-s block text-text-muted">{disabled ? disabledNote : m.blurb}</span>
      </span>
      {disabled ? <Lock size={20} className="text-text-muted" aria-hidden /> : <ChevronRight size={20} className="text-text-muted" aria-hidden />}
    </>
  )
  const cls = cn(
    'flex w-full items-center gap-4 rounded-md border border-border bg-surface p-4 text-left transition-shadow',
    disabled ? 'cursor-not-allowed opacity-70' : 'hover:shadow-e2',
  )
  if (to && !disabled)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    )
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cls} aria-disabled={disabled}>
      {body}
    </button>
  )
}

/* ───────────── Catalog card ───────────── */

export function CatalogCard({
  title,
  blurb,
  seed,
  selected,
  disabled,
  tag,
  tall,
  onSelect,
}: {
  title: string
  blurb: string
  seed: number
  selected?: boolean
  disabled?: boolean
  tag?: string
  tall?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('group flex min-w-0 flex-col gap-2 text-left', disabled && 'cursor-not-allowed')}
    >
      <span className={cn('relative block overflow-hidden rounded-md border-[3px]', selected ? 'border-primary' : 'border-transparent')}>
        <Thumb seed={seed} alt={title} className={cn('w-full !rounded-none', tall ? 'aspect-[171/284]' : 'aspect-[171/256]', disabled && 'opacity-40 grayscale')} />
        {tag && <span className="t-label-xs absolute left-2 top-2 rounded-full bg-surface px-2 py-1 text-text">{tag}</span>}
        {selected && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
            <Check size={14} aria-hidden />
          </span>
        )}
        {disabled && <Lock size={20} className="absolute right-2 top-2 text-white drop-shadow" aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className={cn('t-label-s block truncate', disabled ? 'text-text-muted' : 'text-text')}>{title}</span>
        <span className="t-caption block truncate text-text-muted">{blurb}</span>
      </span>
    </button>
  )
}

export function FilterChip({ label, selected, disabled, onClick }: { label: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        't-label-s h-8 shrink-0 rounded-full px-3.5',
        selected ? 'bg-primary text-white' : 'bg-surface-2 text-text',
        disabled && 'cursor-not-allowed text-text-muted',
      )}
    >
      {label}
    </button>
  )
}

/* ───────────── Photo dropzone ───────────── */

export type DropzoneState = 'idle' | 'dragging' | 'uploading'

export function PhotoDropzone({ state = 'idle', progress = 64, onTake, onUpload }: { state?: DropzoneState; progress?: number; onTake?: () => void; onUpload?: () => void }) {
  const title = state === 'dragging' ? 'Drop to upload' : state === 'uploading' ? `Uploading… ${progress}%` : 'Add your photo'
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-6 text-center', state === 'dragging' ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary">
        <ImageIcon size={28} aria-hidden />
      </span>
      <p className="t-h4">{title}</p>
      <p className="t-caption max-w-[260px] text-text-muted">JPG, PNG, WebP or HEIC · up to 12 MB · kept for 24 hours</p>
      {state === 'uploading' && (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-56 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      )}
      {state === 'idle' && (
        <div className="flex w-full max-w-[286px] gap-2">
          <Button icon={Camera} className="!h-12 flex-1" onClick={onTake}>
            Take photo
          </Button>
          <Button variant="secondary" icon={Upload} className="!h-12 flex-1" onClick={onUpload}>
            Upload photo
          </Button>
        </div>
      )}
    </div>
  )
}

/* ───────────── Toast card (static, from Figma "Toast") ───────────── */

const toastTone = {
  success: { icon: Check, cls: 'text-success' },
  error: { icon: AlertCircle, cls: 'text-danger' },
  warning: { icon: AlertCircle, cls: 'text-warning' },
  info: { icon: Info, cls: 'text-info' },
}

export function ToastCard({ tone, title, body }: { tone: keyof typeof toastTone; title: string; body?: string }) {
  const T = toastTone[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex w-[360px] max-w-full items-start gap-3 rounded-md border border-border bg-surface p-4 shadow-e2">
      <T.icon size={20} className={cn('mt-0.5 shrink-0', T.cls)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="t-label-s">{title}</p>
        {body && <p className="t-caption mt-0.5 text-text-muted">{body}</p>}
      </div>
    </div>
  )
}

/* ───────────── Bottom sheet / dialog ───────────── */

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-text/50 md:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-lg bg-surface p-5 pb-6 shadow-e2 md:rounded-lg"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="t-h3">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-sm p-1 text-text-muted hover:bg-surface-2">
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Centered status block used by processing, failed, error and empty screens. */
export function StatusBlock({
  icon: Icon,
  tone = 'primary',
  title,
  body,
  dark,
  children,
}: {
  icon: LucideIcon
  tone?: 'primary' | 'warning' | 'info' | 'danger' | 'success'
  title: string
  body?: ReactNode
  dark?: boolean
  children?: ReactNode
}) {
  const light = { primary: 'bg-primary-soft text-primary', warning: 'bg-warning-soft text-warning', info: 'bg-info-soft text-info', danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success' }
  const stage = { primary: 'bg-stage-primary-soft text-stage-primary', warning: 'bg-stage-warning-soft text-stage-warning', info: 'bg-stage-info-soft text-stage-info', danger: 'bg-stage-danger-soft text-stage-danger', success: 'bg-stage-success-soft text-stage-success' }
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-16 text-center">
      <span className={cn('flex h-[72px] w-[72px] items-center justify-center rounded-full', (dark ? stage : light)[tone])}>
        <Icon size={32} aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className={cn('t-h2', dark && 'text-stage-text')}>{title}</h1>
        {body && <p className={cn('t-body', dark ? 'text-stage-muted' : 'text-text-muted')}>{body}</p>}
      </div>
      {children}
    </div>
  )
}
