import { type ReactNode, useRef } from 'react'
import { Sparkles, Trash2, Upload } from 'lucide-react'
import { Button, cn, InlineAlert, StatusChip, Thumb } from './ui'

/* ───────────── Timeline ───────────── */

export type TimelineEvent = { type: string; detail: string; at: string; tone?: 'primary' | 'accent' | 'info' | 'success' | 'danger' }

const dot = { primary: 'bg-primary', accent: 'bg-accent', info: 'bg-info', success: 'bg-success', danger: 'bg-danger' }

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex w-4 flex-col items-center">
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', dot[e.tone ?? 'primary'])} />
            {i < events.length - 1 && <span className="w-0.5 flex-1 bg-border" />}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex justify-between gap-4">
              <p className="t-label-s">{e.type}</p>
              <time className="font-mono text-xs font-medium text-text-muted">{e.at}</time>
            </div>
            <p className="t-body-s text-text-muted">{e.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ───────────── SimpleBarChart ───────────── */

/** Horizontal bars, one hue, values labelled directly — no legend or axis needed. */
export function SimpleBarChart({ data, unit }: { data: Array<{ label: string; value: number }>; unit: string }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <ul className="flex flex-col gap-3">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[140px_1fr_120px] items-center gap-3">
          <span className="t-body-s truncate">{d.label}</span>
          <span className="h-2.5 rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="t-body-s text-right tabular-nums">
            {d.value.toLocaleString('en')} {unit} <span className="text-text-muted">· {Math.round((d.value / total) * 100)}%</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ───────────── ImageAssetPanel ───────────── */

type AssetProps = {
  title: string
  /** Tailwind aspect class, e.g. "aspect-[2/3]". */
  aspect: string
  present: boolean
  seed?: number
  src?: string
  constraints: string
  status?: string
  error?: string
  busy?: boolean
  onUpload: (file: File) => void
  onRemove?: () => void
  onGenerate?: () => void
  generateLabel?: string
  footer?: ReactNode
}

export function ImageAssetPanel({ title, aspect, present, seed, src, constraints, status, error, busy, onUpload, onRemove, onGenerate, generateLabel, footer }: AssetProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
      <header className="flex items-center justify-between gap-3">
        <h3 className="t-h4">{title}</h3>
        {status ? <StatusChip value={status} /> : <StatusChip value={present ? 'ready' : 'missing'} label={present ? 'Present' : 'Missing'} />}
      </header>
      <Thumb seed={seed} src={src} missing={!present} alt={title} className={cn('w-full', aspect, busy && 'animate-pulse')} />
      {error && (
        <InlineAlert tone="danger" title="Preview failed">
          {error}
        </InlineAlert>
      )}
      <p className="t-caption text-text-muted">{constraints}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={Upload} disabled={busy} onClick={() => input.current?.click()}>
          {present ? 'Replace' : 'Upload'}
        </Button>
        {onGenerate && (
          <Button variant="secondary" icon={Sparkles} loading={busy} onClick={onGenerate}>
            {generateLabel ?? 'Generate preview'}
          </Button>
        )}
        {onRemove && present && (
          <Button variant="tertiary" icon={Trash2} disabled={busy} onClick={onRemove} className="text-danger hover:bg-danger-soft">
            Remove
          </Button>
        )}
      </div>
      {footer}
    </section>
  )
}
