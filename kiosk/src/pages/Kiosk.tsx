import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Camera, Check, ChevronRight, Clock, Film, RotateCcw, Sparkles, SquareUser, Upload, Zap } from 'lucide-react'
import { cn, Thumb } from '../components/ui'
import { Logo, QrPlaceholder } from '../components/brand'
import { artStyles } from '../data/customer'

/**
 * Web kiosk — 1080 × 1920 portrait, dark stage. Operator-gated.
 * 96 px touch targets, text ×1.5, persistent "Start over", idle reset with an "I'm still here" extension.
 */

type Step = 'signin' | 'attract' | 'mode' | 'camera' | 'style' | 'processing' | 'result' | 'idle'
const STEP_NO: Partial<Record<Step, number>> = { mode: 1, camera: 2, style: 3, result: 4, idle: 4 }
const STEP_NAME: Record<number, string> = { 1: 'Mode', 2: 'Photo', 3: 'Style', 4: 'Result' }

const IDLE_AFTER_S = 20
const IDLE_COUNTDOWN_S = 15

/* ───────────── Stage that scales a fixed 1080 × 1920 canvas to the window ───────────── */

function useFit() {
  const calc = () => Math.min(window.innerWidth / 1080, window.innerHeight / 1920)
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const on = () => setScale(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return scale
}

function Stage({ children }: { children: ReactNode }) {
  const scale = useFit()
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <div style={{ width: 1080 * scale, height: 1920 * scale }}>
        <div className="relative flex origin-top-left flex-col overflow-hidden bg-stage-bg text-stage-text" style={{ width: 1080, height: 1920, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ───────────── Kiosk primitives ───────────── */

function KButton({ children, icon: Icon, variant = 'primary', onClick, className, disabled }: { children: ReactNode; icon?: typeof Zap; variant?: 'primary' | 'secondary'; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-24 items-center justify-center gap-4 whitespace-nowrap rounded-[20px] px-10 text-2xl font-semibold transition-opacity active:opacity-80 disabled:opacity-40',
        variant === 'primary' ? 'bg-stage-primary text-stage-bg' : 'bg-stage-surface text-stage-text',
        className,
      )}
    >
      {Icon && <Icon size={32} aria-hidden />}
      {children}
    </button>
  )
}

function KHeader({ step, onStartOver }: { step: Step; onStartOver: () => void }) {
  const n = STEP_NO[step] ?? 1
  return (
    <div className="flex flex-col gap-8">
      <div className="flex h-24 items-center justify-between">
        <Logo dark />
        <KButton variant="secondary" icon={RotateCcw} onClick={onStartOver} className="w-[234px] shrink-0 !gap-3 !px-6">
          Start over
        </KButton>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex gap-3" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={n}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn('h-2.5 flex-1 rounded-full', i <= n ? 'bg-stage-primary' : 'bg-stage-surface-2')} />
          ))}
        </div>
        <p className="text-2xl text-stage-muted">Step {n} of 4 · {STEP_NAME[n]}</p>
      </div>
    </div>
  )
}

function Screen({ children, gap = 'gap-10' }: { children: ReactNode; gap?: string }) {
  return <div className={cn('flex h-full flex-col p-16', gap)}>{children}</div>
}

const H1 = ({ children }: { children: ReactNode }) => <h1 className="font-display text-[54px] font-bold leading-[66px]">{children}</h1>
const Muted = ({ children }: { children: ReactNode }) => <p className="text-2xl text-stage-muted">{children}</p>

function BrandRow() {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stage-primary text-stage-bg"><Zap size={32} aria-hidden /></span>
      <span className="font-display text-[32px] font-semibold">NXBooth</span>
    </div>
  )
}

/* ───────────── Screens ───────────── */

function OperatorSignIn({ onAuthorised }: { onAuthorised: () => void }) {
  const [denied, setDenied] = useState(true)
  return (
    <Screen gap="gap-12">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex w-[760px] flex-col gap-8 rounded-[32px] bg-stage-surface p-16">
          <BrandRow />
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-[42px] font-bold leading-[54px]">Kiosk sign-in</h1>
            <Muted>Staff only. Sign in with the authorised Google account to unlock this kiosk.</Muted>
          </div>
          <KButton variant="secondary" onClick={() => (denied ? setDenied(false) : onAuthorised())} className="border border-stage-border">
            Continue with Google
          </KButton>
          {denied && (
            <div role="alert" className="flex items-center gap-4 rounded-2xl bg-stage-danger-soft p-6">
              <Ban size={32} className="shrink-0 text-stage-danger" aria-hidden />
              <p className="text-2xl">This account does not have kiosk access.</p>
            </div>
          )}
        </div>
      </div>
    </Screen>
  )
}

