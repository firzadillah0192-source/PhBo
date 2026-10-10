import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Info, Pencil, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Button, cn, InlineAlert, Thumb } from '../../components/ui'
import {
  BigButton,
  CatalogCard,
  FilterChip,
  ModeBadge,
  ModeCard,
  Page,
  PhotoDropzone,
  Sheet,
  Stepper,
  StickyCta,
} from '../../components/customer'
import { artStyles, classicLayouts, frameStyles, howItWorks, type Mode, modes, ornaments, styleCategories, templates } from '../../data/customer'
import { useCustomer } from '../../lib/customer'

const NO_CREDITS = 'No AI credits left. Sign up or try Classic.'

/* ───────────── 1 · Home (+ 9a/9b out of credits) ───────────── */

export function Home() {
  const { credits, signedIn, setMode } = useCustomer()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(false)
  const out = credits === 0

  const start = (m: Mode) => {
    setMode(m)
    navigate(m === 'classic' ? '/app/create/layout' : '/app/create/photo')
  }

  return (
    <Page>
      <section className="grid gap-6 md:grid-cols-[1fr_420px] md:items-center md:gap-12 md:py-8">
        <div className="space-y-2 pt-2 md:space-y-4">
          {!out && <span className="t-label-s hidden w-fit rounded-full bg-accent-soft px-3 py-1 md:inline-flex">Free to try · {credits} AI credits</span>}
          <h1 className="t-h1 md:t-display">Make your photobooth moment</h1>
          <p className="t-body text-text-muted md:t-body-l">
            Turn your photo into a print-ready strip or an AI portrait in about a minute.<span className="hidden md:inline"> No app to install.</span>
          </p>
          <div className="hidden gap-3 pt-2 md:flex">
            <Button className="!h-12 !rounded-md px-6 !text-base" onClick={() => (out ? setSheet(true) : start('basic'))}>
              Start creating
            </Button>
            {!signedIn && (
              <Link to="/app/signup" className="t-label inline-flex h-12 items-center rounded-md px-5 text-primary hover:bg-primary-soft">
                Create a free account
              </Link>
            )}
          </div>
          <p className="t-caption hidden text-text-muted md:block">Uploads are kept for 24 hours, then removed.</p>
        </div>
      </section>

      <section aria-labelledby="modes" className="mt-4 space-y-3 md:mt-8">
        <h2 id="modes" className="t-h3 hidden md:block">Choose a mode</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <ModeCard mode="classic" onClick={() => start('classic')} />
          <ModeCard mode="basic" disabledNote={out ? NO_CREDITS : undefined} onClick={() => start('basic')} />
          <ModeCard mode="advanced" disabledNote={out ? NO_CREDITS : undefined} onClick={() => start('advanced')} />
        </div>
        {!signedIn && !out && <p className="t-body-s rounded-md bg-primary-soft p-3 text-primary">Create a free account to get 5 AI credits and keep your creations.</p>}
      </section>

      <section aria-labelledby="how" className="mt-8 space-y-4">
        <h2 id="how" className="t-h3">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {howItWorks.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 md:flex-col md:rounded-md md:border md:border-border md:bg-surface md:p-5">
              <span className="t-label-s flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">{i + 1}</span>
              <div>
                <p className="t-label">{s.title}</p>
                <p className="t-body-s text-text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="t-caption text-text-muted md:hidden">Uploads are kept for 24 hours, then removed.</p>
      </section>

      {out && !sheet && (
        <StickyCta>
          <BigButton onClick={() => setSheet(true)}>Create with AI</BigButton>
        </StickyCta>
      )}
      {sheet && <OutOfCreditsSheet signedIn={signedIn} onClose={() => setSheet(false)} onClassic={() => start('classic')} />}
    </Page>
  )
}

/** 9a (guest) and 9b (account) share one sheet; copy differs by sign-in state. */
export function OutOfCreditsSheet({ signedIn, onClose, onClassic }: { signedIn: boolean; onClose: () => void; onClassic: () => void }) {
  const navigate = useNavigate()
  return (
    <Sheet title={signedIn ? "You've used your credits" : "You're out of AI credits"} onClose={onClose}>
      {signedIn ? (
        <div className="space-y-4">
          <p className="t-body text-text-muted">Classic photo strips are always free.</p>
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between">
              <p className="t-label-s">Free plan</p>
              <span className="t-caption text-text-muted">5 of 5 used</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full w-full rounded-full bg-warning" />
            </div>
            <p className="t-caption mt-2 text-text-muted">Paid plans are coming soon. No payment is needed today.</p>
          </div>
          <div className="flex flex-col gap-2">
            <BigButton onClick={onClassic}>Try Classic — free</BigButton>
            <BigButton variant="tertiary" onClick={onClose}>Not now</BigButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="t-body text-text-muted">Create a free account for 5 more credits. Your photos come with you.</p>
          <div className="flex flex-col gap-3">
            <BigButton onClick={() => navigate('/app/signup')}>Sign up free</BigButton>
            <BigButton variant="secondary">Continue with Google</BigButton>
            <p className="t-caption text-center text-text-muted">or</p>
            <BigButton variant="tertiary" onClick={onClassic}>Try Classic — free</BigButton>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/* ───────────── Flow chrome ───────────── */

function FlowHeader({ steps, current, title, subtitle }: { steps: string[]; current: number; title: string; subtitle?: string }) {
  const { mode } = useCustomer()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper steps={steps} current={current} />
        <ModeBadge mode={mode} />
      </div>
      <div>
        <h1 className="t-h2">{title}</h1>
        {subtitle && <p className="t-body-s mt-1 text-text-muted">{subtitle}</p>}
      </div>
    </div>
  )
}

const aiSteps = ['Photo', 'Style', 'Review']
const classicSteps = ['Layout', 'Photos', 'Review']

/* ───────────── 2 · Photo ───────────── */

export function CreatePhoto() {
  const { hasPhoto, setHasPhoto } = useCustomer()
  const navigate = useNavigate()
  return (
    <Page narrow>
      <FlowHeader
        steps={aiSteps}
        current={0}
        title={hasPhoto ? 'Looking good' : 'Add your photo'}
        subtitle={hasPhoto ? 'You can replace it before continuing.' : 'A clear, front-facing photo works best.'}
      />
      <div className="mt-5 space-y-4">
        {hasPhoto ? (
          <div className="flex items-center gap-4 rounded-md border border-border bg-surface p-3">
            <Thumb seed={0} alt="Your photo" className="h-24 w-[72px] shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="t-label-s flex items-center gap-1.5 text-success">
                <Check size={16} aria-hidden />
                Photo ready
              </p>
              <p className="t-caption text-text-muted">3024 × 4032 · Kept for 24 h</p>
            </div>
            <Button variant="secondary" icon={RefreshCw} onClick={() => setHasPhoto(false)}>
              Replace
            </Button>
          </div>
        ) : (
          <>
            <PhotoDropzone onTake={() => setHasPhoto(true)} onUpload={() => setHasPhoto(true)} />
            <p className="t-caption text-center text-text-muted">We'll ask for camera access only to take your photo here. You can always upload instead.</p>
          </>
        )}
      </div>
      <StickyCta>
        <BigButton disabled={!hasPhoto} onClick={() => navigate('/app/create/style')}>
          Continue
        </BigButton>
      </StickyCta>
    </Page>
  )
}

/* ───────────── 3 · Basic style  /  4 · Advanced style ───────────── */

export function CreateStyle() {
  const { mode } = useCustomer()
  return mode === 'advanced' ? <AdvancedStyle /> : <BasicStyle />
}

function BasicStyle() {
  const { templateId, setTemplateId } = useCustomer()
  const navigate = useNavigate()
  const chosen = templates.find((t) => t.id === templateId)
  return (
    <Page>
      <FlowHeader steps={aiSteps} current={1} title="Pick a template" subtitle="Your face is blended into the scene." />
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {templates.map((t) => (
          <CatalogCard key={t.id} title={t.name} blurb={t.blurb} seed={t.seed} disabled={!t.available} selected={t.id === templateId} onSelect={() => setTemplateId(t.id)} />
        ))}
      </div>
      <StickyCta note={chosen ? `${chosen.name} selected` : undefined}>
        <BigButton onClick={() => navigate('/app/create/review')}>Continue</BigButton>
      </StickyCta>
    </Page>
  )
}

function AdvancedStyle() {
  const { styleId, setStyleId, frameId, setFrameId, ornaments: picked, setOrnaments } = useCustomer()
  const navigate = useNavigate()
  const [cat, setCat] = useState<(typeof styleCategories)[number]>('All')
  const list = artStyles.filter((s) => cat === 'All' || s.category === cat)
  const toggle = (name: string) => {
    if (picked.includes(name)) setOrnaments(picked.filter((p) => p !== name))
    else if (picked.length < 3) setOrnaments([...picked, name])
  }
  return (
    <Page>
      <FlowHeader steps={aiSteps} current={1} title="Choose an art style" />
      <div role="group" aria-label="Style category" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {styleCategories.map((c) => (
          <FilterChip key={c} label={c} selected={c === cat} onClick={() => setCat(c)} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.map((s) => (
          <CatalogCard key={s.id} title={s.name} blurb={s.blurb} seed={s.seed} tag={s.category} disabled={!s.available} selected={s.id === styleId} onSelect={() => setStyleId(s.id)} />
        ))}
      </div>

      <section className="mt-8 space-y-3" aria-labelledby="frame">
        <h2 id="frame" className="t-h4">Frame style</h2>
        <div role="radiogroup" aria-labelledby="frame" className="grid gap-3 md:grid-cols-3">
          {frameStyles.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={frameId === f.id}
              disabled={!f.available}
              onClick={() => setFrameId(f.id)}
              className={cn(
                'flex items-center gap-3 rounded-md border bg-surface p-3 text-left',
                frameId === f.id ? 'border-2 border-primary' : 'border-border',
                !f.available && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', frameId === f.id ? 'border-primary' : 'border-border')}>
                {frameId === f.id && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="t-label-s block">{f.name}</span>
                <span className="t-caption block text-text-muted">{f.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 space-y-3" aria-labelledby="orn">
        <div className="flex items-baseline justify-between">
          <h2 id="orn" className="t-h4">Ornaments</h2>
          <span className="t-caption text-text-muted">{picked.length}/3 selected</span>
        </div>
        <p className="t-body-s text-text-muted">Optional finishing touches.</p>
        <div className="flex flex-wrap gap-2">
          {ornaments.map((o) => (
            <FilterChip key={o} label={o} selected={picked.includes(o)} disabled={!picked.includes(o) && picked.length >= 3} onClick={() => toggle(o)} />
          ))}
        </div>
      </section>

      <StickyCta>
        <BigButton onClick={() => navigate('/app/create/review')}>Continue</BigButton>
      </StickyCta>
    </Page>
  )
}

/* ───────────── 5a · Classic layout  /  5b · Classic photos ───────────── */

export function ClassicLayoutPick() {
  const { layoutId, setLayoutId } = useCustomer()
  const navigate = useNavigate()
  return (
    <Page>
      <FlowHeader steps={classicSteps} current={0} title="Pick a strip layout" subtitle="Free · prints at 2×6 in." />
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {classicLayouts.map((l) => (
          <div key={l.id} className="space-y-1">
            <CatalogCard title={l.name} blurb={`Classic · ${l.shots} shots`} seed={l.seed} tag={l.tag} tall selected={l.id === layoutId} onSelect={() => setLayoutId(l.id)} />
          </div>
        ))}
      </div>
      <StickyCta>
        <BigButton onClick={() => navigate('/app/create/classic-photos')}>Continue</BigButton>
      </StickyCta>
    </Page>
  )
}

export function ClassicPhotos() {
  const { classicPhotos, setClassicPhotos, layoutId } = useCustomer()
  const navigate = useNavigate()
  const need = classicLayouts.find((l) => l.id === layoutId)?.shots ?? 3
  const target = Math.min(need, 3)
  const slots = Array.from({ length: target })
  const remaining = Math.max(target - classicPhotos, 0)
  return (
    <Page narrow>
      <FlowHeader steps={classicSteps} current={1} title={`Add ${target} photos`} subtitle="They appear top to bottom in this order." />
      <ol className="mt-5 space-y-3">
        {slots.map((_, i) => {
          const filled = i < classicPhotos
          return (
            <li key={i} className="flex items-center gap-4 rounded-md border border-border bg-surface p-3">
              <span className="t-label-xs flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">{i + 1}</span>
              {filled ? <Thumb seed={i + 3} alt={`Photo ${i + 1}`} className="h-16 w-20 shrink-0" /> : <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted"><Plus size={20} aria-hidden /></div>}
              <div className="min-w-0 flex-1">
                <p className="t-label-s">Photo {i + 1}</p>
                <p className="t-caption text-text-muted">{filled ? 'Tap to retake' : 'Take or upload'}</p>
              </div>
              {filled ? (
                <Button variant="tertiary" icon={RefreshCw} onClick={() => setClassicPhotos(Math.max(classicPhotos - 1, 0))}>
                  Retake
                </Button>
              ) : i === classicPhotos ? (
                <Button icon={Plus} onClick={() => setClassicPhotos(classicPhotos + 1)}>
                  Take photo
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
      {remaining > 0 && <p className="t-caption mt-3 text-center text-text-muted">or upload from your device</p>}
      <StickyCta note={remaining > 0 ? `Add ${remaining} more photo${remaining > 1 ? 's' : ''} to continue` : undefined}>
        <BigButton disabled={remaining > 0} onClick={() => navigate('/app/create/review')}>
          Continue
        </BigButton>
      </StickyCta>
    </Page>
  )
}

/* ───────────── 6 · Review ───────────── */

export function CreateReview() {
  const { mode, credits, templateId, styleId, layoutId } = useCustomer()
  const navigate = useNavigate()
  const isClassic = mode === 'classic'
  const title = isClassic
    ? classicLayouts.find((l) => l.id === layoutId)?.name
    : mode === 'advanced'
      ? artStyles.find((s) => s.id === styleId)?.name
      : templates.find((t) => t.id === templateId)?.name
  const cost = isClassic ? 0 : 1
  const create = () => navigate('/app/processing?state=queued')
  return (
    <Page narrow>
      <FlowHeader steps={isClassic ? classicSteps : aiSteps} current={2} title="Review" />
      <div className="mt-5 space-y-3">
        <SummaryRow thumbSeed={0} title="Your photo" body={isClassic ? 'Photos · kept for 24 h' : '1 photo · kept for 24 h'} action="Replace" to={isClassic ? '/app/create/classic-photos' : '/app/create/photo'} />
        <SummaryRow thumbSeed={3} title={title ?? ''} body={`${modes[mode].name} · ${modes[mode].blurb}`} action="Change" to={isClassic ? '/app/create/layout' : '/app/create/style'} />
        {cost > 0 ? (
          <div className="rounded-md bg-accent-soft p-4">
            <p className="t-label-s flex items-center gap-2"><Sparkles size={16} aria-hidden />Uses 1 AI credit</p>
            <p className="t-caption mt-0.5 text-text-muted">{Math.max(credits - 1, 0)} left after · returned if it fails</p>
          </div>
        ) : (
          <InlineAlert tone="success">Classic is free. No credits are used.</InlineAlert>
        )}
        {!isClassic && (
          <p className="t-caption flex items-start gap-2 text-text-muted">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            The result is an AI portrait that resembles you. It is not an exact copy of your face.
          </p>
        )}
      </div>
      <StickyCta>
        <BigButton icon={isClassic ? undefined : Sparkles} onClick={create}>
          {isClassic ? 'Create my strip' : 'Create my photo'}
        </BigButton>
      </StickyCta>
    </Page>
  )
}

function SummaryRow({ thumbSeed, title, body, action, to }: { thumbSeed: number; title: string; body: string; action: string; to: string }) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-surface p-3">
      <Thumb seed={thumbSeed} alt="" className="h-16 w-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="t-label-s truncate">{title}</p>
        <p className="t-caption text-text-muted">{body}</p>
      </div>
      <Link to={to} className="t-label-s inline-flex h-8 items-center gap-1 rounded-sm px-2.5 text-primary hover:bg-primary-soft">
        <Pencil size={14} aria-hidden />
        {action}
      </Link>
    </div>
  )
}
