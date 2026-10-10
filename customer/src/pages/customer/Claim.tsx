import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ban, Check, ChevronRight, Clock, Info, Loader2, Lock, Zap } from 'lucide-react'
import { Chip, cn, InlineAlert, Thumb } from '../../components/ui'
import { BigButton, CatalogCard, Logo, ModeCard, ModeBadge, Page, StatusBlock, StickyCta } from '../../components/customer'
import { artStyles, creations, kioskSession } from '../../data/customer'

/** Steps: claiming → home → photo | photos → style → (processing) · history · 403/409/410 errors. */
type Step = 'claiming' | 'home' | 'photo' | 'photos' | 'style' | 'history' | '403' | '409' | '410'

function ClaimHeader({ session }: { session: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className={cn('mx-auto flex h-14 w-full max-w-xl items-center px-4', session ? 'justify-between' : 'justify-center')}>
        <Logo />
        {session && (
          <span className="t-label-s inline-flex h-8 items-center gap-1.5 rounded-full bg-warning-soft px-3 text-warning">
            <Clock size={16} aria-hidden />
            Ends in {kioskSession.endsIn}
          </span>
        )}
      </div>
      {session && (
        <div className="bg-accent-soft">
          <p className="t-body-s mx-auto flex max-w-xl items-center gap-2 px-4 py-2.5">
            <Zap size={16} className="text-accent" aria-hidden />
            {kioskSession.creationsLeft} AI creations left · Classic unlimited
          </p>
        </div>
      )}
    </header>
  )
}