function Collage() {
  return (
    <div className="flex items-center justify-center gap-8" aria-hidden>
      <div className="h-[450px] w-[300px] overflow-hidden rounded-[28px]"><Thumb seed={9} className="h-full w-full !rounded-none" /></div>
      <div className="flex w-[200px] flex-col gap-3.5 rounded-md bg-white p-3.5">
        {[2, 6, 4].map((s) => (
          <div key={s} className="h-[161px] overflow-hidden rounded-[3px]"><Thumb seed={s} className="h-full w-full !rounded-none" /></div>
        ))}
      </div>
      <div className="h-[450px] w-[300px] overflow-hidden rounded-[28px]"><Thumb seed={3} className="h-full w-full !rounded-none" /></div>
    </div>
  )
}

function Attract({ onStart }: { onStart: () => void }) {
  return (
    <button type="button" onClick={onStart} aria-label="Tap to start" className="flex h-full w-full flex-col items-center justify-between p-16 text-center">
      <div className="self-start"><BrandRow /></div>
      <Collage />
      <div className="flex flex-col items-center gap-5">
        <h1 className="font-display text-[72px] font-extrabold leading-[84px]">Make your<br />photobooth moment</h1>
        <Muted>Photo strips and AI portraits in about a minute.</Muted>
      </div>
      <span className="flex h-40 w-[600px] items-center justify-center rounded-full bg-stage-primary font-display text-[54px] font-bold text-stage-bg">Tap to start</span>
    </button>
  )
}

const modeRows = [
  { id: 'classic', name: 'Classic', blurb: 'Photo strip · 1–4 shots', price: 'Free', icon: Film, tile: 'bg-[#3a2218] text-stage-classic', chip: 'bg-stage-success-soft text-stage-success' },
  { id: 'basic', name: 'Basic', blurb: 'AI themed portrait', price: '1 credit', icon: SquareUser, tile: 'bg-[#0f2e2a] text-stage-basic', chip: 'bg-stage-accent-soft text-stage-accent' },
  { id: 'advanced', name: 'Advanced', blurb: 'AI art styles', price: '1 credit', icon: Sparkles, tile: 'bg-stage-primary-soft text-stage-primary', chip: 'bg-stage-accent-soft text-stage-accent' },
]

function ModeChoice({ onPick }: { onPick: () => void }) {
  return (
    <>
      <H1>What would you like to make?</H1>
      <div className="flex flex-col gap-10">
        {modeRows.map((m) => (
          <button key={m.id} type="button" onClick={onPick} className="flex h-[244px] items-center gap-10 rounded-[28px] bg-stage-surface p-10 text-left active:opacity-80">
            <span className={cn('flex h-[140px] w-[140px] shrink-0 items-center justify-center rounded-[28px]', m.tile)}><m.icon size={72} aria-hidden /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-3">
              <span className="font-display text-[42px] font-bold leading-[54px]">{m.name}</span>
              <span className="text-2xl text-stage-muted">{m.blurb}</span>
              <span className={cn('inline-flex h-12 w-fit items-center rounded-full px-5 text-xl font-semibold', m.chip)}>{m.price}</span>
            </span>
            <ChevronRight size={56} className="shrink-0 text-stage-muted" aria-hidden />
          </button>
        ))}
      </div>
      <p className="flex items-center gap-4 text-2xl text-stage-muted"><Zap size={36} aria-hidden />2 AI credits available</p>
    </>
  )
}

function CameraCapture({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(3)
  const [run, setRun] = useState(0)
  useEffect(() => {
    setCount(3)
    const id = window.setInterval(() => setCount((c) => (c > 1 ? c - 1 : c)), 1000)
    const done = window.setTimeout(onDone, 3600)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(done)
    }
  }, [run, onDone])
  return (
    <>
      <H1>Get ready!</H1>
      <div className="relative flex h-[1190px] items-center justify-center overflow-hidden rounded-[32px] bg-stage-surface-2">
        <Thumb seed={9} className="absolute inset-0 h-full w-full opacity-60 !rounded-none" />
        <span aria-live="assertive" className="relative font-display text-[380px] font-extrabold leading-none text-white drop-shadow-lg">{count}</span>
      </div>
      <div className="flex gap-6">
        <KButton variant="secondary" icon={Upload} onClick={onDone} className="flex-1">Upload instead</KButton>
        <KButton variant="secondary" icon={Camera} onClick={() => setRun((r) => r + 1)} className="flex-1">Retake</KButton>
      </div>
    </>
  )
}

