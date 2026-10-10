import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, Clock, Copy, Download, Loader2, QrCode, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Button, cn, Thumb } from '../../components/ui'
import { BigButton, ModeBadge, Page, Sheet, StatusBlock, Logo } from '../../components/customer'
import { useToast } from '../../components/overlays'
import { useCustomer } from '../../lib/customer'

/* ───────────── 7 · Processing (dark stage) ───────────── */

type ProcState = 'queued' | 'processing' | 'failed'

export function Processing() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { mode } = useCustomer()
  const state = (params.get('state') as ProcState) || 'queued'
  const hold = params.has('hold')

  // Polling-only states: advance on a timer unless held for design review.
  useEffect(() => {
    if (hold || state === 'failed') return
    const t = window.setTimeout(
      () => (state === 'queued' ? navigate('/app/processing?state=processing', { replace: true }) : navigate(`/app/result/${mode === 'classic' ? 'classic' : 'ai'}`, { replace: true })),
      state === 'queued' ? 2500 : 4000,
    )
    return () => window.clearTimeout(t)
  }, [state, hold, mode, navigate])

  return (
    <div className="min-h-screen bg-stage-bg text-stage-text">
      <header className="flex h-14 items-center justify-between border-b border-stage-border bg-stage-surface px-4 md:px-8">
        <Logo dark />
        {state !== 'failed' && (
          <span className="t-label-xs inline-flex h-6 items-center gap-1 rounded-full bg-stage-info-soft px-2 text-stage-info">
            {state === 'queued' ? <Clock size={12} aria-hidden /> : <Loader2 size={12} className="animate-spin" aria-hidden />}
            {state === 'queued' ? 'In line' : 'Creating'}
          </span>
        )}
      </header>
      <main className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-16">
        {state === 'queued' && (
          <StatusBlock dark icon={Clock} tone="info" title="In line…" body="You're next. This usually takes under a minute.">
            <p className="t-caption text-stage-muted">You can leave this page. We'll keep working.</p>
          </StatusBlock>
        )}
        {state === 'processing' && (
          <StatusBlock dark icon={Loader2} tone="primary" title="Creating your photo…" body="Still working. Busy moments can take a little longer.">
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-stage-surface-2" role="progressbar" aria-label="Creating">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-stage-primary" />
            </div>
            <p className="t-caption text-stage-muted">You can leave this page. Find it later in My Creations.</p>
          </StatusBlock>
        )}
        {state === 'failed' && (
          <StatusBlock dark icon={TriangleAlert} tone="danger" title="We couldn't create this photo" body="Something went wrong on our side. Your credit was returned.">
            <span className="t-label-s inline-flex h-8 items-center gap-1.5 rounded-full bg-stage-success-soft px-3 text-stage-success">
              <Check size={16} aria-hidden />1 credit returned
            </span>
            <p className="t-mono text-stage-muted">Reference ID: req_7d1e9a40</p>
            <div className="flex w-full flex-col gap-2">
              <BigButton icon={RefreshCw} onClick={() => navigate('/app/processing?state=queued')}>Try again</BigButton>
              <Link to="/app/create/style" className="t-label inline-flex h-12 items-center justify-center rounded-md text-stage-primary hover:bg-stage-primary-soft">
                Choose another style
              </Link>
            </div>
          </StatusBlock>
        )}
      </main>
    </div>
  )
}

/* ───────────── 8 · Result + sheets ───────────── */

/** Deterministic QR-looking grid (visual stand-in until the real QR component is wired). */
export function QrPlaceholder({ size = 192, dark }: { size?: number; dark?: boolean }) {
  const cells = useMemo(() => {
    const n = 25
    const out: boolean[] = []
    let x = 1234567
    for (let i = 0; i < n * n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      out.push(x % 3 === 0)
    }
    const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c > n - 8) || (r > n - 8 && c < 7)
    return out.map((v, i) => (finder(Math.floor(i / n), i % n) ? true : v))
  }, [])
  return (
    <div role="img" aria-label="QR code" className={cn('rounded-md p-3', dark ? 'bg-white' : 'border border-border bg-white')} style={{ width: size, height: size }}>
      <div className="grid h-full w-full" style={{ gridTemplateColumns: 'repeat(25, 1fr)' }}>
        {cells.map((on, i) => (
          <span key={i} className={on ? 'bg-text' : 'bg-white'} />
        ))}
      </div>
    </div>
  )
}