export function Claim() {
  const { code = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const step = (params.get('step') as Step) || (code === 'used' ? '409' : code === 'old' ? '410' : code === 'bad' ? '403' : 'claiming')
  const go = (s: Step) => setParams({ step: s }, { replace: false })

  // Claiming is a short, polling-only state.
  useEffect(() => {
    if (step !== 'claiming' || params.has('hold')) return
    const t = window.setTimeout(() => setParams({ step: 'home' }, { replace: true }), 1600)
    return () => window.clearTimeout(t)
  }, [step, params, setParams])

  if (step === 'claiming')
    return (
      <div className="min-h-screen bg-bg">
        <ClaimHeader session={false} />
        <StatusBlock icon={Loader2} title="Getting your photos…" body="Keep this page open." />
      </div>
    )

  if (step === '409' || step === '410' || step === '403') {
    const e = {
      '409': { icon: Ban, tone: 'warning' as const, title: 'Already opened on another device', body: 'This session is in use on another phone.' },
      '410': { icon: Clock, tone: 'info' as const, title: 'This session has expired', body: 'Kiosk sessions last 24 hours.' },
      '403': { icon: Ban, tone: 'danger' as const, title: "This link isn't valid", body: 'Scan the QR code on the kiosk again.' },
    }[step]
    return (
      <div className="min-h-screen bg-bg">
        <ClaimHeader session={false} />
        <StatusBlock icon={e.icon} tone={e.tone} title={e.title} body={e.body}>
          <p className="t-caption text-text-muted">Ask the booth staff for a new code.</p>
        </StatusBlock>
      </div>
    )
  }

  const nav = (
    <div role="tablist" className="mx-auto flex w-full max-w-xl gap-1 rounded-md bg-surface-2 p-1">
      {(['home', 'history'] as const).map((t) => (
        <button key={t} role="tab" aria-selected={step === t || (t === 'home' && step !== 'history')} onClick={() => go(t)} className={cn('t-label-s h-9 flex-1 rounded-sm', (step === t || (t === 'home' && step !== 'history')) ? 'bg-surface shadow-e1' : 'text-text-muted')}>
          {t === 'home' ? 'Create' : 'History'}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-bg">
      <ClaimHeader session />
      <Page narrow className="space-y-4 pt-3">
        {nav}
        {step === 'home' && <Home go={go} />}
        {step === 'photo' && <PickPhotos go={go} count={1} />}
        {step === 'photos' && <PickPhotos go={go} count={3} />}
        {step === 'style' && <Style onCreate={() => navigate('/app/processing?state=queued')} />}
        {step === 'history' && <History />}
      </Page>
    </div>
  )
}

function Home({ go }: { go: (s: Step) => void }) {
  const photos = [0, 1, 2, 3]
  return (
    <div className="space-y-4">
      <section aria-labelledby="kp" className="space-y-2">
        <h2 id="kp" className="t-h4">Your kiosk photos</h2>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p) => (
            <Thumb key={p} seed={p + 2} alt={`Kiosk photo ${p + 1}`} className="aspect-[82/110] w-full" />
          ))}
        </div>
      </section>
      <h2 className="t-h3">What would you like to make?</h2>
      <ModeCard mode="classic" onClick={() => go('photos')} />
      <ModeCard mode="advanced" onClick={() => go('photo')} />
      <p className="t-caption text-text-muted">This event offers Classic and Advanced.</p>
    </div>
  )
}

function PickPhotos({ go, count }: { go: (s: Step) => void; count: 1 | 3 }) {
  const [picked, setPicked] = useState<number[]>(count === 1 ? [0] : [0, 1, 3])
  const toggle = (i: number) => {
    if (count === 1) return setPicked([i])
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 3 ? [...p, i] : p))
  }
  return (
    <div className="space-y-4 pb-28">
      <div>
        <h1 className="t-h2">{count === 1 ? 'Choose a photo' : 'Choose 3 photos'}</h1>
        <p className="t-body-s mt-1 text-text-muted">{count === 1 ? 'Pick one for your AI portrait.' : 'Tap in the order you want them on the strip.'}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => {
          const order = picked.indexOf(i)
          const on = order >= 0
          return (
            <button key={i} type="button" aria-pressed={on} onClick={() => toggle(i)} className={cn('relative overflow-hidden rounded-md border-[3px]', on ? 'border-primary' : 'border-transparent')}>
              <Thumb seed={i + 2} alt={`Photo ${i + 1}`} className="aspect-[171/228] w-full !rounded-none" />
              {on && (
                <span className="t-label-xs absolute right-2 top-2 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary text-white">
                  {count === 1 ? <Check size={14} aria-hidden /> : order + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <StickyCta note={count === 3 ? `${picked.length} of 3 selected` : undefined}>
        <BigButton disabled={picked.length !== count} onClick={() => (count === 1 ? go('style') : window.history.length ? go('history') : undefined)}>
          Continue
        </BigButton>
      </StickyCta>
    </div>
  )
}

function Style({ onCreate }: { onCreate: () => void }) {
  const list = artStyles.filter((s) => ['space-commander', 'enchanted-forest'].includes(s.id))
  const [sel, setSel] = useState(list[0].id)
  return (
    <div className="space-y-4 pb-28">
      <h1 className="t-h2">Choose an art style</h1>
      <InlineAlert tone="info" title={undefined}>
        <span className="flex items-center gap-2"><Info size={16} aria-hidden />This event has a curated set of styles.</span>
      </InlineAlert>
      <div className="grid grid-cols-2 gap-4">
        {list.map((s) => (
          <CatalogCard key={s.id} title={s.name} blurb={s.blurb} seed={s.seed} tag={s.category} selected={s.id === sel} onSelect={() => setSel(s.id)} />
        ))}
      </div>
      <StickyCta>
        <BigButton icon={Zap} onClick={onCreate}>Create my photo</BigButton>
      </StickyCta>
    </div>
  )
}

function History() {
  const rows = creations.filter((c) => ['c1', 'c3', 'c2', 'c4'].includes(c.id))
  return (
    <ul className="space-y-3">
      {rows.map((c) => (
        <li key={c.id}>
          <Link to={c.status === 'processing' ? '/app/processing?state=processing&hold' : '/app/result/ai'} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
            <Thumb seed={c.seed} alt="" className="h-[72px] w-12 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="t-label-s truncate">{c.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <ModeBadge mode={c.mode} />
                <Chip tone={c.status === 'completed' ? 'success' : c.status === 'processing' ? 'info' : 'danger'} icon={c.status === 'completed' ? Check : c.status === 'processing' ? Loader2 : Ban}>
                  {c.status === 'completed' ? 'Completed' : c.status === 'processing' ? 'Creating' : 'Failed'}
                </Chip>
              </div>
              <p className="t-caption text-text-muted">{c.status === 'failed' ? `${c.when} · Credit returned` : c.status === 'completed' ? '17:42 · Tap to view' : '17:44'}</p>
            </div>
            <ChevronRight size={18} className="text-text-muted" aria-hidden />
          </Link>
        </li>
      ))}
      <li className="t-caption flex items-center gap-1.5 text-text-muted"><Lock size={12} aria-hidden />Only event-allowed modes and styles appear.</li>
    </ul>
  )
}