function StyleGallery({ onCreate }: { onCreate: () => void }) {
  const [sel, setSel] = useState(artStyles[0].id)
  const list = artStyles.filter((s) => s.available).slice(0, 6)
  return (
    <>
      <H1>Pick a style</H1>
      <div className="grid grid-cols-3 gap-8">
        {list.map((s) => {
          const on = s.id === sel
          return (
            <button key={s.id} type="button" aria-pressed={on} onClick={() => setSel(s.id)} className="flex flex-col gap-4 text-left">
              <span className={cn('relative block h-[444px] overflow-hidden rounded-3xl border-4', on ? 'border-stage-primary' : 'border-transparent')}>
                <Thumb seed={s.seed} alt={s.name} className="h-full w-full !rounded-none" />
                {on && <span className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-stage-primary text-stage-bg"><Check size={28} aria-hidden /></span>}
              </span>
              <span className="text-2xl font-semibold">{s.name}</span>
            </button>
          )
        })}
      </div>
      <KButton icon={Sparkles} onClick={onCreate} className="self-end">Create my photo</KButton>
    </>
  )
}

function Processing({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(8)
  useEffect(() => {
    const id = window.setInterval(() => setPct((p) => Math.min(p + 6, 96)), 400)
    const done = window.setTimeout(onDone, 5000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(done)
    }
  }, [onDone])
  return (
    <Screen gap="gap-16">
      <BrandRow />
      <div className="flex flex-1 flex-col items-center justify-center gap-16">
        <div className="h-[780px] w-[520px] overflow-hidden rounded-[32px]"><Thumb seed={9} className="h-full w-full !rounded-none opacity-80" /></div>
        <div className="flex flex-col items-center gap-5 text-center">
          <H1>Creating your photo…</H1>
          <Muted>This can take up to a minute.</Muted>
        </div>
        <div role="progressbar" aria-label="Creating" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-3 w-[600px] overflow-hidden rounded-full bg-stage-surface-2">
          <div className="h-full rounded-full bg-stage-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Screen>
  )
}

function ResultQr({ onDone }: { onDone: () => void }) {
  return (
    <>
      <div className="flex gap-12">
        <div className="h-[780px] w-[520px] shrink-0 overflow-hidden rounded-[28px]"><Thumb seed={9} alt="Your photo" className="h-full w-full !rounded-none" /></div>
        <div className="flex w-[384px] flex-col gap-7">
          <div className="rounded-2xl bg-white p-6"><QrPlaceholder size={300} dark /></div>
          <p className="font-display text-[32px] font-semibold leading-[44px]">Scan to get your photo</p>
          <p className="flex items-center gap-3 text-2xl text-stage-muted"><Clock size={32} aria-hidden />Link works for 24 hours</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <H1>Your photo is ready</H1>
        <Muted>Space Commander · Advanced</Muted>
      </div>
      <KButton icon={Check} onClick={onDone}>Done</KButton>
    </>
  )
}

function IdleDialog({ seconds, onStay }: { seconds: number; onStay: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-stage-bg/90" role="alertdialog" aria-modal="true" aria-label="Still there?">
      <div className="flex w-[800px] flex-col items-center gap-10 rounded-[40px] bg-stage-surface p-16 text-center">
        <span aria-live="polite" className="font-display text-[72px] font-extrabold leading-[84px] text-stage-accent">{seconds}</span>
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-[54px] font-bold leading-[66px]">Still there?</h2>
          <Muted>Starting over in {seconds} seconds to keep your photos private.</Muted>
        </div>
        <KButton onClick={onStay} className="w-[670px]">I'm still here</KButton>
      </div>
    </div>
  )
}

/* ───────────── Flow ───────────── */

export function Kiosk() {
  const [params, setParams] = useSearchParams()
  const step = (params.get('step') as Step) || 'attract'
  const go = useCallback((s: Step) => setParams({ step: s }, { replace: true }), [setParams])
  const startOver = useCallback(() => go('attract'), [go])
  const hold = params.has('hold')

  // Idle reset: after IDLE_AFTER_S on the result screen, warn for IDLE_COUNTDOWN_S, then start over.
  const [idleLeft, setIdleLeft] = useState(IDLE_COUNTDOWN_S)
  useEffect(() => {
    if (step !== 'result' || hold) return
    const t = window.setTimeout(() => go('idle'), IDLE_AFTER_S * 1000)
    return () => window.clearTimeout(t)
  }, [step, hold, go])
  useEffect(() => {
    if (step !== 'idle') return
    setIdleLeft(IDLE_COUNTDOWN_S)
    if (hold) return
    const id = window.setInterval(() => setIdleLeft((n) => n - 1), 1000)
    return () => window.clearInterval(id)
  }, [step, hold])
  useEffect(() => {
    if (step === 'idle' && idleLeft <= 0) startOver()
  }, [step, idleLeft, startOver])

  const showHeader = step === 'mode' || step === 'camera' || step === 'style' || step === 'result' || step === 'idle'
  const body = (() => {
    switch (step) {
      case 'signin':
        return <OperatorSignIn onAuthorised={() => go('attract')} />
      case 'attract':
        return <Attract onStart={() => go('mode')} />
      case 'processing':
        return <Processing onDone={() => go('result')} />
      default:
        return null
    }
  })()

  return (
    <Stage>
      {body ?? (
        <Screen gap={step === 'result' || step === 'idle' ? 'gap-14' : step === 'mode' ? 'gap-12' : 'gap-10'}>
          {showHeader && <KHeader step={step} onStartOver={startOver} />}
          {step === 'mode' && <ModeChoice onPick={() => go('camera')} />}
          {step === 'camera' && <CameraCapture onDone={() => go('style')} />}
          {step === 'style' && <StyleGallery onCreate={() => go('processing')} />}
          {(step === 'result' || step === 'idle') && <ResultQr onDone={startOver} />}
        </Screen>
      )}
      {step === 'idle' && <IdleDialog seconds={Math.max(idleLeft, 0)} onStay={() => go('result')} />}
    </Stage>
  )
}
