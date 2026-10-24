import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Check, Info, Search, TriangleAlert, X } from 'lucide-react'
import { Button, cn, InlineAlert, TextArea } from './ui'

/* ───────────── Modal ───────────── */

export function Modal({ title, description, onClose, children, footer, wide }: { title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, select, button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !panel.current) return
      const nodes = panel.current.querySelectorAll<HTMLElement>('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])')
      const list = Array.from(nodes).filter((n) => !n.hasAttribute('disabled'))
      if (!list.length) return
      const firstNode = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === firstNode) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), firstNode.focus())
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#12131F]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('flex max-h-[90vh] w-full flex-col rounded-lg bg-surface shadow-e2', wide ? 'max-w-2xl' : 'max-w-[480px]')}>
        <header className="flex items-start justify-between gap-4 px-7 pt-7">
          <div>
            <h2 id={titleId} className="t-h3">
              {title}
            </h2>
            {description && <p className="t-body-s mt-1.5 text-text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text">
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto px-7 py-5">{children}</div>
        <footer className="flex justify-end gap-3 px-7 pb-7">{footer}</footer>
      </div>
    </div>
  )
}

/* ───────────── ConfirmDialog ───────────── */

type ConfirmProps = {
  title: string
  description?: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** Admin financial/status mutations need a 3–1000 character reason plus `confirm: true`. */
  requireReason?: boolean
  /** Text for the explicit confirmation checkbox. */
  confirmText?: string
  /** Server rejection to show inline, e.g. CREDIT_ADJUSTMENT_REJECTED. */
  error?: string
  children?: ReactNode
  disabled?: boolean
  onConfirm: (reason: string) => void | Promise<void>
  onClose: () => void
}

export function ConfirmDialog({ title, description, confirmLabel, destructive, requireReason, confirmText, error, children, disabled, onConfirm, onClose }: ConfirmProps) {
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const len = reason.trim().length
  const reasonOk = !requireReason || (len >= 3 && len <= 1000)
  const ready = reasonOk && checked && !disabled

  const submit = async () => {
    setBusy(true)
    try {
      await onConfirm(reason.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} disabled={!ready} loading={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requireReason && (
        <TextArea
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          helper={`3–1000 characters. Recorded in the audit log. ${len}/1000`}
          error={len > 0 && len < 3 ? 'Enter at least 3 characters.' : undefined}
        />
      )}
      <label className="t-body-s flex items-start gap-2.5">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        {confirmText ?? 'I confirm this change'}
      </label>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </Modal>
  )
}

/* ───────────── Toasts ───────────── */

type Toast = { id: number; tone: 'success' | 'error' | 'warning' | 'info'; title: string; body?: string; referenceId?: string }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const toastIcon = {
  success: { Icon: Check, cls: 'text-success' },
  error: { Icon: AlertCircle, cls: 'text-danger' },
  warning: { Icon: TriangleAlert, cls: 'text-warning' },
  info: { Icon: Info, cls: 'text-info' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((list) => [...list, { ...t, id }])
      // Errors stay until dismissed so the Reference ID can be copied.
      if (t.tone !== 'error') setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-6 top-[72px] z-50 flex w-[360px] flex-col gap-3">
        {toasts.map((t) => {
          const { Icon, cls } = toastIcon[t.tone]
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex gap-3 rounded-md border border-border bg-surface p-4 shadow-e2">
              <Icon size={20} className={cn('shrink-0', cls)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="t-label-s">{t.title}</p>
                {t.body && <p className="t-body-s text-text-muted">{t.body}</p>}
                {t.referenceId && <p className="mt-0.5 font-mono text-xs font-medium text-text-muted">Reference ID: {t.referenceId}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="h-fit rounded p-0.5 text-text-muted hover:text-text">
                <X size={16} aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

/* ───────────── FilterBar ───────────── */

export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {onReset && (
        <Button variant="tertiary" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn('relative block', className ?? 'w-72')}>
      <span className="sr-only">{placeholder}</span>
      <Search size={16} className="pointer-events-none absolute left-3 top-3 text-text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="t-body-s h-10 w-full rounded-sm border border-border bg-surface pl-9 pr-3 placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </label>
  )
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const cls = 't-body-s h-10 rounded-sm border border-border bg-surface px-3 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
  return (
    <div className="flex items-center gap-2">
      <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className={cls} />
      <span className="t-body-s text-text-muted">to</span>
      <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className={cls} />
    </div>
  )
}