export function Result() {
  const { kind } = useParams()
  const isClassic = kind === 'classic'
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { credits, setCredits } = useCustomer()
  const [sheet, setSheet] = useState<string | null>(params.get('sheet'))
  const name = isClassic ? 'Retro Film Strip' : 'Garden Party'
  const close = () => setSheet(null)

  return (
    <Page className="md:pt-10">
      <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_1fr] md:gap-12">
        <div className="mx-auto w-full max-w-sm md:max-w-none">
          <Thumb seed={isClassic ? 4 : 0} alt={name} className={cn('w-full shadow-e2', isClassic ? 'aspect-[1/3] max-h-[560px] !rounded-md' : 'aspect-[2/3]')} />
        </div>
        <div className="space-y-5 md:pt-6">
          <div className="space-y-2">
            <h1 className="t-h2 md:t-h1">Your photo is ready</h1>
            <p className="t-body-s flex items-center gap-2 text-text-muted">
              <ModeBadge mode={isClassic ? 'classic' : 'basic'} />
              {name} · just now
            </p>
          </div>
          <div className="flex flex-col gap-3 md:max-w-sm">
            <BigButton icon={Download} onClick={() => toast({ tone: 'success', title: 'Download started' })}>Download</BigButton>
            {isClassic && <BigButton variant="secondary" icon={Download}>Download print strip (2×6 in, 300 dpi)</BigButton>}
            <BigButton variant="secondary" icon={QrCode} onClick={() => setSheet('share')}>Share via QR</BigButton>
          </div>
          <div className="hidden flex-col gap-3 border-t border-border pt-5 md:flex md:max-w-sm">
            <Button variant="tertiary" onClick={() => { setCredits(credits); navigate('/app') }}>Create another</Button>
            <Button variant="tertiary" icon={Trash2} className="!text-danger hover:!bg-danger-soft" onClick={() => setSheet('delete')}>Delete this photo</Button>
            <p className="t-caption text-text-muted">2160 × 3240 PNG · Saved to My Creations</p>
          </div>
          <div className="flex gap-2 md:hidden">
            <Button variant="tertiary" onClick={() => navigate('/app')}>Create another</Button>
            <Button variant="tertiary" icon={Trash2} className="!text-danger" onClick={() => setSheet('delete')}>Delete</Button>
          </div>
        </div>
      </div>

      {sheet === 'share' && (
        <Sheet title="Share your photo" onClose={close}>
          <div className="space-y-4">
            <p className="t-body-s text-text-muted">Scan the code or send the link.</p>
            <div className="flex justify-center"><QrPlaceholder /></div>
            <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 p-2 pl-3">
              <span className="t-mono min-w-0 flex-1 truncate">nxbooth.gennexbyte.com/r/9fK2…xQ</span>
              <Button variant="secondary" size="sm" icon={Copy} onClick={() => toast({ tone: 'success', title: 'Link copied' })}>Copy</Button>
            </div>
            <p className="t-caption flex items-center gap-1.5 text-text-muted"><Clock size={14} aria-hidden />Link expires in 23 h</p>
            <button type="button" className="t-caption text-primary underline" onClick={() => setSheet('exists')}>Already shared this one?</button>
          </div>
        </Sheet>
      )}
      {sheet === 'exists' && (
        <Sheet title="A link already exists" onClose={close}>
          <p className="t-body text-text-muted">We can't show the earlier code again on this device. Create a new link and the old one stops working.</p>
          <div className="mt-5 flex flex-col gap-2">
            <BigButton onClick={() => setSheet('share')}>Create new link</BigButton>
            <BigButton variant="tertiary" onClick={close}>Cancel</BigButton>
          </div>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Sheet title="Delete this photo?" onClose={close}>
          <p className="t-body text-text-muted">This can't be undone. Any shared link to it will stop working.</p>
          <div className="mt-5 flex gap-2">
            <BigButton variant="secondary" onClick={close}>Cancel</BigButton>
            <BigButton variant="destructive" icon={Trash2} onClick={() => { toast({ tone: 'success', title: 'Photo deleted' }); navigate('/app/account/creations') }}>Delete</BigButton>
          </div>
        </Sheet>
      )}
    </Page>
  )
}
